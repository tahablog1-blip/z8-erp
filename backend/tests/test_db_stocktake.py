# اختبارات دورة الجرد على قاعدة اختبار حقيقية: لقطة → عدّ → مراجعة → إعادة عدّ → اعتماد/إلغاء + المؤشرات والخط الزمني.
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


@pytest.fixture
def world(db_ready):
    """مستودع فيه زيت 10 (تكلفة 30) وفلتر 4 (تكلفة 10)"""
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE stocktake_sessions, audit_log, inventory, products, branches RESTART IDENTITY CASCADE")
            oil, flt = uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO products (id,company_id,name,barcode,cost_price) VALUES ($1,$3,'زيت','111',30),($2,$3,'فلتر','222',10)", oil, flt, CID)
            await c.execute("INSERT INTO inventory (company_id,loc_type,loc_id,product_id,qty) VALUES ($1,'warehouse','main',$2,10),($1,'warehouse','main',$3,4)", CID, oil, flt)
            return {"oil": str(oil), "flt": str(flt)}
    return run(go)


def _svc():
    from app.modules.inventory import service
    return service


def _start(note="جرد اختبار"):
    return _svc().create_stocktake(CO, str(uuid.uuid4()), "أمين", "warehouse", "main", note)


def test_full_cycle_counts_variance_and_settlement(world):
    s = _svc()

    async def go():
        st = await _start()
        sid = st["id"]
        assert st["totalItems"] == 2 and st["countedItems"] == 0
        await s.count_stocktake_item(CO, sid, world["oil"], 7)        # عجز 3 × 30 = 90
        await s.count_stocktake_item(CO, sid, world["flt"], 6)        # زيادة 2 × 10 = 20
        row = (await s.list_stocktakes(CO))[0]
        assert (row["diffItems"], row["shortageValue"], row["surplusValue"]) == (2, 90.0, 20.0)
        await s.submit_stocktake_for_review(CO, sid, str(uuid.uuid4()), "أمين")
        # لم يتغير الرصيد قبل الاعتماد
        assert (await s.get_stocktake(CO, sid))["items"][0]["currentQty"] in (10, 4)
        done = await s.approve_stocktake(CO, str(uuid.uuid4()), "مدير", sid)
        assert done["status"] == "approved"
        from app.core import db
        qty = {str(r["product_id"]): r["qty"] for r in await db.fetch("SELECT product_id, qty FROM inventory WHERE loc_type='warehouse'")}
        assert qty[world["oil"]] == 7 and qty[world["flt"]] == 6
        return sid
    sid = run(go)

    async def after():
        sm = await s.stocktake_summary(CO)
        assert sm["total"] == 1 and sm["approved"] == 1 and sm["open"] == 0
        assert (sm["shortageValue"], sm["surplusValue"], sm["netValue"]) == (90.0, 20.0, -70.0)
        tl = await s.stocktake_timeline(CO, sid)
        assert [t["action"] for t in tl] == ["stocktake_created", "stocktake_submitted", "stocktake_approved"]
    run(after)


def test_reopen_requires_reason_and_keeps_counts(world):
    s = _svc()

    async def go():
        sid = (await _start())["id"]
        await s.count_stocktake_item(CO, sid, world["oil"], 9)
        with pytest.raises(HTTPException) as e:                       # لا إعادة عدّ لجلسة لم تُرسل للمراجعة
            await s.reopen_stocktake(CO, sid, "u", "مدير", "سبب")
        assert e.value.status_code == 409
        await s.submit_stocktake_for_review(CO, sid, "u", "أمين")
        with pytest.raises(HTTPException) as e:
            await s.reopen_stocktake(CO, sid, "u", "مدير", "  ")
        assert e.value.status_code == 400
        back = await s.reopen_stocktake(CO, sid, str(uuid.uuid4()), "مدير", "فرق كبير في الزيت")
        assert back["status"] == "in_progress"
        assert next(i for i in back["items"] if i["productId"] == world["oil"])["countedQty"] == 9
        tl = await s.stocktake_timeline(CO, sid)
        assert tl[-1]["action"] == "stocktake_reopened" and "فرق كبير في الزيت" in tl[-1]["details"]
    run(go)


def test_cancel_logs_reason_and_never_touches_stock(world):
    s = _svc()

    async def go():
        sid = (await _start())["id"]
        await s.count_stocktake_item(CO, sid, world["oil"], 1)
        out = await s.cancel_stocktake(CO, sid, str(uuid.uuid4()), "مدير", "بدأ بالخطأ")
        assert out["status"] == "cancelled"
        with pytest.raises(HTTPException):
            await s.cancel_stocktake(CO, sid)                          # لا إلغاء مزدوج
        from app.core import db
        assert await db.fetchrow("SELECT qty FROM inventory WHERE product_id=$1", uuid.UUID(world["oil"])) is not None
        assert (await db.fetchrow("SELECT qty FROM inventory WHERE product_id=$1", uuid.UUID(world["oil"])))["qty"] == 10
        tl = await s.stocktake_timeline(CO, sid)
        assert "بدأ بالخطأ" in tl[-1]["details"]
        sm = await s.stocktake_summary(CO)
        assert sm["cancelled"] == 1 and sm["approved"] == 0 and sm["netValue"] == 0
    run(go)


def test_summary_branch_scope_isolation(world):
    s = _svc()

    async def go():
        from app.core import db
        br = uuid.uuid4()
        await db.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$2,'فرع')", br, CID)
        await _start()                                                 # جلسة المستودع
        await s.create_stocktake(CO, str(uuid.uuid4()), "أمين", "branch", str(br), None)
        assert (await s.stocktake_summary(CO))["total"] == 2
        assert (await s.stocktake_summary(CO, str(br)))["total"] == 1   # موظف الفرع لا يرى المستودع
        assert (await s.stocktake_summary(CO, str(uuid.uuid4())))["total"] == 0
    run(go)


def test_approve_blocked_when_stock_moved_since_snapshot(world):
    s = _svc()

    async def go():
        from app.core import db
        sid = (await _start())["id"]
        await s.count_stocktake_item(CO, sid, world["oil"], 8)
        await s.submit_stocktake_for_review(CO, sid, "u", "أمين")
        await db.execute("UPDATE inventory SET qty=qty-1 WHERE product_id=$1", uuid.UUID(world["oil"]))   # بيع أثناء الجرد
        with pytest.raises(HTTPException) as e:
            await s.approve_stocktake(CO, "u", "مدير", sid)
        assert e.value.status_code == 409
        assert (await db.fetchrow("SELECT qty FROM inventory WHERE product_id=$1", uuid.UUID(world["oil"])))["qty"] == 9   # لم يُمسّ
    run(go)
