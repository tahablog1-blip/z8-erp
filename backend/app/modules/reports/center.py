# modules/reports/center.py — مركز التقارير: فهرس التقارير (حسب الصلاحية) + تفضيلات المستخدم + تقارير قراءة فقط
# كل الأرقام تُجمَّع هنا في الخادم من الجداول الفعلية (بتوقيت الرياض) — لا حساب مالي في الواجهة.
# لا يكتب في أي جدول مالي/مخزني: الكتابة الوحيدة هي تفضيلات المستخدم (company_settings) وأثر التدقيق (audit_log).
import datetime as dt
import json
from decimal import Decimal

from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow

RIYADH_DAY = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"

# ══════════════════ الفهرس ══════════════════
# route: الشاشة التي تفتح التقرير (موجودة فعلاً أو تقرير مركز التقارير الجديد). perms: أي مفتاح يكفي (الأدمن يملك الكل).
# sensitive: يُسجَّل فتحه في التدقيق.
CATEGORIES = [
    ("executive", "التنفيذي", "dashboard"), ("financial", "المالية", "account_balance"), ("sales", "المبيعات", "receipt_long"),
    ("purchases", "المشتريات", "shopping_cart"), ("inventory", "المخزون", "warehouse"), ("treasury", "الخزينة", "payments"),
    ("customers", "العملاء", "groups"), ("suppliers", "الموردون", "local_shipping"), ("hr", "الموارد البشرية", "badge"),
    ("branches", "الفروع", "storefront"), ("operations", "التشغيل", "directions_car"),
]
_FIN = ("accounting.view_reports",)
CATALOG: list[dict] = [
    # ── تنفيذي
    dict(id="executive", cat="executive", title="لوحة القيادة التنفيذية", icon="dashboard", route="/dashboard", perms=(), sensitive=False,
         desc="مبيعات، أرباح، مصروفات، نقدية، ذمم، مخزون وفروع بفترة محددة ومقارنة بالفترة السابقة.", tags="مؤشرات أداء إدارة ملخص"),
    # ── مالية
    dict(id="trial-balance", cat="financial", title="ميزان المراجعة", icon="balance", route="/accounting?tab=trial-balance", perms=_FIN, sensitive=True,
         desc="أرصدة الحسابات المدينة والدائنة في تاريخ محدد مع فحص الاتزان.", tags="حسابات أستاذ مدين دائن"),
    dict(id="income-statement", cat="financial", title="قائمة الدخل (الأرباح والخسائر)", icon="trending_up", route="/accounting?tab=income-statement", perms=_FIN, sensitive=True,
         desc="الإيرادات والمصروفات وصافي الربح من دفتر اليومية لفترة.", tags="ربح خسارة إيرادات مصروفات"),
    dict(id="balance-sheet", cat="financial", title="الميزانية العمومية", icon="account_balance", route="/accounting?tab=balance-sheet", perms=_FIN, sensitive=True,
         desc="الأصول والالتزامات وحقوق الملكية في تاريخ محدد.", tags="أصول التزامات ملكية"),
    dict(id="journal", cat="financial", title="دفتر اليومية", icon="menu_book", route="/accounting?tab=journal", perms=_FIN, sensitive=True,
         desc="القيود المحاسبية بالتاريخ والمصدر والفرع.", tags="قيود أستاذ حركة الحسابات"),
    dict(id="chart-of-accounts", cat="financial", title="دليل الحسابات", icon="account_tree", route="/accounting?tab=accounts", perms=_FIN, sensitive=False,
         desc="شجرة الحسابات وأكوادها وأنواعها.", tags="حسابات شجرة"),
    dict(id="vat-return", cat="financial", title="تقرير الضريبة (الإقرار)", icon="request_quote", route="/reports/analysis?tab=vat", perms=("accounting.view_vat",), sensitive=True,
         desc="ضريبة المخرجات والمدخلات وصافي المستحق للهيئة — بنسب الضريبة المسجّلة في النظام.", tags="vat ضريبة زكاة هيئة"),
    dict(id="profitability", cat="financial", title="تقرير الربحية", icon="monetization_on", route="/reports/analysis?tab=profit", perms=_FIN, sensitive=True,
         desc="المبيعات والتكلفة ومجمل الربح والهامش بالصنف أو التصنيف أو الفرع.", tags="ربح هامش تكلفة مبيعات"),
    # ── مبيعات
    dict(id="sales-summary", cat="sales", title="ملخص المبيعات", icon="point_of_sale", route="/reports/analysis?tab=sales", perms=("reports.sales", "accounting.view_reports"), sensitive=False,
         desc="المبيعات اليومية/الشهرية بالمصدر وطريقة الدفع ومجمل الربح.", tags="مبيعات يومية شهرية فواتير"),
    dict(id="payment-methods", cat="sales", title="المبيعات حسب طريقة الدفع", icon="credit_card", route="/reports/payment-methods", perms=("reports.sales", "accounting.view_reports"), sensitive=False,
         desc="القيمة وعدد العمليات والنسبة لكل طريقة دفع، بالفرع والفترة.", tags="نقدي شبكة تحويل بطاقة آجل دفع"),
    dict(id="invoices", cat="sales", title="سجل الفواتير", icon="receipt", route="/sales/history", perms=("invoices.view_all", "invoices.view_today", "invoices.view_pending"), sensitive=False,
         desc="كل الفواتير بالفلاتر: الفرع، العميل، الحالة، المرتجعات.", tags="فواتير مرتجعات آجلة"),
    dict(id="zatca-status", cat="sales", title="حالة الفواتير الضريبية", icon="qr_code_2", route="/reports/zatca-status", perms=("accounting.view_vat", "accounting.view_reports"), sensitive=False,
         desc="الفواتير حسب حالة الإرسال المسجّلة ووجود رمز QR. لا يشمل تحققاً فعلياً من الهيئة.", tags="zatca qr فاتورة ضريبية"),
    # ── مشتريات
    dict(id="purchases", cat="purchases", title="تقرير المشتريات", icon="shopping_cart", route="/reports/purchases", perms=("purchasing.invoices", "accounting.view_reports"), sensitive=False,
         desc="المشتريات بالمورد والشهر: الإجمالي والضريبة والمدفوع والمتبقي.", tags="مشتريات موردين فواتير شراء"),
    dict(id="purchases-center", cat="purchases", title="فواتير المشتريات وأوامر الشراء", icon="inventory_2", route="/purchases", perms=("purchasing.invoices", "purchasing.orders"), sensitive=False,
         desc="الفواتير والأوامر وعروض الأسعار.", tags="أوامر شراء عروض"),
    # ── مخزون
    dict(id="inventory-valuation", cat="inventory", title="تقييم المخزون وأعماره", icon="warehouse", route="/reports/analysis?tab=inventory", perms=_FIN, sensitive=True,
         desc="قيمة المخزون الحالية بتكلفة الصنف المعتمدة في النظام وأعمار الأصناف الراكدة.", tags="قيمة مخزون راكد تكلفة"),
    dict(id="stock-center", cat="inventory", title="مركز المخزون (أرصدة، حركة، تنبيهات)", icon="inventory", route="/inventory", perms=("products.view_stock",), sensitive=False,
         desc="الرصيد بالموقع، حركة المخزون، النافد والمنخفض، الوارد والمنصرف والتحويلات.", tags="رصيد حركة نافد منخفض تحويلات"),
    dict(id="stocktake", cat="inventory", title="تقرير الجرد وفروقاته", icon="fact_check", route="/inventory/stocktake", perms=("inventory.stocktake", "inventory.stocktake_approve", "products.view_stock"), sensitive=False,
         desc="جلسات الجرد، الكمية النظامية والفعلية والفروقات وقيمتها.", tags="جرد فروقات تسوية"),
    # ── خزينة
    dict(id="treasury-report", cat="treasury", title="حركة الخزينة", icon="payments", route="/reports/treasury", perms=("treasury.view", "accounting.view_reports"), sensitive=True,
         desc="المقبوضات والمدفوعات بالطريقة والتصنيف والفرع وصافي الحركة.", tags="مقبوضات مدفوعات سندات صناديق"),
    dict(id="treasury-center", cat="treasury", title="سندات الخزينة والحسابات البنكية", icon="account_balance_wallet", route="/treasury", perms=("treasury.view",), sensitive=True,
         desc="السندات والبنوك والمطابقة البنكية.", tags="بنوك سندات قبض صرف"),
    # ── عملاء / موردون
    dict(id="customers", cat="customers", title="مركز العملاء (أرصدة وكشف حساب)", icon="groups", route="/customers", perms=("customers.view_statement", "customers.create", "customers.edit"), sensitive=False,
         desc="أرصدة العملاء، كشف الحساب، المبيعات والمدفوعات والعملاء الأكثر شراءً.", tags="عملاء كشف حساب أرصدة"),
    dict(id="ar-aging", cat="customers", title="أعمار ديون العملاء", icon="hourglass_bottom", route="/reports/analysis?tab=ar", perms=_FIN, sensitive=True,
         desc="المستحق على العملاء حسب عمر الدين.", tags="ذمم تحصيل أعمار ديون"),
    dict(id="suppliers", cat="suppliers", title="مركز الموردين (المستحقات والأعمار)", icon="local_shipping", route="/suppliers", perms=("purchasing.suppliers",), sensitive=False,
         desc="أرصدة الموردين، المتأخر، أعمار الديون، كشف حساب المورد.", tags="موردين مستحقات أعمار كشف"),
    # ── موارد بشرية
    dict(id="hr-dashboard", cat="hr", title="لوحة الموارد البشرية", icon="badge", route="/hr", perms=("hr.view", "hr.manage"), sensitive=False,
         desc="الموظفون، الحضور والغياب والتأخير، الإجازات، العقود والمستندات المنتهية.", tags="موظفين حضور إجازات عقود"),
    dict(id="hr-payroll", cat="hr", title="الرواتب والسلف", icon="request_page", route="/hr?tab=payroll", perms=("hr.payroll",), sensitive=True,
         desc="مسيرات الرواتب والقسائم والسلف.", tags="رواتب بدلات خصومات سلف"),
    # ── فروع / تشغيل
    dict(id="branches-compare", cat="branches", title="مقارنة الفروع", icon="compare_arrows", route="/reports/analysis", perms=("reports.view", "accounting.view_reports"), sensitive=True,
         desc="مبيعات وأرباح وفواتير كل فرع مع ترتيب ومقارنة بفترة سابقة.", tags="فروع مقارنة أداء"),
    dict(id="technicians", cat="operations", title="إنتاجية الفنيين", icon="engineering", route="/reports/analysis?tab=techs", perms=("reports.sales", "reports.view", "accounting.view_reports"), sensitive=False,
         desc="السيارات والخدمات لكل فني بالفترة والفرع.", tags="فنيين سيارات خدمات أداء موظفين"),
    dict(id="service-line", cat="operations", title="خط الخدمة والسيارات", icon="directions_car", route="/cars", perms=("cars.create", "cars.confirm_entry", "cars.confirm_exit"), sensitive=False,
         desc="السيارات في الخدمة والدور والخروج.", tags="سيارات تغيير زيت خدمة"),
]
CAT_IDS = {c["id"] for c in CATALOG}


def _allowed(user, r: dict) -> bool:
    return not r["perms"] or user.has(*r["perms"])


def catalog_for(user) -> dict:
    """الفهرس المتاح للمستخدم فقط — الحجب هنا في الخادم (والـ endpoint نفسه يتحقق من صلاحيته بشكل مستقل)"""
    cats = [{"id": i, "title": t, "icon": ic} for i, t, ic in CATEGORIES]
    rows = [{**{k: v for k, v in r.items() if k != "perms"}} for r in CATALOG if _allowed(user, r)]
    used = {r["cat"] for r in rows}
    return {"categories": [c for c in cats if c["id"] in used], "reports": rows}


# ══════════════════ تفضيلات المستخدم (مفضلة / آخر التقارير / المحفوظة) ══════════════════

def _pkey(user) -> str:
    return f"reports_prefs:{user.user_id}"


async def get_prefs(user) -> dict:
    row = await fetchrow("SELECT value FROM company_settings WHERE company_id=$1 AND key=$2", user.company_id, _pkey(user))
    try:
        d = json.loads(row["value"]) if row else {}
    except Exception:
        d = {}
    ok = {r["id"] for r in CATALOG if _allowed(user, r)}
    return {"favorites": [x for x in d.get("favorites", []) if x in ok],
            "recents": [x for x in d.get("recents", []) if x.get("id") in ok][:8],
            "saved": [x for x in d.get("saved", []) if x.get("reportId") in ok][:30]}


async def put_prefs(user, favorites: list[str] | None, saved: list[dict] | None) -> dict:
    cur = await get_prefs(user)
    ok = {r["id"] for r in CATALOG if _allowed(user, r)}
    if favorites is not None:
        cur["favorites"] = [x for x in dict.fromkeys(favorites) if x in ok][:24]
    if saved is not None:
        clean = []
        for s in saved[:30]:
            if s.get("reportId") not in ok:
                continue
            name = str(s.get("name") or "").strip()[:80]
            filters = s.get("filters") if isinstance(s.get("filters"), dict) else {}
            if name and len(json.dumps(filters)) < 2000:
                clean.append({"id": str(s.get("id") or "")[:40] or None, "reportId": s["reportId"], "name": name, "filters": filters})
        cur["saved"] = clean
    await _save(user, cur)
    return cur


async def _save(user, d: dict) -> None:
    await execute(
        """INSERT INTO company_settings (company_id, key, value) VALUES ($1,$2,$3)
           ON CONFLICT (company_id, key) DO UPDATE SET value=EXCLUDED.value""",
        user.company_id, _pkey(user), json.dumps(d, ensure_ascii=False))


async def record_open(user, report_id: str) -> dict:
    """يُسجَّل فتح التقرير في آخر التقارير، وفي سجل التدقيق للتقارير الحساسة"""
    r = next((x for x in CATALOG if x["id"] == report_id), None)
    if not r or not _allowed(user, r):
        raise HTTPException(404, "التقرير غير موجود")
    cur = await get_prefs(user)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    cur["recents"] = ([{"id": report_id, "at": now}] + [x for x in cur["recents"] if x["id"] != report_id])[:8]
    await _save(user, cur)
    if r["sensitive"]:
        try:
            await execute(
                """INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details)
                   VALUES ($1,$2,$3,'report_open','reports',$4)""",
                user.company_id, user.user_id, user.full_name or user.email, report_id)
        except Exception as e:
            print(f"⚠ report audit: {e}")
    return {"ok": True}


# ══════════════════ أدوات مشتركة للتقارير ══════════════════

def _num(v) -> float:
    return float(v) if isinstance(v, Decimal) else (v or 0)


def riyadh_today() -> dt.date:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=3)).date()


def parse_range(date_from: str | None, date_to: str | None) -> tuple[dt.date, dt.date]:
    """افتراضي: من أول الشهر الحالي (بتوقيت الرياض) لليوم. يوم البداية والنهاية شاملان."""
    today = riyadh_today()
    try:
        f = dt.date.fromisoformat(date_from) if date_from else today.replace(day=1)
        t = dt.date.fromisoformat(date_to) if date_to else today
    except ValueError:
        raise HTTPException(422, "صيغة التاريخ: YYYY-MM-DD")
    if t < f:
        raise HTTPException(422, "تاريخ النهاية قبل البداية")
    if (t - f).days > 3660:
        raise HTTPException(422, "الفترة أطول من المسموح (10 سنوات)")
    return f, t


def _branch(user, branch_id: str | None) -> str | None:
    """مستخدم مقيَّد بفرع يرى فرعه فقط مهما طلب"""
    return user.branch_scope or (branch_id or None)


def _meta(user, f: dt.date, t: dt.date, branch: str | None) -> dict:
    return {"from": f.isoformat(), "to": t.isoformat(), "branchId": branch, "branchLocked": bool(user.branch_scope),
            "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(), "timezone": "Asia/Riyadh"}


# ══════════════════ المبيعات حسب طريقة الدفع ══════════════════

_METHOD_LABEL = {"cash": "نقدي", "card": "شبكة / بطاقة", "transfer": "تحويل بنكي", "credit": "آجل"}


async def payment_methods(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    p: list = [user.company_id, f, t]
    bc = ""
    if branch:
        p.append(branch); bc = f" AND i.branch_id = ${len(p)}::uuid"
    base = f"i.company_id=$1 AND NOT i.is_returned AND {RIYADH_DAY} BETWEEN $2 AND $3{bc}"
    rows = await fetch(
        f"""SELECT ip.method, COALESCE(SUM(ip.amount),0) AS amount, COUNT(*)::int AS n
            FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id WHERE {base} GROUP BY ip.method""", *p)
    credit = await fetchrow(
        f"""SELECT COALESCE(SUM(i.credit_total),0) AS amount, COUNT(*) FILTER (WHERE i.credit_total > 0)::int AS n
            FROM invoices i WHERE {base}""", *p)
    by_branch = await fetch(
        f"""SELECT COALESCE(b.name,'—') AS branch, ip.method, COALESCE(SUM(ip.amount),0) AS amount
            FROM invoice_payments ip JOIN invoices i ON i.id = ip.invoice_id LEFT JOIN branches b ON b.id = i.branch_id
            WHERE {base} GROUP BY b.name, ip.method ORDER BY 1""", *p)
    items = [{"method": r["method"], "label": _METHOD_LABEL.get(r["method"], r["method"]), "amount": _num(r["amount"]), "count": r["n"]} for r in rows]
    if _num(credit["amount"]) > 0:
        items.append({"method": "credit", "label": _METHOD_LABEL["credit"], "amount": _num(credit["amount"]), "count": credit["n"]})
    total = sum(i["amount"] for i in items)
    for i in items:
        i["sharePct"] = round(i["amount"] / total * 100, 1) if total else 0
    items.sort(key=lambda x: -x["amount"])
    br: dict[str, dict] = {}
    for r in by_branch:
        br.setdefault(r["branch"], {"branch": r["branch"], "total": 0.0, "byMethod": {}})
        br[r["branch"]]["byMethod"][r["method"]] = _num(r["amount"]); br[r["branch"]]["total"] += _num(r["amount"])
    return {"meta": _meta(user, f, t, branch), "totals": {"amount": round(total, 2), "count": sum(i["count"] for i in items)},
            "rows": items, "byBranch": list(br.values()),
            "note": "المدفوع عند الإصدار حسب طريقة الدفع، والآجل = المتبقي على العميل. تُستثنى الفواتير المرتجعة بالكامل."}


# ══════════════════ المشتريات ══════════════════

async def purchases_report(user, date_from, date_to, supplier_id) -> dict:
    if user.branch_scope:
        raise HTTPException(403, "فواتير المشتريات على مستوى الشركة — لا تُقيَّد بفرع، وهذا التقرير غير متاح لمستخدم مقيَّد بفرع")
    f, t = parse_range(date_from, date_to)
    p: list = [user.company_id, f, t]
    sc = ""
    if supplier_id:
        p.append(supplier_id); sc = f" AND pi.supplier_id = ${len(p)}::uuid"
    base = f"pi.company_id=$1 AND pi.invoice_date BETWEEN $2 AND $3 AND COALESCE(pi.status,'') <> 'cancelled'{sc}"
    tot = await fetchrow(
        f"""SELECT COUNT(*)::int AS n, COALESCE(SUM(subtotal),0) AS subtotal, COALESCE(SUM(vat_total),0) AS vat,
                   COALESCE(SUM(total),0) AS total, COALESCE(SUM(paid_total),0) AS paid FROM purchase_invoices pi WHERE {base}""", *p)
    by_sup = await fetch(
        f"""SELECT pi.supplier_id, COALESCE(s.name,'—') AS name, COUNT(*)::int AS n, COALESCE(SUM(pi.subtotal),0) AS subtotal,
                   COALESCE(SUM(pi.vat_total),0) AS vat, COALESCE(SUM(pi.total),0) AS total, COALESCE(SUM(pi.paid_total),0) AS paid
            FROM purchase_invoices pi LEFT JOIN suppliers s ON s.id = pi.supplier_id WHERE {base}
            GROUP BY pi.supplier_id, s.name ORDER BY total DESC LIMIT 200""", *p)
    by_month = await fetch(
        f"""SELECT to_char(pi.invoice_date,'YYYY-MM') AS month, COUNT(*)::int AS n, COALESCE(SUM(pi.total),0) AS total,
                   COALESCE(SUM(pi.vat_total),0) AS vat FROM purchase_invoices pi WHERE {base} GROUP BY 1 ORDER BY 1""", *p)
    fmt = lambda r: {**{k: (_num(v) if k in ("subtotal", "vat", "total", "paid") else v) for k, v in dict(r).items()}}
    out_sup = []
    for r in by_sup:
        d = fmt(r); d["supplier_id"] = str(d["supplier_id"]) if d["supplier_id"] else None
        d["remaining"] = round(d["total"] - d["paid"], 2); out_sup.append(d)
    T = fmt(tot); T["remaining"] = round(T["total"] - T["paid"], 2)
    return {"meta": _meta(user, f, t, None), "totals": T, "bySupplier": out_sup,
            "byMonth": [fmt(r) for r in by_month],
            "note": "المشتريات من فواتير الشراء غير الملغاة بتاريخ الفاتورة. المرتجعات للموردين غير مسجّلة كمستند في النظام."}


# ══════════════════ حركة الخزينة ══════════════════

async def treasury_report(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    p: list = [user.company_id, f, t]
    bc = ""
    if branch:
        p.append(branch); bc = f" AND v.branch_id = ${len(p)}::uuid"
    day = "(v.created_at AT TIME ZONE 'Asia/Riyadh')::date"
    base = f"v.company_id=$1 AND v.status <> 'cancelled' AND {day} BETWEEN $2 AND $3{bc}"
    by_tm = await fetch(
        f"""SELECT v.type, v.method, COUNT(*)::int AS n, COALESCE(SUM(v.amount),0) AS amount
            FROM treasury_vouchers v WHERE {base} GROUP BY v.type, v.method""", *p)
    by_cat = await fetch(
        f"""SELECT v.type, COALESCE(NULLIF(v.category,''),'غير مصنّف') AS category, COUNT(*)::int AS n, COALESCE(SUM(v.amount),0) AS amount
            FROM treasury_vouchers v WHERE {base} GROUP BY v.type, 2 ORDER BY amount DESC LIMIT 40""", *p)
    by_branch = await fetch(
        f"""SELECT COALESCE(b.name,'—') AS branch, v.type, COALESCE(SUM(v.amount),0) AS amount
            FROM treasury_vouchers v LEFT JOIN branches b ON b.id = v.branch_id WHERE {base} GROUP BY b.name, v.type""", *p)
    rec = sum(_num(r["amount"]) for r in by_tm if r["type"] == "receipt")
    pay = sum(_num(r["amount"]) for r in by_tm if r["type"] == "payment")
    br: dict[str, dict] = {}
    for r in by_branch:
        d = br.setdefault(r["branch"], {"branch": r["branch"], "receipts": 0.0, "payments": 0.0})
        d["receipts" if r["type"] == "receipt" else "payments"] += _num(r["amount"])
    for d in br.values():
        d["net"] = round(d["receipts"] - d["payments"], 2)
    return {"meta": _meta(user, f, t, branch),
            "totals": {"receipts": round(rec, 2), "payments": round(pay, 2), "net": round(rec - pay, 2),
                       "count": sum(r["n"] for r in by_tm)},
            "byMethod": [{"type": r["type"], "method": r["method"], "label": _METHOD_LABEL.get(r["method"], r["method"]), "count": r["n"], "amount": _num(r["amount"])} for r in by_tm],
            "byCategory": [{"type": r["type"], "category": r["category"], "count": r["n"], "amount": _num(r["amount"])} for r in by_cat],
            "byBranch": list(br.values()),
            "note": "سندات القبض والصرف غير الملغاة. أرصدة الصناديق والبنوك ومطابقتها من شاشة الخزينة."}


# ══════════════════ حالة الفواتير الضريبية ══════════════════

async def zatca_status(user, date_from, date_to, branch_id) -> dict:
    f, t = parse_range(date_from, date_to)
    branch = _branch(user, branch_id)
    p: list = [user.company_id, f, t]
    bc = ""
    if branch:
        p.append(branch); bc = f" AND i.branch_id = ${len(p)}::uuid"
    base = f"i.company_id=$1 AND {RIYADH_DAY} BETWEEN $2 AND $3{bc}"
    tot = await fetchrow(
        f"""SELECT COUNT(*)::int AS n,
                   COUNT(*) FILTER (WHERE COALESCE(i.qr_tlv,'') <> '')::int AS with_qr,
                   COUNT(*) FILTER (WHERE COALESCE(i.qr_tlv,'') = '')::int AS without_qr
            FROM invoices i WHERE {base}""", *p)
    by_status = await fetch(
        f"""SELECT COALESCE(i.zatca_status,'غير محدد') AS status, COUNT(*)::int AS n FROM invoices i WHERE {base} GROUP BY 1 ORDER BY 2 DESC""", *p)
    missing = await fetch(
        f"""SELECT i.id, i.invoice_no, i.issued_at, i.total_inc, COALESCE(i.zatca_status,'غير محدد') AS status
            FROM invoices i WHERE {base} AND COALESCE(i.qr_tlv,'') = '' ORDER BY i.issued_at DESC LIMIT 50""", *p)
    return {"meta": _meta(user, f, t, branch),
            "totals": {"invoices": tot["n"], "withQr": tot["with_qr"], "withoutQr": tot["without_qr"]},
            "byStatus": [dict(r) for r in by_status],
            "missingQr": [{"id": str(r["id"]), "invoiceNo": r["invoice_no"], "issuedAt": r["issued_at"], "total": _num(r["total_inc"]), "status": r["status"]} for r in missing],
            "note": "هذا التقرير يعرض ما هو مسجّل في الفواتير (الحالة ورمز QR) ولا يعني اعتماداً أو امتثالاً من الهيئة — لا يوجد في النظام تحقق فعلي مع منصة الفوترة."}
