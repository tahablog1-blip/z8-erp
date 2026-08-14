"""
Z8 - تعبئة اللوحات الموحّدة للسيارات الموجودة
==============================================
شغّله مرة واحدة بعد ملف الـ SQL:

    cd C:\\Users\\sda56\\Desktop\\z8\\backend
    python -m app.workers.backfill_plates

ولو حبيت تشوف النتيجة قبل الحفظ:
    python -m app.workers.backfill_plates --dry-run
"""

import os
import sys
import asyncio

import asyncpg

from app.core.plate_utils import normalize_plate

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/z8_car_manager",
)

CARS_TABLE = "cars"
COL_ID = "id"
COL_PLATE = "plate_number"


async def main(dry_run: bool = False) -> None:
    conn = await asyncpg.connect(DATABASE_URL)
    try:
        rows = await conn.fetch(
            f"SELECT {COL_ID} AS id, {COL_PLATE} AS plate FROM {CARS_TABLE}"
        )
        print(f"عدد السيارات: {len(rows)}")

        updates, skipped, invalid = [], 0, []

        for r in rows:
            key = normalize_plate(r["plate"])
            if not key.canonical:
                skipped += 1
                continue
            if not key.is_valid:
                invalid.append((r["plate"], key.canonical))
            updates.append((r["id"], key.canonical, key.loose))

        # تنبيه على اللوحات المكررة بعد التوحيد
        seen, dupes = {}, []
        for _id, canon, _loose in updates:
            if canon in seen:
                dupes.append(canon)
            seen[canon] = _id

        if dupes:
            print(f"\n⚠ لوحات مكررة بعد التوحيد ({len(dupes)}): {sorted(set(dupes))[:20]}")
            print("  راجعها — احتمال يكون فيه سيارات مسجّلة مرتين.")

        if invalid:
            print(f"\n⚠ لوحات صيغتها غير قياسية ({len(invalid)}):")
            for raw, canon in invalid[:20]:
                print(f"   {raw!r} -> {canon}")

        if dry_run:
            print(f"\n[تجربة فقط] كان هيتحدث {len(updates)} صف، وتم تخطي {skipped}.")
            return

        async with conn.transaction():
            await conn.executemany(
                f"UPDATE {CARS_TABLE} SET plate_normalized=$2, plate_loose=$3 "
                f"WHERE {COL_ID}=$1",
                updates,
            )

        print(f"\n✔ تم تحديث {len(updates)} سيارة. تم تخطي {skipped} بدون لوحة.")
    finally:
        await conn.close()


if __name__ == "__main__":
    asyncio.run(main(dry_run="--dry-run" in sys.argv))
