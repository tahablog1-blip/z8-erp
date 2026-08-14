# modules/inventory/service.py — منطق المخزون معزول عن طبقة الـ HTTP
# الاستعلامات منقولة من inventory.routes.js القديم بالحرف — نفس صيغة $1
#
# فرق معماري واحد مقصود عن النسخة القديمة: بدل BEGIN/COMMIT/ROLLBACK يدوي،
# بنستخدم `async with conn.transaction()` — أي استثناء (حتى HTTPException
# بتاعة "الكمية غير كافية") بيعمل ROLLBACK لوحده. مستحيل ننسى نرجّع.
import time
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting
from ...core.db import execute, fetch, fetchrow, transaction

WAREHOUSE_LOC_ID = "main"      # موقع المستودع الثابت لكل شركة
WAREHOUSE_LABEL = "المستودع الرئيسي"

_B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _base36(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = _B36[r] + s
    return s or "0"


def _new_move_no(prefix: str) -> str:
    """R-XXXX للاستلام، T-XXXX للتحويل — نفس صيغة النظام القديم بالحرف
    (Date.now().toString(36).toUpperCase())"""
    return f"{prefix}-{_base36(int(time.time() * 1000))}"


def _loc_name(loc_type: str | None, loc_id: str | None, branch_map: dict) -> str:
    if loc_type == "warehouse":
        return WAREHOUSE_LABEL
    name = branch_map.get(str(loc_id))
    return f"فرع {name}" if name else "مورد خارجي"


async def _branch_map(company_id: str) -> dict:
    rows = await fetch("SELECT id, name FROM branches WHERE company_id = $1", company_id)
    return {str(r["id"]): r["name"] for r in rows}


# ══════════════════ قراءة ══════════════════

async def list_levels(company_id: str) -> list[dict]:
    """أرصدة كل الأصناف في كل المواقع (المستودع + الفروع)"""
    rows = await fetch(
        """SELECT i.loc_type, i.loc_id, i.product_id, i.qty,
                  p.category, p.name, p.spec, p.unit, p.min_qty, p.barcode,
                  b.name AS branch_name
           FROM inventory i
           JOIN products p ON p.id = i.product_id
           LEFT JOIN branches b ON b.id::text = i.loc_id AND i.loc_type = 'branch'
           WHERE i.company_id = $1
           ORDER BY p.category, p.name, i.loc_type, branch_name""",
        company_id,
    )
    out = []
    for r in rows:
        r = dict(r)
        r["product_id"] = str(r["product_id"])
        r["loc_id"] = str(r["loc_id"])
        r["loc_name"] = (WAREHOUSE_LABEL if r["loc_type"] == "warehouse"
                         else (f"فرع {r['branch_name']}" if r["branch_name"] else "موقع محذوف"))
        # حد الانخفاض بيتحسب هنا مرة واحدة بدل ما كل واجهة تعيد حسابه بطريقتها
        r["is_low"] = bool(r["min_qty"]) and r["qty"] <= r["min_qty"]
        out.append(r)
    return out


async def get_qty(company_id: str, loc_type: str, loc_id: str, product_id: str) -> int:
    row = await fetchrow(
        """SELECT qty FROM inventory
           WHERE company_id = $1 AND loc_type = $2 AND loc_id = $3 AND product_id = $4""",
        company_id, loc_type, loc_id, product_id,
    )
    return row["qty"] if row else 0


async def list_suppliers(company_id: str) -> list[str]:
    """أسماء الموردين المستخدمة سابقاً — لاقتراحها بدل إعادة الكتابة"""
    rows = await fetch(
        """SELECT DISTINCT supplier_name FROM stock_moves
           WHERE company_id = $1 AND supplier_name IS NOT NULL AND supplier_name != ''
           ORDER BY supplier_name""",
        company_id,
    )
    return [r["supplier_name"] for r in rows]


async def list_moves(company_id: str, limit: int = 100) -> list[dict]:
    rows = await fetch(
        """SELECT id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                  product_id, product_label, unit, qty, move_no, note,
                  supplier_name, unit_cost, created_at
           FROM stock_moves WHERE company_id = $1
           ORDER BY created_at DESC LIMIT $2""",
        company_id, min(max(limit, 1), 300),
    )
    out = []
    for r in rows:
        r = dict(r)
        r["id"] = str(r["id"])
        r["product_id"] = str(r["product_id"])
        if isinstance(r.get("unit_cost"), Decimal):
            r["unit_cost"] = float(r["unit_cost"])
        out.append(r)
    return out


async def list_vouchers(company_id: str) -> list[dict]:
    """السندات مجمّعة حسب move_no — كل سند سطر واحد بملخصه"""
    rows = await fetch(
        """SELECT move_no, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                  MIN(created_at) AS created_at, COUNT(*)::int AS item_count,
                  SUM(qty)::int AS total_qty, MAX(supplier_name) AS supplier_name
           FROM stock_moves WHERE company_id = $1
           GROUP BY move_no, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id
           ORDER BY MIN(created_at) DESC LIMIT 100""",
        company_id,
    )
    bmap = await _branch_map(company_id)
    return [{
        "moveNo": r["move_no"],
        "type": r["move_type"],
        "from": (_loc_name(r["from_loc_type"], r["from_loc_id"], bmap) if r["from_loc_type"]
                 else (r["supplier_name"] or "مورد خارجي (بدون اسم)")),
        "to": _loc_name(r["to_loc_type"], r["to_loc_id"], bmap),
        "createdAt": r["created_at"],
        "itemCount": r["item_count"],
        "totalQty": r["total_qty"],
    } for r in rows]


async def get_voucher(company_id: str, move_no: str) -> dict:
    rows = await fetch(
        """SELECT sm.*, p.barcode
           FROM stock_moves sm LEFT JOIN products p ON p.id = sm.product_id
           WHERE sm.company_id = $1 AND sm.move_no = $2
           ORDER BY sm.created_at""",
        company_id, move_no,
    )
    if not rows:
        raise HTTPException(404, "السند غير موجود")

    bmap = await _branch_map(company_id)
    first = rows[0]
    return {
        "moveNo": first["move_no"],
        "type": first["move_type"],
        "fromLocType": first["from_loc_type"],
        "fromLocId": first["from_loc_id"],
        "toLocType": first["to_loc_type"],
        "toLocId": first["to_loc_id"],
        "from": (_loc_name(first["from_loc_type"], first["from_loc_id"], bmap)
                 if first["from_loc_type"] else (first["supplier_name"] or "مورد خارجي (بدون اسم)")),
        "to": _loc_name(first["to_loc_type"], first["to_loc_id"], bmap),
        "createdAt": first["created_at"],
        "note": first["note"],
        "supplierName": first["supplier_name"],
        "items": [{
            "productId": str(m["product_id"]),
            "productLabel": m["product_label"],
            "barcode": m["barcode"],
            "qty": m["qty"],
        } for m in rows],
    }


# ══════════════════ كتابة ══════════════════

async def receive(company_id: str, user_id: str, actor_name: str,
                  items: list[dict], supplier_name: str | None, note: str | None) -> dict:
    """استلام من مورد خارجي إلى المستودع — يدعم عدة أصناف في سند واحد،
    وبيقيّد القيد المحاسبي تلقائياً: مدين المخزون / دائن الموردين."""
    move_no = _new_move_no("R")

    async with transaction() as conn:
        async with conn.transaction():
            for it in items:
                await conn.execute(
                    """INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty)
                       VALUES ($1, 'warehouse', $2, $3, $4)
                       ON CONFLICT (loc_type, loc_id, product_id)
                       DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = now()""",
                    company_id, WAREHOUSE_LOC_ID, it["productId"], it["qty"],
                )
                await conn.execute(
                    """INSERT INTO stock_moves
                         (company_id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                          product_id, product_label, qty, move_no, note, supplier_name,
                          created_by, unit_cost)
                       VALUES ($1,'receive',NULL,NULL,'warehouse',$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    company_id, WAREHOUSE_LOC_ID, it["productId"], it["productLabel"],
                    it["qty"], move_no, note, supplier_name, user_id,
                    Decimal(str(it["unitCost"])) if it.get("unitCost") else None,
                )
                # آخر سعر تكلفة مسجّل للصنف — بيُستخدم بعدين لاحتساب تكلفة البضاعة المباعة
                if it.get("unitCost", 0) > 0:
                    await conn.execute(
                        "UPDATE products SET cost_price = $1 WHERE id = $2 AND company_id = $3",
                        Decimal(str(it["unitCost"])), it["productId"], company_id,
                    )

            # ── القيد المحاسبي التلقائي ──
            total_cost = sum(accounting.dec(it.get("unitCost")) * it["qty"] for it in items)
            if total_cost > 0:
                inv_acc = await accounting.get_account_id(
                    conn, company_id, accounting.ACCOUNT_CODES["INVENTORY"])
                pay_acc = await accounting.get_account_id(
                    conn, company_id, accounting.ACCOUNT_CODES["PAYABLES"])
                await accounting.post_journal_entry(
                    conn,
                    company_id=company_id,
                    source_type="stock_receive",
                    source_id=move_no,
                    description=("استلام بضاعة من مورد"
                                 + (f" — {supplier_name}" if supplier_name else "")
                                 + f" (سند {move_no})"),
                    user_id=user_id,
                    lines=[
                        {"account_id": inv_acc, "debit": total_cost,
                         "description": "زيادة قيمة المخزون"},
                        {"account_id": pay_acc, "credit": total_cost,
                         "description": "مستحق للمورد"},
                    ],
                )

            await conn.execute(
                """INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,'stock_receive','stock',$4)""",
                company_id, user_id, actor_name, f"{len(items)} صنف — سند {move_no}",
            )

    return {"success": True, "moveNo": move_no, "itemCount": len(items)}


async def transfer(company_id: str, user_id: str, actor_name: str, d: dict) -> dict:
    """تحويل داخلي بين أي موقعين (مستودع↔فرع أو فرع↔فرع)"""
    if d["fromLocType"] == d["toLocType"] and str(d["fromLocId"]) == str(d["toLocId"]):
        raise HTTPException(400, "لا يمكن التحويل من الموقع إلى نفسه")

    move_no = _new_move_no("T")

    async with transaction() as conn:
        async with conn.transaction():
            for it in d["items"]:
                # FOR UPDATE بيقفل السطر لحد نهاية الـ transaction —
                # سندين بيسحبوا نفس الصنف في نفس اللحظة ما يقدروش يوصّلوا الرصيد لسالب.
                row = await conn.fetchrow(
                    """SELECT qty FROM inventory
                       WHERE company_id=$1 AND loc_type=$2 AND loc_id=$3 AND product_id=$4
                       FOR UPDATE""",
                    company_id, d["fromLocType"], d["fromLocId"], it["productId"],
                )
                current = row["qty"] if row else 0
                if current < it["qty"]:
                    raise HTTPException(
                        409, f"الكمية غير كافية في المصدر للصنف: {it['productLabel']} "
                             f"(المتاح {current})")

                await conn.execute(
                    """UPDATE inventory SET qty = qty - $1, updated_at = now()
                       WHERE company_id=$2 AND loc_type=$3 AND loc_id=$4 AND product_id=$5""",
                    it["qty"], company_id, d["fromLocType"], d["fromLocId"], it["productId"],
                )
                await conn.execute(
                    """INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty)
                       VALUES ($1,$2,$3,$4,$5)
                       ON CONFLICT (loc_type, loc_id, product_id)
                       DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = now()""",
                    company_id, d["toLocType"], d["toLocId"], it["productId"], it["qty"],
                )
                await conn.execute(
                    """INSERT INTO stock_moves
                         (company_id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                          product_id, product_label, qty, move_no, note, created_by)
                       VALUES ($1,'transfer',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)""",
                    company_id, d["fromLocType"], d["fromLocId"], d["toLocType"], d["toLocId"],
                    it["productId"], it["productLabel"], it["qty"], move_no, d.get("note"), user_id,
                )

            await conn.execute(
                """INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,'stock_transfer','stock',$4)""",
                company_id, user_id, actor_name, f"{len(d['items'])} صنف — سند {move_no}",
            )

    return {"success": True, "moveNo": move_no, "itemCount": len(d["items"])}


async def edit_voucher(company_id: str, user_id: str, actor_name: str,
                       move_no: str, new_items: list[dict]) -> dict:
    """تعديل سند موجود: بيعكس تأثير الأصناف القديمة على المخزون،
    يتأكد من كفاية الكميات الجديدة، ثم يستبدل السطور بالكامل."""
    async with transaction() as conn:
        async with conn.transaction():
            old_rows = await conn.fetch(
                "SELECT * FROM stock_moves WHERE company_id = $1 AND move_no = $2 FOR UPDATE",
                company_id, move_no,
            )
            if not old_rows:
                raise HTTPException(404, "السند غير موجود")

            first = old_rows[0]
            is_transfer = first["move_type"] == "transfer"

            # 1) عكس تأثير كل الأصناف القديمة على المخزون
            for old in old_rows:
                if is_transfer:
                    await conn.execute(
                        """UPDATE inventory SET qty = qty + $1, updated_at = now()
                           WHERE company_id=$2 AND loc_type=$3 AND loc_id=$4 AND product_id=$5""",
                        old["qty"], company_id, old["from_loc_type"],
                        old["from_loc_id"], old["product_id"],
                    )
                await conn.execute(
                    """UPDATE inventory SET qty = qty - $1, updated_at = now()
                       WHERE company_id=$2 AND loc_type=$3 AND loc_id=$4 AND product_id=$5""",
                    old["qty"], company_id, old["to_loc_type"],
                    old["to_loc_id"], old["product_id"],
                )

            # 2) التحقق من كفاية الكمية في المصدر (للتحويلات فقط) بعد العكس
            if is_transfer:
                for it in new_items:
                    row = await conn.fetchrow(
                        """SELECT qty FROM inventory
                           WHERE company_id=$1 AND loc_type=$2 AND loc_id=$3 AND product_id=$4""",
                        company_id, first["from_loc_type"], first["from_loc_id"], it["productId"],
                    )
                    avail = row["qty"] if row else 0
                    if avail < it["qty"]:
                        raise HTTPException(
                            409, f"الكمية غير كافية في المصدر للصنف: {it['productLabel']} "
                                 f"(المتاح {avail})")

            # 3) حذف السطور القديمة
            await conn.execute(
                "DELETE FROM stock_moves WHERE company_id = $1 AND move_no = $2",
                company_id, move_no,
            )

            # 4) تطبيق الأصناف الجديدة بنفس رأس السند وتاريخه الأصلي
            for it in new_items:
                if is_transfer:
                    await conn.execute(
                        """UPDATE inventory SET qty = qty - $1, updated_at = now()
                           WHERE company_id=$2 AND loc_type=$3 AND loc_id=$4 AND product_id=$5""",
                        it["qty"], company_id, first["from_loc_type"],
                        first["from_loc_id"], it["productId"],
                    )
                await conn.execute(
                    """INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty)
                       VALUES ($1,$2,$3,$4,$5)
                       ON CONFLICT (loc_type, loc_id, product_id)
                       DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = now()""",
                    company_id, first["to_loc_type"], first["to_loc_id"],
                    it["productId"], it["qty"],
                )
                await conn.execute(
                    """INSERT INTO stock_moves
                         (company_id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                          product_id, product_label, qty, move_no, note, supplier_name,
                          created_by, created_at)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)""",
                    company_id, first["move_type"], first["from_loc_type"], first["from_loc_id"],
                    first["to_loc_type"], first["to_loc_id"], it["productId"], it["productLabel"],
                    it["qty"], move_no, first["note"], first["supplier_name"],
                    user_id, first["created_at"],
                )

            await conn.execute(
                """INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,'stock_transfer','stock',$4)""",
                company_id, user_id, actor_name, f"تعديل سند {move_no}",
            )

    return {"success": True, "moveNo": move_no, "itemCount": len(new_items)}


# ══════════════════ طلبات الفروع (Requisitions) ══════════════════
# مدير الفرع يطلب أصناف بدل ما يحوّلها بنفسه — والموافقة والتنفيذ عند صاحب الصلاحية

async def create_request(company_id: str, branch_id: str, user_id: str, actor_name: str, d: dict) -> dict:
    if not d.get("items"):
        raise HTTPException(422, "أضف صنف واحد على الأقل")
    # ── الكل أو لا شيء: لو فشل إدراج أي صنف، الطلب كله ما يتحفظش (مش طلب ناقص بدون أصناف) ──
    async with transaction() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                """INSERT INTO branch_requests
                     (company_id, requesting_branch_id, source_branch_id, source_loc_type, note, requested_by, requested_by_name)
                   VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
                company_id, branch_id, d.get("sourceBranchId"),
                "warehouse" if d.get("sourceBranchId") == "main" else "branch",
                (d.get("note") or "").strip() or None, user_id, actor_name)
            for it in d["items"]:
                await conn.execute(
                    """INSERT INTO branch_request_items (request_id, product_id, product_label, qty_requested)
                       VALUES ($1,$2,$3,$4)""",
                    row["id"], it["productId"], it["productLabel"], max(1, int(it["qty"])))
    return {"ok": True, "id": str(row["id"])}


async def list_requests(company_id: str, branch_id: str | None, status: str | None) -> list[dict]:
    conds = ["r.company_id=$1"]
    params: list = [company_id]
    if branch_id:
        params.append(branch_id); conds.append(f"r.requesting_branch_id=${len(params)}")
    if status:
        params.append(status); conds.append(f"r.status=${len(params)}")
    rows = await fetch(
        f"""SELECT r.*, rb.name AS requesting_branch_name,
                   CASE WHEN r.source_loc_type = 'warehouse' THEN 'المستودع الرئيسي' ELSE sb.name END AS source_branch_name
            FROM branch_requests r
            JOIN branches rb ON rb.id = r.requesting_branch_id
            LEFT JOIN branches sb ON r.source_loc_type = 'branch' AND sb.id::text = r.source_branch_id
            WHERE {' AND '.join(conds)}
            ORDER BY r.created_at DESC LIMIT 200""", *params)
    out = []
    for r in rows:
        items = await fetch(
            "SELECT * FROM branch_request_items WHERE request_id=$1 ORDER BY id", r["id"])
        out.append({
            "id": str(r["id"]), "status": r["status"],
            "requestingBranchId": str(r["requesting_branch_id"]), "requestingBranchName": r["requesting_branch_name"],
            "sourceBranchId": str(r["source_branch_id"]) if r["source_branch_id"] else None,
            "sourceBranchName": r["source_branch_name"],
            "note": r["note"], "requestedByName": r["requested_by_name"],
            "decidedByName": r["decided_by_name"], "decisionNote": r["decision_note"],
            "createdAt": r["created_at"].isoformat(),
            "decidedAt": r["decided_at"].isoformat() if r["decided_at"] else None,
            "items": [{"id": str(i["id"]), "productId": str(i["product_id"]), "label": i["product_label"],
                      "qtyRequested": i["qty_requested"],
                      "qtyApproved": i["qty_approved"]} for i in items],
        })
    return out


async def decide_request(company_id: str, user_id: str, actor_name: str, request_id: str, d: dict) -> dict:
    """موافقة (كلية/جزئية بتحديد كمية كل صنف) أو رفض — الموافقة بتنفذ التحويل فوراً
    ملاحظة معمارية مهمة: التحويل الفعلي بينفذ الأول، والحالة بتتثبّت بعده بس —
    لو التحويل فشل (رصيد غير كافٍ مثلاً)، الطلب يفضل «معلّق» زي ما هو للمحاولة تاني،
    بدل ما يتعلّم «موافق عليه» وهو فعلياً معلّق بلا تنفيذ (كان بيحصل قبل كده)."""
    # قابل لإعادة المعالجة: pending عادي، أو approved عالقة من محاولة سابقة فشل تنفيذها
    req = await fetchrow(
        "SELECT * FROM branch_requests WHERE id=$1 AND company_id=$2 AND status IN ('pending','approved')",
        request_id, company_id)
    if not req:
        raise HTTPException(404, "الطلب غير موجود أو تم البت فيه (وافق/رفض/نُفّذ) من قبل")

    approve = bool(d.get("approve"))
    if not approve:
        await execute(
            """UPDATE branch_requests SET status='rejected', decided_by_name=$1, decision_note=$2, decided_at=now()
               WHERE id=$3""", actor_name, (d.get("note") or "").strip() or None, request_id)
        return {"ok": True, "status": "rejected"}

    source_loc_id = d.get("sourceBranchId") or req["source_branch_id"]
    if not source_loc_id:
        raise HTTPException(422, "حدد الفرع/المخزن المصدر لتنفيذ التحويل")
    source_loc_id = str(source_loc_id)   # قد يرجع uuid.UUID من القاعدة — نضمن نص دايماً لتفادي تعارض النوع
    source_loc_type = "warehouse" if source_loc_id == "main" else "branch"

    items = await fetch("SELECT * FROM branch_request_items WHERE request_id=$1 ORDER BY id", request_id)
    transfer_items, qty_updates = [], []
    for it in items:
        approved_qty = d.get("quantities", {}).get(str(it["id"]))
        qty = int(approved_qty) if approved_qty is not None else it["qty_requested"]
        qty = max(0, min(qty, it["qty_requested"]))
        qty_updates.append((qty, it["id"]))
        if qty > 0:
            transfer_items.append({"productId": str(it["product_id"]),
                                   "productLabel": it["product_label"], "qty": qty})

    # ── التنفيذ الفعلي أولاً: لو فشل (رصيد غير كافٍ)، الاستثناء بيوقف الدالة هنا
    # ومفيش أي تحديث اتسجل — الطلب يفضل بحالته الحالية بالظبط، جاهز لمحاولة تانية ──
    if transfer_items:
        await transfer(company_id, user_id, actor_name, {
            "fromLocType": source_loc_type, "fromLocId": source_loc_id,
            "toLocType": "branch", "toLocId": str(req["requesting_branch_id"]),
            "items": transfer_items,
            "note": f"تنفيذ طلب فرع — {request_id}",
        })

    # ── التحويل نجح (أو الطلب بالكامل اتعمله موافقة صفرية) — دلوقتي بس نثبّت النتيجة ──
    final_status = "fulfilled" if transfer_items else "approved"
    async with transaction() as conn:
        async with conn.transaction():
            for qty, item_id in qty_updates:
                await conn.execute(
                    "UPDATE branch_request_items SET qty_approved=$1 WHERE id=$2", qty, item_id)
            await conn.execute(
                """UPDATE branch_requests SET status=$1, source_branch_id=$2, source_loc_type=$3,
                     decided_by_name=$4, decision_note=$5, decided_at=now() WHERE id=$6""",
                final_status, source_loc_id, source_loc_type, actor_name,
                (d.get("note") or "").strip() or None, request_id)
    return {"ok": True, "status": final_status}


async def reorder_suggestions(company_id: str) -> list[dict]:
    """نقطة إعادة الطلب: الأصناف اللي رصيدها الكلي ≤ الحد الأدنى —
    مع كمية اقتراح (حدّين أدنى − الرصيد) وآخر مورد اشترينا منه الصنف"""
    rows = await fetch(
        """SELECT p.id, p.name, p.barcode, p.min_qty,
                  COALESCE(SUM(inv.qty),0)::numeric(12,2) AS on_hand,
                  (SELECT s.name FROM purchase_invoice_items pii
                     JOIN purchase_invoices pi ON pi.id = pii.invoice_id
                     JOIN suppliers s ON s.id = pi.supplier_id
                   WHERE pii.product_id = p.id AND pi.company_id = p.company_id
                   ORDER BY pi.invoice_date DESC LIMIT 1) AS last_supplier
           FROM products p
           LEFT JOIN inventory inv ON inv.product_id = p.id AND inv.company_id = p.company_id
           WHERE p.company_id=$1 AND p.is_active=TRUE AND p.is_service=FALSE
             AND COALESCE(p.min_qty,0) > 0
           GROUP BY p.id, p.name, p.barcode, p.min_qty
           HAVING COALESCE(SUM(inv.qty),0) <= p.min_qty
           ORDER BY (p.min_qty - COALESCE(SUM(inv.qty),0)) DESC""",
        company_id)
    out = []
    for r in rows:
        on_hand = float(r["on_hand"]); min_q = float(r["min_qty"])
        out.append({
            "productId": str(r["id"]), "name": r["name"], "barcode": r["barcode"],
            "onHand": on_hand, "minQty": min_q,
            "suggestedQty": max(1, round(min_q * 2 - on_hand)),
            "lastSupplier": r["last_supplier"],
        })
    return out
