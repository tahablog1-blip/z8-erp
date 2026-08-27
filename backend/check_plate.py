# -*- coding: utf-8 -*-
import asyncio
import os
import sys
import io

try:
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
except Exception:
    pass


async def main():
    import asyncpg

    url = os.getenv("DATABASE_URL", "")
    if not url:
        for line in open(".env", encoding="utf-8"):
            line = line.strip()
            if line.startswith("DATABASE_URL="):
                url = line.split("=", 1)[1].strip().strip('"').strip("'")
                break
    if not url:
        print("لم أجد DATABASE_URL")
        return

    conn = await asyncpg.connect(url)
    rows = await conn.fetch(
        "SELECT id, plate, plate_normalized, plate_loose, name, brand "
        "FROM cars WHERE plate ILIKE '%4733%' OR plate ILIKE '%KUR%' OR plate ILIKE '%كور%'"
    )
    if not rows:
        print("لا توجد نتائج مطابقة لـ 4733 أو KUR أو كور")
    for r in rows:
        print(dict(r))
    await conn.close()


asyncio.run(main())
