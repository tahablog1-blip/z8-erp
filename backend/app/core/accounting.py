# core/accounting.py — الخدمة المحاسبية المركزية (منقولة بالحرف من accounting.service.js)
# أي موديول محتاج ينشئ قيد يومية تلقائي (استلام مخزون، بيع، مشتريات...) بيستخدمها.
# كل الدوال بتاخد `conn` بتاع الـ transaction الأصلي — لو حصل خطأ يترجع كل حاجة مع بعض.
#
# ⚠ تنبيه asyncpg مهم: أعمدة NUMERIC بتطلب Decimal مش float —
# لو بعتّ float بيرمي "a Decimal is expected". عشان كده كل التحويلات بتعدّي على _dec().
from decimal import Decimal, ROUND_HALF_UP

import asyncpg

ACCOUNT_CODES = {
    "CASH": "1010",
    "RECEIVABLES": "1020",
    "INVENTORY": "1030",
    "INPUT_VAT": "1040",
    "VAT_PAYABLE": "2010",
    "PAYABLES": "2020",
    "SALES_REVENUE": "4010",
    "COGS": "5010",
}

# ربط طريقة الدفع بكود الحساب المحاسبي المناسب
# (النقد/الشبكة/التحويل حسابات أصول فرعية، والآجل = ذمم مدينة)
PAYMENT_ACCOUNT_CODES = {
    "cash": "1011",      # النقد بالصندوق
    "card": "1012",      # شبكة/بطاقات (مدى)
    "transfer": "1013",  # تحويلات بنكية
    "credit": "1020",    # الذمم المدينة (آجل)
}


def dec(value) -> Decimal:
    """أي رقم → Decimal بخانتين عشريتين (صيغة NUMERIC(12,2) في القاعدة)"""
    if value is None:
        return Decimal("0.00")
    return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


async def get_account_id(conn: asyncpg.Connection, company_id: str, code: str) -> str:
    """يجيب id الحساب بالكود، ويرمي خطأ واضح لو الحساب مش موجود
    (يعني الشركة محتاجة تشغّل migration-005-accounting.sql الأول)"""
    row = await conn.fetchrow(
        "SELECT id FROM accounts WHERE company_id = $1 AND code = $2", company_id, code
    )
    if not row:
        raise RuntimeError(
            f"حساب غير موجود في شجرة الحسابات (كود {code}) — "
            "تأكد من تشغيل migration-005-accounting.sql على قاعدة بيانات هذه الشركة"
        )
    return str(row["id"])


async def post_journal_entry(
    conn: asyncpg.Connection,
    *,
    company_id: str,
    source_type: str,
    source_id: str,
    lines: list[dict],
    description: str | None = None,
    branch_id: str | None = None,
    entry_date=None,
    user_id: str | None = None,
) -> str | None:
    """ينشئ قيد يومية متوازن (رأس + سطور).
    بيرمي خطأ لو مدين ≠ دائن — فيرجّع الـ transaction كله بالخارج.
    كل سطر: {"account_id": ..., "debit": 0, "credit": 0, "description": "..."}"""
    total_debit = sum((dec(l.get("debit")) for l in lines), Decimal("0.00"))
    total_credit = sum((dec(l.get("credit")) for l in lines), Decimal("0.00"))

    if abs(total_debit - total_credit) > Decimal("0.01"):
        raise RuntimeError(
            f"قيد غير متوازن ({source_type}/{source_id}): "
            f"مدين {total_debit} ≠ دائن {total_credit}"
        )
    if total_debit == 0 and total_credit == 0:
        return None  # لا داعي لقيد فارغ

    entry = await conn.fetchrow(
        """INSERT INTO journal_entries
             (company_id, branch_id, entry_date, source_type, source_id, description, created_by)
           VALUES ($1, $2, COALESCE($3, CURRENT_DATE), $4, $5, $6, $7)
           RETURNING id""",
        company_id, branch_id, entry_date, source_type, str(source_id), description, user_id,
    )
    entry_id = str(entry["id"])

    for l in lines:
        d, c = dec(l.get("debit")), dec(l.get("credit"))
        if d == 0 and c == 0:
            continue
        await conn.execute(
            """INSERT INTO journal_lines (entry_id, account_id, debit, credit, description)
               VALUES ($1, $2, $3, $4, $5)""",
            entry_id, l["account_id"], d, c, l.get("description"),
        )
    return entry_id


async def reverse_journal_entries(
    conn: asyncpg.Connection, company_id: str, source_type: str, source_id: str
) -> None:
    """يحذف أي قيود سابقة مرتبطة بنفس المصدر — نمط \"استبدال\" متوافق مع بقية النظام.
    ⚠ يعني السجل المحاسبي قابل للتعديل، مش immutable ledger بالمعنى الصارم."""
    await conn.execute(
        "DELETE FROM journal_entries WHERE company_id = $1 AND source_type = $2 AND source_id = $3",
        company_id, source_type, str(source_id),
    )
