# modules/reports/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, HTTPException, Query

from ...core.deps import CurrentUser, get_current_user, require_permission
from . import service
from .schemas import SalesSummaryOut, VatReturnOut

router = APIRouter()


@router.get("/vat-return", response_model=VatReturnOut)
async def vat_return(date_from: str | None = Query(default=None, alias="from"),
                     date_to: str | None = Query(default=None, alias="to"),
                     user: CurrentUser = Depends(require_permission("accounting.view_vat"))):
    return await service.vat_return(user.company_id, date_from, date_to)


@router.get("/sales-summary", response_model=SalesSummaryOut)
async def sales_summary(date_from: str | None = Query(default=None, alias="from"),
                        date_to: str | None = Query(default=None, alias="to"),
                        branchId: str | None = Query(default=None),
                        groupBy: str = Query(default="day"),
                        user: CurrentUser = Depends(require_permission("reports.sales"))):
    group_by = "month" if groupBy == "month" else "day"
    return await service.sales_summary(user.company_id, date_from, date_to, branchId, group_by)

@router.get("/dashboard")
async def dashboard(user: CurrentUser = Depends(get_current_user)):
    """ملخص لوحة القيادة — أرقام اليوم والشهر وسلسلة 14 يوم وحالة التشغيل"""
    return await service.dashboard(user.company_id)


# ══════════════════ الذكاء الاصطناعي: المساعد + الملخص الصباحي + كشف الشذوذ ══════════════════
from pydantic import BaseModel as _AIBM

from ...core import ai as _ai
from ...core.db import execute as _exec
from ...core.db import fetch as _fetch
from ...core.db import fetchrow as _fetchrow

_SCHEMA_BRIEF = """
الجداول المتاحة (كلها فيها company_id uuid لازم تفلتر عليه بـ $1):
- customers(id, name, phone, customer_type, vat_number, created_at)
- cars(id, branch_id, plate, brand, name, model_year, customer_id, customer_name, entered_at, exited_at, station, odometer_current, service_type, created_at, is_deleted)
- products(id, category, name, spec, price numeric, price_vat numeric, cost_price numeric, is_service bool, is_oil bool, oil_brand, is_active)
- inventory(company_id, loc_type, loc_id, product_id, qty)  -- الرصيد الحالي لكل موقع
- invoices(id, branch_id, invoice_no, customer_id, customer_name, issued_at timestamptz, total_ex, total_vat, total_inc, paid_total, credit_total, is_returned, source, created_by)
- invoice_items(invoice_id, product_id, product_label, qty, unit_price, line_total)  -- بدون company_id: اربطها بـ invoices
- branches(id, name)
- suppliers(id, name, vat_number)
- purchase_invoices(id, supplier_id, invoice_no, invoice_date, subtotal, vat_total, total, paid_total, status)
- expenses? لا — المصروفات في treasury_vouchers(voucher_no, voucher_type in ('receipt','payment'), amount, expense_key, description, created_at)
"""


class AskIn(_AIBM):
    question: str


@router.post("/ask")
async def ask_data(body: AskIn,
                   user: CurrentUser = Depends(require_permission("reports.view"))):
    """اسأل بياناتك بالعربي — الذكاء يترجم لاستعلام قراءة آمن وينفذه ويشرح النتيجة"""
    q = (body.question or "").strip()
    if len(q) < 3:
        raise HTTPException(422, "اكتب سؤالاً واضحاً")

    prompt = (
        f"{_SCHEMA_BRIEF}\n"
        f"سؤال المدير: {q}\n"
        "اكتب استعلام PostgreSQL واحد فقط للإجابة. قواعد صارمة:\n"
        "- SELECT فقط. ممنوع أي تعديل. ممنوع الفاصلة المنقوطة.\n"
        "- فلتر company_id = $1::uuid على كل جدول رئيسي.\n"
        "- الحد الأقصى 50 صف (LIMIT).\n"
        "- سمِّ الأعمدة بأسماء عربية واضحة AS.\n"
        'رد بـ JSON فقط: {"sql": "..."}'
    )
    try:
        parsed = _ai.extract_json(await _ai.ask_text(prompt, 600))
        sql = str(parsed.get("sql", "")).strip()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    except Exception:
        raise HTTPException(502, "تعذّر فهم السؤال — جرّب صياغة أوضح")

    low = sql.lower()
    banned = ("insert", "update", "delete", "drop", "alter", "create", "truncate", "grant", ";", "--")
    if not low.startswith("select") or any(b in low for b in banned) or "$1" not in sql:
        raise HTTPException(422, "الاستعلام المولّد غير آمن — أعد صياغة السؤال")
    if "limit" not in low:
        sql += " LIMIT 50"

    try:
        rows = await _fetch(sql, user.company_id)
    except Exception as e:
        raise HTTPException(422, f"الاستعلام فشل: {type(e).__name__} — جرّب سؤالاً أبسط")

    data = [{k: (float(v) if hasattr(v, "quantize") else str(v) if hasattr(v, "isoformat") else v)
             for k, v in dict(r).items()} for r in rows[:50]]

    # شرح موجز بالعربي
    try:
        summary_prompt = (f"السؤال: {q}\nالنتيجة (JSON): {str(data)[:3000]}\n"
                          "لخّص الإجابة للمدير بالعربي في جملة أو جملتين بالأرقام المهمة. بدون مقدمات.")
        summary = (await _ai.ask_text(summary_prompt, 200)).strip()
    except Exception:
        summary = ""
    return {"answer": summary, "rows": data, "columns": list(data[0].keys()) if data else []}


@router.get("/daily-brief")
async def daily_brief(force: bool = Query(default=False),
                      user: CurrentUser = Depends(require_permission("reports.view"))):
    """الملخص الصباحي الذكي — بيتحسب مرة يومياً ويتخزن"""
    if not force:
        cached = await _fetchrow(
            "SELECT content FROM ai_briefs WHERE company_id=$1 AND brief_date=CURRENT_DATE",
            user.company_id)
        if cached:
            return {"brief": cached["content"], "cached": True}

    facts = {}
    facts["yesterday"] = [dict(r) for r in await _fetch(
        """SELECT COUNT(*) AS invoices, COALESCE(SUM(total_inc),0)::float AS sales
           FROM invoices WHERE company_id=$1 AND is_returned=FALSE
             AND issued_at::date = CURRENT_DATE - 1""", user.company_id)]
    facts["same_weekday_avg"] = [dict(r) for r in await _fetch(
        """SELECT COALESCE(AVG(day_total),0)::float AS avg_sales FROM (
             SELECT issued_at::date AS d, SUM(total_inc) AS day_total
             FROM invoices WHERE company_id=$1 AND is_returned=FALSE
               AND EXTRACT(DOW FROM issued_at) = EXTRACT(DOW FROM CURRENT_DATE - 1)
               AND issued_at::date BETWEEN CURRENT_DATE - 29 AND CURRENT_DATE - 2
             GROUP BY 1) t""", user.company_id)]
    facts["low_stock"] = [dict(r) for r in await _fetch(
        """SELECT p.name, SUM(inv.qty)::int AS qty
           FROM inventory inv JOIN products p ON p.id = inv.product_id
           WHERE inv.company_id=$1 AND p.is_active=TRUE AND p.is_service=FALSE
           GROUP BY p.id, p.name
           HAVING SUM(inv.qty) <= GREATEST(COALESCE(MAX(p.min_qty), 0), 1)
           ORDER BY qty LIMIT 8""", user.company_id)]
    facts["overdue_credit"] = [dict(r) for r in await _fetch(
        """SELECT customer_name, SUM(credit_total - 0)::float AS due
           FROM invoices WHERE company_id=$1 AND credit_total > 0 AND is_returned=FALSE
           GROUP BY customer_name ORDER BY due DESC LIMIT 5""", user.company_id)]
    facts["cars_today"] = [dict(r) for r in await _fetch(
        """SELECT COUNT(*) FILTER (WHERE exited_at IS NULL AND entered_at IS NULL) AS waiting,
                  COUNT(*) FILTER (WHERE entered_at IS NOT NULL AND exited_at IS NULL) AS in_service
           FROM cars WHERE company_id=$1 AND is_deleted=FALSE AND created_at::date=CURRENT_DATE""",
        user.company_id)]

    def _clean(o):
        return str(o)[:2200]

    prompt = (
        "أنت مساعد مدير مركز خدمة سيارات. اكتب ملخصاً صباحياً عربياً موجزاً (4-6 أسطر) "
        "بنقاط عملية بالأرقام: مبيعات أمس مقارنة بمتوسط نفس اليوم، تنبيهات المخزون الناقص، "
        "أكبر الآجل، وحالة الدور الحالية. لهجة مباشرة بدون مجاملات.\n"
        f"البيانات: {_clean(facts)}"
    )
    try:
        brief = (await _ai.ask_text(prompt, 400)).strip()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    await _exec(
        """INSERT INTO ai_briefs (company_id, brief_date, content) VALUES ($1, CURRENT_DATE, $2)
           ON CONFLICT (company_id, brief_date) DO UPDATE SET content=$2, created_at=now()""",
        user.company_id, brief)
    return {"brief": brief, "cached": False}


@router.get("/anomalies")
async def anomalies(user: CurrentUser = Depends(require_permission("reports.view"))):
    """كشف الشذوذ المالي — فحوصات ثابتة + قراءة ذكية للنتائج"""
    checks = {}
    checks["returns_by_user"] = [dict(r) for r in await _fetch(
        """SELECT u.full_name, COUNT(*) FILTER (WHERE i.is_returned) AS returns, COUNT(*) AS total
           FROM invoices i JOIN users u ON u.id = i.created_by
           WHERE i.company_id=$1 AND i.issued_at >= CURRENT_DATE - 30
           GROUP BY u.full_name HAVING COUNT(*) >= 5 ORDER BY returns DESC LIMIT 8""",
        user.company_id)]
    checks["negative_stock"] = [dict(r) for r in await _fetch(
        """SELECT p.name, inv.qty::int, inv.loc_type
           FROM inventory inv JOIN products p ON p.id=inv.product_id
           WHERE inv.company_id=$1 AND inv.qty < 0 ORDER BY inv.qty LIMIT 8""", user.company_id)]
    checks["big_credit"] = [dict(r) for r in await _fetch(
        """SELECT customer_name, SUM(credit_total)::float AS due, COUNT(*) AS invoices
           FROM invoices WHERE company_id=$1 AND credit_total > 0 AND is_returned=FALSE
           GROUP BY customer_name HAVING SUM(credit_total) > 500 ORDER BY due DESC LIMIT 8""",
        user.company_id)]
    checks["zero_price_lines"] = [dict(r) for r in await _fetch(
        """SELECT ii.product_label, COUNT(*) AS times
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.company_id=$1 AND i.issued_at >= CURRENT_DATE - 30 AND ii.unit_price <= 0
           GROUP BY ii.product_label ORDER BY times DESC LIMIT 8""", user.company_id)]

    prompt = (
        "أنت مدقق مالي لمركز خدمة سيارات. اقرأ نتائج الفحوصات واكتب تقريراً عربياً موجزاً "
        "بنقاط: ما الطبيعي وما المريب وما يستحق التحقيق، بالأسماء والأرقام. "
        "لو كل شيء سليم قل ذلك صراحة. بدون مقدمات.\n"
        f"الفحوصات: {str(checks)[:2600]}"
    )
    try:
        report = (await _ai.ask_text(prompt, 450)).strip()
    except RuntimeError as e:
        raise HTTPException(503, str(e))
    return {"report": report, "checks": checks}


@router.get("/branches-compare")
async def branches_compare(days: int = Query(default=30, ge=1, le=365),
                           month: str | None = Query(default=None),
                           user: CurrentUser = Depends(require_permission("reports.view"))):
    import re as _re
    if month and not _re.fullmatch(r"\d{4}-\d{2}", month):
        raise HTTPException(422, "صيغة الشهر: YYYY-MM")
    return await service.branches_compare(user.company_id, days, month)
