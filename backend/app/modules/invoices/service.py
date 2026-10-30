# modules/invoices/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# منقول من invoices.routes.js بالحرف — إنشاء الفاتورة، القائمة، التفاصيل، والمرتجع (كامل وجزئي)
#
# ⚠ نطاق مقصود لهذه الدفعة: مُسقَط تعديل بنود/قيم فاتورة صادرة (غير متوافق مع
# متطلبات الفوترة الإلكترونية SZATCA لو غيّر القيم المالية بعد الإصدار). المرتجع
# الكامل (return_invoice) والمرتجع الجزئي (partial_return_invoice) كلاهما مطبّق
# بالكامل — المرتجع الجزئي بيسجّل حركة منفصلة (invoice_returns) من غير ما يلمس
# الفاتورة الأصلية، ومحتاج رمز اعتماد مشرف بنفس منطق اعتماد أوامر العمل
# (cars.service.prepare_confirm).
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting, notify, zatca
from ...core.db import fetch, fetchrow, transaction
from ...core.stock_lock import lock_stock_location
from ..branches.service import next_branch_invoice_no
from ..shifts.service import require_open_shift


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def _invoice_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["branch_id"] = str(r["branch_id"])
    r["invoice_uuid"] = str(r["invoice_uuid"])
    r["car_id"] = str(r["car_id"]) if r.get("car_id") else None
    r["customer_id"] = str(r["customer_id"]) if r.get("customer_id") else None
    r["shift_id"] = str(r["shift_id"]) if r.get("shift_id") else None
    for k in ("total_ex", "total_vat", "total_inc", "discount_total", "paid_total", "credit_total"):
        r[k] = _num(r.get(k))
    return r


async def _next_doc_no(conn, company_id: str, doc_type: str, prefix: str) -> str:
    """رقم مستند متسلسل ذرياً — نفس منطق purchases.service._next_doc_no"""
    row = await conn.fetchrow(
        """INSERT INTO document_counters (company_id, doc_type, last_number) VALUES ($1,$2,1)
           ON CONFLICT (company_id, doc_type) DO UPDATE SET last_number = document_counters.last_number + 1
           RETURNING last_number""",
        company_id, doc_type,
    )
    return f"{prefix}-{row['last_number']:06d}"


async def _next_invoice_no(conn, company_id: str) -> str:
    """رقم فاتورة متسلسل ذرياً داخل نفس الـ transaction"""
    row = await conn.fetchrow(
        """INSERT INTO invoice_counters (company_id, last_number) VALUES ($1, 1)
           ON CONFLICT (company_id) DO UPDATE SET last_number = invoice_counters.last_number + 1
           RETURNING last_number""",
        company_id,
    )
    return f"INV-{row['last_number']:06d}"


# ══════════════════ إنشاء فاتورة (POS أو مرتبطة بسيارة) ══════════════════

async def create_invoice(company_id: str, user_id: str, user_email: str, d: dict) -> dict:
    # ── Idempotency: لو نفس المفتاح استُخدم من قبل لنفس الشركة، رجّع الفاتورة الموجودة
    #    بدل ما ننشئ فاتورة ثانية — يحمي من الضغط المزدوج وإعادة الإرسال الشبكية ──
    idem_key = d.get("idempotencyKey")
    if idem_key:
        existing = await fetchrow(
            "SELECT id FROM invoices WHERE company_id=$1 AND idempotency_key=$2",
            company_id, idem_key)
        if existing:
            return await get_invoice(company_id, str(existing["id"]))

    async with transaction() as conn:
        async with conn.transaction():
            # 0) لازم جلسة مفتوحة قبل أي بيع
            shift_id = await require_open_shift(company_id, user_id)

            # 1) الإجماليات — مع خصم البند (على القيمة شاملة الضريبة، والباقي يُشتق بنفس نسبة الضريبة)
            item_discount_total = sum(accounting.dec(it.get("discountAmount", 0)) for it in d["items"])
            gross_inc = sum(accounting.dec(it["unitPriceVat"]) * it["qty"] for it in d["items"])
            gross_ex = sum(accounting.dec(it["unitPrice"]) * it["qty"] for it in d["items"])
            invoice_discount = accounting.dec(d.get("discountAmount", 0))
            discount_total = item_discount_total + invoice_discount
            if discount_total > gross_inc:
                raise HTTPException(400, "الخصم أكبر من إجمالي الفاتورة")
            total_inc = gross_inc - discount_total
            # نسبة الخصم على القيمة الشاملة نطبّقها على القيمة قبل الضريبة أيضاً — الضريبة تبقى 15% دقيقة
            total_ex = (total_inc / Decimal("1.15")) if total_inc > 0 else Decimal("0.00")
            total_ex = total_ex.quantize(Decimal("0.01"))
            total_vat = total_inc - total_ex

            # 2) التحقق من تطابق مجموع الدفعات مع إجمالي الفاتورة
            paid_total = sum(accounting.dec(p["amount"]) for p in d["payments"] if p["method"] != "credit")
            credit_total = sum(accounting.dec(p["amount"]) for p in d["payments"] if p["method"] == "credit")
            payments_sum = paid_total + credit_total
            if abs(payments_sum - total_inc) > Decimal("0.01"):
                raise HTTPException(
                    400, f"مجموع الدفعات ({payments_sum}) لا يساوي إجمالي الفاتورة ({total_inc})")
            if credit_total > 0 and not d.get("customerId"):
                raise HTTPException(400, "البيع الآجل يتطلب اختيار عميل مسجّل لتسجيله في ذمته")

            # 3) خصم المخزون من الفرع + حساب تكلفة البضاعة المباعة
            product_ids = [it["productId"] for it in d["items"]]
            cost_rows = await conn.fetch(
                "SELECT id, cost_price, is_service, min_qty, name FROM products WHERE id = ANY($1::uuid[])",
                product_ids
            )
            cost_map = {str(r["id"]): accounting.dec(r["cost_price"]) for r in cost_rows}
            service_ids = {str(r["id"]) for r in cost_rows if r["is_service"]}
            min_qty_map = {str(r["id"]): (r["min_qty"], r["name"]) for r in cost_rows}
            if any(it['productId'] not in service_ids for it in d['items']):
                await lock_stock_location(
                    conn, company_id, 'branch', d['branchId']
                )

            low_stock_hits: list[dict] = []
            for it in d["items"]:
                if it["productId"] in service_ids:
                    continue  # صنف خدمة — لا مخزون يُخصم
                inv_row = await conn.fetchrow(
                    """SELECT qty FROM inventory WHERE loc_type='branch' AND loc_id=$1 AND product_id=$2
                       FOR UPDATE""",
                    d["branchId"], it["productId"],
                )
                current_qty = inv_row["qty"] if inv_row else 0
                if current_qty < it["qty"]:
                    raise HTTPException(
                        409, f"الكمية غير كافية للصنف: {it['label']} (المتاح {current_qty})")
                new_qty = current_qty - it["qty"]
                await conn.execute(
                    """UPDATE inventory SET qty = qty - $1, updated_at = now()
                       WHERE loc_type='branch' AND loc_id=$2 AND product_id=$3""",
                    it["qty"], d["branchId"], it["productId"],
                )
                min_qty, p_name = min_qty_map.get(it["productId"], (0, it.get("label")))
                if min_qty and new_qty <= min_qty:
                    low_stock_hits.append({"productId": it["productId"], "name": p_name or it.get("label"),
                                           "qty": new_qty, "minQty": min_qty})
            total_cost = sum(
                cost_map.get(it["productId"], Decimal("0.00")) * it["qty"]
                for it in d["items"] if it["productId"] not in service_ids
            )

            # 4) رقم الفاتورة + بيانات البائع لتوليد الـ QR
            # لو الفرع مفعّل عليه ترقيم مستقل، ياخد تسلسله الخاص؛ غير كده
            # التسلسل العام المشترك بين كل الفروع (نفس السلوك القديم تماماً)
            invoice_no = await next_branch_invoice_no(conn, company_id, d["branchId"])
            if not invoice_no:
                invoice_no = await _next_invoice_no(conn, company_id)
            seller = await conn.fetchrow("SELECT name, vat_number FROM companies WHERE id = $1", company_id)
            qr_tlv = zatca.generate_qr_tlv(
                seller_name=(seller and seller["name"]) or "",
                vat_number=(seller and seller["vat_number"]) or "",
                timestamp=datetime.now(timezone.utc),
                total_with_vat=float(total_inc), vat_total=float(total_vat),
            )

            # اسم العميل النصي (من السجل أو من المدخل المباشر)
            customer_name = d.get("customerName")
            customer_vat = d.get("customerVat")
            if d.get("customerId"):
                cr = await conn.fetchrow(
                    "SELECT name, vat_number FROM customers WHERE id=$1 AND company_id=$2",
                    d["customerId"], company_id,
                )
                if cr:
                    customer_name = customer_name or cr["name"]
                    customer_vat = customer_vat or cr["vat_number"]

            # 5) حفظ رأس الفاتورة
            # ── حارس خط الخدمة: فاتورة السيارة تصدر مرة واحدة، لأمر عمل معتمد، لزيارة قائمة ──
            if d.get("carId"):
                car_state = await conn.fetchrow(
                    """SELECT c.work_status, c.exited_at, i.invoice_no AS existing_no
                       FROM cars c
                       LEFT JOIN invoices i ON i.car_id = c.id AND i.is_returned = FALSE
                       WHERE c.id=$1 AND c.company_id=$2""",
                    d["carId"], company_id)
                if not car_state:
                    raise HTTPException(400, "السيارة المرتبطة بالفاتورة غير موجودة")
                if car_state["existing_no"]:
                    raise HTTPException(409,
                        f"السيارة عليها فاتورة سارية بالفعل ({car_state['existing_no']}) — "
                        "أرجِع الفاتورة الأولى إن كنت تريد التعديل، فلا تصدر فاتورتين لنفس الزيارة")
                if car_state["exited_at"]:
                    raise HTTPException(409, "السيارة خرجت بالفعل — لا يمكن فوترة زيارة منتهية")
                if car_state["work_status"] != "ready":
                    raise HTTPException(409,
                        "أمر العمل لم يُعتمد بعد — يعتمده موظف أوامر العمل من التابلت أولاً ثم يظهر للكاشير")

            invoice = await conn.fetchrow(
                """INSERT INTO invoices
                     (company_id, branch_id, invoice_no, invoice_type, source, car_id, customer_id,
                      customer_name, customer_vat, qr_tlv,
                      total_ex, total_vat, total_inc, paid_total, credit_total, created_by, shift_id,
                      cogs_total, discount_total, idempotency_key)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
                   RETURNING *""",
                company_id, d["branchId"], invoice_no, d["invoiceType"], d["source"],
                d.get("carId"), d.get("customerId"), customer_name, customer_vat, qr_tlv,
                total_ex, total_vat, total_inc, paid_total, credit_total, user_id, shift_id, total_cost, discount_total, idem_key
            )

            # ── إقفال أمر العمل: الفاتورة صدرت — الحالة invoiced والمسودة تتمسح ──
            if d.get("carId"):
                await conn.execute(
                    """UPDATE cars SET work_status='invoiced', draft_items=NULL
                       WHERE id=$1 AND company_id=$2""",
                    d["carId"], company_id)

            # 6) بنود الفاتورة — خصم البند (إن وُجد) يُطرح من قيمة السطر الشاملة،
            #    وتُشتق منه ex/vat بنفس نسبة 15% الدقيقة (بلا كسر التقريب المتراكم)
            for it in d["items"]:
                item_disc = accounting.dec(it.get("discountAmount", 0))
                gross_line_inc = accounting.dec(it["unitPriceVat"]) * it["qty"]
                if item_disc > gross_line_inc:
                    raise HTTPException(400, f"خصم البند أكبر من قيمته: {it['label']}")
                line_inc = gross_line_inc - item_disc
                line_ex = (line_inc / Decimal("1.15")).quantize(Decimal("0.01")) if line_inc > 0 else Decimal("0.00")
                await conn.execute(
                    """INSERT INTO invoice_items
                         (invoice_id, product_id, label, qty, unit_price, unit_price_vat, line_ex, line_vat, line_inc, discount_amount)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    invoice["id"], it["productId"], it["label"], it["qty"],
                    accounting.dec(it["unitPrice"]), accounting.dec(it["unitPriceVat"]),
                    line_ex, line_inc - line_ex, line_inc, item_disc,
                )

            # 7) الدفعات
            for p in d["payments"]:
                await conn.execute(
                    "INSERT INTO invoice_payments (invoice_id, company_id, method, amount) VALUES ($1,$2,$3,$4)",
                    invoice["id"], company_id, p["method"], accounting.dec(p["amount"]),
                )

            # 8) القيد المحاسبي التلقائي للبيع
            sales_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["SALES_REVENUE"])
            vat_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["VAT_PAYABLE"])
            debit_lines = []
            for p in d["payments"]:
                acc = await accounting.get_account_id(conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[p["method"]])
                debit_lines.append({"account_id": acc, "debit": accounting.dec(p["amount"]),
                                    "description": f"تحصيل ({p['method']})"})
            await accounting.post_journal_entry(
                conn, company_id=company_id, branch_id=d["branchId"],
                source_type="invoice_sale", source_id=invoice["id"],
                description=f"فاتورة {invoice_no}" + (f" — {customer_name}" if customer_name else ""),
                user_id=user_id,
                lines=[*debit_lines,
                      {"account_id": sales_acc, "credit": total_ex, "description": "إيراد المبيعات"},
                      {"account_id": vat_acc, "credit": total_vat, "description": "ضريبة القيمة المضافة"}],
            )

            # 9) قيد تكلفة البضاعة المباعة
            if total_cost > 0:
                cogs_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["COGS"])
                inv_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INVENTORY"])
                await accounting.post_journal_entry(
                    conn, company_id=company_id, branch_id=d["branchId"],
                    source_type="invoice_cogs", source_id=invoice["id"],
                    description=f"تكلفة بضاعة مباعة — فاتورة {invoice_no}",
                    user_id=user_id,
                    lines=[{"account_id": cogs_acc, "debit": total_cost, "description": "تكلفة البضاعة المباعة"},
                          {"account_id": inv_acc, "credit": total_cost, "description": "تخفيض قيمة المخزون"}],
                )

            # 10) الجزء الآجل في كشف حساب العميل
            if credit_total > 0 and d.get("customerId"):
                await conn.execute(
                    """INSERT INTO customer_ledger (company_id, customer_id, entry_type, invoice_id, amount, note, created_by)
                       VALUES ($1,$2,'invoice',$3,$4,$5,$6)""",
                    company_id, d["customerId"], invoice["id"], credit_total,
                    f"فاتورة {invoice_no} (آجل)", user_id,
                )

            await conn.execute(
                """INSERT INTO audit_log (company_id, branch_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,$4,'invoice_create','cars',$5)""",
                company_id, d["branchId"], user_id, user_email,
                f"{invoice_no} — {len(d['items'])} صنف — {total_inc} ر.س",
            )

    # إشعار نقص المخزون — بعد نجاح العملية بالكامل (أثر جانبي لا يدخل الـ transaction)
    for hit in low_stock_hits:
        await notify.notify_users_with_permission(
            company_id, "products.view_stock", "low_stock",
            f"نقص مخزون: {hit['name']}",
            body=f"الرصيد الحالي {hit['qty']} (الحد الأدنى {hit['minQty']})",
            link="/inventory",
            severity="warn",
            dedupe_key=f"low_stock:{hit['productId']}:branch:{d['branchId']}",
        )

    return _invoice_out(invoice)


# ══════════════════ قراءة ══════════════════

async def invoices_by_car(company_id: str, car_id: str, limit: int = 5) -> list[dict]:
    """آخر فواتير السيارة ببنودها — لشاشة التجهيز (عرض السوابق + تكرار آخر فاتورة).
    الهوية الحقيقية للسيارة هي اللوحة لا معرّف الزيارة: كل دخول للمركز يسجّل صف
    سيارة جديداً، فزيارة اليوم لا فواتير عليها بعد — السوابق على كل زيارات نفس اللوحة."""
    rows = await fetch(
        """SELECT i.id, i.invoice_no, i.issued_at, i.total_inc, i.discount_total
           FROM invoices i
           JOIN cars vc ON vc.id = i.car_id
           WHERE i.company_id=$1 AND i.is_returned=FALSE
             AND vc.plate = (SELECT plate FROM cars WHERE id=$2 AND company_id=$1)
           ORDER BY i.issued_at DESC LIMIT $3""",
        company_id, car_id, min(max(limit, 1), 20))
    out = []
    for r in rows:
        items = await fetch(
            """SELECT it.product_id, it.label, it.qty, it.unit_price, it.unit_price_vat,
                      COALESCE(p.barcode, '') AS barcode
               FROM invoice_items it LEFT JOIN products p ON p.id = it.product_id
               WHERE it.invoice_id=$1 ORDER BY it.id""", r["id"])
        out.append({
            "id": str(r["id"]), "invoice_no": r["invoice_no"],
            "issued_at": r["issued_at"].isoformat(),
            "total_inc": float(r["total_inc"]),
            "items": [{
                "productId": str(i["product_id"]) if i["product_id"] else None,
                "label": i["label"], "qty": i["qty"], "barcode": i["barcode"],
                "unitPrice": float(i["unit_price"]), "unitPriceVat": float(i["unit_price_vat"]),
            } for i in items],
        })
    return out


def _like(v: str) -> str:
    """نمط ILIKE آمن: نهرّب % و _ و \\ اللي المستخدم يكتبها"""
    return "%" + v.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


async def list_invoices(company_id: str, branch_scope: str | None, branch_id_param: str | None,
                        customer_id: str | None, date_from: str | None, date_to: str | None,
                        limit: int, *, q: str | None = None, invoice_no: str | None = None,
                        customer: str | None = None, plate: str | None = None,
                        source: str | None = None, status: str | None = None,
                        min_total: float | None = None, max_total: float | None = None,
                        offset: int = 0) -> list[dict]:
    """قائمة الفواتير مع بحث متقدم على السيرفر (كل الفواتير مش بس آخر N):
    q = بحث سريع في الرقم/العميل/الجوال/اللوحة، والباقي فلاتر دقيقة."""
    branch_id = branch_scope or branch_id_param
    conditions = ["i.company_id = $1"]
    params: list = [company_id]

    def add(cond: str, value) -> None:
        params.append(value)
        conditions.append(cond.replace("$$", f"${len(params)}"))

    plate_expr = "REPLACE(COALESCE(ca.plate,''),' ','')"
    if branch_id:
        add("i.branch_id = $$", branch_id)
    if customer_id:
        add("i.customer_id = $$", customer_id)
    if date_from:
        add("i.issued_at >= $$::text::timestamptz", date_from)
    if date_to:
        add("i.issued_at <= $$::text::timestamptz", f"{date_to} 23:59:59")
    if q and q.strip():
        params.append(_like(q)); a = len(params)
        params.append(_like(q.replace(" ", ""))); b = len(params)
        conditions.append(
            f"(i.invoice_no ILIKE ${a} OR i.customer_name ILIKE ${a} OR cu.phone ILIKE ${a} "
            f"OR {plate_expr} ILIKE ${b})")
    if invoice_no and invoice_no.strip():
        add("i.invoice_no ILIKE $$", _like(invoice_no))
    if customer and customer.strip():
        params.append(_like(customer)); a = len(params)
        conditions.append(f"(i.customer_name ILIKE ${a} OR cu.phone ILIKE ${a})")
    if plate and plate.strip():
        add(f"{plate_expr} ILIKE $$", _like(plate.replace(" ", "")))
    if source in ("pos", "car"):
        add("i.source = $$", source)
    if status == "active":
        conditions.append("NOT i.is_returned")
    elif status == "returned":
        conditions.append("i.is_returned")
    elif status == "credit":
        conditions.append("i.credit_total > 0")
    if min_total is not None:
        add("i.total_inc >= $$", min_total)
    if max_total is not None:
        add("i.total_inc <= $$", max_total)
    params.append(min(max(limit, 1), 500)); lim = len(params)
    params.append(max(offset, 0)); off = len(params)

    rows = await fetch(
        f"""SELECT i.*, b.name AS branch_name, cu.phone AS customer_phone, ca.plate AS plate
            FROM invoices i
            JOIN branches b ON b.id = i.branch_id
            LEFT JOIN customers cu ON cu.id = i.customer_id
            LEFT JOIN cars ca ON ca.id = i.car_id
            WHERE {' AND '.join(conditions)}
            ORDER BY i.issued_at DESC LIMIT ${lim} OFFSET ${off}""",
        *params,
    )
    return [_invoice_out(r) for r in rows]


async def get_invoice(company_id: str, invoice_id: str) -> dict:
    invoice = await fetchrow(
        """SELECT i.*, b.name AS branch_name, u.full_name AS cashier_name,
                  cu.phone AS customer_phone
           FROM invoices i
           JOIN branches b ON b.id = i.branch_id
           LEFT JOIN users u ON u.id = i.created_by
           LEFT JOIN customers cu ON cu.id = i.customer_id
           WHERE i.id=$1 AND i.company_id=$2""",
        invoice_id, company_id,
    )
    if not invoice:
        raise HTTPException(404, "الفاتورة غير موجودة")

    items = await fetch(
        """SELECT it.*, COALESCE(p.barcode, '') AS barcode
           FROM invoice_items it LEFT JOIN products p ON p.id = it.product_id
           WHERE it.invoice_id=$1 ORDER BY it.id""", invoice_id)
    payments = await fetch("SELECT * FROM invoice_payments WHERE invoice_id=$1 ORDER BY created_at", invoice_id)

    car = None
    if invoice.get("car_id"):
        car_row = await fetchrow(
            """SELECT c.plate, c.name AS model, c.brand, c.model_year, c.color, c.chassis_number,
                      c.odometer_current, c.odometer_previous, c.notes, c.registrar_name, c.checklist,
                      f.full_name  AS filler_name,
                      t1.full_name AS fitter1_name,
                      t2.full_name AS fitter2_name,
                      ch.full_name AS checker_name
               FROM cars c
               LEFT JOIN hr_employees f  ON f.id  = c.filler_id
               LEFT JOIN hr_employees t1 ON t1.id = c.fitter1_id
               LEFT JOIN hr_employees t2 ON t2.id = c.fitter2_id
               LEFT JOIN hr_employees ch ON ch.id = c.checker_id
               WHERE c.id=$1 AND c.company_id=$2""",
            invoice["car_id"], company_id,
        )
        car = dict(car_row) if car_row else None

    out = _invoice_out(invoice)
    out["cashier_name"] = invoice["cashier_name"]
    out["customer_phone"] = invoice["customer_phone"]
    out["items"] = [{
        "id": str(it["id"]), "product_id": str(it["product_id"]) if it["product_id"] else None,
        "label": it["label"], "qty": it["qty"], "returned_qty": it.get("returned_qty", 0) or 0,
        "unit_price": _num(it["unit_price"]), "unit_price_vat": _num(it["unit_price_vat"]),
        "discount_amount": _num(it.get("discount_amount")),   # كان ناقصاً من الاستجابة → الخصم ما كانش بيظهر في الطباعة
        "line_ex": _num(it["line_ex"]), "line_vat": _num(it["line_vat"]), "line_inc": _num(it["line_inc"]),
    } for it in items]
    out["payments"] = [{
        "id": str(p["id"]), "method": p["method"], "amount": _num(p["amount"]), "created_at": p["created_at"],
    } for p in payments]
    out["car"] = car
    out["returns"] = await list_invoice_returns(company_id, invoice_id)
    return out


# ══════════════════ مرتجع فاتورة (كامل) ══════════════════

async def return_invoice(company_id: str, user_id: str, user_email: str, invoice_id: str) -> None:
    async with transaction() as conn:
        async with conn.transaction():
            invoice = await conn.fetchrow(
                "SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE", invoice_id, company_id
            )
            if not invoice:
                raise HTTPException(404, "الفاتورة غير موجودة")
            if invoice["is_returned"]:
                raise HTTPException(409, "الفاتورة مرتجعة بالفعل")

            # 1) إعادة الكميات لمخزون الفرع
            items = await conn.fetch(
                """SELECT ii.product_id, ii.qty, COALESCE(p.is_service, FALSE) AS is_service
                   FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
                   WHERE ii.invoice_id=$1""", invoice_id)
            if any(it['product_id'] and not it['is_service'] for it in items):
                await lock_stock_location(
                    conn, company_id, 'branch', invoice['branch_id']
                )
            for it in items:
                if not it["product_id"] or it["is_service"]:
                    continue  # صنف خدمة — لا مخزون يُعاد
                await conn.execute(
                    """UPDATE inventory SET qty = qty + $1, updated_at = now()
                       WHERE loc_type='branch' AND loc_id=$2 AND product_id=$3""",
                    it["qty"], str(invoice["branch_id"]), it["product_id"],
                )

            # 2) عكس القيود المحاسبية (بيع + تكلفة)
            await accounting.reverse_journal_entries(conn, company_id, "invoice_sale", invoice_id)
            await accounting.reverse_journal_entries(conn, company_id, "invoice_cogs", invoice_id)

            # 3) عكس الجزء الآجل من كشف حساب العميل
            credit_total = accounting.dec(invoice["credit_total"])
            if credit_total > 0 and invoice["customer_id"]:
                await conn.execute(
                    """INSERT INTO customer_ledger (company_id, customer_id, entry_type, invoice_id, amount, note, created_by)
                       VALUES ($1,$2,'return',$3,$4,$5,$6)""",
                    company_id, invoice["customer_id"], invoice_id, -credit_total,
                    f"مرتجع فاتورة {invoice['invoice_no']}", user_id,
                )

            await conn.execute("UPDATE invoices SET is_returned=TRUE WHERE id=$1", invoice_id)
            await conn.execute(
                """INSERT INTO audit_log (company_id, branch_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,$4,'invoice_return','cars',$5)""",
                company_id, invoice["branch_id"], user_id, user_email, invoice["invoice_no"],
            )


# ══════════════════ مرتجع فاتورة (جزئي) ══════════════════

async def _check_return_approval(conn, company_id: str, approval_pin: str | None) -> tuple[str | None, str | None]:
    """نفس نمط رمز اعتماد أوامر العمل (cars.service.prepare_confirm): لو فيه رموز
    اعتماد مفعّلة في الشركة، المرتجع الجزئي يتطلب رمزاً صحيحاً — الحارس على
    السيرفر نفسه فلا يُتجاوز من أي تطبيق أو API مباشرة."""
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
        raise HTTPException(403, "رمز اعتماد مشرف مطلوب لعمل مرتجع جزئي")
    return None, None


def _return_item_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["invoice_item_id"] = str(r["invoice_item_id"])
    r["product_id"] = str(r["product_id"]) if r.get("product_id") else None
    for k in ("unit_price", "unit_price_vat", "line_ex", "line_vat", "line_inc"):
        r[k] = _num(r.get(k))
    return r


def _return_out(r: dict, items: list[dict]) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["invoice_id"] = str(r["invoice_id"])
    for k in ("total_ex", "total_vat", "total_inc"):
        r[k] = _num(r.get(k))
    r["items"] = [_return_item_out(it) for it in items]
    return r


async def partial_return_invoice(company_id: str, user_id: str, user_email: str, invoice_id: str,
                                 items: list[dict], note: str | None, approval_pin: str | None) -> dict:
    """مرتجع بنود/كميات معينة من فاتورة صادرة، من غير ما يلمس الفاتورة الأصلية —
    يسجّل حركة invoice_returns منفصلة (نفس فكرة النظام الأصل قبل الترحيل)،
    ويعيد الكمية للمخزون ويعكس الإيراد/الضريبة/التكلفة بنسبة المرتجع فقط."""
    async with transaction() as conn:
        async with conn.transaction():
            invoice = await conn.fetchrow(
                "SELECT * FROM invoices WHERE id=$1 AND company_id=$2 FOR UPDATE", invoice_id, company_id
            )
            if not invoice:
                raise HTTPException(404, "الفاتورة غير موجودة")
            if invoice["is_returned"]:
                raise HTTPException(409, "الفاتورة مرتجعة بالكامل بالفعل")

            approver_id, approver_name = await _check_return_approval(conn, company_id, approval_pin)

            # ── دمج البنود المكررة في نفس الطلب، وتحميلها FOR UPDATE لمنع تعارض مرتجعات متزامنة ──
            requested: dict[str, int] = {}
            for it in items:
                requested[it["invoiceItemId"]] = requested.get(it["invoiceItemId"], 0) + it["qty"]

            rows = await conn.fetch(
                """SELECT ii.*, COALESCE(p.is_service, FALSE) AS is_service,
                          COALESCE(p.cost_price, 0) AS cost_price
                   FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
                   WHERE ii.id = ANY($1::uuid[]) AND ii.invoice_id = $2
                   FOR UPDATE OF ii""",
                list(requested.keys()), invoice_id,
            )
            found = {str(r["id"]): r for r in rows}
            missing = set(requested.keys()) - set(found.keys())
            if missing:
                raise HTTPException(400, "بعض البنود غير موجودة في هذه الفاتورة")

            return_lines: list[dict] = []
            stock_updates: list[tuple[str, int]] = []
            total_ex = total_vat = total_inc = total_cost = Decimal("0.00")

            for iid, qty in requested.items():
                row = found[iid]
                available = row["qty"] - row["returned_qty"]
                if qty > available:
                    raise HTTPException(
                        409, f"الكمية المطلوب ترجيعها لـ«{row['label']}» أكبر من المتاح للإرجاع ({available})")

                # ── سعر الوحدة الفعلي من نفس بند الفاتورة الأصلية (بعد خصم البند إن وُجد) ──
                orig_qty = row["qty"]
                unit_eff_inc = (accounting.dec(row["line_inc"]) / orig_qty).quantize(Decimal("0.01"))
                unit_eff_ex = (accounting.dec(row["line_ex"]) / orig_qty).quantize(Decimal("0.01"))
                r_line_inc = (unit_eff_inc * qty).quantize(Decimal("0.01"))
                r_line_ex = (unit_eff_ex * qty).quantize(Decimal("0.01"))
                r_line_vat = r_line_inc - r_line_ex

                total_ex += r_line_ex; total_vat += r_line_vat; total_inc += r_line_inc

                if row["product_id"] and not row["is_service"]:
                    total_cost += accounting.dec(row["cost_price"]) * qty
                    stock_updates.append((str(row["product_id"]), qty))

                return_lines.append({
                    "invoice_item_id": iid, "product_id": str(row["product_id"]) if row["product_id"] else None,
                    "label": row["label"], "qty": qty,
                    "unit_price": unit_eff_ex, "unit_price_vat": unit_eff_inc,
                    "line_ex": r_line_ex, "line_vat": r_line_vat, "line_inc": r_line_inc,
                })

                await conn.execute(
                    "UPDATE invoice_items SET returned_qty = returned_qty + $1 WHERE id = $2", qty, iid)

            if total_inc <= 0:
                raise HTTPException(400, "لا يوجد شيء للإرجاع")

            # ── إعادة الكميات لمخزون الفرع ──
            if stock_updates:
                await lock_stock_location(conn, company_id, "branch", invoice["branch_id"])
                for product_id, qty in stock_updates:
                    await conn.execute(
                        """UPDATE inventory SET qty = qty + $1, updated_at = now()
                           WHERE loc_type='branch' AND loc_id=$2 AND product_id=$3""",
                        qty, str(invoice["branch_id"]), product_id,
                    )

            # ── رأس المرتجع + بنوده ──
            return_no = await _next_doc_no(conn, company_id, "invoice_return", "RET")
            ret = await conn.fetchrow(
                """INSERT INTO invoice_returns
                     (company_id, branch_id, invoice_id, return_no, total_ex, total_vat, total_inc,
                      note, approved_by, approved_name, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   RETURNING *""",
                company_id, invoice["branch_id"], invoice_id, return_no,
                total_ex, total_vat, total_inc, note, approver_id, approver_name, user_id,
            )
            for ln in return_lines:
                await conn.execute(
                    """INSERT INTO invoice_return_items
                         (return_id, invoice_item_id, product_id, label, qty,
                          unit_price, unit_price_vat, line_ex, line_vat, line_inc)
                       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)""",
                    ret["id"], ln["invoice_item_id"], ln["product_id"], ln["label"], ln["qty"],
                    ln["unit_price"], ln["unit_price_vat"], ln["line_ex"], ln["line_vat"], ln["line_inc"],
                )

            # ── القيد المحاسبي: عكس نسبي للإيراد/الضريبة، مقابله نفس توزيع طرق الدفع
            #    الأصلية بالتناسب (آخر طريقة تاخد فرق التقريب عشان القيد يتوازن بالضبط) ──
            payments = await conn.fetch(
                "SELECT method, amount FROM invoice_payments WHERE invoice_id=$1 ORDER BY created_at", invoice_id)
            ratio = (total_inc / accounting.dec(invoice["total_inc"])) if accounting.dec(invoice["total_inc"]) > 0 else Decimal("0")

            refund_lines = []
            allocated = Decimal("0.00")
            for idx, p in enumerate(payments):
                amt = (accounting.dec(p["amount"]) * ratio).quantize(Decimal("0.01"))
                if idx == len(payments) - 1:
                    amt = total_inc - allocated
                allocated += amt
                if amt <= 0:
                    continue
                acc = await accounting.get_account_id(conn, company_id, accounting.PAYMENT_ACCOUNT_CODES[p["method"]])
                refund_lines.append({"account_id": acc, "credit": amt,
                                     "description": f"إرجاع/تسوية مرتجع جزئي ({p['method']})"})

            sales_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["SALES_REVENUE"])
            vat_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["VAT_PAYABLE"])
            await accounting.post_journal_entry(
                conn, company_id=company_id, branch_id=invoice["branch_id"],
                source_type="invoice_partial_return", source_id=ret["id"],
                description=f"مرتجع جزئي {return_no} — فاتورة {invoice['invoice_no']}",
                user_id=user_id,
                lines=[{"account_id": sales_acc, "debit": total_ex, "description": "عكس إيراد مبيعات (مرتجع جزئي)"},
                      {"account_id": vat_acc, "debit": total_vat, "description": "عكس ضريبة القيمة المضافة (مرتجع جزئي)"},
                      *refund_lines],
            )

            if total_cost > 0:
                cogs_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["COGS"])
                inv_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["INVENTORY"])
                await accounting.post_journal_entry(
                    conn, company_id=company_id, branch_id=invoice["branch_id"],
                    source_type="invoice_partial_return_cogs", source_id=ret["id"],
                    description=f"عكس تكلفة بضاعة مرتجعة — {return_no}",
                    user_id=user_id,
                    lines=[{"account_id": inv_acc, "debit": total_cost, "description": "إعادة قيمة المخزون"},
                          {"account_id": cogs_acc, "credit": total_cost, "description": "عكس تكلفة البضاعة المباعة"}],
                )

            # ── الجزء الآجل: لو من ضمن الدفعات الأصلية آجل، نخصم من ذمة العميل بنفس نسبة المرتجع ──
            credit_total = accounting.dec(invoice["credit_total"])
            if credit_total > 0 and invoice["customer_id"]:
                credit_refund = (credit_total * ratio).quantize(Decimal("0.01"))
                if credit_refund > 0:
                    await conn.execute(
                        """INSERT INTO customer_ledger (company_id, customer_id, entry_type, invoice_id, amount, note, created_by)
                           VALUES ($1,$2,'return',$3,$4,$5,$6)""",
                        company_id, invoice["customer_id"], invoice_id, -credit_refund,
                        f"مرتجع جزئي {return_no} من فاتورة {invoice['invoice_no']}", user_id,
                    )

            await conn.execute(
                """INSERT INTO audit_log (company_id, branch_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,$4,'invoice_partial_return','cars',$5)""",
                company_id, invoice["branch_id"], user_id, user_email,
                f"{return_no} — فاتورة {invoice['invoice_no']} — {len(return_lines)} بند — {total_inc} ر.س"
                + (f" — معتمد من {approver_name}" if approver_name else ""),
            )

    out_items = await fetch(
        "SELECT * FROM invoice_return_items WHERE return_id=$1 ORDER BY id", ret["id"])
    return _return_out(dict(ret), [dict(r) for r in out_items])


async def list_invoice_returns(company_id: str, invoice_id: str) -> list[dict]:
    """سجل المرتجعات الجزئية لفاتورة معينة — لعرضه في شاشة تفاصيل الفاتورة"""
    rets = await fetch(
        """SELECT r.* FROM invoice_returns r
           JOIN invoices i ON i.id = r.invoice_id
           WHERE r.invoice_id=$1 AND i.company_id=$2 ORDER BY r.created_at DESC""",
        invoice_id, company_id)
    out = []
    for r in rets:
        items = await fetch(
            "SELECT * FROM invoice_return_items WHERE return_id=$1 ORDER BY id", r["id"])
        out.append(_return_out(dict(r), [dict(it) for it in items]))
    return out
