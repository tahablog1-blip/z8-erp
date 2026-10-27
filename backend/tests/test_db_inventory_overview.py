# مركز قيادة المخزون: مؤشرات الحالة، النطاق (موقع/فرع الموظف)، الداخل/الخارج، حجب التكلفة، الحركات والتحليلات — على قاعدة اختبار حقيقية.
import datetime as dt
import uuid

import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
NOW = dt.datetime.now(dt.timezone.utc)


def _user(role="admin", branch=None, perms=None):
    from app.core.deps import CurrentUser
    return CurrentUser(user_id="1", company_id=CO, branch_id=branch, email="x@x", full_name="مستخدم", role=role, permissions=perms or [])


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE branches, users, products, inventory, stock_moves, invoices, invoice_items, stocktake_sessions RESTART IDENTITY CASCADE")
            br1, br2, u = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            for b, n in ((br1, "النسيم"), (br2, "الخليج")):
                await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$2,$3)", b, CID, n)
            await c.execute("INSERT INTO users (id, company_id, full_name) VALUES ($1,$2,'أمين')", u, CID)
            P = {}
            for key, name, cat, cost, mn in (("ok", "زيت أ", "زيوت", 30, 5), ("low", "زيت ب", "زيوت", 20, 10), ("out", "فلتر", "فلاتر", 10, 3), ("dead", "شمعة", "قطع", 5, 0)):
                pid = uuid.uuid4(); P[key] = str(pid)
                await c.execute("INSERT INTO products (id,company_id,name,category,cost_price,min_qty) VALUES ($1,$2,$3,$4,$5,$6)", pid, CID, name, cat, cost, mn)
            inv = [("ok", "warehouse", "main", 100), ("ok", "branch", str(br1), 20), ("low", "warehouse", "main", 6), ("out", "warehouse", "main", 0), ("dead", "warehouse", "main", 7)]
            for k, t, i, q in inv:
                await c.execute("INSERT INTO inventory (company_id,loc_type,loc_id,product_id,qty) VALUES ($1,$2,$3,$4,$5)", CID, t, i, uuid.UUID(P[k]), q)
            # حركات: استلام «ok» الآن + استلام قديم لـ«dead» قبل 200 يوم + تحويل ok إلى النسيم الآن
            await c.execute("INSERT INTO stock_moves (company_id,move_type,to_loc_type,to_loc_id,product_id,product_label,qty,move_no,supplier_name,unit_cost,created_by,created_at) VALUES ($1,'receive','warehouse','main',$2,'زيت أ',120,'R-1','مورد 1',30,$3,$4)", CID, uuid.UUID(P["ok"]), u, NOW)
            await c.execute("INSERT INTO stock_moves (company_id,move_type,to_loc_type,to_loc_id,product_id,product_label,qty,move_no,created_at) VALUES ($1,'receive','warehouse','main',$2,'شمعة',7,'R-0',$3)", CID, uuid.UUID(P["dead"]), NOW - dt.timedelta(days=200))
            await c.execute("INSERT INTO stock_moves (company_id,move_type,from_loc_type,from_loc_id,to_loc_type,to_loc_id,product_id,product_label,qty,move_no,created_by) VALUES ($1,'transfer','warehouse','main','branch',$2,$3,'زيت أ',20,'T-1',$4)", CID, str(br1), uuid.UUID(P["ok"]), u)
            # بيع 4 من «ok» في النسيم اليوم
            inv_id = uuid.uuid4()
            await c.execute("INSERT INTO invoices (id,company_id,branch_id,invoice_no,source,issued_at,total_ex,total_inc,paid_total,credit_total,cogs_total) VALUES ($1,$2,$3,'INV-1','pos',$4,200,230,230,0,120)", inv_id, CID, br1, NOW)
            await c.execute("INSERT INTO invoice_items (invoice_id,product_id,label,qty,unit_price_vat,line_ex,line_inc) VALUES ($1,$2,'زيت أ',4,57.5,200,230)", inv_id, uuid.UUID(P["ok"]))
            return {"P": P, "br1": str(br1), "br2": str(br2)}
    return run(go)


def _ov(user, **p):
    from app.modules.inventory import overview
    return run(lambda: overview.overview(CO, user, p))


def test_kpis_health_and_value_for_all_locations(world):
    r = _ov(_user())
    k = r["kpis"]
    assert (k["catalog"], k["skus"], k["units"]) == (4, 3, 100 + 20 + 6 + 7)     # ok/low/dead لهم رصيد
    assert k["value"] == 120 * 30 + 6 * 20 + 7 * 5                                  # الرصيد × التكلفة
    assert (k["low"], k["out"], k["dead"]) == (1, 1, 1)
    assert r["health"] == {"ok": 1, "low": 1, "out": 1, "dead": 1}
    assert k["in"] == 120                                                           # استلام الشهر فقط؛ استلام قبل 200 يوم خارج الفترة
    assert k["out_qty"] == 4 and k["net"] == k["in"] - 4                            # التحويلات لا تُحسب عند «كل المواقع»


def test_location_scope_and_branch_user_isolation(world):
    wh = _ov(_user(), loc="warehouse")
    assert wh["kpis"]["units"] == 100 + 6 + 7 and wh["kpis"]["out_qty"] == 20      # لا مبيعات من المستودع؛ 20 = تحويل صادر للنسيم
    br = _ov(_user(), loc=world["br1"])
    assert br["kpis"]["units"] == 20 and br["kpis"]["in"] == 20 and br["kpis"]["out_qty"] == 4
    emp = _user("employee", world["br1"], ["products.view_stock"])
    r = _ov(emp, loc="warehouse")                                                    # محاولة تجاوز النطاق: يُجبَر على فرعه
    assert r["scope"]["kind"] == "branch" and r["kpis"]["units"] == 20
    other = _ov(_user("employee", world["br2"], ["products.view_stock"]))
    assert other["kpis"]["units"] == 0 and other["items"][0]["stock"] == 0


def test_table_filters_search_sort_and_pagination(world):
    r = _ov(_user(), status="low")
    assert [i["name"] for i in r["items"]] == ["زيت ب"] and r["total"] == 1
    assert [i["name"] for i in _ov(_user(), status="out")["items"]] == ["فلتر"]
    assert [i["name"] for i in _ov(_user(), status="dead")["items"]] == ["شمعة"]
    assert [i["name"] for i in _ov(_user(), status="ok")["items"]] == ["زيت أ"]
    assert _ov(_user(), q="مورد 1")["total"] == 1                                    # بحث بالمورد
    top = _ov(_user(), sort="value", dir="desc")["items"][0]
    assert top["name"] == "زيت أ" and top["value"] == 120 * 30 and top["stockWarehouse"] == 100 and top["stockBranches"] == 20
    pg = _ov(_user(), pageSize=5)
    assert pg["total"] == 4 and len(pg["items"]) == 4


def test_cost_hidden_without_permission(world):
    emp = _user("employee", None, ["inventory.request"])                             # بلا صلاحية المخزون
    r = _ov(emp)
    assert r["kpis"]["value"] is None and all(i["cost"] is None and i["value"] is None for i in r["items"])


def test_movements_filters_and_scope(world):
    from app.modules.inventory import overview

    async def go():
        a = await overview.movements(CO, _user(), {})
        assert a["total"] == 3 and a["items"][0]["user"] in ("أمين", None)
        t = await overview.movements(CO, _user(), {"type": "transfer"})
        assert [m["moveNo"] for m in t["items"]] == ["T-1"] and t["items"][0]["to"].startswith("فرع")
        b = await overview.movements(CO, _user("employee", world["br2"], ["products.view_stock"]), {})
        assert b["total"] == 0                                                        # فرع بلا حركات
        s = await overview.movements(CO, _user(), {"q": "R-0"})
        assert s["total"] == 1
    run(go)


def test_analytics_and_product_drawer(world):
    from app.modules.inventory import overview

    async def go():
        an = await overview.analytics(CO, _user(), {})
        assert {x["name"] for x in an["byLocation"]} >= {"المستودع الرئيسي", "فرع النسيم"}
        wh = next(x for x in an["byLocation"] if x["type"] == "warehouse")
        assert (wh["low"], wh["out"], wh["units"]) == (1, 1, 113)
        assert an["byCategory"][0]["category"] == "زيوت" and an["topMovers"][0]["qty"] == 4
        d = await overview.product_inventory(CO, _user(), world["P"]["ok"])
        assert d["total"] == 120 and d["value"] == 3600.0 and {s["name"] for s in d["stock"]} == {"المستودع الرئيسي", "فرع النسيم"}
        assert d["lastSale"]["invoiceNo"] == "INV-1" and d["lastReceive"]["supplier"] == "مورد 1" and len(d["moves"]) == 2
        scoped = await overview.product_inventory(CO, _user("employee", world["br1"], ["products.view_stock"]), world["P"]["ok"])
        assert scoped["total"] == 20 and len(scoped["stock"]) == 1 and scoped["lastReceive"] is None
        with pytest.raises(Exception):
            await overview.product_inventory(CO, _user(), "bad-id")
    run(go)
