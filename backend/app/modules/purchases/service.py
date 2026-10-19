# modules/purchases/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# منقول من فرع "الشراء المباشر بدون أمر شراء" في purchases.routes.js
# + دورة الشراء الرسمية: عروض أسعار ← أمر شراء معتمد ← استلام مخزني ← مطابقة فاتورة المورد
import time
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction
from ...core.stock_lock import lock_stock_location
from ..treasury import service as _treasury

WAREHOUSE_LOC_ID = "main"
_B36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def _base36(n: int) -> str:
    s = ""
    while n:
        n, r = divmod(n, 36)
        s = _B36[r] + s
    return s or "0"


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def _out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"]); r["supplier_id"] = str(r["supplier_id"])
    if r.get("po_id") is not None:
        r["po_id"] = str(r["po_id"])
    for k in ("subtotal", "vat_total", "total", "paid_total"):
        r[k] = _num(r.get(k))
    return r


async def _check_po_approval(conn, company_id: str, approval_pin: str | None) -> tuple[str | None, str | None]:
    """نفس نمط رمز اعتماد أوامر العمل والمرتجعات الجزئية: لو فيه رموز اعتماد
    مفعّلة في الشركة، اعتماد/رفض أمر الشراء يتطلب رمزاً صحيحاً."""
    if approval_pin and approval_pin.strip():
        emp = await conn.fetchrow(
            """SELECT id, full_name FROM hr_employees
               WHERE company_id=$1 AND approval_pin=$2 AND is_active=TRUE""",
            company_id, approval_pin.strip())
        if not emp:
            raise HTTPException(403, "رمز الاعتماد غير صحيح — راجع رمزك مع المدير")
        return str(emp["id"]), emp["full_name"]

    pins_active = await conn.fetchrow(
        """SELECT 1 AS x FROM hr_employees
           WHERE company_id=$1 AND approval_pin IS NOT NULL AND is_active=TRUE LIMIT 1""",
        company_id)
    if pins_active:
        raise HTTPException(403, "رمز اعتماد مشرف مطلوب لاعتماد/رفض أمر الشراء")
    return None, None


async def _next_doc_no(conn, company_id: str, doc_type: str, prefix: str) -> str:
    """رقم مستند متسلسل ذرياً — نفس منطق nextDocNo في numbering.service.js"""
    row = await conn.fetchrow(
        """INSERT INTO document_counters (company_id, doc_type, last_number) VALUES ($1,$2,1)
           ON CONFLICT (company_id, doc_type) DO UPDATE SET last_number = document_counters.last_number + 1
           RETURNING last_number""",
        company_id, doc_type,
    )
    return f"{prefix}-{row['last_number']:06d}"


async def create_purchase_invoice(company_id: str, user_id: str, d: dict) -> dict:
    """فاتورة مشتريات — مساران:
    1) شراء مباشر (بلا poId، كالمعتاد): تزوّد المخزون وتسجّل القيد المعتاد فوراً.
    2) مطابقة أمر شراء (poId محدد): الأصناف المطابقة لبنود أمر الشراء افترض استلامها
       مسبقاً (عبر receive_po) فلا تُضاف للمخزون مرة ثانية — الفاتورة هنا تُصفّي حساب
       "بضاعة مستلمة غير مفوترة" وتسجّل أي فرق سعر عن أمر الشراء. أصناف على الفاتورة
       لم تكن على أمر الشراء (أو بلا productId مطابق) تُعامَل كشراء مباشر عادي."""
    async with transaction() as conn:
        async with conn.transaction():
            po = None
            po_items_by_product: dict[str, dict] = {}
            if d.get("poId"):
                po = await conn.fetchrow(
                    "SELECT * FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE",
                    d["poId"], company_id)
                if not po:
                    raise HTTPException(404, "أمر الشراء غير موجود")
                if str(po["supplier_id"]) != str(d["supplierId"]):
                    raise HTTPException(400, "المورد المحدد لا يطابق مورد أمر الشراء")
                if po["status"] not in ("approved", "partially_received", "received"):
                    raise HTTPException(409,
                        f"أمر الشراء حالته الحالية لا تسمح بالفوترة ({po['status']}) — "
                        "يلزم اعتماده واستلام بضاعة عليه أولاً")
                po_item_rows = await conn.fetch(
                    "SELECT * FROM purchase_order_items WHERE po_id=$1", po["id"])
                for r in po_item_rows:
                    if r["product_id"]:
                        po_items_by_product[str(r["product_id"])] = dict(r)

            for it in d["items"]:
                await conn.execute(
                    "UPDATE products SET cost_price=$1 WHERE id=$2 AND company_id=$3",
                    accounting.dec(it["unitCost"]), it["productId"], company_id,
                )

            subtotal = sum(accounting.dec(it["unitCost"]) * it["qty"] for it in d["items"])
            company = await conn.fetchrow("SELECT vat_percent FROM companies WHERE id=$1", company_id)
            vat_percent = accounting.dec((company and company["vat_percent"]) or 15)
            vat_total = (subtotal * vat_percent / 100).quantize(Decimal("0.01"))
            total = subtotal + vat_total
            is_cash = d["paymentTerms"] == "cash"

            invoice_no = await _next_doc_no(conn, company_id, "purchase_invoice", "PINV")

            invoice = await conn.fetchrow(
                """INSERT INTO purchase_invoices
                     (company_id, supplier_id, invoice_no, supplier_invoice_ref, invoice_date,
                      payment_terms, due_date, subtotal, vat_total, total, paid_total, status, created_by, po_id)
                   VALUES ($1,$2,$3,$4,COALESCE($5::text::date,CURRENT_DATE),$6,$7::text::date,$8,$9,$10,$11,$12,$13,$14)
                   RETURNING *""",
                company_id, d["supplierId"], invoice_no, d.get("supplierInvoiceRef"), d.get("invoiceDate"),
                d["paymentTerms"], d.get("dueDate"), subtotal, vat_total, total,
                total if is_cash else Decimal("0.00"), "paid" if is_cash else "unpaid", user_id,
                po["id"] if po else None,
            )

            for it in d["items"]:
                line_total = accounting.dec(it["unitCost"]) * it["qty"]
                await conn.execute(
                    """INSERT INTO purchase_invoice_items
                         (invoice_id, product_id, product_label, qty, unit_cost, line_total)
                       VALUES ($1,$2,$3,$4,$5,$6)""",
                    invoice["id"], it["productId"], it["productLabel"], it["qty"],
                    accounting.dec(it["unitCost"]), line_total,
                )

            # ── مطابقة بنود الفاتورة ببنود أمر الشراء (المستلمة فعلاً وغير المفوترة بعد) ──
            matched_clear = Decimal("0.00")    # أساس GR/IR المراد تصفيته (بتكلفة أمر الشراء)
            matched_actual = Decimal("0.00")   # القيمة الفعلية المفوترة لنفس البنود
            variance_notes: list[str] = []
            direct_items = list(d["items"])
            if po:
                direct_items = []
                for it in d["items"]:
                    po_item = po_items_by_product.get(str(it["productId"]))
                    if not po_item:
                        direct_items.append(it)   # صنف لم يكن على أمر الشراء — يُعامَل كشراء مباشر
                        continue
                    qty = it["qty"]
                    unit_cost = accounting.dec(it["unitCost"])
                    remaining = po_item["qty_received"] - po_item["qty_invoiced"]
                    if qty > remaining:
                        raise HTTPException(422,
                            f"الكمية المفوترة لـ «{it['productLabel']}» ({qty}) أكبر من الكمية "
                            f"المستلمة غير المفوترة بعد ({max(remaining, 0)}) — راجع استلامات أمر الشراء")
                    po_unit_cost = accounting.dec(po_item["unit_cost"])
                    matched_clear += po_unit_cost * qty
                    matched_actual += unit_cost * qty
                    if po_unit_cost > 0:
                        variance_pct = abs(unit_cost - po_unit_cost) / po_unit_cost * 100
                        if variance_pct > 10:
                            variance_notes.append(
                                f"«{it['productLabel']}»: سعر أمر الشراء {po_unit_cost:.2f} ← "
                                f"سعر الفاتورة {unit_cost:.2f} (فرق {variance_pct:.0f}%)")
                    await conn.execute(
                        "UPDATE purchase_order_items SET qty_invoiced = qty_invoiced + $1 WHERE id=$2",
                        qty, po_item["id"])
                if variance_notes and not d.get("confirmVariance"):
                    raise HTTPException(422,
                        "فرق سعر كبير (>10%) بين أمر الشراء والفاتورة — راجع السعر، أو أعد الإرسال "
                        "بتأكيد الفرق إن كان مقصوداً:\n" + "\n".join(variance_notes))

            # شراء مباشر (أو أصناف خارج أمر الشراء): يزوّد مخزون المستودع فوراً
            unmatched_subtotal = Decimal("0.00")
            if direct_items:
                move_no = f"R-{_base36(int(time.time() * 1000))}"
                supplier = await conn.fetchrow("SELECT name FROM suppliers WHERE id=$1", d["supplierId"])
                await lock_stock_location(conn, company_id, 'warehouse', WAREHOUSE_LOC_ID)
                for it in direct_items:
                    unmatched_subtotal += accounting.dec(it["unitCost"]) * it["qty"]
                    await conn.execute(
                        """INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty)
                           VALUES ($1,'warehouse',$2,$3,$4)
                           ON CONFLICT (loc_type, loc_id, product_id)
                           DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = now()""",
                        company_id, WAREHOUSE_LOC_ID, it["productId"], it["qty"],
                    )
                    await conn.execute(
                        """INSERT INTO stock_moves
                             (company_id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                              product_id, product_label, qty, move_no, supplier_name, created_by,
                              unit_cost, purchase_invoice_id)
                           VALUES ($1,'receive',NULL,NULL,'warehouse',$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                        company_id, WAREHOUSE_LOC_ID, it["productId"], it["productLabel"], it["qty"],
                        move_no, (supplier and supplier["name"]), user_id,
                        accounting.dec(it["unitCost"]), invoice["id"],
                    )

            # ── القيد المحاسبي ──
            # شراء مباشر: مدين المخزون + مدين ضريبة المدخلات — دائن (نقد أو الذمم الدائنة)
            # مطابق لأمر شراء: مدين تصفية GR/IR (+ فرق سعر إن وُجد) بدل مدين المخزون
            vat_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INPUT_VAT"])
            credit_acc = await accounting.get_account_id(
                conn, company_id,
                accounting.PAYMENT_ACCOUNT_CODES[d["paymentMethod"]] if is_cash
                else accounting.ACCOUNT_CODES["PAYABLES"],
            )
            lines = []
            if unmatched_subtotal > 0:
                inv_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INVENTORY"])
                lines.append({"account_id": inv_acc, "debit": unmatched_subtotal,
                             "description": "زيادة قيمة المخزون (شراء مباشر)"})
            if vat_total > 0:
                lines.append({"account_id": vat_acc, "debit": vat_total, "description": "ضريبة مدخلات قابلة للخصم"})
            if matched_clear > 0:
                grir_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.GRIR_CLEARING_ACCOUNT[0],
                    _treasury.GRIR_CLEARING_ACCOUNT[1], "liability")
                lines.append({"account_id": grir_acc, "debit": matched_clear,
                             "description": "تصفية بضاعة مستلمة غير مفوترة (مطابقة أمر شراء)"})
            variance_net = matched_actual - matched_clear
            if abs(variance_net) > Decimal("0.01"):
                var_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.PURCHASE_VARIANCE_ACCOUNT[0],
                    _treasury.PURCHASE_VARIANCE_ACCOUNT[1], "expense")
                if variance_net > 0:
                    lines.append({"account_id": var_acc, "debit": variance_net, "description": "فرق سعر شراء غير مواتٍ"})
                else:
                    lines.append({"account_id": var_acc, "credit": -variance_net, "description": "فرق سعر شراء مواتٍ"})
            ref_note = f" (مرجع المورد: {d['supplierInvoiceRef']})" if d.get("supplierInvoiceRef") else ""
            po_note = f" — مطابقة أمر شراء {po['po_no']}" if po else ""
            lines.append({"account_id": credit_acc, "credit": total,
                         "description": f"دفع فوري ({d['paymentMethod']})" if is_cash else "مستحق للمورد"})
            await accounting.post_journal_entry(
                conn, company_id=company_id,
                source_type="purchase_invoice", source_id=invoice["id"],
                description=f"فاتورة مشتريات {invoice_no}{ref_note}{po_note}", user_id=user_id,
                lines=lines,
            )

            if not is_cash:
                await conn.execute(
                    """INSERT INTO supplier_ledger (company_id, supplier_id, entry_type, invoice_id, amount, note, created_by)
                       VALUES ($1,$2,'invoice',$3,$4,$5,$6)""",
                    company_id, d["supplierId"], invoice["id"], total, f"فاتورة مشتريات {invoice_no}", user_id,
                )

            if po:
                po_rows = await conn.fetch(
                    "SELECT qty, qty_invoiced FROM purchase_order_items WHERE po_id=$1", po["id"])
                fully_invoiced = all(r["qty_invoiced"] >= r["qty"] for r in po_rows)
                if fully_invoiced and po["status"] != "invoiced":
                    await conn.execute("UPDATE purchase_orders SET status='invoiced' WHERE id=$1", po["id"])

    return _out(invoice)


async def list_purchase_invoices(company_id: str, supplier_id: str | None, status: str | None) -> list[dict]:
    conditions = ["pi.company_id = $1"]
    params: list = [company_id]
    if supplier_id:
        params.append(supplier_id); conditions.append(f"pi.supplier_id = ${len(params)}")
    if status:
        params.append(status); conditions.append(f"pi.status = ${len(params)}")
    rows = await fetch(
        f"""SELECT pi.*, s.name AS supplier_name
            FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
            WHERE {' AND '.join(conditions)}
            ORDER BY pi.invoice_date DESC, pi.created_at DESC""",
        *params,
    )
    return [_out(r) for r in rows]


async def get_purchase_invoice(company_id: str, invoice_id: str) -> dict:
    invoice = await fetchrow(
        """SELECT pi.*, s.name AS supplier_name FROM purchase_invoices pi
           JOIN suppliers s ON s.id=pi.supplier_id WHERE pi.id=$1 AND pi.company_id=$2""",
        invoice_id, company_id,
    )
    if not invoice:
        raise HTTPException(404, "الفاتورة غير موجودة")
    items = await fetch("SELECT * FROM purchase_invoice_items WHERE invoice_id=$1", invoice_id)
    out = _out(invoice)
    out["items"] = [{
        "id": str(it["id"]), "product_id": str(it["product_id"]) if it["product_id"] else None,
        "product_label": it["product_label"], "qty": it["qty"],
        "unit_cost": _num(it["unit_cost"]), "line_total": _num(it["line_total"]),
    } for it in items]
    return out


# ══════════════════ عروض الأسعار (طلبات تسعير من الموردين) ══════════════════

def _q_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"]); r["supplier_id"] = str(r["supplier_id"])
    r["total"] = _num(r.get("total"))
    return r


async def create_quotation(company_id: str, user_id: str, d: dict) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            supplier = await conn.fetchrow(
                "SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", d["supplierId"], company_id)
            if not supplier:
                raise HTTPException(404, "المورد غير موجود")
            quotation_no = await _next_doc_no(conn, company_id, "quotation", "RFQ")
            q = await conn.fetchrow(
                """INSERT INTO purchase_quotations (company_id, quotation_no, supplier_id, valid_until, note, created_by)
                   VALUES ($1,$2,$3,$4::text::date,$5,$6) RETURNING *""",
                company_id, quotation_no, d["supplierId"], d.get("validUntil"), d.get("note"), user_id)
            for it in d["items"]:
                await conn.execute(
                    """INSERT INTO purchase_quotation_items (quotation_id, product_id, product_label, qty, unit_cost)
                       VALUES ($1,$2,$3,$4,$5)""",
                    q["id"], it.get("productId"), it["productLabel"], it["qty"], accounting.dec(it["unitCost"]))
    return await get_quotation(company_id, str(q["id"]))


async def list_quotations(company_id: str, supplier_id: str | None, status: str | None) -> list[dict]:
    conditions = ["q.company_id=$1"]; params: list = [company_id]
    if supplier_id:
        params.append(supplier_id); conditions.append(f"q.supplier_id=${len(params)}")
    if status:
        params.append(status); conditions.append(f"q.status=${len(params)}")
    rows = await fetch(
        f"""SELECT q.*, s.name AS supplier_name,
                   COALESCE((SELECT SUM(qi.qty*qi.unit_cost) FROM purchase_quotation_items qi
                             WHERE qi.quotation_id=q.id),0) AS total
            FROM purchase_quotations q JOIN suppliers s ON s.id=q.supplier_id
            WHERE {' AND '.join(conditions)}
            ORDER BY q.created_at DESC""",
        *params)
    return [_q_out(r) for r in rows]


async def get_quotation(company_id: str, quotation_id: str) -> dict:
    q = await fetchrow(
        """SELECT q.*, s.name AS supplier_name FROM purchase_quotations q
           JOIN suppliers s ON s.id=q.supplier_id WHERE q.id=$1 AND q.company_id=$2""",
        quotation_id, company_id)
    if not q:
        raise HTTPException(404, "عرض السعر غير موجود")
    items = await fetch(
        "SELECT * FROM purchase_quotation_items WHERE quotation_id=$1 ORDER BY id", quotation_id)
    out = _q_out(q)
    out["items"] = [{
        "id": str(it["id"]), "product_id": str(it["product_id"]) if it["product_id"] else None,
        "product_label": it["product_label"], "qty": it["qty"], "unit_cost": _num(it["unit_cost"]),
        "line_total": round(it["qty"] * _num(it["unit_cost"]), 2),
    } for it in items]
    out["total"] = round(sum(i["line_total"] for i in out["items"]), 2)
    return out


async def set_quotation_status(company_id: str, quotation_id: str, status: str) -> dict:
    row = await fetchrow(
        "UPDATE purchase_quotations SET status=$1 WHERE id=$2 AND company_id=$3 RETURNING id",
        status, quotation_id, company_id)
    if not row:
        raise HTTPException(404, "عرض السعر غير موجود")
    return await get_quotation(company_id, quotation_id)


# ══════════════════ أوامر الشراء (اعتماد + استلام مخزني) ══════════════════

def _po_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"]); r["supplier_id"] = str(r["supplier_id"])
    r["quotation_id"] = str(r["quotation_id"]) if r.get("quotation_id") else None
    for k in ("subtotal", "vat_total", "total"):
        r[k] = _num(r.get(k))
    return r


async def create_po(company_id: str, user_id: str, d: dict) -> dict:
    items = list(d.get("items") or [])
    async with transaction() as conn:
        async with conn.transaction():
            supplier = await conn.fetchrow(
                "SELECT id FROM suppliers WHERE id=$1 AND company_id=$2", d["supplierId"], company_id)
            if not supplier:
                raise HTTPException(404, "المورد غير موجود")

            if d.get("quotationId"):
                qrow = await conn.fetchrow(
                    "SELECT id, supplier_id FROM purchase_quotations WHERE id=$1 AND company_id=$2",
                    d["quotationId"], company_id)
                if not qrow:
                    raise HTTPException(404, "عرض السعر غير موجود")
                if str(qrow["supplier_id"]) != str(d["supplierId"]):
                    raise HTTPException(400, "المورد المحدد لا يطابق مورد عرض السعر")
                if not items:
                    qitems = await conn.fetch(
                        "SELECT * FROM purchase_quotation_items WHERE quotation_id=$1", d["quotationId"])
                    items = [{"productId": str(it["product_id"]) if it["product_id"] else None,
                             "productLabel": it["product_label"], "qty": it["qty"],
                             "unitCost": _num(it["unit_cost"])} for it in qitems]

            if not items:
                raise HTTPException(400, "أمر الشراء يجب أن يحتوي على أصناف — مباشرة أو من عرض سعر مختار")

            subtotal = sum(accounting.dec(it["unitCost"]) * it["qty"] for it in items)
            company = await conn.fetchrow("SELECT vat_percent FROM companies WHERE id=$1", company_id)
            vat_percent = accounting.dec((company and company["vat_percent"]) or 15)
            vat_total = (subtotal * vat_percent / 100).quantize(Decimal("0.01"))
            total = subtotal + vat_total

            po_no = await _next_doc_no(conn, company_id, "purchase_order", "PO")
            po = await conn.fetchrow(
                """INSERT INTO purchase_orders
                     (company_id, po_no, supplier_id, quotation_id, expected_date, note,
                      subtotal, vat_total, total, created_by)
                   VALUES ($1,$2,$3,$4,$5::text::date,$6,$7,$8,$9,$10) RETURNING *""",
                company_id, po_no, d["supplierId"], d.get("quotationId"), d.get("expectedDate"),
                d.get("note"), subtotal, vat_total, total, user_id)
            for it in items:
                line_total = accounting.dec(it["unitCost"]) * it["qty"]
                await conn.execute(
                    """INSERT INTO purchase_order_items
                         (po_id, product_id, product_label, qty, unit_cost, line_total)
                       VALUES ($1,$2,$3,$4,$5,$6)""",
                    po["id"], it.get("productId"), it["productLabel"], it["qty"],
                    accounting.dec(it["unitCost"]), line_total)
            if d.get("quotationId"):
                await conn.execute(
                    "UPDATE purchase_quotations SET status='selected' WHERE id=$1", d["quotationId"])
    return await get_po(company_id, str(po["id"]))


async def list_pos(company_id: str, supplier_id: str | None, status: str | None) -> list[dict]:
    conditions = ["po.company_id=$1"]; params: list = [company_id]
    if supplier_id:
        params.append(supplier_id); conditions.append(f"po.supplier_id=${len(params)}")
    if status:
        params.append(status); conditions.append(f"po.status=${len(params)}")
    rows = await fetch(
        f"""SELECT po.*, s.name AS supplier_name, pi.id AS invoice_id, pi.invoice_no
            FROM purchase_orders po
            JOIN suppliers s ON s.id = po.supplier_id
            LEFT JOIN purchase_invoices pi ON pi.po_id = po.id
            WHERE {' AND '.join(conditions)}
            ORDER BY po.created_at DESC""",
        *params)
    out = []
    for r in rows:
        o = _po_out(r)
        o["invoice_id"] = str(r["invoice_id"]) if r["invoice_id"] else None
        o["invoice_no"] = r["invoice_no"]
        out.append(o)
    return out


async def get_po(company_id: str, po_id: str) -> dict:
    po = await fetchrow(
        """SELECT po.*, s.name AS supplier_name, pi.id AS invoice_id, pi.invoice_no
           FROM purchase_orders po
           JOIN suppliers s ON s.id = po.supplier_id
           LEFT JOIN purchase_invoices pi ON pi.po_id = po.id
           WHERE po.id=$1 AND po.company_id=$2""",
        po_id, company_id)
    if not po:
        raise HTTPException(404, "أمر الشراء غير موجود")
    item_rows = await fetch("SELECT * FROM purchase_order_items WHERE po_id=$1 ORDER BY id", po_id)
    receipt_rows = await fetch(
        "SELECT * FROM purchase_order_receipts WHERE po_id=$1 ORDER BY created_at DESC", po_id)
    receipt_ids = [r["id"] for r in receipt_rows]
    ritem_rows = []
    if receipt_ids:
        ritem_rows = await fetch(
            """SELECT ri.*, oi.product_label FROM purchase_order_receipt_items ri
               JOIN purchase_order_items oi ON oi.id = ri.po_item_id
               WHERE ri.receipt_id = ANY($1::uuid[])""", receipt_ids)

    out = _po_out(po)
    out["invoice_id"] = str(po["invoice_id"]) if po["invoice_id"] else None
    out["invoice_no"] = po["invoice_no"]
    out["items"] = [{
        "id": str(it["id"]), "product_id": str(it["product_id"]) if it["product_id"] else None,
        "product_label": it["product_label"], "qty": it["qty"], "unit_cost": _num(it["unit_cost"]),
        "line_total": _num(it["line_total"]), "qty_received": it["qty_received"],
    } for it in item_rows]
    by_receipt: dict[str, list] = {}
    for ri in ritem_rows:
        by_receipt.setdefault(str(ri["receipt_id"]), []).append({
            "po_item_id": str(ri["po_item_id"]), "product_label": ri["product_label"],
            "qty_received": ri["qty_received"],
        })
    out["receipts"] = [{
        "id": str(r["id"]), "receipt_no": r["receipt_no"], "note": r["note"],
        "received_by_name": r["received_by_name"], "created_at": r["created_at"],
        "items": by_receipt.get(str(r["id"]), []),
    } for r in receipt_rows]
    return out


async def approve_po(company_id: str, user_id: str, user_name: str, po_id: str,
                     approval_pin: str | None) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            approver_id, approver_name = await _check_po_approval(conn, company_id, approval_pin)
            row = await conn.fetchrow(
                """UPDATE purchase_orders
                   SET status='approved', approved_by=$3, approved_by_name=$4, approved_at=now()
                   WHERE id=$1 AND company_id=$2 AND status='pending_approval' RETURNING id""",
                po_id, company_id, approver_id or user_id, approver_name or user_name)
            if not row:
                raise HTTPException(409, "أمر الشراء غير موجود أو ليس بانتظار الاعتماد")
    return await get_po(company_id, po_id)


async def reject_po(company_id: str, user_id: str, user_name: str, po_id: str,
                    reason: str, approval_pin: str | None) -> dict:
    async with transaction() as conn:
        async with conn.transaction():
            approver_id, approver_name = await _check_po_approval(conn, company_id, approval_pin)
            row = await conn.fetchrow(
                """UPDATE purchase_orders
                   SET status='rejected', rejected_reason=$3,
                       approved_by=$4, approved_by_name=$5, approved_at=now()
                   WHERE id=$1 AND company_id=$2 AND status='pending_approval' RETURNING id""",
                po_id, company_id, reason, approver_id or user_id, approver_name or user_name)
            if not row:
                raise HTTPException(409, "أمر الشراء غير موجود أو ليس بانتظار الاعتماد")
    return await get_po(company_id, po_id)


async def cancel_po(company_id: str, po_id: str) -> dict:
    row = await fetchrow(
        """UPDATE purchase_orders SET status='cancelled'
           WHERE id=$1 AND company_id=$2 AND status='pending_approval' RETURNING id""",
        po_id, company_id)
    if not row:
        raise HTTPException(409, "لا يمكن إلغاء أمر شراء تم اعتماده أو رفضه أو استلامه بالفعل")
    return await get_po(company_id, po_id)


async def receive_po(company_id: str, user_id: str, user_name: str, po_id: str,
                     items: list[dict], note: str | None) -> dict:
    """استلام مخزني مقابل أمر شراء معتمد — يزوّد المخزون فوراً بسعر أمر الشراء
    ويسجّل الالتزام في حساب GR/IR لحين وصول فاتورة المورد ومطابقتها (راجع
    create_purchase_invoice). يمكن تكرار الاستلام (دفعات جزئية) حتى اكتمال الكمية."""
    async with transaction() as conn:
        async with conn.transaction():
            po = await conn.fetchrow(
                "SELECT * FROM purchase_orders WHERE id=$1 AND company_id=$2 FOR UPDATE",
                po_id, company_id)
            if not po:
                raise HTTPException(404, "أمر الشراء غير موجود")
            if po["status"] not in ("approved", "partially_received"):
                raise HTTPException(409, f"لا يمكن تسجيل استلام لأمر شراء حالته الحالية '{po['status']}'")

            po_item_rows = await conn.fetch("SELECT * FROM purchase_order_items WHERE po_id=$1", po_id)
            po_items = {str(r["id"]): r for r in po_item_rows}

            receipt_no = await _next_doc_no(conn, company_id, "purchase_receipt", "GRN")
            receipt = await conn.fetchrow(
                """INSERT INTO purchase_order_receipts
                     (company_id, po_id, receipt_no, note, received_by, received_by_name)
                   VALUES ($1,$2,$3,$4,$5,$6) RETURNING *""",
                company_id, po_id, receipt_no, note, user_id, user_name)

            supplier = await conn.fetchrow("SELECT name FROM suppliers WHERE id=$1", po["supplier_id"])
            total_value = Decimal("0.00")
            await lock_stock_location(conn, company_id, 'warehouse', WAREHOUSE_LOC_ID)
            for it in items:
                po_item = po_items.get(it["poItemId"])
                if not po_item:
                    raise HTTPException(400, "بند أمر الشراء غير موجود ضمن هذا الأمر")
                qty = it["qtyReceived"]
                remaining = po_item["qty"] - po_item["qty_received"]
                if qty > remaining:
                    raise HTTPException(422,
                        f"الكمية المستلمة لـ «{po_item['product_label']}» ({qty}) أكبر من "
                        f"المتبقي من أمر الشراء ({max(remaining, 0)})")
                await conn.execute(
                    """INSERT INTO purchase_order_receipt_items (receipt_id, po_item_id, qty_received)
                       VALUES ($1,$2,$3)""",
                    receipt["id"], po_item["id"], qty)
                await conn.execute(
                    "UPDATE purchase_order_items SET qty_received = qty_received + $1 WHERE id=$2",
                    qty, po_item["id"])

                unit_cost = accounting.dec(po_item["unit_cost"])
                total_value += unit_cost * qty
                if po_item["product_id"]:
                    await conn.execute(
                        "UPDATE products SET cost_price=$1 WHERE id=$2 AND company_id=$3",
                        unit_cost, po_item["product_id"], company_id)
                    await conn.execute(
                        """INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty)
                           VALUES ($1,'warehouse',$2,$3,$4)
                           ON CONFLICT (loc_type, loc_id, product_id)
                           DO UPDATE SET qty = inventory.qty + EXCLUDED.qty, updated_at = now()""",
                        company_id, WAREHOUSE_LOC_ID, po_item["product_id"], qty)
                    await conn.execute(
                        """INSERT INTO stock_moves
                             (company_id, move_type, from_loc_type, from_loc_id, to_loc_type, to_loc_id,
                              product_id, product_label, qty, move_no, supplier_name, created_by,
                              unit_cost, po_id)
                           VALUES ($1,'receive',NULL,NULL,'warehouse',$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                        company_id, WAREHOUSE_LOC_ID, po_item["product_id"], po_item["product_label"], qty,
                        receipt_no, (supplier and supplier["name"]), user_id, unit_cost, po_id)

            if total_value > 0:
                inv_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INVENTORY"])
                grir_acc = await _treasury._get_or_create_account(
                    conn, company_id, _treasury.GRIR_CLEARING_ACCOUNT[0],
                    _treasury.GRIR_CLEARING_ACCOUNT[1], "liability")
                await accounting.post_journal_entry(
                    conn, company_id=company_id, source_type="purchase_order_receipt",
                    source_id=str(receipt["id"]),
                    description=f"استلام بضاعة — أمر شراء {po['po_no']} (سند {receipt_no})", user_id=user_id,
                    lines=[
                        {"account_id": inv_acc, "debit": total_value,
                         "description": "زيادة قيمة المخزون (استلام لم تُفوتَر بعد)"},
                        {"account_id": grir_acc, "credit": total_value,
                         "description": "بضاعة مستلمة غير مفوترة بعد — GR/IR"},
                    ])

            refreshed = await conn.fetch(
                "SELECT qty, qty_received FROM purchase_order_items WHERE po_id=$1", po_id)
            all_received = all(r["qty_received"] >= r["qty"] for r in refreshed)
            any_received = any(r["qty_received"] > 0 for r in refreshed)
            new_status = "received" if all_received else ("partially_received" if any_received else po["status"])
            if new_status != po["status"]:
                await conn.execute("UPDATE purchase_orders SET status=$1 WHERE id=$2", new_status, po_id)
    return await get_po(company_id, po_id)
