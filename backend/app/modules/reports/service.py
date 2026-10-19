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

    # ── لوحة المؤشرات التنفيذية: أبرز نواقص المخزون + ملخّص أعمار ذمم العملاء ──
    # (نفس منطق /inventory/low-stock-alerts و /reports/ar-aging لكن بأعلى N بس،
    # وبصلابة _safe لأن أي خطأ فيهما ما يكسرش الداشبورد الأساسية)
    async def _low_stock_top():
        from ..inventory.service import low_stock_alerts
        return (await low_stock_alerts(company_id))[:8]
    low_stock_items = await _safe(_low_stock_top(), [])
    ar_summary = await _safe(ar_aging(company_id, summary_only=True), {"totals": {"current": 0, "d31_60": 0, "d61_90": 0, "d90plus": 0, "total": 0}})

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
        "lowStockItems": low_stock_items,
        "creditOutstanding": n(credit["total"]),
        "arAging": ar_summary["totals"],
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


# ══════════════════ تقييم وأعمار المخزون ══════════════════

async def inventory_valuation(company_id: str) -> dict:
    """قيمة المخزون الحالية (كمية × تكلفة) مجمّعة بالصنف، مع عمر كل صنف منذ
    آخر استلام (يفيد في رصد الأصناف الراكدة). الخدمات مستبعدة لأنها بلا مخزون."""
    rows = await fetch(
        """SELECT p.id, p.name, p.category, COALESCE(p.cost_price,0)::numeric(12,2) AS cost_price,
                  COALESCE(SUM(inv.qty),0)::numeric(12,2) AS qty,
                  (SELECT MAX(sm.created_at) FROM stock_moves sm
                    WHERE sm.product_id = p.id AND sm.move_type='receive') AS last_received_at
           FROM products p
           LEFT JOIN inventory inv ON inv.product_id = p.id AND inv.company_id = p.company_id
           WHERE p.company_id=$1 AND p.is_active=TRUE AND p.is_service=FALSE
           GROUP BY p.id, p.name, p.category, p.cost_price
           HAVING COALESCE(SUM(inv.qty),0) != 0
           ORDER BY (COALESCE(SUM(inv.qty),0) * COALESCE(p.cost_price,0)) DESC""",
        company_id,
    )

    def bucket_of(days: float | None) -> str:
        if days is None:
            return "unknown"      # دخل المخزون قبل تسجيل حركات الاستلام — عمره غير معروف
        if days <= 30:
            return "fresh"
        if days <= 60:
            return "d30"
        if days <= 90:
            return "d60"
        return "d90"

    today_ts = __import__("datetime").datetime.now(__import__("datetime").timezone.utc)
    by_product = []
    buckets = {"fresh": 0.0, "d30": 0.0, "d60": 0.0, "d90": 0.0, "unknown": 0.0}
    by_category: dict[str, dict] = {}
    total_value = 0.0
    for r in rows:
        qty = _num(r["qty"]); cost = _num(r["cost_price"]); value = round(qty * cost, 2)
        days = (today_ts - r["last_received_at"]).days if r["last_received_at"] else None
        b = bucket_of(days)
        buckets[b] = round(buckets[b] + value, 2)
        total_value = round(total_value + value, 2)
        cat = r["category"] or "غير مصنّف"
        cs = by_category.setdefault(cat, {"category": cat, "qty": 0.0, "value": 0.0})
        cs["qty"] = round(cs["qty"] + qty, 2); cs["value"] = round(cs["value"] + value, 2)
        by_product.append({
            "productId": str(r["id"]), "name": r["name"], "category": cat,
            "qty": qty, "costPrice": cost, "value": value,
            "daysSinceReceive": days, "ageBucket": b,
        })

    return {
        "asOf": today_ts.date().isoformat(), "totalValue": total_value,
        "agingBuckets": buckets, "byCategory": sorted(by_category.values(), key=lambda c: -c["value"]),
        "byProduct": by_product,
    }


# ══════════════════ تقرير الربحية ══════════════════

async def profitability(company_id: str, date_from: str | None, date_to: str | None,
                        group_by: str) -> dict:
    """ربحية مجمّعة بالصنف أو الفئة أو الفرع خلال فترة — نفس منطق هامش ملخص المبيعات
    لكن بتفصيل أعمق من مجرد خدمة/بيع بالقطعة."""
    f, t, t_end = _period(date_from, date_to)
    if group_by == "category":
        key_expr, label_expr, join_products = "p.category", "COALESCE(p.category,'غير مصنّف')", True
    elif group_by == "branch":
        key_expr, label_expr, join_products = "i.branch_id::text", "COALESCE(b.name,'بلا فرع')", False
    else:
        group_by = "product"
        key_expr, label_expr, join_products = "ii.label", "ii.label", True

    branch_join = "LEFT JOIN branches b ON b.id = i.branch_id" if group_by == "branch" else ""
    products_join = "LEFT JOIN products p ON p.id = ii.product_id" if join_products else ""

    rows = await fetch(
        f"""SELECT {key_expr} AS grp_key, {label_expr} AS label,
                   SUM(ii.qty)::numeric(12,2) AS qty,
                   COALESCE(SUM(ii.line_ex),0)::numeric(12,2) AS revenue_ex,
                   COALESCE(SUM(ii.qty * COALESCE(p2.cost_price,0)),0)::numeric(12,2) AS cogs
            FROM invoice_items ii
            JOIN invoices i ON i.id = ii.invoice_id
            {branch_join}
            {products_join}
            LEFT JOIN products p2 ON p2.id = ii.product_id
            WHERE i.company_id=$1 AND i.is_returned=FALSE
              AND i.issued_at BETWEEN $2::text::timestamptz AND $3::text::timestamptz
            GROUP BY {key_expr}, {label_expr}
            ORDER BY revenue_ex DESC""",
        company_id, f, t_end,
    )
    out = []
    tot_rev = tot_cogs = tot_qty = 0.0
    for r in rows:
        qty = _num(r["qty"]); rev = _num(r["revenue_ex"]); cogs = _num(r["cogs"])
        profit = round(rev - cogs, 2)
        margin = round((profit / rev) * 100, 1) if rev > 0 else 0
        tot_rev += rev; tot_cogs += cogs; tot_qty += qty
        out.append({
            "key": r["grp_key"], "label": r["label"] or "—", "qty": qty,
            "revenueEx": rev, "cogs": cogs, "grossProfit": profit, "marginPct": margin,
        })
    tot_profit = round(tot_rev - tot_cogs, 2)
    return {
        "from": f, "to": t, "groupBy": group_by, "rows": out,
        "totals": {
            "qty": round(tot_qty, 2), "revenueEx": round(tot_rev, 2), "cogs": round(tot_cogs, 2),
            "grossProfit": tot_profit,
            "marginPct": round((tot_profit / tot_rev) * 100, 1) if tot_rev > 0 else 0,
        },
    }


# ══════════════════ أعمار ذمم العملاء (AR Aging) ══════════════════

async def ar_aging(company_id: str, summary_only: bool = False) -> dict:
    """عمر كل ريال مستحق على العميل منذ تاريخ فاتورته — السداد يُطبَّق على الأقدم
    أولاً (FIFO) لأن النظام الحالي يسجّل السداد على مستوى العميل لا الفاتورة."""
    import datetime as _dt

    rows = await fetch(
        """SELECT cl.customer_id, c.name AS customer_name, c.phone AS customer_phone,
                  cl.entry_type, cl.amount, cl.created_at,
                  i.issued_at
           FROM customer_ledger cl
           JOIN customers c ON c.id = cl.customer_id
           LEFT JOIN invoices i ON i.id = cl.invoice_id
           WHERE cl.company_id=$1
           ORDER BY cl.customer_id, COALESCE(i.issued_at, cl.created_at)""",
        company_id,
    )

    by_customer: dict[str, dict] = {}
    for r in rows:
        cid = str(r["customer_id"])
        c = by_customer.setdefault(cid, {
            "customerId": cid, "name": r["customer_name"], "phone": r["customer_phone"],
            "invoices": [], "reduction": Decimal("0.00"),
        })
        if r["entry_type"] == "invoice" and r["amount"] and r["amount"] > 0:
            d = (r["issued_at"] or r["created_at"])
            d = d.date() if hasattr(d, "date") else d
            c["invoices"].append({"date": d, "remaining": Decimal(str(r["amount"]))})
        else:
            # سداد أو مرتجع: يخفّض الرصيد — يُطبَّق على أقدم فاتورة أولاً
            c["reduction"] += Decimal(str(-r["amount"])) if r["amount"] < 0 else Decimal("0.00")

    today = _dt.date.today()
    out = []
    totals = {"current": 0.0, "d31_60": 0.0, "d61_90": 0.0, "d90plus": 0.0, "total": 0.0}
    for cid, c in by_customer.items():
        left = c["reduction"]
        for inv in c["invoices"]:
            if left <= 0:
                break
            consume = min(left, inv["remaining"])
            inv["remaining"] -= consume
            left -= consume
        buckets = {"current": Decimal("0.00"), "d31_60": Decimal("0.00"),
                  "d61_90": Decimal("0.00"), "d90plus": Decimal("0.00")}
        for inv in c["invoices"]:
            if inv["remaining"] <= 0:
                continue
            age = (today - inv["date"]).days
            key = "current" if age <= 30 else "d31_60" if age <= 60 else "d61_90" if age <= 90 else "d90plus"
            buckets[key] += inv["remaining"]
        total = sum(buckets.values())
        if total <= 0:
            continue
        row = {"customerId": cid, "name": c["name"], "phone": c["phone"],
               "current": _num(buckets["current"]), "d31_60": _num(buckets["d31_60"]),
               "d61_90": _num(buckets["d61_90"]), "d90plus": _num(buckets["d90plus"]),
               "total": _num(total)}
        out.append(row)
        for k in ("current", "d31_60", "d61_90", "d90plus"):
            totals[k] = round(totals[k] + row[k], 2)
        totals["total"] = round(totals["total"] + row["total"], 2)
    out.sort(key=lambda r: -r["total"])
    if summary_only:
        return {"totals": totals}
    return {"rows": out, "totals": totals}
