# modules/shifts/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# منقول من shifts.routes.js بالحرف — نفس الاستعلامات ونفس منطق التسوية النقدية
from decimal import Decimal

from fastapi import HTTPException

from ...core import notify
from ...core.db import execute, fetch, fetchrow, transaction


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


async def _build_shift_report(company_id: str, shift_id: str) -> dict | None:
    """يبني تقرير الجلسة المفصّل — نفس الدالة تُستخدم عند العرض وعند الإغلاق"""
    shift = await fetchrow(
        """SELECT s.*, b.name AS branch_name, u.full_name AS user_name
           FROM shifts s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.user_id
           WHERE s.id = $1 AND s.company_id = $2""",
        shift_id, company_id,
    )
    if not shift:
        return None

    # إجماليات الفواتير في الجلسة (المرتجعة بالكامل مستبعدة من المبيعات)
    sales = await fetchrow(
        """SELECT COUNT(*)::int AS invoice_count,
                  COALESCE(SUM(total_ex),0)::numeric(12,2)  AS total_ex,
                  COALESCE(SUM(total_vat),0)::numeric(12,2) AS total_vat,
                  COALESCE(SUM(total_inc),0)::numeric(12,2) AS total_inc
           FROM invoices WHERE company_id=$1 AND shift_id=$2 AND is_returned=FALSE""",
        company_id, shift_id,
    )

    # تفصيل التحصيل حسب طريقة الدفع
    pay_rows = await fetch(
        """SELECT ip.method, COALESCE(SUM(ip.amount),0)::numeric(12,2) AS amount
           FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
           WHERE i.company_id=$1 AND i.shift_id=$2 AND i.is_returned=FALSE
           GROUP BY ip.method""",
        company_id, shift_id,
    )
    by_method = {"cash": 0.0, "card": 0.0, "transfer": 0.0, "credit": 0.0}
    for r in pay_rows:
        by_method[r["method"]] = _num(r["amount"])

    # المرتجعات خلال الجلسة (حسب وقت إنشاء المرتجع نفسه، مش وقت الفاتورة الأصلية)
    returns = await fetchrow(
        """SELECT COUNT(*)::int AS return_count,
                  COALESCE(SUM(total_inc),0)::numeric(12,2) AS total_inc,
                  COALESCE(SUM(CASE WHEN refund_method='cash' THEN total_inc ELSE 0 END),0)::numeric(12,2) AS cash_refunds
           FROM invoice_returns
           WHERE company_id=$1 AND created_at >= $2 AND ($3::timestamptz IS NULL OR created_at <= $3)""",
        company_id, shift["opened_at"], shift["closed_at"],
    )

    # النقد المتوقع في الدرج = عهدة البداية + تحصيل نقدي − مرتجعات نقدية
    tv = await fetchrow(
        """SELECT COALESCE(SUM(amount) FILTER (WHERE type='receipt'),0)::numeric(12,2) AS rec,
                  COALESCE(SUM(amount) FILTER (WHERE type='payment'),0)::numeric(12,2) AS pay
           FROM treasury_vouchers
           WHERE company_id=$1 AND created_by=$2 AND method='cash' AND status='active'
             AND created_at >= $3 AND ($4::timestamptz IS NULL OR created_at <= $4)""",
        company_id, shift["user_id"], shift["opened_at"], shift["closed_at"],
    )
    expected_cash = round(_num(shift["opening_cash"]) + by_method["cash"] - _num(returns["cash_refunds"])
                          + _num(tv["rec"]) - _num(tv["pay"]), 2)
    counted_cash = None if shift["closing_cash_counted"] is None else _num(shift["closing_cash_counted"])
    difference = None if counted_cash is None else round(counted_cash - expected_cash, 2)

    # أكثر الأصناف مبيعاً في الجلسة
    top_items = await fetch(
        """SELECT ii.label, SUM(ii.qty)::int AS qty, COALESCE(SUM(ii.line_inc),0)::numeric(12,2) AS total
           FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.company_id=$1 AND i.shift_id=$2 AND i.is_returned=FALSE
           GROUP BY ii.label ORDER BY qty DESC LIMIT 10""",
        company_id, shift_id,
    )

    shift_out = dict(shift)
    shift_out["id"] = str(shift_out["id"])
    shift_out["branch_id"] = str(shift_out["branch_id"])
    shift_out["user_id"] = str(shift_out["user_id"])
    shift_out["opening_cash"] = _num(shift_out["opening_cash"])
    shift_out["closing_cash_counted"] = counted_cash

    return {
        "shift": shift_out,
        "sales": {
            "invoiceCount": sales["invoice_count"],
            "totalEx": _num(sales["total_ex"]),
            "totalVat": _num(sales["total_vat"]),
            "totalInc": _num(sales["total_inc"]),
        },
        "byMethod": by_method,
        "returns": {
            "count": returns["return_count"],
            "totalInc": _num(returns["total_inc"]),
            "cashRefunds": _num(returns["cash_refunds"]),
        },
        "cash": {
            "opening": _num(shift["opening_cash"]),
            "expected": expected_cash,
            "counted": counted_cash,
            "difference": difference,
        },
        "treasury": {"cashReceipts": _num(tv["rec"]), "cashPayments": _num(tv["pay"])},
        "topItems": [{"label": r["label"], "qty": r["qty"], "total": _num(r["total"])} for r in top_items],
    }


def redact_amounts(r: dict | None) -> dict | None:
    """إغلاق أعمى: صاحب الجلسة (بلا صلاحية «جلسات الفرع») لا يرى أي مبلغ — لا المبيعات ولا المتوقع بالدرج ولا الفرق،
    حتى لا يطابق عدّه على الرقم المتوقع. الحجب هنا في الخادم (الواجهة وحدها لا تكفي: الرد يُرى في أدوات المتصفح)."""
    if not r:
        return r
    out = dict(r)
    out["shift"] = {**r["shift"], "opening_cash": 0.0, "closing_cash_counted": None}
    out["sales"] = {"invoiceCount": r["sales"]["invoiceCount"], "totalEx": 0.0, "totalVat": 0.0, "totalInc": 0.0}
    out["byMethod"] = {k: 0.0 for k in r["byMethod"]}
    out["returns"] = {"count": r["returns"]["count"], "totalInc": 0.0, "cashRefunds": 0.0}
    out["cash"] = {"opening": 0.0, "expected": 0.0, "counted": None, "difference": None}
    out["treasury"] = {"cashReceipts": 0.0, "cashPayments": 0.0}
    out["topItems"] = [{"label": t["label"], "qty": t["qty"], "total": 0.0} for t in r["topItems"]]
    out["redacted"] = True
    return out


async def get_current(company_id: str, user_id: str) -> dict | None:
    row = await fetchrow(
        """SELECT s.id FROM shifts s
           WHERE s.company_id=$1 AND s.user_id=$2 AND s.status='open'""",
        company_id, user_id,
    )
    if not row:
        return None
    return await _build_shift_report(company_id, str(row["id"]))


async def open_shift(company_id: str, user_id: str, branch_id: str, opening_cash: float) -> dict:
    async with transaction() as conn:
        existing = await conn.fetchrow(
            "SELECT id FROM shifts WHERE company_id=$1 AND user_id=$2 AND status='open'",
            company_id, user_id,
        )
        if existing:
            raise HTTPException(409, "عندك جلسة مفتوحة بالفعل — اقفلها الأول")
        row = await conn.fetchrow(
            """INSERT INTO shifts (company_id, branch_id, user_id, opening_cash)
               VALUES ($1,$2,$3,$4) RETURNING id, branch_id, user_id, opening_cash,
                                                opened_at, closed_at, status""",
            company_id, branch_id, user_id, Decimal(str(opening_cash)),
        )
    out = dict(row)
    out["id"] = str(out["id"]); out["branch_id"] = str(out["branch_id"]); out["user_id"] = str(out["user_id"])
    out["opening_cash"] = _num(out["opening_cash"])
    return out


async def close_shift(company_id: str, shift_id: str, counted_cash: float, notes: str | None,
                      caller_id: str | None = None, can_close_any: bool = False) -> dict:
    if caller_id and not can_close_any:
        owner = await fetchrow("SELECT user_id FROM shifts WHERE id=$1 AND company_id=$2",
                               shift_id, company_id)
        if owner and str(owner["user_id"]) != caller_id:
            raise HTTPException(403, "لا يمكنك إغلاق جلسة موظف آخر")
    row = await fetchrow(
        "SELECT id FROM shifts WHERE id=$1 AND company_id=$2 AND status='open'",
        shift_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الجلسة غير موجودة أو مقفولة بالفعل")

    await execute(
        """UPDATE shifts SET status='closed', closed_at=now(),
                              closing_cash_counted=$2, closing_notes=$3
           WHERE id=$1""",
        shift_id, Decimal(str(counted_cash)), notes,
    )
    report = await _build_shift_report(company_id, shift_id)

    # إشعار فرق الصندوق — لو الفرق تجاوز هامش تافه (5 ر.س) يستحق مراجعة المشرف
    diff = report["cash"]["difference"] if report else None
    if diff is not None and abs(diff) > 5:
        user_name = report["shift"].get("user_name") or ""
        await notify.notify_users_with_permission(
            company_id, "shifts.view_branch", "shift_cash_variance",
            f"فرق صندوق في جلسة {user_name}".strip(),
            body=f"المتوقع {report['cash']['expected']} — المعدود {report['cash']['counted']} "
                 f"— الفرق {diff:+.2f} ر.س",
            link="/shifts", severity="danger",
            dedupe_key=f"shift_variance:{shift_id}",
        )
    return report


async def list_shifts(company_id: str, viewer_id: str, can_view_branch: bool,
                      branch_scope: str | None) -> list[dict]:
    """عزل الرؤية: بلا صلاحية عرض الفرع = جلسات الموظف نفسه فقط؛
    بصلاحية عرض الفرع = جلسات فرعه فقط (None = إدارة الشركة كلها)."""
    conds, args = ["s.company_id=$1"], [company_id]
    if not can_view_branch:
        args.append(viewer_id)
        conds.append(f"s.user_id=${len(args)}")
    elif branch_scope is not None:
        args.append(branch_scope)
        conds.append(f"s.branch_id=${len(args)}")
    rows = await fetch(
        f"""SELECT s.*, b.name AS branch_name, u.full_name AS user_name,
                  (SELECT COUNT(*) FROM invoices i WHERE i.shift_id = s.id AND i.is_returned=FALSE)::int AS invoice_count,
                  (SELECT COALESCE(SUM(i.total_inc),0) FROM invoices i WHERE i.shift_id = s.id AND i.is_returned=FALSE)::numeric(12,2) AS total_sales
           FROM shifts s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.user_id
           WHERE {' AND '.join(conds)} ORDER BY s.opened_at DESC LIMIT 100""",
        *args,
    )
    out = []
    for r in rows:
        r = dict(r)
        r["id"] = str(r["id"]); r["branch_id"] = str(r["branch_id"]); r["user_id"] = str(r["user_id"])
        r["opening_cash"] = _num(r["opening_cash"])
        r["closing_cash_counted"] = _num(r["closing_cash_counted"]) if r["closing_cash_counted"] is not None else None
        r["total_sales"] = _num(r["total_sales"])
        out.append(r)
    return out


async def get_report(company_id: str, shift_id: str,
                     caller_id: str | None = None, can_view_any: bool = False) -> dict:
    if caller_id and not can_view_any:
        owner = await fetchrow("SELECT user_id FROM shifts WHERE id=$1 AND company_id=$2",
                               shift_id, company_id)
        if owner and str(owner["user_id"]) != caller_id:
            raise HTTPException(403, "لا يمكنك عرض تقرير جلسة موظف آخر")
    report = await _build_shift_report(company_id, shift_id)
    if not report:
        raise HTTPException(404, "الجلسة غير موجودة")
    return report


async def require_open_shift(company_id: str, user_id: str) -> str:
    """تُستخدم من موديول الفواتير: بترجّع id الجلسة المفتوحة أو ترمي 409"""
    row = await fetchrow(
        "SELECT id FROM shifts WHERE company_id=$1 AND user_id=$2 AND status='open'",
        company_id, user_id,
    )
    if not row:
        raise HTTPException(409, "لازم تفتح جلسة الأول قبل ما تقدر تصدر فواتير")
    return str(row["id"])
