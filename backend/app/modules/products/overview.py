# modules/products/overview.py — مركز قيادة الأصناف: قائمة مُصفّحة + مؤشرات + ملف الصنف 360 (قراءة فقط)
#
# مبادئ الأمان (راجع حدود التنفيذ الآمن):
#   • قراءة فقط: لا كتابة في المخزون ولا التكلفة ولا القيود. كل التعديلات تمر عبر مسارات الأصناف/المخزون القائمة.
#   • قيمة المخزون = الكمية (كل المواقع) × products.cost_price — نفس تعريف reports.service.inventory_valuation بالضبط.
#   • الربح الإجمالي في المؤشرات = total_ex − cogs_total من الفواتير نفسها (المصدر المحاسبي)، لا تُعاد حسابه من تكلفة الصنف الحالية.
#   • ملف الصنف لا يحسب ربحاً تاريخياً للصنف (التكلفة التاريخية غير محفوظة لكل سطر) — يعرض سعر البيع الحالي مقابل التكلفة الحالية فقط.
#   • الموظف المقيّد بفرع يرى مخزون فرعه ومبيعات فرعه فقط.
import datetime as dt
from decimal import Decimal

from fastapi import HTTPException

from ...core.db import fetch, fetchrow

WAREHOUSE_LOC_ID = "main"
WAREHOUSE_LABEL = "المستودع الرئيسي"

STOCK_PERMS = ("products.view_stock", "products.edit", "products.create", "accounting.view_reports")
SALES_PERMS = ("invoices.view_all", "reports.view", "reports.sales", "accounting.view_reports")


def f2(v) -> float:
    return round(float(v or 0), 2)


def _date(s: str | None) -> dt.date | None:
    try:
        return dt.date.fromisoformat(s) if s else None
    except ValueError:
        return None


def _int(v, d):
    try:
        return int(v)
    except (TypeError, ValueError):
        return d


SORTS = {
    "name": "p.name", "category": "p.category", "price": "p.price", "cost": "p.cost_price",
    "stock": "COALESCE(st.total,0)", "sales": "COALESCE(sl.rev_p,0)", "created": "p.created_at",
    "margin": "CASE WHEN p.price > 0 AND p.cost_price > 0 THEN (p.price - p.cost_price) / p.price END",
}


async def _locations(company_id: str, scope: str | None) -> list[dict]:
    locs = [] if scope else [{"type": "warehouse", "id": WAREHOUSE_LOC_ID, "name": WAREHOUSE_LABEL}]
    rows = await fetch("SELECT id, name FROM branches WHERE company_id=$1 AND ($2::text IS NULL OR id::text=$2) ORDER BY name",
                       company_id, scope)
    return locs + [{"type": "branch", "id": str(r["id"]), "name": r["name"]} for r in rows]


async def list_overview(company_id: str, user, p: dict) -> dict:
    scope = user.branch_scope
    can_stock = user.has(*STOCK_PERMS)
    can_sales = user.has(*SALES_PERMS)
    today = dt.date.today()
    d_from = _date(p.get("from")) or today.replace(day=1)
    d_to = _date(p.get("to")) or today
    page = max(1, min(_int(p.get("page"), 1), 100000))
    size = min(100, max(5, _int(p.get("pageSize"), 25)))

    args: list = [company_id]

    def arg(v) -> str:
        args.append(v)
        return f"${len(args)}"

    # ── نطاق المخزون: مستودع/فرع محدد، أو فرع الموظف المقيّد، أو الكل ──
    loc = p.get("loc") or ""
    inv_cond = ""
    if scope:
        inv_cond = f" AND loc_type = 'branch' AND loc_id = {arg(scope)}"
    elif loc == "warehouse":
        inv_cond = " AND loc_type = 'warehouse'"
    elif loc:
        inv_cond = f" AND loc_type = 'branch' AND loc_id = {arg(loc)}"
    br_inv = f" AND i.branch_id = {arg(scope)}::uuid" if scope else ""

    pf, pt = arg(d_from), arg(d_to)
    day = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"

    where = ["p.company_id = $1"]
    status = p.get("status") or "active"
    if status == "active":
        where.append("p.is_active = TRUE")
    elif status == "inactive":
        where.append("p.is_active = FALSE")
    t = p.get("type")
    if t == "service":
        where.append("p.is_service = TRUE")
    elif t == "product":
        where.append("p.is_service = FALSE")
    elif t == "oil":
        where.append("p.is_oil = TRUE")
    elif t == "oilFilter":
        where.append("p.is_oil_filter = TRUE")
    if p.get("category"):
        where.append(f"p.category = {arg(p['category'])}")
    if p.get("brand"):
        where.append(f"p.oil_brand = {arg(p['brand'])}")
    if p.get("supplier"):
        where.append(f"EXISTS (SELECT 1 FROM stock_moves sm WHERE sm.product_id = p.id AND sm.supplier_name = {arg(p['supplier'])})")
    q = (p.get("q") or "").strip()
    if q:
        like = arg(f"%{q}%")
        where.append(f"""(p.name ILIKE {like} OR p.spec ILIKE {like} OR p.category ILIKE {like} OR p.barcode ILIKE {like}
                          OR p.sku ILIKE {like} OR p.oil_brand ILIKE {like}
                          OR EXISTS (SELECT 1 FROM stock_moves sm WHERE sm.product_id = p.id AND sm.supplier_name ILIKE {like}))""")
    stock = p.get("stock")
    if stock == "out":
        where.append("p.is_service = FALSE AND COALESCE(st.total,0) <= 0")
    elif stock == "low":
        where.append("p.is_service = FALSE AND p.min_qty > 0 AND COALESCE(st.total,0) > 0 AND COALESCE(st.total,0) <= p.min_qty")
    elif stock == "in":
        where.append("p.is_service = FALSE AND COALESCE(st.total,0) > 0")
    mv = p.get("movement")
    if mv == "fast":
        where.append("COALESCE(sl.q30,0) > 0 AND COALESCE(sl.q30,0) >= (SELECT t FROM thr)")
    elif mv == "slow":
        where.append("p.is_service = FALSE AND COALESCE(st.total,0) > 0 AND COALESCE(sl.q90,0) > 0 AND NOT (COALESCE(sl.q30,0) > 0 AND COALESCE(sl.q30,0) >= (SELECT t FROM thr))")
    elif mv == "dead":
        where.append("p.is_service = FALSE AND COALESCE(st.total,0) > 0 AND COALESCE(sl.q90,0) = 0")
    for key, col, op in (("priceMin", "p.price", ">="), ("priceMax", "p.price", "<="), ("stockMin", "COALESCE(st.total,0)", ">="), ("stockMax", "COALESCE(st.total,0)", "<=")):
        try:
            if p.get(key) not in (None, ""):
                where.append(f"{col} {op} {arg(float(p[key]))}")
        except (TypeError, ValueError):
            pass

    sort = SORTS.get(p.get("sort") or "name", "p.name")
    direction = "DESC" if p.get("dir") == "desc" else "ASC"
    off = (page - 1) * size
    cutoff = f"LEAST(now() - interval '90 days', {pf}::date)"

    rows = await fetch(
        f"""WITH st AS (
              SELECT product_id, SUM(qty) AS total,
                     SUM(qty) FILTER (WHERE loc_type = 'warehouse') AS wh,
                     SUM(qty) FILTER (WHERE loc_type = 'branch') AS br
              FROM inventory WHERE company_id = $1{inv_cond} GROUP BY product_id),
            sl AS (
              SELECT it.product_id,
                     SUM(it.qty) FILTER (WHERE i.issued_at >= now() - interval '30 days') AS q30,
                     SUM(it.qty) FILTER (WHERE i.issued_at >= now() - interval '90 days') AS q90,
                     SUM(it.qty) FILTER (WHERE {day} BETWEEN {pf} AND {pt}) AS qty_p,
                     SUM(it.line_ex) FILTER (WHERE {day} BETWEEN {pf} AND {pt}) AS rev_p
              FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
              WHERE i.company_id = $1 AND NOT i.is_returned AND i.issued_at >= {cutoff}{br_inv}
              GROUP BY it.product_id),
            thr AS (SELECT COALESCE(percentile_cont(0.8) WITHIN GROUP (ORDER BY q30), 0) AS t FROM sl WHERE q30 > 0)
            SELECT p.id, p.category, p.name, p.spec, p.unit, p.barcode, p.sku, p.price, p.price_vat, p.cost_price, p.min_qty,
                   p.is_service, p.is_oil, p.is_oil_filter, p.oil_brand, p.is_active, p.created_at,
                   (p.image_base64 IS NOT NULL AND p.image_base64 <> '') AS has_image,
                   COALESCE(st.total,0) AS stock, COALESCE(st.wh,0) AS stock_wh, COALESCE(st.br,0) AS stock_br,
                   COALESCE(sl.q30,0) AS q30, COALESCE(sl.q90,0) AS q90,
                   COALESCE(sl.qty_p,0) AS qty_p, COALESCE(sl.rev_p,0) AS rev_p,
                   (SELECT t FROM thr) AS fast_threshold,
                   COUNT(*) OVER() AS total_rows
            FROM products p LEFT JOIN st ON st.product_id = p.id LEFT JOIN sl ON sl.product_id = p.id
            WHERE {' AND '.join(where)}
            ORDER BY {sort} {direction} NULLS LAST, p.name ASC
            LIMIT {size} OFFSET {off}""", *args)

    ids = [r["id"] for r in rows]
    last_sale: dict[str, dt.datetime] = {}
    last_recv: dict[str, dt.datetime] = {}
    if ids:
        for r in await fetch(
            f"""SELECT it.product_id, MAX(i.issued_at) AS at FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                WHERE i.company_id = $1 AND NOT i.is_returned AND it.product_id = ANY($2::uuid[]){' AND i.branch_id = $3::uuid' if scope else ''}
                GROUP BY it.product_id""", *([company_id, ids] + ([scope] if scope else []))):
            last_sale[str(r["product_id"])] = r["at"]
        for r in await fetch(
            "SELECT product_id, MAX(created_at) AS at FROM stock_moves WHERE company_id=$1 AND move_type='receive' AND product_id = ANY($2::uuid[]) GROUP BY product_id",
                company_id, ids):
            last_recv[str(r["product_id"])] = r["at"]

    now = dt.datetime.now(dt.timezone.utc)
    items = []
    for r in rows:
        pid = str(r["id"])
        price, cost = float(r["price"] or 0), float(r["cost_price"] or 0)
        total = float(r["stock"] or 0)
        is_service = r["is_service"]
        if is_service:
            sstat = "service"
        elif total <= 0:
            sstat = "out"
        elif r["min_qty"] and total <= r["min_qty"]:
            sstat = "low"
        else:
            sstat = "ok"
        ls = last_sale.get(pid)
        items.append({
            "id": pid, "name": r["name"], "spec": r["spec"], "category": r["category"], "unit": r["unit"],
            "barcode": r["barcode"], "sku": r["sku"], "brand": r["oil_brand"],
            "isService": is_service, "isOil": r["is_oil"], "isOilFilter": r["is_oil_filter"], "isActive": r["is_active"],
            "hasImage": r["has_image"], "minQty": r["min_qty"],
            "price": f2(price), "priceVat": f2(r["price_vat"]),
            "cost": f2(cost) if can_stock else None,
            "unitProfit": f2(price - cost) if (can_stock and price > 0 and cost > 0) else None,
            "margin": round((price - cost) / price * 100, 1) if (can_stock and price > 0 and cost > 0) else None,
            "stock": None if is_service else total, "stockWarehouse": None if is_service else float(r["stock_wh"] or 0),
            "stockBranches": None if is_service else float(r["stock_br"] or 0),
            "stockValue": f2(total * cost) if (can_stock and not is_service) else None,
            "stockStatus": sstat,
            "sold30": float(r["q30"] or 0), "sold90": float(r["q90"] or 0),
            "periodQty": float(r["qty_p"] or 0), "periodRevenue": f2(r["rev_p"]) if can_sales else None,
            "lastSaleAt": ls.isoformat() if ls else None,
            "daysNoSale": (now - ls).days if ls else None,
            "lastReceiveAt": last_recv[pid].isoformat() if pid in last_recv else None,
            "isFast": float(r["q30"] or 0) > 0 and float(r["q30"] or 0) >= float(r["fast_threshold"] or 0),
            "createdAt": r["created_at"].isoformat() if r["created_at"] else None,
        })
    total_rows = rows[0]["total_rows"] if rows else 0
    return {"items": items, "total": total_rows, "page": page, "pageSize": size,
            "kpis": await _kpis(company_id, d_from, d_to, scope, loc, can_stock, can_sales),
            "facets": await _facets(company_id, scope), "canCost": can_stock, "canSales": can_sales,
            "period": {"from": d_from.isoformat(), "to": d_to.isoformat()}}


async def _facets(company_id: str, scope: str | None) -> dict:
    cats = await fetch("SELECT COALESCE(NULLIF(category,''),'غير مصنّف') AS c, COUNT(*)::int AS n FROM products WHERE company_id=$1 AND is_active GROUP BY 1 ORDER BY n DESC", company_id)
    brands = await fetch("SELECT oil_brand AS b, COUNT(*)::int AS n FROM products WHERE company_id=$1 AND is_active AND oil_brand IS NOT NULL AND oil_brand <> '' GROUP BY 1 ORDER BY n DESC", company_id)
    sup = await fetch("SELECT supplier_name AS s FROM stock_moves WHERE company_id=$1 AND move_type='receive' AND supplier_name IS NOT NULL AND supplier_name <> '' GROUP BY 1 ORDER BY MAX(created_at) DESC LIMIT 100", company_id)
    return {"categories": [{"name": r["c"], "count": r["n"]} for r in cats], "brands": [{"name": r["b"], "count": r["n"]} for r in brands],
            "suppliers": [r["s"] for r in sup], "locations": await _locations(company_id, scope)}


async def _kpis(company_id, f, t, scope, loc, can_stock, can_sales) -> dict:
    inv_cond, args = "", [company_id]
    if scope:
        args.append(scope); inv_cond = " AND loc_type='branch' AND loc_id = $2"
    elif loc == "warehouse":
        inv_cond = " AND loc_type='warehouse'"
    elif loc:
        args.append(loc); inv_cond = " AND loc_type='branch' AND loc_id = $2"
    row = await fetchrow(
        f"""WITH st AS (SELECT product_id, SUM(qty) AS total FROM inventory WHERE company_id=$1{inv_cond} GROUP BY product_id)
            SELECT COUNT(*) FILTER (WHERE p.is_active)::int AS total,
                   COUNT(*) FILTER (WHERE p.is_active AND NOT p.is_service)::int AS stocked,
                   COUNT(*) FILTER (WHERE p.is_active AND p.is_service)::int AS services,
                   COUNT(*) FILTER (WHERE NOT p.is_active)::int AS inactive,
                   COUNT(*) FILTER (WHERE p.is_active AND NOT p.is_service AND COALESCE(st.total,0) <= 0)::int AS out_cnt,
                   COUNT(*) FILTER (WHERE p.is_active AND NOT p.is_service AND p.min_qty > 0 AND COALESCE(st.total,0) > 0 AND COALESCE(st.total,0) <= p.min_qty)::int AS low_cnt,
                   COALESCE(SUM(COALESCE(st.total,0) * COALESCE(p.cost_price,0)) FILTER (WHERE p.is_active AND NOT p.is_service AND COALESCE(st.total,0) <> 0), 0) AS stock_value
            FROM products p LEFT JOIN st ON st.product_id = p.id WHERE p.company_id = $1""", *args)
    out = {"total": row["total"], "stocked": row["stocked"], "services": row["services"], "inactive": row["inactive"],
           "outOfStock": row["out_cnt"], "lowStock": row["low_cnt"],
           "stockValue": f2(row["stock_value"]) if can_stock else None, "sales": None, "salesQty": None, "grossProfit": None, "margin": None}
    if can_sales:
        a2: list = [company_id, f, t]
        br = ""
        if scope:
            a2.append(scope); br = " AND i.branch_id = $4::uuid"
        day = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
        s = await fetchrow(
            f"""SELECT COALESCE(SUM(it.line_ex),0) AS rev, COALESCE(SUM(it.qty),0) AS qty
                FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                WHERE i.company_id=$1 AND NOT i.is_returned AND {day} BETWEEN $2 AND $3{br}""", *a2)
        g = await fetchrow(
            f"""SELECT COALESCE(SUM(i.total_ex),0) AS ex, COALESCE(SUM(i.total_ex - COALESCE(i.cogs_total,0)),0) AS gp
                FROM invoices i WHERE i.company_id=$1 AND NOT i.is_returned AND {day} BETWEEN $2 AND $3{br}""", *a2)
        out.update({"sales": f2(s["rev"]), "salesQty": float(s["qty"] or 0), "grossProfit": f2(g["gp"]),
                    "margin": round(float(g["gp"]) / float(g["ex"]) * 100, 1) if float(g["ex"] or 0) > 0 else None})
    return out


# ══════════════════ ملف الصنف 360 ══════════════════

def _loc_name(t: str | None, i: str | None, names: dict[str, str]) -> str:
    if not t:
        return ""
    return WAREHOUSE_LABEL if t == "warehouse" else names.get(str(i), "موقع محذوف")


async def profile(company_id: str, user, product_id: str) -> dict:
    from uuid import UUID
    try:
        pid = str(UUID(product_id))
    except (ValueError, TypeError):
        raise HTTPException(404, "الصنف غير موجود")
    scope = user.branch_scope
    can_stock = user.has(*STOCK_PERMS)
    can_sales = user.has(*SALES_PERMS)
    if not (can_stock or can_sales):
        raise HTTPException(403, "ليس لديك صلاحية عرض ملف الصنف")

    pr = await fetchrow(
        """SELECT id, category, name, spec, unit, barcode, sku, price, price_vat, cost_price, min_qty, service_interval_km,
                  is_service, is_oil, is_oil_filter, oil_brand, oil_type, filter_kind, is_active, created_at, updated_at,
                  (image_base64 IS NOT NULL AND image_base64 <> '') AS has_image
           FROM products WHERE id=$1 AND company_id=$2""", pid, company_id)
    if not pr:
        raise HTTPException(404, "الصنف غير موجود")
    price, cost = float(pr["price"] or 0), float(pr["cost_price"] or 0)

    branches = {str(r["id"]): r["name"] for r in await fetch("SELECT id, name FROM branches WHERE company_id=$1", company_id)}
    out: dict = {
        "product": {
            "id": str(pr["id"]), "name": pr["name"], "spec": pr["spec"], "category": pr["category"], "unit": pr["unit"], "barcode": pr["barcode"],
            "sku": pr["sku"], "brand": pr["oil_brand"], "oilType": pr["oil_type"], "filterKind": pr["filter_kind"], "isService": pr["is_service"], "isOil": pr["is_oil"], "isOilFilter": pr["is_oil_filter"],
            "isActive": pr["is_active"], "hasImage": pr["has_image"], "minQty": pr["min_qty"], "price": f2(price), "priceVat": f2(pr["price_vat"]),
            "cost": f2(cost) if can_stock else None, "serviceIntervalKm": pr["service_interval_km"],
            "unitProfit": f2(price - cost) if (can_stock and price > 0 and cost > 0) else None,
            "margin": round((price - cost) / price * 100, 1) if (can_stock and price > 0 and cost > 0) else None,
            "createdAt": pr["created_at"].isoformat() if pr["created_at"] else None,
        },
        "canCost": can_stock, "canSales": can_sales,
        "stock": [], "totalStock": None, "stockValue": None, "kpis": {}, "movements": [], "sales": None, "purchases": None,
        "trend": None, "suppliers": None, "timeline": [],
    }

    # ── المخزون حسب الموقع ──
    inv = await fetch(
        """SELECT loc_type, loc_id, qty, shelf_location FROM inventory WHERE company_id=$1 AND product_id=$2
           ORDER BY loc_type DESC""", company_id, pid)
    stock = []
    for r in inv:
        if scope and not (r["loc_type"] == "branch" and str(r["loc_id"]) == scope):
            continue
        q = float(r["qty"] or 0)
        status = "service" if pr["is_service"] else ("out" if q <= 0 else "low" if (pr["min_qty"] and q <= pr["min_qty"]) else "ok")
        stock.append({"locType": r["loc_type"], "locId": str(r["loc_id"]), "locName": _loc_name(r["loc_type"], r["loc_id"], branches),
                      "qty": q, "minQty": pr["min_qty"], "shelf": r["shelf_location"], "status": status})
    out["stock"] = stock
    total = sum(s["qty"] for s in stock)
    out["totalStock"] = None if pr["is_service"] else total
    out["stockValue"] = f2(total * cost) if (can_stock and not pr["is_service"]) else None

    kp: dict = {"unitMargin": out["product"]["margin"]}
    br = " AND i.branch_id = $3::uuid" if scope else ""
    base_args = [company_id, pid] + ([scope] if scope else [])
    events: list[dict] = []

    # ── حركات المخزون (استلام/تحويل/تسوية) + مبيعات ──
    moves = await fetch(
        """SELECT sm.move_type, sm.qty, sm.move_no, sm.note, sm.supplier_name, sm.unit_cost, sm.created_at,
                  sm.from_loc_type, sm.from_loc_id, sm.to_loc_type, sm.to_loc_id, u.full_name AS user_name, sm.purchase_invoice_id
           FROM stock_moves sm LEFT JOIN users u ON u.id = sm.created_by
           WHERE sm.company_id=$1 AND sm.product_id=$2 ORDER BY sm.created_at DESC LIMIT 300""", company_id, pid)
    MT = {"receive": "استلام", "transfer": "تحويل", "adjust": "تسوية جرد", "adjustment": "تسوية جرد"}
    mv_out = []
    for m in moves:
        touches_scope = (not scope) or str(m["from_loc_id"]) == scope or str(m["to_loc_id"]) == scope
        if not touches_scope:
            continue
        item = {"kind": m["move_type"], "label": MT.get(m["move_type"], m["move_type"]), "at": m["created_at"].isoformat(), "doc": m["move_no"],
                "qty": float(m["qty"] or 0), "from": _loc_name(m["from_loc_type"], m["from_loc_id"], branches),
                "to": _loc_name(m["to_loc_type"], m["to_loc_id"], branches), "user": m["user_name"], "note": m["note"],
                "supplier": m["supplier_name"], "unitCost": f2(m["unit_cost"]) if (can_stock and m["unit_cost"] is not None) else None}
        mv_out.append(item)

    if can_sales or can_stock:
        sales_rows = await fetch(
            f"""SELECT i.id AS invoice_id, i.invoice_no, i.issued_at, i.is_returned, i.customer_name, b.name AS branch,
                       u.full_name AS user_name, it.qty, it.unit_price_vat, it.discount_amount, it.line_inc, it.line_ex
                FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                LEFT JOIN branches b ON b.id = i.branch_id LEFT JOIN users u ON u.id = i.created_by
                WHERE i.company_id=$1 AND it.product_id=$2{br} ORDER BY i.issued_at DESC LIMIT 300""", *base_args)
        for r in sales_rows:
            mv_out.append({"kind": "return" if r["is_returned"] else "sale", "label": "مرتجع" if r["is_returned"] else "بيع", "at": r["issued_at"].isoformat(),
                           "doc": r["invoice_no"], "qty": float(r["qty"] or 0) * (1 if r["is_returned"] else -1), "from": r["branch"] or "", "to": "",
                           "user": r["user_name"], "note": r["customer_name"], "supplier": None, "unitCost": None, "invoiceId": str(r["invoice_id"])})
        if can_sales:
            out["sales"] = [{"invoiceId": str(r["invoice_id"]), "invoiceNo": r["invoice_no"], "at": r["issued_at"].isoformat(), "branch": r["branch"],
                             "customer": r["customer_name"], "qty": float(r["qty"] or 0), "price": f2(r["unit_price_vat"]), "discount": f2(r["discount_amount"]),
                             "total": f2(r["line_inc"]), "isReturned": r["is_returned"]} for r in sales_rows]
            valid = [r for r in sales_rows if not r["is_returned"]]
            agg = await fetchrow(
                f"""SELECT COALESCE(SUM(it.qty),0) AS qty, COALESCE(SUM(it.line_ex),0) AS rev, COALESCE(SUM(it.line_inc),0) AS rev_inc,
                           MAX(i.issued_at) AS last_at, COUNT(DISTINCT i.id)::int AS invoices
                    FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                    WHERE i.company_id=$1 AND it.product_id=$2 AND NOT i.is_returned{br}""", *base_args)
            kp.update({"salesQty": float(agg["qty"] or 0), "salesRevenue": f2(agg["rev"]), "salesRevenueInc": f2(agg["rev_inc"]),
                       "salesInvoices": agg["invoices"], "lastSaleAt": agg["last_at"].isoformat() if agg["last_at"] else None})
            if valid:
                for r in valid[:25]:
                    events.append({"type": "sale", "at": r["issued_at"].isoformat(), "title": f"بيع {float(r['qty'] or 0):g} — {r['invoice_no']}", "amount": f2(r["line_inc"])})
            # اتجاه المبيعات
            day = "(i.issued_at AT TIME ZONE 'Asia/Riyadh')::date"
            trend = {}
            for key, expr, span in (("daily", f"{day}", "30 days"), ("weekly", f"date_trunc('week', i.issued_at AT TIME ZONE 'Asia/Riyadh')::date", "84 days"),
                                    ("monthly", f"date_trunc('month', i.issued_at AT TIME ZONE 'Asia/Riyadh')::date", "365 days")):
                tr = await fetch(
                    f"""SELECT {expr} AS d, SUM(it.qty) AS qty, SUM(it.line_ex) AS rev
                        FROM invoice_items it JOIN invoices i ON i.id = it.invoice_id
                        WHERE i.company_id=$1 AND it.product_id=$2 AND NOT i.is_returned AND i.issued_at >= now() - interval '{span}'{br}
                        GROUP BY 1 ORDER BY 1""", *base_args)
                trend[key] = [{"date": r["d"].isoformat(), "qty": float(r["qty"] or 0), "revenue": f2(r["rev"])} for r in tr]
            out["trend"] = trend

    mv_out.sort(key=lambda x: x["at"], reverse=True)
    out["movements"] = mv_out[:300]
    for m in moves[:25]:
        if (not scope) or str(m["from_loc_id"]) == scope or str(m["to_loc_id"]) == scope:
            kind = m["move_type"]
            events.append({"type": kind, "at": m["created_at"].isoformat(),
                           "title": f"{MT.get(kind, kind)} {float(m['qty'] or 0):g}" + (f" — {m['move_no']}" if m["move_no"] else "")
                                    + (f" ← {_loc_name(m['from_loc_type'], m['from_loc_id'], branches)}" if kind == "transfer" and m["from_loc_type"] else "")
                                    + (f" → {_loc_name(m['to_loc_type'], m['to_loc_id'], branches)}" if kind == "transfer" and m["to_loc_type"] else "")})

    # ── المشتريات والموردون (التكلفة الفعلية للاستلام) ──
    if can_stock and not scope:
        recv = [m for m in moves if m["move_type"] == "receive"]
        out["purchases"] = [{"at": m["created_at"].isoformat(), "supplier": m["supplier_name"], "doc": m["move_no"], "qty": float(m["qty"] or 0),
                             "unitCost": f2(m["unit_cost"]) if m["unit_cost"] is not None else None,
                             "total": f2(float(m["qty"] or 0) * float(m["unit_cost"])) if m["unit_cost"] is not None else None,
                             "location": _loc_name(m["to_loc_type"], m["to_loc_id"], branches),
                             "purchaseInvoiceId": str(m["purchase_invoice_id"]) if m["purchase_invoice_id"] else None} for m in recv]
        sup: dict[str, dict] = {}
        for m in recv:
            name = m["supplier_name"] or "غير محدد"
            s = sup.setdefault(name, {"name": name, "qty": 0.0, "spend": 0.0, "lastAt": None, "lastCost": None})
            s["qty"] += float(m["qty"] or 0)
            if m["unit_cost"] is not None:
                s["spend"] += float(m["qty"] or 0) * float(m["unit_cost"])
            if s["lastAt"] is None:
                s["lastAt"] = m["created_at"].isoformat(); s["lastCost"] = f2(m["unit_cost"]) if m["unit_cost"] is not None else None
        out["suppliers"] = [{**v, "spend": f2(v["spend"])} for v in sup.values()]
        kp.update({"purchaseQty": sum(float(m["qty"] or 0) for m in recv),
                   "purchaseCost": f2(sum(float(m["qty"] or 0) * float(m["unit_cost"]) for m in recv if m["unit_cost"] is not None)),
                   "lastPurchaseAt": recv[0]["created_at"].isoformat() if recv else None,
                   "lastPurchaseCost": f2(recv[0]["unit_cost"]) if recv and recv[0]["unit_cost"] is not None else None})
    out["kpis"] = kp
    events.sort(key=lambda e: e["at"], reverse=True)
    out["timeline"] = events[:60]
    return out
