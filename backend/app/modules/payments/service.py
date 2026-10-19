# modules/payments/service.py — المدفوعات الإلكترونية: بنية هيكلية جاهزة لتفعيل مزوّد حقيقي
#
# ⚠ لا يوجد مزوّد دفع (PSP) مربوط فعلياً بهذا النظام حالياً — هذا الموديول هيكل كامل
# (جدول عمليات + مسار إنشاء نية دفع + مسار ويبهوك) جاهز للتفعيل عند اختيار مزوّد سعودي
# يدعم مدى/Apple Pay/STC Pay مثل Moyasar أو PayTabs أو HyperPay أو Tap:
#   1) تسجيل حساب تاجر (Merchant Account) لدى المزوّد المختار والحصول على مفاتيح API.
#   2) استدعاء API المزوّد الفعلي من create_intent بدل حقل checkout_url الفارغ حالياً
#      (توليد جلسة دفع حقيقية وإرجاع رابطها).
#   3) ضبط متغير البيئة PAYMENTS_WEBHOOK_SECRET بالقيمة التي يوفّرها المزوّد للتحقق من
#      توقيع الويبهوك — بدونه يرفض /webhook أي تأكيد دفع (راجع _verify_signature).
#   4) مطابقة شكل حمولة الويبهوك الفعلية من المزوّد مع handle_webhook (الحقول الحالية
#      reference/status/providerRef افتراض عام يحتاج تكييف حسب توثيق المزوّد المختار).
import hashlib
import hmac
import os
import secrets

from fastapi import HTTPException

from ...core import accounting
from ...core.db import fetch, fetchrow, transaction
from ...core.integration_log import log_event

WEBHOOK_SECRET_ENV = "PAYMENTS_WEBHOOK_SECRET"


def _num(v) -> float:
    return float(v) if v is not None else 0.0


def _out(r: dict) -> dict:
    r = dict(r)
    for k in ("id", "invoice_id", "customer_id"):
        if r.get(k) is not None:
            r[k] = str(r[k])
    r["amount"] = _num(r.get("amount"))
    return r


def _next_reference() -> str:
    # مرجع عام عشوائي (وليس تسلسلياً داخلياً) — هو ما يصل لمزوّد الدفع كمعرّف خارجي للعملية
    return f"PAY-{secrets.token_hex(8).upper()}"


async def create_intent(company_id: str, user_id: str, d: dict) -> dict:
    """ينشئ نية/عملية دفع إلكتروني بحالة pending. بلا مزوّد مربوط فعلياً حالياً يرجع
    checkout_url=null — الواجهة أو التكامل اللاحق يستخدم reference للمتابعة أو لبناء
    رابط الدفع الحقيقي عند تفعيل مزوّد."""
    async with transaction() as conn:
        async with conn.transaction():
            customer_id = d.get("customerId")
            amount = d.get("amount")
            invoice_id = d.get("invoiceId")

            if invoice_id:
                invoice = await conn.fetchrow(
                    "SELECT id, customer_id, invoice_no, total_inc, paid_total FROM invoices "
                    "WHERE id=$1 AND company_id=$2", invoice_id, company_id)
                if not invoice:
                    raise HTTPException(404, "الفاتورة غير موجودة")
                if not invoice["customer_id"]:
                    raise HTTPException(400, "الفاتورة بلا عميل مسجّل — لا يمكن إنشاء دفعة إلكترونية لها")
                customer_id = customer_id or str(invoice["customer_id"])
                outstanding = accounting.dec(invoice["total_inc"]) - accounting.dec(invoice["paid_total"])
                if outstanding <= 0:
                    raise HTTPException(409, "الفاتورة مسددة بالكامل")
                amount = accounting.dec(amount) if amount else outstanding
                if amount > outstanding:
                    raise HTTPException(422, f"المبلغ أكبر من المتبقي على الفاتورة ({outstanding})")
            else:
                amount = accounting.dec(amount)

            if not customer_id:
                raise HTTPException(400, "يلزم تحديد عميل — مباشرة أو عبر الفاتورة")
            customer = await conn.fetchrow(
                "SELECT id FROM customers WHERE id=$1 AND company_id=$2", customer_id, company_id)
            if not customer:
                raise HTTPException(404, "العميل غير موجود")
            if amount <= 0:
                raise HTTPException(400, "المبلغ غير صالح")

            reference = _next_reference()
            row = await conn.fetchrow(
                """INSERT INTO payment_transactions
                     (company_id, invoice_id, customer_id, amount, provider, reference, note, created_by)
                   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
                company_id, invoice_id, customer_id, amount, d.get("provider"),
                reference, d.get("note"), user_id)
    return await get_transaction(company_id, str(row["id"]))


async def get_transaction(company_id: str, tx_id: str) -> dict:
    row = await fetchrow(
        """SELECT t.*, i.invoice_no, c.name AS customer_name
           FROM payment_transactions t
           LEFT JOIN invoices i ON i.id = t.invoice_id
           LEFT JOIN customers c ON c.id = t.customer_id
           WHERE t.id=$1 AND t.company_id=$2""", tx_id, company_id)
    if not row:
        raise HTTPException(404, "عملية الدفع غير موجودة")
    return _out(row)


async def list_transactions(company_id: str, status: str | None, invoice_id: str | None) -> list[dict]:
    conditions = ["t.company_id=$1"]
    params: list = [company_id]
    if status:
        params.append(status); conditions.append(f"t.status=${len(params)}")
    if invoice_id:
        params.append(invoice_id); conditions.append(f"t.invoice_id=${len(params)}")
    rows = await fetch(
        f"""SELECT t.*, i.invoice_no, c.name AS customer_name
            FROM payment_transactions t
            LEFT JOIN invoices i ON i.id = t.invoice_id
            LEFT JOIN customers c ON c.id = t.customer_id
            WHERE {' AND '.join(conditions)}
            ORDER BY t.created_at DESC LIMIT 500""", *params)
    return [_out(r) for r in rows]


def provider_status() -> dict:
    connected = bool(os.environ.get(WEBHOOK_SECRET_ENV))
    return {
        "connected": connected,
        "message": ("مزوّد الدفع مفعّل — الويبهوك يقبل تأكيدات موقّعة" if connected else
                     "لا يوجد مزوّد دفع إلكتروني مفعّل بعد — البنية جاهزة، يلزم اختيار مزوّد "
                     "(مثل Moyasar أو PayTabs أو HyperPay أو Tap) وضبط متغير البيئة "
                     f"{WEBHOOK_SECRET_ENV} لتفعيل استقبال التأكيدات"),
    }


def _verify_signature(raw_body: bytes, signature: str | None) -> bool:
    secret = os.environ.get(WEBHOOK_SECRET_ENV)
    if not secret or not signature:
        return False
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


async def handle_webhook(raw_body: bytes, signature: str | None, payload: dict) -> dict:
    """نقطة استقبال تأكيد الدفع من مزوّد الدفع. ترفض أي طلب بلا توقيع صالح — انظر تعليق
    الهيدر أعلى الملف لخطوات التفعيل الفعلية عند اختيار مزوّد."""
    if not _verify_signature(raw_body, signature):
        raise HTTPException(501, provider_status()["message"])

    reference = (payload or {}).get("reference")
    status = (payload or {}).get("status")
    provider_ref = (payload or {}).get("providerRef")
    if not reference or status not in ("paid", "failed", "refunded"):
        raise HTTPException(422, "بيانات ويبهوك غير صالحة — الحقول المتوقعة: reference, status, providerRef")

    async with transaction() as conn:
        async with conn.transaction():
            tx = await conn.fetchrow(
                "SELECT * FROM payment_transactions WHERE reference=$1 FOR UPDATE", reference)
            if not tx:
                raise HTTPException(404, "مرجع العملية غير معروف")

            if tx["status"] != "pending":
                return _out(dict(tx))   # معالجة سابقة لنفس الويبهوك — استجابة متكررة آمنة (idempotent)

            await conn.execute(
                """UPDATE payment_transactions SET status=$1, provider_ref=$2,
                     paid_at = CASE WHEN $1='paid' THEN now() ELSE paid_at END
                   WHERE id=$3""",
                status, provider_ref, tx["id"])

            if status == "paid":
                company_id = str(tx["company_id"])
                customer_id = str(tx["customer_id"])
                amount_dec = accounting.dec(tx["amount"])
                note = f"دفعة إلكترونية — مرجع {reference}" + (f" ({tx['provider']})" if tx["provider"] else "")

                # 1) قيد كشف حساب العميل (سالب = تخفيض المديونية) — نفس منطق customers.record_payment
                await conn.execute(
                    """INSERT INTO customer_ledger (company_id, customer_id, entry_type, amount, note)
                       VALUES ($1,$2,'payment',$3,$4)""",
                    company_id, customer_id, -amount_dec, note)

                # 2) القيد المحاسبي: مدين حساب التحويلات البنكية (تسوّي عليه إيرادات بوابة
                #    الدفع لحين الربط بحساب تسوية مخصص) — دائن الذمم المدينة
                cash_acc = await accounting.get_account_id(conn, company_id, accounting.PAYMENT_ACCOUNT_CODES["transfer"])
                recv_acc = await accounting.get_account_id(conn, company_id, accounting.ACCOUNT_CODES["RECEIVABLES"])
                await accounting.post_journal_entry(
                    conn, company_id=company_id, source_type="online_payment", source_id=reference,
                    description=note,
                    lines=[
                        {"account_id": cash_acc, "debit": amount_dec, "description": "تحصيل إلكتروني (بوابة دفع)"},
                        {"account_id": recv_acc, "credit": amount_dec, "description": "تخفيض ذمة العميل"},
                    ])

            updated = await conn.fetchrow("SELECT * FROM payment_transactions WHERE id=$1", tx["id"])

    await log_event(str(updated["company_id"]), "payment_gateway", "webhook", status,
                    detail=f"reference={reference} providerRef={provider_ref or '—'}")
    return _out(dict(updated))
