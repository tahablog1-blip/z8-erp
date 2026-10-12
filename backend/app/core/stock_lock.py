"""أقفال موحدة لتنسيق عمليات تعديل أرصدة المخزون."""

async def lock_stock_location(conn, company_id, loc_type, loc_id):
    """قفل موقع مخزون حتى نهاية المعاملة الحالية."""
    await conn.fetchval(
        """
        SELECT pg_advisory_xact_lock(
            hashtext($1::text),
            hashtext($2::text || ':' || $3::text)
        )
        """,
        str(company_id),
        str(loc_type),
        str(loc_id),
    )


async def lock_stock_locations(conn, company_id, locations):
    """قفل عدة مواقع بترتيب ثابت لتقليل احتمالات التعارض."""
    normalized = sorted({
        (str(loc_type), str(loc_id))
        for loc_type, loc_id in locations
    })

    for loc_type, loc_id in normalized:
        await lock_stock_location(
            conn, company_id, loc_type, loc_id
        )
