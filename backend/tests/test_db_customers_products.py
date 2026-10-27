# اختبارات استعلامات شاشتي العملاء والأصناف + منع تكرار اللوحات — على قاعدة اختبار حقيقية (PostgreSQL).
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
NOW = dt.datetime.now(dt.timezone.utc)


def _id():
    return uuid.uuid4()


async def _seed(c):
    """عميلان: أ (فاتورة آجلة 100 قبل 45 يوماً + سداد 30) و ب (فاتورة نقدية). صنفان: زيت (مخزون 3 وحد أدنى 5) وفلتر (مخزون 0)."""
    br, br2, u = _id(), _id(), _id()
    for b, n in ((br, "الرئيسي"), (br2, "الفرع 2")):
        await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$2,$3)", b, uuid.UUID(CO), n)
    await c.execute("INSERT INTO users (id, company_id, full_name) VALUES ($1,$2,'أحمد')", u, uuid.UUID(CO))
    a, b_ = _id(), _id()
    await c.execute("INSERT INTO customers (id, company_id, name, phone, email, created_at) VALUES ($1,$2,'عميل أ','0511111111','a@x.com',$3)", a, uuid.UUID(CO), NOW - dt.timedelta(days=200))
    await c.execute("INSERT INTO customers (id, company_id, name, phone, created_at) VALUES ($1,$2,'عميل ب','0522222222',$3)", b_, uuid.UUID(CO), NOW - dt.timedelta(days=2))
    inv_a, inv_b = _id(), _id()
    await c.execute("INSERT INTO invoices (id,company_id,branch_id,invoice_no,source,customer_id,issued_at,total_ex,total_inc,paid_total,credit_total,cogs_total,created_by) VALUES ($1,$2,$3,'INV-A','pos',$4,$5,86.96,100,0,100,40,$6)",
                    inv_a, uuid.UUID(CO), br, a, NOW - dt.timedelta(days=45), u)
    await c.execute("INSERT INTO invoices (id,company_id,branch_id,invoice_no,source,customer_id,issued_at,total_ex,total_inc,paid_total,credit_total,cogs_total,created_by) VALUES ($1,$2,$3,'INV-B','pos',$4,now(),43.48,50,50,0,20,$5)",
                    inv_b, uuid.UUID(CO), br2, b_, u)
    await c.execute("INSERT INTO customer_ledger (company_id,customer_id,entry_type,amount,invoice_id,created_at) VALUES ($1,$2,'invoice',100,$3,$4)", uuid.UUID(CO), a, inv_a, NOW - dt.timedelta(days=45))
    await c.execute("INSERT INTO customer_ledger (company_id,customer_id,entry_type,amount,note) VALUES ($1,$2,'payment',-30,'سداد')", uuid.UUID(CO), a)
    oil, flt = _id(), _id()
    await c.execute("INSERT INTO products (id,company_id,category,name,spec,sku,price,price_vat,cost_price,min_qty) VALUES ($1,$2,'زيوت','زيت','5W-30','SKU-1',50,57.5,30,5)", oil, uuid.UUID(CO))
    await c.execute("INSERT INTO products (id,company_id,category,name,sku,price,price_vat,cost_price,min_qty) VALUES ($1,$2,'فلاتر','فلتر','SKU-2',20,23,10,2)", flt, uuid.UUID(CO))
    await c.execute("INSERT INTO inventory (company_id,loc_type,loc_id,product_id,qty) VALUES ($1,'warehouse','main',$2,3),($1,'branch',$3,$2,0)", uuid.UUID(CO), oil, str(br))
    await c.execute("INSERT INTO invoice_items (invoice_id,product_id,label,qty,unit_price_vat,line_ex,line_inc) VALUES ($1,$2,'زيت',2,57.5,100,115)", inv_b, oil)
    return {"a": str(a), "b": str(b_), "oil": str(oil), "flt": str(flt), "br": str(br)}


@pytest.fixture(scope="module")
def seeded(db_ready):
    from app.core import db

    async def go():
        c = db.pool()
        async with c.acquire() as conn:
            await conn.execute("TRUNCATE branches, users, customers, customer_ledger, customer_vehicles, customer_notes, invoices, invoice_items, invoice_payments, products, inventory, stock_moves RESTART IDENTITY CASCADE")
            return await _seed(conn)
    return run(go)


def test_customer_balance_and_overdue_come_from_ledger(seeded, admin):
    from app.modules.customers import overview

    async def go():
        return await overview.list_overview(CO, admin, {})
    r = run(go)
    rows = {i["name"]: i for i in r["items"]}
    assert rows["عميل أ"]["balance"] == 70.0 and rows["عميل ب"]["balance"] == 0.0     # 100 − 30
    assert rows["عميل أ"]["isCredit"] and not rows["عميل ب"]["isCredit"]
    assert rows["عميل ب"]["segment"] == "new" and rows["عميل أ"]["sales"] == 100.0
    assert r["kpis"]["receivables"] == 70.0 and r["kpis"]["debtors"] == 1


def test_customer_search_filters_and_pagination(seeded, admin):
    from app.modules.customers import overview

    async def q(**p):
        return await overview.list_overview(CO, admin, p)
    assert run(lambda: q(q="0511111111"))["total"] == 1
    assert run(lambda: q(q="INV-B"))["items"][0]["name"] == "عميل ب"        # بحث برقم الفاتورة
    assert run(lambda: q(hasBalance="1"))["total"] == 1
    assert run(lambda: q(pay="cash"))["items"][0]["name"] == "عميل ب"
    assert run(lambda: q(page="abc", pageSize="x"))["page"] == 1              # مدخلات سيئة لا تكسر
    assert run(lambda: q(sort="sales", dir="desc"))["items"][0]["name"] == "عميل أ"


def test_customer_financials_hidden_without_permission(seeded):
    from app.core.deps import CurrentUser
    from app.modules.customers import overview
    cashier = CurrentUser(user_id="2", company_id=CO, branch_id=None, email="c", full_name="c", role="employee", permissions=["customers.create"])

    async def go():
        return await overview.list_overview(CO, cashier, {}), await overview.profile(CO, cashier, seeded["a"])
    lst, prof = run(go)
    assert lst["canFinance"] is False and all(i["balance"] is None for i in lst["items"]) and lst["kpis"]["receivables"] is None
    assert prof["kpis"] is None and prof["invoices"] is None


def test_duplicate_detection(seeded):
    from app.modules.customers import overview
    d = run(lambda: overview.check_duplicate(CO, "+966 51 111 1111", None, None, None, None))
    assert [x["name"] for x in d] == ["عميل أ"] and d[0]["reasons"] == ["phone"]
    assert run(lambda: overview.check_duplicate(CO, "0511111111", None, None, None, seeded["a"])) == []


def test_bulk_deactivate_refuses_customer_with_balance(seeded):
    from app.modules.customers import overview
    r = run(lambda: overview.bulk_status(CO, [seeded["a"], seeded["b"]], False))
    assert r["updated"] == 1 and r["skipped"][0]["name"] == "عميل أ"
    run(lambda: overview.bulk_status(CO, [seeded["b"]], True))


def test_vehicle_plate_duplicates_blocked_in_any_format(seeded):
    from app.modules.customers import service

    async def go():
        await service.add_vehicle(CO, seeded["a"], {"plate": "aaa 111", "plateType": "saudi"})
        out = []
        for plate, cust in (("111 AAA", "a"), ("١١١ ااا", "a"), ("A-A-A 111", "b"), ("1111 AAA", "a")):
            try:
                await service.add_vehicle(CO, seeded[cust], {"plate": plate, "plateType": "saudi"}); out.append("ok")
            except HTTPException as e:
                out.append(e.status_code)
        return out
    assert run(go) == [409, 409, 409, "ok"]


def test_vehicle_update_excludes_itself_but_not_others(seeded):
    from app.modules.customers import service

    async def go():
        v = await service.add_vehicle(CO, seeded["b"], {"plate": "222 BDR"})
        same = await service.update_vehicle(CO, v["id"], {"plate": "BDR 222", "color": "أبيض"})
        try:
            await service.update_vehicle(CO, v["id"], {"plate": "111 AAA"}); other = None
        except HTTPException as e:
            other = e.status_code
        return same["plate"], same["color"], other
    assert run(go) == ("222 BDR", "أبيض", 409)


def test_products_stock_value_status_and_sales(seeded, admin):
    from app.modules.products import overview

    async def go():
        return await overview.list_overview(CO, admin, {}), await overview.list_overview(CO, admin, {"stock": "low"}), await overview.list_overview(CO, admin, {"stock": "out"})
    allp, low, out = run(go)
    k = allp["kpis"]
    assert k["stockValue"] == 90.0                       # 3 × 30 (التكلفة المعتمدة) — نفس تعريف تقييم المخزون
    assert (k["lowStock"], k["outOfStock"]) == (1, 1)
    assert [i["name"] for i in low["items"]] == ["زيت"] and [i["name"] for i in out["items"]] == ["فلتر"]
    oil = next(i for i in allp["items"] if i["name"] == "زيت")
    assert oil["margin"] == 40.0 and oil["unitProfit"] == 20.0 and oil["stock"] == 3
    assert k["sales"] == 100.0 and k["grossProfit"] == round(43.48 - 20, 2)   # الفترة الافتراضية = الشهر الحالي، فالفاتورة القديمة (45 يوماً) خارجها


def test_products_cost_hidden_without_permission_and_branch_scope(seeded, admin):
    from app.core.deps import CurrentUser
    from app.modules.products import overview
    cashier = CurrentUser(user_id="2", company_id=CO, branch_id=None, email="c", full_name="c", role="employee", permissions=["invoices.create"])
    scoped = CurrentUser(user_id="3", company_id=CO, branch_id=seeded["br"], email="d", full_name="d", role="employee", permissions=["products.view_stock"])

    async def go():
        return await overview.list_overview(CO, cashier, {}), await overview.list_overview(CO, scoped, {})
    c, s = run(go)
    assert c["canCost"] is False and all(i["cost"] is None for i in c["items"]) and c["kpis"]["stockValue"] is None
    oil = next(i for i in s["items"] if i["name"] == "زيت")
    assert oil["stock"] == 0.0                           # الموظف المقيّد بفرع يرى رصيد فرعه فقط (المستودع مخفي)
    assert [l["name"] for l in s["facets"]["locations"]] == ["الرئيسي"]


def test_product_profile_sections_follow_permissions(seeded, admin):
    from app.modules.products import overview

    async def go():
        return await overview.profile(CO, admin, seeded["oil"])
    p = run(go)
    assert p["totalStock"] == 3 and p["stockValue"] == 90.0 and p["kpis"]["salesQty"] == 2
    assert any(m["kind"] == "sale" for m in p["movements"])


def test_product_bad_id_is_404(seeded, admin):
    from app.modules.products import overview
    with pytest.raises(HTTPException) as e:
        run(lambda: overview.profile(CO, admin, "not-a-uuid"))
    assert e.value.status_code == 404
