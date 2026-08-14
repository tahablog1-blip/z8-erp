# modules/invoices/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# منقول من invoices.routes.js بالحرف — إنشاء الفاتورة، القائمة، التفاصيل، والمرتجع الكامل
#
# ⚠ نطاق مقصود لهذه الدفعة: مُسقَط تعديل بنود فاتورة صادرة والمرتجع الجزئي
# (كلاهما "عكس كامل ثم إعادة ترحيل" معقّد يستاهل دفعة مستقلة). المرتجع الكامل
# (return()) مطبّق بالكامل بمنطق مطابق.
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException

from ...core import accounting, zatca
from ...core.db import fetch, fetchrow, transaction
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
            # 0) لازم وردية مفتوحة قبل أي بيع
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
                "SELECT id, cost_price, is_service FROM products WHERE id = ANY($1::uuid[])", product_ids
            )
            cost_map = {str(r["id"]): accounting.dec(r["cost_price"]) for r in cost_rows}
            service_ids = {str(r["id"]) for r in cost_rows if r["is_service"]}

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
                await conn.execute(
                    """UPDATE inventory SET qty = qty - $1, updated_at = now()
                       WHERE loc_type='branch' AND loc_id=$2 AND product_id=$3""",
                    it["qty"], d["branchId"], it["productId"],
                )
            total_cost = sum(
                cost_map.get(it["productId"], Decimal("0.00")) * it["qty"]
                for it in d["items"] if it["productId"] not in service_ids
            )

            # 4) رقم الفاتورة + بيانات البائع لتوليد الـ QR
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


async def list_invoices(company_id: str, branch_scope: str | None, branch_id_param: str | None,
                        customer_id: str | None, date_from: str | None, date_to: str | None,
                        limit: int) -> list[dict]:
    branch_id = branch_scope or branch_id_param
    conditions = ["i.company_id = $1"]
    params: list = [company_id]
    if branch_id:
        params.append(branch_id); conditions.append(f"i.branch_id = ${len(params)}")
    if customer_id:
        params.append(customer_id); conditions.append(f"i.customer_id = ${len(params)}")
    if date_from:
        params.append(date_from); conditions.append(f"i.issued_at >= ${len(params)}::text::timestamptz")
    if date_to:
        params.append(f"{date_to} 23:59:59"); conditions.append(f"i.issued_at <= ${len(params)}::text::timestamptz")
    params.append(min(max(limit, 1), 500))

    rows = await fetch(
        f"""SELECT i.*, b.name AS branch_name
            FROM invoices i JOIN branches b ON b.id = i.branch_id
            WHERE {' AND '.join(conditions)}
            ORDER BY i.issued_at DESC LIMIT ${len(params)}""",
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
        "label": it["label"], "qty": it["qty"],
        "unit_price": _num(it["unit_price"]), "unit_price_vat": _num(it["unit_price_vat"]),
        "line_ex": _num(it["line_ex"]), "line_vat": _num(it["line_vat"]), "line_inc": _num(it["line_inc"]),
    } for it in items]
    out["payments"] = [{
        "id": str(p["id"]), "method": p["method"], "amount": _num(p["amount"]), "created_at": p["created_at"],
    } for p in payments]
    out["car"] = car
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
            for it in items:
                if not it["product_id"] or it["is_service"]:
                    continue  # صنف خدمة — لا مخزون يُعاد
                await conn.execute(
                    """UPDATE inventory SET qty = qty + $1, updated_at = now()
                       WHERE loc_type='branch' AND loc_id=$2 AND product_id=$3""",
                    it["qty"], invoice["branch_id"], it["product_id"],
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
