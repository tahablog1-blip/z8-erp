# modules/price_lists/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# قوائم أسعار متعددة: كل قائمة فيها أسعار مخصّصة لأصناف معيّنة (الباقي يفضل
# على السعر العادي). عميل بلا قائمة معيّنة (price_list_id = NULL) سعره عادي
# زي أي عميل — صفر تغيير على السلوك الحالي.
from fastapi import HTTPException

from ...core.db import execute, fetch, fetchrow, transaction


def _out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    return r


async def list_price_lists(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT pl.id, pl.name, pl.created_at,
                  COALESCE((SELECT COUNT(*) FROM price_list_items i
                             WHERE i.price_list_id = pl.id), 0)::int AS item_count
           FROM price_lists pl WHERE pl.company_id = $1 ORDER BY pl.name""",
        company_id,
    )
    return [_out(r) for r in rows]


async def create_price_list(company_id: str, name: str) -> dict:
    row = await fetchrow(
        """INSERT INTO price_lists (company_id, name) VALUES ($1, $2)
           RETURNING id, name, created_at, 0::int AS item_count""",
        company_id, name.strip(),
    )
    return _out(row)


async def rename_price_list(company_id: str, list_id: str, name: str) -> dict:
    row = await fetchrow(
        """UPDATE price_lists SET name = $3 WHERE id = $1 AND company_id = $2
           RETURNING id, name, created_at,
             (SELECT COUNT(*) FROM price_list_items i
               WHERE i.price_list_id = price_lists.id)::int AS item_count""",
        list_id, company_id, name.strip(),
    )
    if not row:
        raise HTTPException(404, "قائمة الأسعار غير موجودة")
    return _out(row)


async def delete_price_list(company_id: str, list_id: str) -> None:
    async with transaction() as conn:
        async with conn.transaction():
            row = await conn.fetchrow(
                "SELECT id FROM price_lists WHERE id=$1 AND company_id=$2", list_id, company_id
            )
            if not row:
                raise HTTPException(404, "قائمة الأسعار غير موجودة")
            # رجوع كل عميل كان معيّن عليها للسعر العادي تلقائياً
            await conn.execute("UPDATE customers SET price_list_id = NULL WHERE price_list_id = $1", list_id)
            await conn.execute("DELETE FROM price_list_items WHERE price_list_id = $1", list_id)
            await conn.execute("DELETE FROM price_lists WHERE id = $1", list_id)


async def _assert_owner(company_id: str, list_id: str) -> None:
    row = await fetchrow("SELECT id FROM price_lists WHERE id=$1 AND company_id=$2", list_id, company_id)
    if not row:
        raise HTTPException(404, "قائمة الأسعار غير موجودة")


async def list_items(company_id: str, list_id: str, search: str | None = None) -> list[dict]:
    await _assert_owner(company_id, list_id)
    params: list = [company_id, list_id]
    where = "p.company_id = $1 AND p.is_active = TRUE"
    if search:
        params.append(f"%{search}%")
        i = len(params)
        where += (f" AND (p.category ILIKE ${i} OR p.name ILIKE ${i} "
                  f"OR p.spec ILIKE ${i} OR p.barcode ILIKE ${i})")
    rows = await fetch(
        f"""SELECT p.id AS product_id, p.name, p.category, p.spec, p.barcode,
                  p.price_vat AS base_price_vat, i.price_vat AS override_price_vat
           FROM products p
           LEFT JOIN price_list_items i ON i.product_id = p.id AND i.price_list_id = $2
           WHERE {where}
           ORDER BY p.category, p.name, p.spec
           LIMIT 300""",
        *params,
    )
    out = []
    for r in rows:
        r = dict(r)
        r["product_id"] = str(r["product_id"])
        base = float(r.pop("base_price_vat") or 0)
        override = r.pop("override_price_vat")
        r["base_price_vat"] = base
        r["is_override"] = override is not None
        r["price_vat"] = float(override) if override is not None else base
        out.append(r)
    return out


async def set_item_price(company_id: str, list_id: str, product_id: str, price_vat: float) -> dict:
    await _assert_owner(company_id, list_id)
    prod = await fetchrow("SELECT id FROM products WHERE id=$1 AND company_id=$2", product_id, company_id)
    if not prod:
        raise HTTPException(404, "الصنف غير موجود")
    price_ex = round(price_vat / 1.15, 6)
    row = await fetchrow(
        """INSERT INTO price_list_items (price_list_id, product_id, price, price_vat)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (price_list_id, product_id) DO UPDATE SET price = $3, price_vat = $4
           RETURNING product_id, price_vat""",
        list_id, product_id, price_ex, price_vat,
    )
    return {"product_id": str(row["product_id"]), "price_vat": float(row["price_vat"])}


async def remove_item_price(company_id: str, list_id: str, product_id: str) -> None:
    await _assert_owner(company_id, list_id)
    await execute(
        "DELETE FROM price_list_items WHERE price_list_id = $1 AND product_id = $2", list_id, product_id
    )
