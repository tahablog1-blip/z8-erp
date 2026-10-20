# modules/shortage_overrides/service.py
from ...core.db import fetch, fetchrow, execute


async def list_overrides() -> list[dict]:
    return await fetch(
        "SELECT barcode, name, updated_at FROM shortage_catalog_overrides ORDER BY updated_at DESC"
    )


async def upsert_override(barcode: str, name: str) -> dict:
    row = await fetchrow(
        """INSERT INTO shortage_catalog_overrides (barcode, name, updated_at)
             VALUES ($1, $2, now())
           ON CONFLICT (barcode) DO UPDATE
             SET name = EXCLUDED.name, updated_at = now()
           RETURNING barcode, name, updated_at""",
        barcode.strip(), name.strip(),
    )
    return row
