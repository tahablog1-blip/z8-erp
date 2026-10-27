# modules/inventory/overview.py — مركز قيادة المخزون: قراءة فقط (لا كتابة في الأرصدة ولا الحركات ولا التكلفة ولا القيود).
#
# تعريفات (مطابقة لما يعتمده النظام الحالي):
#   • الرصيد = inventory.qty للموقع (أو مجموع المواقع). لا يُعاد حسابه من البيع/الشراء.
#   • قيمة المخزون = الرصيد × products.cost_price — نفس تعريف products.overview و reports.inventory_valuation. تُحجب عمّن لا يملك صلاحية المخزون.
#   • منخفض: min_qty>0 والرصيد بين 1 وmin_qty — نافد: الرصيد ≤ 0 — راكد: رصيد>0 ولا بيع ولا حركة مخزون منذ N يوماً.
#   • الداخل = استلام + تحويل وارد + تسوية جرد (زيادة). الخارج = بيع + تحويل صادر + تسوية جرد (عجز). المرتجعات خارج الحساب.
#   • لا يوجد في النظام حجز مخزون (Reserved) ولا حد أقصى (Max) ولا رصيد بعد الحركة، فلا تُعرض.
#   • الموظف المقيّد بفرع يرى مخزون فرعه ومبيعات فرعه فقط.
import datetime as dt

from fastapi import HTTPException

from ...core.db import fetch, fetchrow

WAREHOUSE_LOC_ID = "main"
WAREHOUSE_LABEL = "المستودع الرئيسي"
COST_PERMS = ("products.view_stock", "products.edit", "products.create", "accounting.view_reports")

SORTS = {
    "name": "p.name", "qty": "COALESCE(st.total,0)", "cost": "p.cost_price",
    "value": "COALESCE(st.total,0) * p.cost_price", "last": "GREATEST(sl.last_sale, mv.last_move)",
    "sales": "COALESCE(sl.qty_p,0)", "min": "p.min_qty",
}


def f2(v) -> float:
    return round(float(v or 0), 2)


def _date(s):
    try:
        return dt.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def _int(v, d):
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


def _mk(company_id):
    """قائمة معاملات مستقلة لكل استعلام (asyncpg يرفض المعاملات غير المستخدمة)."""
    args: list = [company_id]

    def arg(v) -> str:
        args.append(v)
        return f"${len(args)}"
    return args, arg


class _Scope:
    """نطاق الموقع المختار + قيود فرع الموظف. يُبنى مرة ويُستخدم في كل الاستعلامات."""

    def __init__(self, user, loc: str):
        self.user_scope = user.branch_scope
        self.loc = loc or ""
        if self.user_scope:                      # موظف فرع: فرعه فقط، أياً كان الطلب
            self.kind, self.loc_id = "branch", self.user_scope
        elif self.loc == "warehouse":
            self.kind, self.loc_id = "warehouse", WAREHOUSE_LOC_ID
        elif self.loc:
            self.kind, self.loc_id = "branch", self.loc
        else:
            self.kind, self.loc_id = "all", None

    def inv(self, a) -> str:          # شرط على جدول inventory (بلا alias)
        if self.kind == "all":
            return ""
        return f" AND loc_type = '{self.kind}' AND loc_id = {a(self.loc_id)}"

    def mv_to(self, a) -> str:
        if self.kind == "all":
            return "sm.to_loc_type IS NOT NULL AND sm.move_type <> 'transfer'"
        return f"(sm.to_loc_type = '{self.kind}' AND sm.to_loc_id = {a(self.loc_id)})"

    def mv_from(self, a) -> str:
        if self.kind == "all":
            return "sm.from_loc_type IS NOT NULL AND sm.move_type <> 'transfer'"
        return f"(sm.from_loc_type = '{self.kind}' AND sm.from_loc_id = {a(self.loc_id)})"

    def mv_any(self, a) -> str:       # أي حركة تمس الموقع
        if self.kind == "all":
            return "TRUE"
        k, i = f"'{self.kind}'", a(self.loc_id)
        return f"((sm.to_loc_type = {k} AND sm.to_loc_id = {i}) OR (sm.from_loc_type = {k} AND sm.from_loc_id = {i}))"

    def sales(self, a) -> str:        # فواتير البيع تخص الفروع فقط
        if self.kind == "warehouse":
            return "FALSE"
        if self.kind == "branch":
            return f"i.branch_id = {a(self.loc_id)}::uuid"
        return "TRUE"


async def _branch_names(company_id: str) -> dict:
    rows = await fetch("SELECT id, name FROM branches WHERE company_id=$1", company_id)
    return {str(r["id"]): r["name"] for r in rows}


def _loc_label(t, i, names) -> str:
    if not t:
        return "—"
    return WAREHOUSE_LABEL if t == "warehouse" else (f"فرع {names[str(i)]}" if str(i) in names else "موقع محذوف")


def _status(stock, min_qty, last_move, dead_cut) -> str:
    if stock <= 0:
        return "out"
    if min_qty and min_qty > 0 and stock <= min_qty:
        return "low"
    if last_move is None or last_move < dead_cut:
        return "dead"
    return "ok"


async def locations(company_id: str, user) -> list[dict]:
    names = await _branch_names(company_id)
    out = [] if user.branch_scope else [{"value": "warehouse", "type": "warehouse", "id": WAREHOUSE_LOC_ID, "name": WAREHOUSE_LABEL}]
    for bid, n in sorted(names.items(), key=lambda x: x[1]):
        if user.branch_scope and bid != str(user.branch_scope):
            continue
        out.append({"value": bid, "type": "branch", "id": bid, "name": f"فرع {n}"})
    return out


async def overview(company_id: str, user, p: dict) -> dict:
    sc = _Scope(user, p.get("loc"))
    can_cost = user.has(*COST_PERMS)
    today = dt.date.today()
    d_from = _date(p.get("from")) or today.replace(day=1)
    d_to = _date(p.get("to")) or today
    dead_days = _int(p.get("deadDays"), 90)
    dead_days = dead_days if dead_days in (30, 60, 90, 180) else 90
    page = max(1, min(_int(p.get("page"), 1), 100000))
    size = min(100, max(5, _int(p.get("pageSize"), 25)))

    def build():
        """يبني CTEs بقائمة معاملات مستقلة — حتى لا تبقى معاملات غير مستخدمة (asyncpg يرفضها)."""
        args: list = [company_id]

        def arg(v) -> str:
            args.append(v)
            return f"${len(args)}"
        inv_cond = sc.inv(arg)
        mv_any = sc.mv_any(arg)
        sales_cond = sc.sales(arg)
        pf, pt = arg(d_from), arg(d_to)
        dead_cut = arg(dead_days)
        day = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
        ctes = f"""WITH st AS (
              SELECT product_id, SUM(qty) AS total,
                     SUM(qty) FILTER (WHERE loc_type = 'warehouse') AS wh,
                     SUM(qty) FILTER (WHERE loc_type = 'branch') AS br
              FROM inventory WHERE company_id = $1{inv_cond} GROUP BY product_id),
            mv AS (
              SELECT sm.product_id, MAX(sm.created_at) AS last_move
              FROM stock_moves sm WHERE sm.company_id = $1 AND {mv_any} GROUP BY sm.product_id),
            sl AS (
              SELECT it.product_id, MAX(i.issued_at) AS last_sale,
                     SUM(it.qty) FILTER (WHERE i.issued_at >= now() - interval '30 days') AS q30,
                     SUM(it.qty) FILTER (WHERE {day} BETWEEN {pf} AND {pt}) AS qty_p,
                     SUM(it.line_ex) FILTER (WHERE {day} BETWEEN {pf} AND {pt}) AS rev_p
              FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
              WHERE i.company_id = $1 AND NOT i.is_returned AND {sales_cond} GROUP BY it.product_id),
            thr AS (SELECT COALESCE(percentile_cont(0.8) WITHIN GROUP (ORDER BY q30), 0) AS t FROM sl WHERE q30 > 0),
            cfg AS (SELECT {dead_cut}::int AS dead_days)"""
        dead_expr = f"(COALESCE(st.total,0) > 0 AND (GREATEST(sl.last_sale, mv.last_move) IS NULL OR GREATEST(sl.last_sale, mv.last_move) < now() - ({dead_cut}::int * interval '1 day')))"
        return args, arg, ctes, dead_expr

    low_expr = "(COALESCE(st.total,0) > 0 AND p.min_qty > 0 AND COALESCE(st.total,0) <= p.min_qty)"
    frm = "FROM products p LEFT JOIN st ON st.product_id = p.id LEFT JOIN mv ON mv.product_id = p.id LEFT JOIN sl ON sl.product_id = p.id"

    # ── الجدول ──
    args, arg, ctes, dead_expr = build()
    where = ["p.company_id = $1", "p.is_active = TRUE", "p.is_service = FALSE"]
    if p.get("category"):
        where.append(f"p.category = {arg(p['category'])}")
    if p.get("brand"):
        where.append(f"p.oil_brand = {arg(p['brand'])}")
    if p.get("supplier"):
        where.append(f"EXISTS (SELECT 1 FROM stock_moves sm2 WHERE sm2.product_id = p.id AND sm2.supplier_name = {arg(p['supplier'])})")
    q = (p.get("q") or "").strip()
    if q:
        like = arg(f"%{q}%")
        where.append(f"""(p.name ILIKE {like} OR p.spec ILIKE {like} OR p.category ILIKE {like} OR p.barcode ILIKE {like}
                          OR p.sku ILIKE {like} OR p.oil_brand ILIKE {like}
                          OR EXISTS (SELECT 1 FROM stock_moves sm2 WHERE sm2.product_id = p.id AND sm2.supplier_name ILIKE {like}))""")
    status = p.get("status") or ""
    if status == "out":
        where.append("COALESCE(st.total,0) <= 0")
    elif status == "low":
        where.append(low_expr)
    elif status == "dead":
        where.append(f"{dead_expr} AND NOT {low_expr}")
    elif status == "ok":
        where.append(f"COALESCE(st.total,0) > 0 AND NOT {low_expr} AND NOT {dead_expr}")
    elif status == "in":
        where.append("COALESCE(st.total,0) > 0")
    mvf = p.get("movement")
    if mvf == "fast":
        where.append("COALESCE(sl.q30,0) > 0 AND COALESCE(sl.q30,0) >= (SELECT t FROM thr)")
    elif mvf == "none":
        where.append("GREATEST(sl.last_sale, mv.last_move) IS NULL")
    for key, col, op in (("qtyMin", "COALESCE(st.total,0)", ">="), ("qtyMax", "COALESCE(st.total,0)", "<=")):
        try:
            if p.get(key) not in (None, ""):
                where.append(f"{col} {op} {arg(float(p[key]))}")
        except (TypeError, ValueError):
            pass
    sort = SORTS.get(p.get("sort") or "name", "p.name")
    direction = "DESC" if p.get("dir") == "desc" else "ASC"
    off = (page - 1) * size
    rows = await fetch(
        f"""{ctes}
            SELECT p.id, p.category, p.name, p.spec, p.unit, p.barcode, p.sku, p.price_vat, p.cost_price, p.min_qty, p.oil_brand,
                   (p.image_base64 IS NOT NULL AND p.image_base64 <> '') AS has_image,
                   COALESCE(st.total,0) AS stock, COALESCE(st.wh,0) AS stock_wh, COALESCE(st.br,0) AS stock_br,
                   sl.last_sale, mv.last_move, COALESCE(sl.q30,0) AS q30, COALESCE(sl.qty_p,0) AS qty_p, COALESCE(sl.rev_p,0) AS rev_p,
                   COUNT(*) OVER() AS total_rows
            {frm} WHERE {' AND '.join(where)}
            ORDER BY {sort} {direction} NULLS LAST, p.name ASC
            LIMIT {size} OFFSET {off}""", *args)

    cut = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=dead_days)
    items = []
    for r in rows:
        last = max([x for x in (r["last_sale"], r["last_move"]) if x], default=None)
        stock = int(r["stock"])
        items.append({
            "id": str(r["id"]), "name": r["name"], "spec": r["spec"], "category": r["category"], "brand": r["oil_brand"],
            "unit": r["unit"], "barcode": r["barcode"], "sku": r["sku"], "hasImage": r["has_image"],
            "stock": stock, "stockWarehouse": int(r["stock_wh"]), "stockBranches": int(r["stock_br"]),
            "minQty": int(r["min_qty"] or 0),
            "cost": f2(r["cost_price"]) if can_cost else None,
            "value": f2(stock * float(r["cost_price"] or 0)) if can_cost else None,
            "price": f2(r["price_vat"]),
            "lastMove": last.isoformat() if last else None,
            "lastSale": r["last_sale"].isoformat() if r["last_sale"] else None,
            "soldPeriod": int(r["qty_p"]), "revenuePeriod": f2(r["rev_p"]) if can_cost else None,
            "status": _status(stock, int(r["min_qty"] or 0), last, cut),
        })
    total = int(rows[0]["total_rows"]) if rows else 0

    # ── المؤشرات: على نطاق الموقع والتصنيف فقط (لا تتأثر ببحث/حالة الجدول) ──
    kargs, karg, kctes, kdead = build()
    kw = ["p.company_id = $1", "p.is_active = TRUE", "p.is_service = FALSE"]
    if p.get("category"):
        kw.append(f"p.category = {karg(p['category'])}")
    k = await fetchrow(
        f"""{kctes}
            SELECT COUNT(*) FILTER (WHERE COALESCE(st.total,0) > 0)::int AS skus,
                   COALESCE(SUM(st.total) FILTER (WHERE st.total > 0),0)::bigint AS units,
                   COALESCE(SUM(COALESCE(st.total,0) * p.cost_price) FILTER (WHERE st.total > 0),0) AS value,
                   COUNT(*) FILTER (WHERE {low_expr})::int AS low,
                   COUNT(*) FILTER (WHERE COALESCE(st.total,0) <= 0)::int AS out,
                   COUNT(*) FILTER (WHERE {kdead} AND NOT {low_expr})::int AS dead,
                   COUNT(*) FILTER (WHERE COALESCE(st.total,0) > 0 AND NOT {low_expr} AND NOT {kdead})::int AS ok,
                   COUNT(*) FILTER (WHERE COALESCE(sl.q30,0) > 0 AND COALESCE(sl.q30,0) >= (SELECT t FROM thr))::int AS fast,
                   COUNT(*)::int AS catalog
            {frm} WHERE {' AND '.join(kw)}""", *kargs)

    # حركة اليوم + الداخل/الخارج للفترة
    sday = "(sm.created_at AT TIME ZONE 'Asia/Riyadh')::date"
    iday = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
    a2, arg2 = _mk(company_id)
    to_c, from_c, any_c = sc.mv_to(arg2), sc.mv_from(arg2), sc.mv_any(arg2)
    f_, t_ = arg2(d_from), arg2(d_to)
    mvs = await fetchrow(
        f"""SELECT COALESCE(SUM(sm.qty) FILTER (WHERE {to_c} AND {sday} BETWEEN {f_} AND {t_}),0)::bigint AS qin,
                   COALESCE(SUM(sm.qty) FILTER (WHERE {from_c} AND {sday} BETWEEN {f_} AND {t_}),0)::bigint AS qout,
                   COUNT(DISTINCT sm.product_id) FILTER (WHERE {sday} = (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS moved_today
            FROM stock_moves sm WHERE sm.company_id = $1 AND {any_c}""", *a2)
    a3, arg3 = _mk(company_id)
    sales_c = sc.sales(arg3)
    f3, t3 = arg3(d_from), arg3(d_to)
    sold = await fetchrow(
        f"""SELECT COALESCE(SUM(it.qty) FILTER (WHERE {iday} BETWEEN {f3} AND {t3}),0)::bigint AS qsold,
                   COUNT(DISTINCT it.product_id) FILTER (WHERE {iday} = (now() AT TIME ZONE 'Asia/Riyadh')::date)::int AS sold_today
            FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
            WHERE i.company_id = $1 AND NOT i.is_returned AND {sales_c}""", *a3)

    names = await _branch_names(company_id)
    locks = await fetch(
        """SELECT id, loc_type, loc_id, status FROM stocktake_sessions
           WHERE company_id=$1 AND status IN ('in_progress','review') ORDER BY created_at DESC""", company_id)
    lock_list = [{"id": str(r["id"]), "status": r["status"], "loc": _loc_label(r["loc_type"], r["loc_id"], names)}
                 for r in locks if (not user.branch_scope) or (r["loc_type"] == "branch" and str(r["loc_id"]) == str(user.branch_scope))]

    return {
        "scope": {"kind": sc.kind, "locId": sc.loc_id, "name": _loc_label(sc.kind if sc.kind != "all" else None, sc.loc_id, names) if sc.kind != "all" else "كل المواقع"},
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat(), "deadDays": dead_days},
        "canCost": can_cost,
        "kpis": {
            "catalog": k["catalog"], "skus": k["skus"], "units": int(k["units"]),
            "value": f2(k["value"]) if can_cost else None,
            "low": k["low"], "out": k["out"], "dead": k["dead"], "fast": k["fast"],
            "movedToday": max(mvs["moved_today"], 0) + sold["sold_today"],   # تقريب: قد يتكرر صنف اشتُري وبيع اليوم
            "in": int(mvs["qin"]), "out_qty": int(mvs["qout"]) + int(sold["qsold"]),
            "net": int(mvs["qin"]) - int(mvs["qout"]) - int(sold["qsold"]),
        },
        "health": {"ok": k["ok"], "low": k["low"], "out": k["out"], "dead": k["dead"]},
        "stocktakeLocks": lock_list,
        "items": items, "total": total, "page": page, "pageSize": size,
    }


async def analytics(company_id: str, user, p: dict) -> dict:
    """تحليلات: حسب الموقع/التصنيف/العلامة + الأكثر حركة + الراكد + اتجاه الداخل والخارج اليومي."""
    sc = _Scope(user, p.get("loc"))
    can_cost = user.has(*COST_PERMS)
    today = dt.date.today()
    d_from = _date(p.get("from")) or today.replace(day=1)
    d_to = _date(p.get("to")) or today
    dead_days = _int(p.get("deadDays"), 90)
    dead_days = dead_days if dead_days in (30, 60, 90, 180) else 90
    names = await _branch_names(company_id)

    # حسب الموقع (يتجاهل اختيار الموقع ليُظهر المقارنة؛ موظف الفرع يرى فرعه)
    a: list = [company_id]
    loc_cond = ""
    if user.branch_scope:
        a.append(str(user.branch_scope)); loc_cond = " AND i.loc_type='branch' AND i.loc_id=$2"
    rows = await fetch(
        f"""SELECT i.loc_type, i.loc_id,
                   COUNT(*) FILTER (WHERE i.qty > 0)::int AS skus,
                   COALESCE(SUM(i.qty) FILTER (WHERE i.qty > 0),0)::bigint AS units,
                   COALESCE(SUM(i.qty * p.cost_price) FILTER (WHERE i.qty > 0),0) AS value,
                   COUNT(*) FILTER (WHERE i.qty > 0 AND p.min_qty > 0 AND i.qty <= p.min_qty)::int AS low,
                   COUNT(*) FILTER (WHERE i.qty <= 0)::int AS out
            FROM inventory i JOIN products p ON p.id = i.product_id
            WHERE i.company_id = $1 AND p.is_active AND NOT p.is_service{loc_cond}
            GROUP BY i.loc_type, i.loc_id""", *a)
    by_loc = sorted([{
        "value": "warehouse" if r["loc_type"] == "warehouse" else str(r["loc_id"]),
        "name": _loc_label(r["loc_type"], r["loc_id"], names), "type": r["loc_type"],
        "skus": r["skus"], "units": int(r["units"]), "value_amt": f2(r["value"]) if can_cost else None,
        "low": r["low"], "out": r["out"],
    } for r in rows], key=lambda x: (x["type"] != "warehouse", x["name"]))

    args: list = [company_id]

    def arg(v) -> str:
        args.append(v)
        return f"${len(args)}"
    inv_cond = sc.inv(arg)
    cats = await fetch(
        f"""SELECT COALESCE(NULLIF(p.category,''),'بدون تصنيف') AS category, COUNT(*) FILTER (WHERE s.total > 0)::int AS skus,
                   COALESCE(SUM(s.total) FILTER (WHERE s.total > 0),0)::bigint AS units,
                   COALESCE(SUM(s.total * p.cost_price) FILTER (WHERE s.total > 0),0) AS value
            FROM products p JOIN (SELECT product_id, SUM(qty) AS total FROM inventory WHERE company_id=$1{inv_cond} GROUP BY product_id) s ON s.product_id = p.id
            WHERE p.company_id=$1 AND p.is_active AND NOT p.is_service GROUP BY 1 HAVING SUM(s.total) > 0 ORDER BY 4 DESC, 1 LIMIT 40""", *args)
    brands = await fetch(
        f"""SELECT p.oil_brand AS brand, COUNT(*) FILTER (WHERE s.total > 0)::int AS skus,
                   COALESCE(SUM(s.total) FILTER (WHERE s.total > 0),0)::bigint AS units,
                   COALESCE(SUM(s.total * p.cost_price) FILTER (WHERE s.total > 0),0) AS value
            FROM products p JOIN (SELECT product_id, SUM(qty) AS total FROM inventory WHERE company_id=$1{inv_cond} GROUP BY product_id) s ON s.product_id = p.id
            WHERE p.company_id=$1 AND p.is_active AND NOT p.is_service AND p.oil_brand IS NOT NULL AND p.oil_brand <> ''
            GROUP BY 1 HAVING SUM(s.total) > 0 ORDER BY 4 DESC, 1 LIMIT 40""", *args)

    sc_args: list = [company_id]

    def sa(v) -> str:
        sc_args.append(v)
        return f"${len(sc_args)}"
    sales_c = sc.sales(sa)
    f_, t_ = sa(d_from), sa(d_to)
    iday = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
    movers = await fetch(
        f"""SELECT p.id, p.name, p.spec, SUM(it.qty)::bigint AS qty, SUM(it.line_ex) AS rev
            FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id JOIN products p ON p.id = it.product_id
            WHERE i.company_id = $1 AND NOT i.is_returned AND {sales_c} AND {iday} BETWEEN {f_} AND {t_} AND NOT p.is_service
            GROUP BY p.id, p.name, p.spec ORDER BY qty DESC LIMIT 10""", *sc_args)
    days = max(1, (d_to - d_from).days + 1)

    t_args, ta = _mk(company_id)
    to_c, from_c = sc.mv_to(ta), sc.mv_from(ta)
    tf, tt = ta(d_from), ta(d_to)
    ins = await fetch(
        f"""SELECT (sm.created_at AT TIME ZONE 'Asia/Riyadh')::date AS d,
                   COALESCE(SUM(sm.qty) FILTER (WHERE {to_c}),0)::bigint AS qin,
                   COALESCE(SUM(sm.qty) FILTER (WHERE {from_c}),0)::bigint AS qout
            FROM stock_moves sm WHERE sm.company_id = $1 AND (sm.created_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN {tf} AND {tt}
            GROUP BY 1""", *t_args)
    o_args, oa = _mk(company_id)
    sales_t = sc.sales(oa)
    of, ot = oa(d_from), oa(d_to)
    outs = await fetch(
        f"""SELECT (i.issued_at AT TIME ZONE 'Asia/Riyadh')::date AS d, SUM(it.qty)::bigint AS q
            FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
            WHERE i.company_id = $1 AND NOT i.is_returned AND {sales_t} AND (i.issued_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN {of} AND {ot}
            GROUP BY 1""", *o_args)
    tmap: dict = {}
    for r in ins:
        tmap.setdefault(r["d"], [0, 0])
        tmap[r["d"]][0] += int(r["qin"]); tmap[r["d"]][1] += int(r["qout"])
    for r in outs:
        tmap.setdefault(r["d"], [0, 0])
        tmap[r["d"]][1] += int(r["q"])
    trend = [{"date": d.isoformat(), "in": v[0], "out": v[1]} for d, v in sorted(tmap.items())]

    return {
        "period": {"from": d_from.isoformat(), "to": d_to.isoformat(), "deadDays": dead_days},
        "canCost": can_cost,
        "byLocation": by_loc,
        "byCategory": [{"category": r["category"], "skus": r["skus"], "units": int(r["units"]), "value": f2(r["value"]) if can_cost else None} for r in cats],
        "byBrand": [{"brand": r["brand"], "skus": r["skus"], "units": int(r["units"]), "value": f2(r["value"]) if can_cost else None} for r in brands],
        "topMovers": [{"id": str(r["id"]), "name": r["name"], "spec": r["spec"], "qty": int(r["qty"]), "revenue": f2(r["rev"]) if can_cost else None,
                       "perDay": round(int(r["qty"]) / days, 2)} for r in movers],
        "trend": trend,
    }


MOVE_TYPES = {"receive": "استلام", "transfer": "تحويل", "adjust": "تسوية جرد"}


async def movements(company_id: str, user, p: dict) -> dict:
    sc = _Scope(user, p.get("loc"))
    page = max(1, min(_int(p.get("page"), 1), 100000))
    size = min(100, max(5, _int(p.get("pageSize"), 25)))
    args: list = [company_id]

    def arg(v) -> str:
        args.append(v)
        return f"${len(args)}"
    where = ["sm.company_id = $1", sc.mv_any(arg)]
    t = p.get("type")
    if t in MOVE_TYPES:
        where.append(f"sm.move_type = {arg(t)}")
    d_from, d_to = _date(p.get("from")), _date(p.get("to"))
    if d_from:
        where.append(f"(sm.created_at AT TIME ZONE 'Asia/Riyadh')::date >= {arg(d_from)}")
    if d_to:
        where.append(f"(sm.created_at AT TIME ZONE 'Asia/Riyadh')::date <= {arg(d_to)}")
    if p.get("product"):
        where.append(f"sm.product_id = {arg(p['product'])}::uuid")
    q = (p.get("q") or "").strip()
    if q:
        like = arg(f"%{q}%")
        where.append(f"(sm.product_label ILIKE {like} OR sm.move_no ILIKE {like} OR sm.supplier_name ILIKE {like} OR sm.note ILIKE {like})")
    off = (page - 1) * size
    try:
        rows = await fetch(
            f"""SELECT sm.id, sm.created_at, sm.move_type, sm.product_id, sm.product_label, sm.qty, sm.move_no, sm.note, sm.supplier_name,
                       sm.unit_cost, sm.from_loc_type, sm.from_loc_id, sm.to_loc_type, sm.to_loc_id, u.full_name AS user_name,
                       COUNT(*) OVER() AS total_rows
                FROM stock_moves sm LEFT JOIN users u ON u.id = sm.created_by
                WHERE {' AND '.join(where)} ORDER BY sm.created_at DESC LIMIT {size} OFFSET {off}""", *args)
    except Exception as e:                      # معرّف صنف غير صالح وما شابه
        raise HTTPException(400, "معاملات البحث غير صحيحة") from e
    names = await _branch_names(company_id)
    can_cost = user.has(*COST_PERMS)
    return {
        "items": [{
            "id": str(r["id"]), "at": r["created_at"].isoformat(), "type": r["move_type"], "typeLabel": MOVE_TYPES.get(r["move_type"], r["move_type"]),
            "productId": str(r["product_id"]), "label": r["product_label"], "qty": r["qty"], "moveNo": r["move_no"], "note": r["note"],
            "supplier": r["supplier_name"], "unitCost": f2(r["unit_cost"]) if (can_cost and r["unit_cost"] is not None) else None,
            "from": _loc_label(r["from_loc_type"], r["from_loc_id"], names) if r["from_loc_type"] else (r["supplier_name"] or ("تسوية جرد (زيادة)" if r["move_type"] == "adjust" else "مورد خارجي")),
            "to": _loc_label(r["to_loc_type"], r["to_loc_id"], names) if r["to_loc_type"] else "تسوية جرد (عجز)",
            "user": r["user_name"],
        } for r in rows],
        "total": int(rows[0]["total_rows"]) if rows else 0, "page": page, "pageSize": size,
    }


async def product_inventory(company_id: str, user, pid: str) -> dict:
    """مخزون صنف: الرصيد حسب المواقع + آخر الحركات + آخر بيع/استلام. للقراءة فقط."""
    try:
        prod = await fetchrow(
            """SELECT id, name, spec, category, unit, barcode, sku, price_vat, cost_price, min_qty, oil_brand,
                      (image_base64 IS NOT NULL AND image_base64 <> '') AS has_image
               FROM products WHERE id=$1::uuid AND company_id=$2""", pid, company_id)
    except Exception as e:
        raise HTTPException(404, "الصنف غير موجود") from e
    if not prod:
        raise HTTPException(404, "الصنف غير موجود")
    scope = user.branch_scope
    can_cost = user.has(*COST_PERMS)
    names = await _branch_names(company_id)
    inv = await fetch(
        """SELECT loc_type, loc_id, qty, shelf_location FROM inventory
           WHERE company_id=$1 AND product_id=$2::uuid AND qty IS NOT NULL
             AND ($3::text IS NULL OR (loc_type='branch' AND loc_id=$3))""", company_id, pid, scope)
    stock = sorted([{
        "value": "warehouse" if r["loc_type"] == "warehouse" else str(r["loc_id"]), "locType": r["loc_type"], "locId": str(r["loc_id"]),
        "name": _loc_label(r["loc_type"], r["loc_id"], names), "qty": r["qty"], "shelf": r["shelf_location"],
        "low": bool(prod["min_qty"]) and r["qty"] <= prod["min_qty"],
    } for r in inv], key=lambda x: (x["locType"] != "warehouse", x["name"]))
    total = sum(x["qty"] for x in stock)
    mvs = await fetch(
        """SELECT sm.created_at, sm.move_type, sm.qty, sm.move_no, sm.note, sm.supplier_name, sm.unit_cost,
                  sm.from_loc_type, sm.from_loc_id, sm.to_loc_type, sm.to_loc_id, u.full_name AS user_name
           FROM stock_moves sm LEFT JOIN users u ON u.id = sm.created_by
           WHERE sm.company_id=$1 AND sm.product_id=$2::uuid
             AND ($3::text IS NULL OR (sm.from_loc_type='branch' AND sm.from_loc_id=$3) OR (sm.to_loc_type='branch' AND sm.to_loc_id=$3))
           ORDER BY sm.created_at DESC LIMIT 15""", company_id, pid, scope)
    sale = await fetchrow(
        """SELECT i.id, i.invoice_no, i.issued_at FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
           WHERE i.company_id=$1 AND it.product_id=$2::uuid AND NOT i.is_returned AND ($3::text IS NULL OR i.branch_id=$3::uuid)
           ORDER BY i.issued_at DESC LIMIT 1""", company_id, pid, scope)
    recv = await fetchrow(
        """SELECT created_at, supplier_name, unit_cost FROM stock_moves
           WHERE company_id=$1 AND product_id=$2::uuid AND move_type='receive' ORDER BY created_at DESC LIMIT 1""", company_id, pid) if not scope else None
    return {
        "canCost": can_cost,
        "product": {
            "id": str(prod["id"]), "name": prod["name"], "spec": prod["spec"], "category": prod["category"], "unit": prod["unit"],
            "barcode": prod["barcode"], "sku": prod["sku"], "brand": prod["oil_brand"], "hasImage": prod["has_image"],
            "price": f2(prod["price_vat"]), "cost": f2(prod["cost_price"]) if can_cost else None, "minQty": int(prod["min_qty"] or 0),
        },
        "total": total, "value": f2(total * float(prod["cost_price"] or 0)) if can_cost else None,
        "stock": stock,
        "moves": [{
            "at": m["created_at"].isoformat(), "type": m["move_type"], "typeLabel": MOVE_TYPES.get(m["move_type"], m["move_type"]),
            "qty": m["qty"], "moveNo": m["move_no"], "note": m["note"], "user": m["user_name"], "supplier": m["supplier_name"],
            "from": _loc_label(m["from_loc_type"], m["from_loc_id"], names) if m["from_loc_type"] else (m["supplier_name"] or "—"),
            "to": _loc_label(m["to_loc_type"], m["to_loc_id"], names) if m["to_loc_type"] else "—",
        } for m in mvs],
        "lastSale": {"invoiceId": str(sale["id"]), "invoiceNo": sale["invoice_no"], "at": sale["issued_at"].isoformat()} if sale else None,
        "lastReceive": {"at": recv["created_at"].isoformat(), "supplier": recv["supplier_name"],
                        "unitCost": f2(recv["unit_cost"]) if (can_cost and recv["unit_cost"] is not None) else None} if recv else None,
    }
