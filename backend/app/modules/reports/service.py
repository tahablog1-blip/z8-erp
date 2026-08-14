# modules/reports/service.py — منطق التقارير معزول عن طبقة الـ HTTP
# منقول من reports.routes.js — راجع __init__.py للتبسيط المقصود في حساب المرتجعات
from datetime import date
from decimal import Decimal

from ...core.db import fetch, fetchrow


def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def _period(date_from: str | None, date_to: str | None) -> tuple[str, str, str]:
    today = date.today().isoformat()
    f = date_from or (today[:8] + "01")
    t = date_to or today
    return f, t, f"{t} 23:59:59"


# ══════════════════ الإقرار الضريبي ══════════════════

async def vat_return(company_id: str, date_from: str | None, date_to: str | None) -> dict:
    f, t, t_end = _period(date_from, date_to)

    # كل الفواتير الصادرة في الفترة (شاملة اللي اترجعت — بنخصمها تحت)
    out_row = await fetchrow(
        """SELECT COALESCE(SUM(total_ex),0)::numeric(12,2) AS sales_ex,
                  COALESCE(SUM(total_vat),0)::numeric(12,2) AS output_vat
           FROM invoices WHERE company_id=$1 AND issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz""",
        company_id, f, t_end,
    )

    # المرتجعات: منسوبة لتاريخ إصدار الفاتورة الأصلي (تبسيط مقصود — راجع __init__.py)
    ret_row = await fetchrow(
        """SELECT COALESCE(SUM(total_ex),0)::numeric(12,2) AS returns_ex,
                  COALESCE(SUM(total_vat),0)::numeric(12,2) AS returns_vat,
                  COUNT(*)::int AS returns_count
           FROM invoices
           WHERE company_id=$1 AND is_returned=TRUE AND issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz""",
        company_id, f, t_end,
    )

    by_source_rows = await fetch(
        """SELECT source, COUNT(*)::int AS invoice_count,
                  COALESCE(SUM(total_ex),0)::numeric(12,2) AS sales_ex,
                  COALESCE(SUM(total_vat),0)::numeric(12,2) AS output_vat
           FROM invoices WHERE company_id=$1 AND issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz
           GROUP BY source""",
        company_id, f, t_end,
    )

    # ضريبة المدخلات الفعلية من فواتير المشتريات الرسمية
    in_row = await fetchrow(
        """SELECT COALESCE(SUM(subtotal),0)::numeric(12,2) AS purchases_ex,
                  COALESCE(SUM(vat_total),0)::numeric(12,2) AS input_vat_real
           FROM purchase_invoices WHERE company_id=$1 AND invoice_date BETWEEN $2::text::date AND $3::text::date""",
        company_id, f, t,
    )

    # تقدير احتياطي لأي استلام بضاعة قديم لم يمرّ عبر فاتورة مشتريات رسمية
    vat_row = await fetchrow("SELECT vat_percent FROM companies WHERE id=$1", company_id)
    vat_percent = _num((vat_row and vat_row["vat_percent"]) or 15)
    legacy_row = await fetchrow(
        """SELECT COALESCE(SUM(qty * COALESCE(unit_cost,0)),0)::numeric(12,2) AS purchases_ex
           FROM stock_moves
           WHERE company_id=$1 AND move_type='receive' AND created_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz
             AND po_id IS NULL AND purchase_invoice_id IS NULL""",
        company_id, f, t_end,
    )

    gross_vat = _num(out_row["output_vat"])
    returns_vat = _num(ret_row["returns_vat"])
    output_vat = round(gross_vat - returns_vat, 2)
    sales_ex = round(_num(out_row["sales_ex"]) - _num(ret_row["returns_ex"]), 2)

    purchases_ex_real = _num(in_row["purchases_ex"])
    input_vat_real = _num(in_row["input_vat_real"])
    purchases_ex_legacy = _num(legacy_row["purchases_ex"])
    input_vat_legacy = round(purchases_ex_legacy * vat_percent / 100, 2)

    purchases_ex = purchases_ex_real + purchases_ex_legacy
    input_vat = round(input_vat_real + input_vat_legacy, 2)
    net_vat = round(output_vat - input_vat, 2)

    by_source = {
        "car": {"invoiceCount": 0, "salesEx": 0, "outputVat": 0},
        "pos": {"invoiceCount": 0, "salesEx": 0, "outputVat": 0},
    }
    for r in by_source_rows:
        by_source[r["source"]] = {
            "invoiceCount": r["invoice_count"], "salesEx": _num(r["sales_ex"]), "outputVat": _num(r["output_vat"]),
        }

    return {
        "from": f, "to": t, "vatPercent": vat_percent,
        "salesEx": sales_ex, "grossVat": round(gross_vat, 2),
        "returnsEx": _num(ret_row["returns_ex"]), "returnsVat": returns_vat,
        "returnsCount": ret_row["returns_count"], "outputVat": output_vat,
        "bySource": by_source,
        "purchasesEx": purchases_ex, "inputVat": input_vat, "netVat": net_vat,
    }


# ══════════════════ ملخّص المبيعات ══════════════════

async def sales_summary(company_id: str, date_from: str | None, date_to: str | None,
                        branch_id: str | None, group_by: str) -> dict:
    f, t, t_end = _period(date_from, date_to)
    params: list = [company_id, f, t_end]
    branch_filter = ""
    if branch_id:
        params.append(branch_id)
        branch_filter = f" AND i.branch_id = ${len(params)}"

    by_source_rows = await fetch(
        f"""SELECT i.source, COUNT(*)::int AS invoice_count,
                   COALESCE(SUM(i.total_ex),0)::numeric(12,2) AS total_ex,
                   COALESCE(SUM(i.total_vat),0)::numeric(12,2) AS total_vat,
                   COALESCE(SUM(i.total_inc),0)::numeric(12,2) AS total_inc,
                   COALESCE(SUM(i.credit_total),0)::numeric(12,2) AS credit_total,
                   COALESCE(AVG(i.total_inc),0)::numeric(12,2) AS avg_ticket
            FROM invoices i
            WHERE i.company_id=$1 AND i.is_returned=FALSE AND i.issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz{branch_filter}
            GROUP BY i.source""",
        *params,
    )
    margin_rows = await fetch(
        f"""SELECT i.source, COALESCE(SUM(ii.qty * COALESCE(p.cost_price,0)),0)::numeric(12,2) AS cogs
            FROM invoices i JOIN invoice_items ii ON ii.invoice_id = i.id
            LEFT JOIN products p ON p.id = ii.product_id
            WHERE i.company_id=$1 AND i.is_returned=FALSE AND i.issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz{branch_filter}
            GROUP BY i.source""",
        *params,
    )
    pay_rows = await fetch(
        f"""SELECT i.source, ip.method, COALESCE(SUM(ip.amount),0)::numeric(12,2) AS amount
            FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id
            WHERE i.company_id=$1 AND i.is_returned=FALSE AND i.issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz{branch_filter}
            GROUP BY i.source, ip.method""",
        *params,
    )
    bucket_expr = (
        "date_trunc('month', i.issued_at AT TIME ZONE 'Asia/Riyadh')::date" if group_by == "month"
        else "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
    )
    daily_rows = await fetch(
        f"""SELECT {bucket_expr} AS day, i.source,
                   COUNT(*)::int AS invoice_count,
                   COALESCE(SUM(i.total_inc),0)::numeric(12,2) AS total_inc
            FROM invoices i
            WHERE i.company_id=$1 AND i.is_returned=FALSE AND i.issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz{branch_filter}
            GROUP BY 1, i.source ORDER BY 1""",
        *params,
    )
    top_rows = await fetch(
        f"""SELECT i.source, ii.label, SUM(ii.qty)::int AS qty,
                   COALESCE(SUM(ii.line_inc),0)::numeric(12,2) AS total_inc
            FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
            WHERE i.company_id=$1 AND i.is_returned=FALSE AND i.issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz{branch_filter}
            GROUP BY i.source, ii.label ORDER BY qty DESC""",
        *params,
    )

    def blank():
        return {"invoiceCount": 0, "totalEx": 0, "totalVat": 0, "totalInc": 0, "creditTotal": 0,
                "avgTicket": 0, "cogs": 0, "grossProfit": 0, "marginPct": 0,
                "byMethod": {"cash": 0, "card": 0, "transfer": 0, "credit": 0}, "topItems": []}

    out = {"car": blank(), "pos": blank()}
    for r in by_source_rows:
        s = out[r["source"]]
        s["invoiceCount"] = r["invoice_count"]
        s["totalEx"] = _num(r["total_ex"]); s["totalVat"] = _num(r["total_vat"])
        s["totalInc"] = _num(r["total_inc"]); s["creditTotal"] = _num(r["credit_total"])
        s["avgTicket"] = _num(r["avg_ticket"])
    for r in margin_rows:
        s = out.get(r["source"])
        if not s:
            continue
        s["cogs"] = _num(r["cogs"])
        s["grossProfit"] = round(s["totalEx"] - s["cogs"], 2)
        s["marginPct"] = round((s["grossProfit"] / s["totalEx"]) * 100, 1) if s["totalEx"] > 0 else 0
    for r in pay_rows:
        if r["source"] in out:
            out[r["source"]]["byMethod"][r["method"]] = _num(r["amount"])
    for r in top_rows:
        s = out.get(r["source"])
        if not s or len(s["topItems"]) >= 10:
            continue
        s["topItems"].append({"label": r["label"], "qty": r["qty"], "totalInc": _num(r["total_inc"])})

    totals = {
        "invoiceCount": out["car"]["invoiceCount"] + out["pos"]["invoiceCount"],
        "totalEx": round(out["car"]["totalEx"] + out["pos"]["totalEx"], 2),
        "totalInc": round(out["car"]["totalInc"] + out["pos"]["totalInc"], 2),
        "grossProfit": round(out["car"]["grossProfit"] + out["pos"]["grossProfit"], 2),
    }

    return {
        "from": f, "to": t, "branchId": branch_id, "groupBy": group_by,
        "service": out["car"], "retail": out["pos"], "totals": totals,
        "daily": [{"day": r["day"].isoformat(), "source": r["source"],
                  "invoiceCount": r["invoice_count"], "totalInc": _num(r["total_inc"])} for r in daily_rows],
    }

# ══════════════════ لوحة القيادة ══════════════════

async def dashboard(company_id: str) -> dict:
    from ...core.db import fetch, fetchrow

    today = await fetchrow(
        """SELECT COALESCE(SUM(total_inc),0) AS total, COUNT(*) AS cnt,
                  COALESCE(SUM(total_ex - COALESCE(cogs_total,0)),0) AS profit
           FROM invoices
           WHERE company_id=$1 AND is_returned=FALSE AND issued_at::date = CURRENT_DATE""",
        company_id)
    month = await fetchrow(
        """SELECT COALESCE(SUM(total_inc),0) AS total, COUNT(*) AS cnt,
                  COALESCE(SUM(total_vat),0) AS vat,
                  COALESCE(SUM(total_ex - COALESCE(cogs_total,0)),0) AS profit
           FROM invoices
           WHERE company_id=$1 AND is_returned=FALSE
             AND date_trunc('month', issued_at) = date_trunc('month', CURRENT_DATE)""",
        company_id)
    cars = await fetchrow(
        """SELECT
             COUNT(*) FILTER (WHERE entered_at IS NULL AND exited_at IS NULL) AS queued,
             COUNT(*) FILTER (WHERE entered_at IS NOT NULL AND exited_at IS NULL) AS in_service,
             COUNT(*) FILTER (WHERE exited_at::date = CURRENT_DATE) AS done_today
           FROM cars WHERE company_id=$1 AND is_deleted=FALSE""",
        company_id)
    today_src = await fetch(
        """SELECT source, COUNT(*)::int AS cnt
           FROM invoices
           WHERE company_id=$1 AND is_returned=FALSE AND issued_at::date = CURRENT_DATE
           GROUP BY source""", company_id)
    low_stock = await fetchrow(
        """SELECT COUNT(*) AS cnt FROM inventory i
           JOIN products p ON p.id = i.product_id
           WHERE p.company_id=$1 AND i.loc_type='branch' AND i.qty <= COALESCE(p.min_qty,0)""",
        company_id)
    credit = await fetchrow(
        """SELECT COALESCE(SUM(credit_total),0) AS total
           FROM invoices WHERE company_id=$1 AND is_returned=FALSE AND credit_total > 0""",
        company_id)
    series = await fetch(
        """SELECT issued_at::date AS d,
                  COALESCE(SUM(total_inc),0) AS total, COUNT(*) AS cnt
           FROM invoices
           WHERE company_id=$1 AND is_returned=FALSE
             AND issued_at >= CURRENT_DATE - INTERVAL '13 days'
           GROUP BY 1 ORDER BY 1""",
        company_id)
    pay = await fetch(
        """SELECT p.method, COALESCE(SUM(p.amount),0) AS total
           FROM invoice_payments p
           JOIN invoices i ON i.id = p.invoice_id
           WHERE i.company_id=$1 AND i.is_returned=FALSE
             AND date_trunc('month', i.issued_at) = date_trunc('month', CURRENT_DATE)
           GROUP BY p.method""",
        company_id)

    # ── عدادات المنظومة + الأكثر مبيعاً + آخر الفواتير (للوحة القيادة الجديدة) ──
    # قاعدة الصلابة: أي ودجة إضافية استعلامها فشل (عمود ناقص في قاعدة قديمة مثلاً)
    # بتتصفّر لوحدها — الداشبورد الأساسية عمرها ما تقع بسببها
    async def _safe(coro, default):
        try:
            return await coro
        except Exception as e:
            print(f"⚠ ودجة داشبورد اتصفّرت: {type(e).__name__}: {e}")
            return default

    counts = await _safe(fetchrow(
        """SELECT
             (SELECT COUNT(*) FROM customers WHERE company_id=$1) AS customers,
             (SELECT COUNT(*) FROM suppliers WHERE company_id=$1) AS suppliers,
             (SELECT COUNT(*) FROM products  WHERE company_id=$1 AND is_active=TRUE) AS products""",
        company_id), {"customers": 0, "suppliers": 0, "products": 0})
    top_products = await _safe(fetch(
        """SELECT ii.label AS label,
                  SUM(ii.qty)::int AS qty,
                  COALESCE(SUM(ii.line_inc),0) AS total
           FROM invoice_items ii
           JOIN invoices i ON i.id = ii.invoice_id
           WHERE i.company_id=$1 AND i.is_returned=FALSE
             AND date_trunc('month', i.issued_at) = date_trunc('month', CURRENT_DATE)
           GROUP BY ii.label ORDER BY total DESC LIMIT 5""",
        company_id), [])
    recent_invoices = await _safe(fetch(
        """SELECT invoice_no, customer_name, total_inc, source, issued_at,
                  (credit_total > 0) AS on_credit
           FROM invoices WHERE company_id=$1 AND is_returned=FALSE
           ORDER BY issued_at DESC LIMIT 6""",
        company_id), [])

    # ── العملاء الجدد (هذا الأسبوع) + أفضل الموردين (هذا الشهر بالمشتريات) ──
    new_customers = await _safe(fetchrow(
        """SELECT COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE) AS today,
                  COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE - INTERVAL '6 days') AS week
           FROM customers WHERE company_id=$1""", company_id), {"today": 0, "week": 0})
    latest_customers = await _safe(fetch(
        """SELECT name, phone, created_at FROM customers
           WHERE company_id=$1 ORDER BY created_at DESC LIMIT 4""", company_id), [])
    # العملاء الأكثر زيارة — الزيارة = سيارة دخلت المركز فعلاً (سجل السيارات)،
    # والإنفاق من فواتيره إن وُجدت — فتشتغل حتى قبل ربط الفواتير بالعملاء
    top_customers = await _safe(fetch(
        """SELECT * FROM (
             SELECT c.name, c.phone,
                    (SELECT COUNT(*) FROM cars cr
                      WHERE cr.customer_id = c.id
                        AND COALESCE(cr.is_deleted, FALSE) = FALSE)::int AS visits,
                    COALESCE((SELECT SUM(i.total_inc) FROM invoices i
                               WHERE i.customer_id = c.id AND i.is_returned=FALSE),0)::numeric(12,2) AS total
             FROM customers c
             WHERE c.company_id=$1 AND c.is_active=TRUE
           ) t WHERE t.visits > 0
           ORDER BY t.visits DESC, t.total DESC LIMIT 5""", company_id), [])

    top_suppliers = await _safe(fetch(
        """SELECT s.name, COALESCE(SUM(pi.total),0) AS total, COUNT(pi.id)::int AS cnt
           FROM purchase_invoices pi JOIN suppliers s ON s.id = pi.supplier_id
           WHERE pi.company_id=$1
             AND date_trunc('month', pi.invoice_date) = date_trunc('month', CURRENT_DATE)
           GROUP BY s.name ORDER BY total DESC LIMIT 4""", company_id), [])

    def n(v):
        from decimal import Decimal
        return float(v) if isinstance(v, Decimal) else (v or 0)

    return {
        "today":   {"total": n(today["total"]), "count": today["cnt"], "profit": n(today["profit"])},
        "month":   {"total": n(month["total"]), "count": month["cnt"], "vat": n(month["vat"]), "profit": n(month["profit"])},
        "cars":    {"queued": cars["queued"], "inService": cars["in_service"], "doneToday": cars["done_today"]},
        "counts":  {"customers": counts["customers"], "suppliers": counts["suppliers"], "products": counts["products"]},
        "topProducts": [{"label": r["label"], "qty": r["qty"], "total": n(r["total"])} for r in top_products],
        "recentInvoices": [{"no": r["invoice_no"], "customer": r["customer_name"] or "بيع نقدي",
                            "total": n(r["total_inc"]), "source": r["source"],
                            "onCredit": r["on_credit"], "at": r["issued_at"].isoformat()} for r in recent_invoices],
        "newCustomers": {"today": new_customers["today"], "week": new_customers["week"],
                         "latest": [{"name": r["name"], "phone": r["phone"]} for r in latest_customers]},
        "topSuppliers": [{"name": r["name"], "total": n(r["total"]), "count": r["cnt"]} for r in top_suppliers],
        "topCustomers": [{"name": r["name"], "phone": r["phone"],
                          "visits": r["visits"], "total": n(r["total"])} for r in top_customers],
        "todayBySource": {r["source"]: r["cnt"] for r in today_src},
        "lowStock": low_stock["cnt"],
        "creditOutstanding": n(credit["total"]),
        "series":  [{"date": str(r["d"]), "total": n(r["total"]), "count": r["cnt"]} for r in series],
        "payMethods": [{"method": r["method"], "total": n(r["total"])} for r in pay],
    }



def n(v) -> float:
    """تحويل أرقام القاعدة (Decimal/None) لرقم عائم آمن"""
    return float(v or 0)


async def branches_compare(company_id: str, days: int = 30,
                           month: str | None = None) -> dict:
    """مقارنة أداء الفروع — وضعان:
    days: نافذة متحركة (آخر N يوم) · month="YYYY-MM": شهر تقويمي كامل
    (الشهر الجاري = من يوم 1 حتى اللحظة، والشهور الماضية محفوظة بالكامل)"""
    if month:
        # حدود الشهر التقويمي [أوله، أول الشهر التالي) — asyncpg يطلب كائن تاريخ لا نصاً
        import datetime as _dt
        start = _dt.date(int(month[:4]), int(month[5:7]), 1)
        inv_cond = "i.issued_at >= $2::date AND i.issued_at < ($2::date + INTERVAL '1 month')"
        car_cond = "exited_at >= $2::date AND exited_at < ($2::date + INTERVAL '1 month')"
        period_arg = start
    else:
        inv_cond = "i.issued_at >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'"
        car_cond = "exited_at >= CURRENT_DATE - ($2::int - 1) * INTERVAL '1 day'"
        period_arg = days
    rows = await fetch(
        f"""SELECT b.id, b.name,
                  COUNT(i.id)::int AS invoices,
                  COALESCE(SUM(i.total_inc),0)::numeric(12,2) AS revenue,
                  COALESCE(AVG(i.total_inc),0)::numeric(12,2) AS avg_invoice,
                  COALESCE(SUM(i.total_ex - COALESCE(i.cogs_total,0)),0)::numeric(12,2) AS gross_profit
           FROM branches b
           LEFT JOIN invoices i ON i.branch_id = b.id AND i.is_returned=FALSE
                AND {inv_cond}
           WHERE b.company_id=$1
           GROUP BY b.id, b.name ORDER BY revenue DESC""",
        company_id, period_arg)
    cars = await fetch(
        f"""SELECT branch_id, COUNT(*)::int AS served
           FROM cars WHERE company_id=$1 AND exited_at IS NOT NULL
             AND {car_cond}
             AND COALESCE(is_deleted, FALSE)=FALSE
           GROUP BY branch_id""", company_id, period_arg)
    served = {str(r["branch_id"]): r["served"] for r in cars}
    return {"days": days, "month": month, "branches": [{
        "id": str(r["id"]), "name": r["name"], "invoices": r["invoices"],
        "revenue": n(r["revenue"]), "avgInvoice": n(r["avg_invoice"]),
        "grossProfit": n(r["gross_profit"]),
        "carsServed": served.get(str(r["id"]), 0),
    } for r in rows]}
