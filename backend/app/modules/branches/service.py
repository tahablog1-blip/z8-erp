# modules/branches/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# لاحظ: الاستعلامات منقولة من branches.routes.js القديم بالحرف — نفس صيغة $1
from fastapi import HTTPException
from ...core.db import fetch, fetchrow

def _row_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    r["manager_user_id"] = str(r["manager_user_id"]) if r.get("manager_user_id") else None
    return r

_COLS = """b.id, b.name, b.category, b.capacity_sir, b.capacity_hafr, b.capacity_rafaat, b.lines,
           b.is_frozen, b.created_at, b.manager_user_id, b.address, b.latitude, b.longitude, b.invoice_prefix,
           b.independent_invoice_numbering, u.full_name AS manager_name"""
_FROM = "FROM branches b LEFT JOIN users u ON u.id = b.manager_user_id"


async def list_branches(company_id: str) -> list[dict]:
    rows = await fetch(
        f"""SELECT {_COLS} {_FROM}
           WHERE b.company_id = $1 AND b.is_active = TRUE
           ORDER BY b.name""",
        company_id,
    )
    return [_row_out(r) for r in rows]

async def create_branch(company_id: str, name: str, category: str, sir: int, hafr: int, rafaat: int,
                        lines: list[str] | None = None, manager_user_id: str | None = None,
                        address: str | None = None, invoice_prefix: str | None = None,
                        independent_invoice_numbering: bool = False,
                        latitude: float | None = None, longitude: float | None = None) -> dict:
    manager_user_id = (manager_user_id or "").strip() or None
    address = (address or "").strip() or None
    row = await fetchrow(
        f"""INSERT INTO branches (company_id, name, category, capacity_sir, capacity_hafr, capacity_rafaat,
                                  lines, manager_user_id, address, invoice_prefix, independent_invoice_numbering,
                                  latitude, longitude)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12, $13)
           RETURNING id""",
        company_id, name, category, (len(lines) if lines else sir), hafr, rafaat, lines or [],
        manager_user_id, address, (invoice_prefix or "").strip().upper() or None, independent_invoice_numbering,
        latitude, longitude,
    )
    return await get_branch(company_id, str(row["id"]))

async def get_branch(company_id: str, branch_id: str) -> dict:
    row = await fetchrow(f"SELECT {_COLS} {_FROM} WHERE b.id=$1 AND b.company_id=$2", branch_id, company_id)
    if not row:
        raise HTTPException(404, "الفرع غير موجود")
    return _row_out(row)

_COL_MAP = {"name": "name", "category": "category", "lines": "lines", "capacitySir": "capacity_sir",
            "capacityHafr": "capacity_hafr", "capacityRafaat": "capacity_rafaat",
            "is_frozen": "is_frozen", "managerUserId": "manager_user_id", "address": "address", "latitude": "latitude", "longitude": "longitude",
            "invoicePrefix": "invoice_prefix", "independentInvoiceNumbering": "independent_invoice_numbering"}

async def update_branch(company_id: str, branch_id: str, fields: dict) -> dict:
    # هنا (بخلاف باقي الموديولات) الفلترة لسه "v is not None" — القيمة الفاضية
    # الصريحة لمسح مدير/عنوان/بادئة بتتبعت "" لا None، فمفيش فقدان نية حقيقية.
    updates = {k: v for k, v in fields.items() if v is not None}
    if not updates:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    # تحديث خطوط السير بيحدّث سعة السير تلقائياً (= عدد الخطوط)
    if "lines" in updates:
        updates["capacitySir"] = len(updates["lines"])
    if "managerUserId" in updates and not str(updates["managerUserId"]).strip():
        updates["managerUserId"] = None
    if "invoicePrefix" in updates:
        updates["invoicePrefix"] = (updates["invoicePrefix"] or "").strip().upper() or None
    if "address" in updates:
        updates["address"] = (updates["address"] or "").strip() or None
    set_parts, values = [], []
    for i, (k, v) in enumerate(updates.items(), start=3):
        cast = "::jsonb" if k == "lines" else ""
        set_parts.append(f"{_COL_MAP[k]} = ${i}{cast}")
        values.append(v)
    row = await fetchrow(
        f"""UPDATE branches SET {', '.join(set_parts)}, updated_at = now()
            WHERE id = $1 AND company_id = $2
            RETURNING id""",
        branch_id, company_id, *values,
    )
    if not row:
        raise HTTPException(404, "الفرع غير موجود")
    return await get_branch(company_id, branch_id)

async def next_branch_invoice_no(conn, company_id: str, branch_id: str) -> str | None:
    """لو الفرع مفعّل عليه ترقيم مستقل، يرجّع رقم فاتورة بتسلسل الفرع نفسه
    (وبادئته لو محددة، وإلا بادئة من أول 3 حروف من اسمه) — وإلا None يعني
    يُستخدم التسلسل العام المشترك (_next_invoice_no في موديول invoices)."""
    row = await conn.fetchrow(
        "SELECT name, invoice_prefix, independent_invoice_numbering FROM branches WHERE id=$1 AND company_id=$2",
        branch_id, company_id,
    )
    if not row or not row["independent_invoice_numbering"]:
        return None
    prefix = (row["invoice_prefix"] or "").strip() or "".join(row["name"].split())[:3].upper() or "BR"
    seq = await conn.fetchrow(
        """INSERT INTO branch_invoice_counters (company_id, branch_id, last_number) VALUES ($1,$2,1)
           ON CONFLICT (company_id, branch_id) DO UPDATE SET last_number = branch_invoice_counters.last_number + 1
           RETURNING last_number""",
        company_id, branch_id,
    )
    return f"{prefix}-{seq['last_number']:06d}"


async def deactivate_branch(company_id: str, branch_id: str) -> None:
    """حذف ناعم — نفس فلسفة النظام: البيانات التاريخية المرتبطة بالفرع تفضل سليمة"""
    row = await fetchrow(
        """UPDATE branches SET is_active = FALSE, updated_at = now()
           WHERE id = $1 AND company_id = $2 AND is_active = TRUE
           RETURNING id""",
        branch_id, company_id,
    )
    if not row:
        raise HTTPException(404, "الفرع غير موجود")
