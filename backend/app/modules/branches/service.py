# modules/branches/service.py — منطق الأعمال معزول عن طبقة الـ HTTP
# لاحظ: الاستعلامات منقولة من branches.routes.js القديم بالحرف — نفس صيغة $1
from fastapi import HTTPException
from ...core.db import fetch, fetchrow

def _row_out(r: dict) -> dict:
    r = dict(r)
    r["id"] = str(r["id"])
    return r

async def list_branches(company_id: str) -> list[dict]:
    rows = await fetch(
        """SELECT id, name, capacity_sir, capacity_hafr, capacity_rafaat, lines, is_frozen, created_at
           FROM branches WHERE company_id = $1 AND is_active = TRUE
           ORDER BY name""",
        company_id,
    )
    return [_row_out(r) for r in rows]

async def create_branch(company_id: str, name: str, sir: int, hafr: int, rafaat: int, lines: list[str] | None = None) -> dict:
    row = await fetchrow(
        """INSERT INTO branches (company_id, name, capacity_sir, capacity_hafr, capacity_rafaat, lines)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb)
           RETURNING id, name, capacity_sir, capacity_hafr, capacity_rafaat, lines, is_frozen, created_at""",
        company_id, name, (len(lines) if lines else sir), hafr, rafaat, lines or [],
    )
    return _row_out(row)

_COL_MAP = {"name": "name", "lines": "lines", "capacitySir": "capacity_sir",
            "capacityHafr": "capacity_hafr", "capacityRafaat": "capacity_rafaat",
            "is_frozen": "is_frozen"}

async def update_branch(company_id: str, branch_id: str, fields: dict) -> dict:
    updates = {k: v for k, v in fields.items() if v is not None}
    if not updates:
        raise HTTPException(400, "لا يوجد ما يُحدَّث")
    # تحديث خطوط السير بيحدّث سعة السير تلقائياً (= عدد الخطوط)
    if "lines" in updates:
        updates["capacitySir"] = len(updates["lines"])
    set_parts, values = [], []
    for i, (k, v) in enumerate(updates.items(), start=3):
        cast = "::jsonb" if k == "lines" else ""
        set_parts.append(f"{_COL_MAP[k]} = ${i}{cast}")
        values.append(v)
    row = await fetchrow(
        f"""UPDATE branches SET {', '.join(set_parts)}, updated_at = now()
            WHERE id = $1 AND company_id = $2
            RETURNING id, name, capacity_sir, capacity_hafr, capacity_rafaat, lines, is_frozen, created_at""",
        branch_id, company_id, *values,
    )
    if not row:
        raise HTTPException(404, "الفرع غير موجود")
    return _row_out(row)

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
