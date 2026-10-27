# مركز الموردين: الرصيد من دفتر المورد، المتأخر/الأعمار من الفواتير، كشف الحساب بالرصيد الافتتاحي، الفلاتر — على قاعدة اختبار حقيقية.
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
TODAY = dt.date.today()
NOW = dt.datetime.now(dt.timezone.utc)


@pytest.fixture
def world(db_ready):
    """مورد أ: فاتورة آجلة 1000 متأخرة 45 يوماً (سُدّد منها 400 مخصصة) + آجلة 500 تستحق بعد 3 أيام + نقدية 200؛ مورد ب بلا حركة؛ مورد ج غير نشط."""
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE suppliers, purchase_invoices, purchase_invoice_items, supplier_ledger, supplier_payments, journal_entries, users, products RESTART IDENTITY CASCADE")
            a, b, cc, u, prod = uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO users (id, company_id, full_name) VALUES ($1,$2,'محاسب')", u, CID)
            await c.execute("INSERT INTO products (id, company_id, name, sku) VALUES ($1,$2,'زيت','SKU-1')", prod, CID)
            await c.execute("INSERT INTO suppliers (id,company_id,name,phone,vat_number,category) VALUES ($1,$3,'مورد أ','0511','3000','زيوت'),($2,$3,'مورد ب',NULL,NULL,NULL)", a, b, CID)
            await c.execute("INSERT INTO suppliers (id,company_id,name,is_active) VALUES ($1,$2,'مورد ج',false)", cc, CID)
            i1, i2, i3 = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            old = TODAY - dt.timedelta(days=75)
            await c.execute("INSERT INTO purchase_invoices (id,company_id,supplier_id,invoice_no,invoice_date,payment_terms,due_date,total,paid_total,status,created_by,created_at) VALUES ($1,$2,$3,'PINV-1',$4,'credit',$5,1000,400,'partially_paid',$6,$7)",
                            i1, CID, a, old, TODAY - dt.timedelta(days=45), u, NOW - dt.timedelta(days=75))
            await c.execute("INSERT INTO purchase_invoices (id,company_id,supplier_id,invoice_no,invoice_date,payment_terms,due_date,total,paid_total,status,created_by) VALUES ($1,$2,$3,'PINV-2',$4,'credit',$5,500,0,'unpaid',$6)",
                            i2, CID, a, TODAY, TODAY + dt.timedelta(days=3), u)
            await c.execute("INSERT INTO purchase_invoices (id,company_id,supplier_id,invoice_no,invoice_date,payment_terms,total,paid_total,status,created_by) VALUES ($1,$2,$3,'PINV-3',$4,'cash',200,200,'paid',$5)", i3, CID, a, TODAY, u)
            await c.execute("INSERT INTO purchase_invoice_items (invoice_id,product_id,product_label,qty,unit_cost,line_total) VALUES ($1,$2,'زيت',10,100,1000),($3,$2,'زيت',5,100,500)", i1, prod, i2)
            # الدفتر: فاتورتان آجلتان + سداد 400 مخصص للأولى + سداد 100 غير مخصص
            await c.execute("INSERT INTO supplier_ledger (company_id,supplier_id,entry_type,invoice_id,amount,note,created_at) VALUES ($1,$2,'invoice',$3,1000,'فاتورة',$4)", CID, a, i1, NOW - dt.timedelta(days=75))
            await c.execute("INSERT INTO supplier_ledger (company_id,supplier_id,entry_type,invoice_id,amount,note,created_at) VALUES ($1,$2,'payment',$3,-400,'سداد',$4)", CID, a, i1, NOW - dt.timedelta(days=40))
            await c.execute("INSERT INTO supplier_ledger (company_id,supplier_id,entry_type,invoice_id,amount,note) VALUES ($1,$2,'invoice',$3,500,'فاتورة')", CID, a, i2)
            await c.execute("INSERT INTO supplier_ledger (company_id,supplier_id,entry_type,amount,note) VALUES ($1,$2,'payment',-100,'سداد غير مخصص')", CID, a)
            await c.execute("INSERT INTO supplier_payments (company_id,supplier_id,invoice_id,method,amount,created_by,created_at) VALUES ($1,$2,$3,'transfer',400,$4,$5)", CID, a, i1, u, NOW - dt.timedelta(days=40))
            await c.execute("INSERT INTO supplier_payments (company_id,supplier_id,method,amount,created_by) VALUES ($1,$2,'cash',100,$3)", CID, a, u)
            await c.execute("INSERT INTO journal_entries (company_id,source_type,source_id) VALUES ($1,'purchase_invoice',$2)", CID, str(i1))
            return {"a": str(a), "b": str(b), "c": str(cc), "i1": str(i1)}
    return run(go)


def _ov(**p):
    from app.modules.suppliers import overview
    return run(lambda: overview.overview(CO, None, p))


def test_kpis_balance_overdue_aging_and_unallocated(world):
    r = _ov(**{"from": (TODAY - dt.timedelta(days=100)).isoformat(), "to": TODAY.isoformat()})
    k = r["kpis"]
    assert (k["total"], k["active"]) == (3, 2)
    assert k["purchases"] == 1000 + 500 + 200 and k["paid"] == 400 + 100 + 200      # سندات الصرف + المشتريات النقدية
    assert k["payable"] == 1000 and k["advances"] == 0                                # 1000−400+500−100 = 1000 (الدفتر)
    assert (k["overdue"], k["overdueCount"]) == (600.0, 1)                            # 1000−400
    assert (k["dueSoon"], k["dueSoonCount"]) == (500.0, 1) and k["openInvoices"] == 2
    assert k["invoiceOutstanding"] == 1100 and k["unallocated"] == 100                # فرق الدفتر عن الفواتير = السداد غير المخصص
    ag = {x["key"]: x for x in r["aging"]}
    assert ag["d31_60"]["amount"] == 600.0 and ag["current"]["amount"] == 500.0 and ag["d1_30"]["count"] == 0


def test_table_rows_filters_search_and_sort(world):
    rows = {i["name"]: i for i in _ov(**{"from": (TODAY - dt.timedelta(days=100)).isoformat()})["items"]}
    a = rows["مورد أ"]
    assert (a["balance"], a["purchases"], a["paid"], a["overdue"], a["openInvoices"], a["invoiceCount"]) == (1000.0, 1700.0, 700.0, 600.0, 2, 3)
    assert a["nextDue"] and a["lastPurchase"] == TODAY.isoformat() and "مورد ج" not in rows                      # غير النشط مخفي افتراضياً
    assert [i["name"] for i in _ov(status="inactive")["items"]] == ["مورد ج"]
    assert _ov(status="all")["total"] == 3
    assert [i["name"] for i in _ov(filter="overdue")["items"]] == ["مورد أ"]
    assert [i["name"] for i in _ov(filter="zero")["items"]] == ["مورد ب"]
    assert [i["name"] for i in _ov(q="3000")["items"]] == ["مورد أ"]                                              # بحث بالرقم الضريبي
    assert [i["name"] for i in _ov(sort="balance", dir="desc")["items"]][0] == "مورد أ"
    assert _ov(category="زيوت")["total"] == 1


def test_supplier_360_ledger_opening_balance_and_journal_link(world):
    from app.modules.suppliers import overview

    async def go():
        full = await overview.supplier_360(CO, world["a"], {})
        assert full["kpis"]["balance"] == 1000 and full["kpis"]["invoiceCount"] == 3 and full["kpis"]["avgInvoice"] == round(1700 / 3, 2)
        assert (full["ledger"]["opening"], full["ledger"]["credit"], full["ledger"]["debit"], full["ledger"]["closing"]) == (0.0, 1500.0, 500.0, 1000.0)
        assert full["ledger"]["entries"][-1]["balance"] == 1000.0                                                   # آخر رصيد جارٍ = الرصيد النهائي
        first = full["ledger"]["entries"][0]
        assert first["credit"] == 1000.0 and first["debit"] == 0 and first["journalId"]                             # قيد الفاتورة مرتبط
        # كشف بفترة: الرصيد الافتتاحي = ما قبل البداية (فاتورة 1000 قبل 75 يوماً، ولا سداد بعد)
        part = await overview.supplier_360(CO, world["a"], {"from": (TODAY - dt.timedelta(days=60)).isoformat()})
        assert part["ledger"]["opening"] == 1000.0 and part["ledger"]["closing"] == 1000.0 and len(part["ledger"]["entries"]) == 3
        assert part["ledger"]["entries"][0]["balance"] == 600.0
        pr = full["products"][0]
        assert (pr["label"], pr["qty"], pr["lastPrice"], pr["sku"]) == ("زيت", 15, 100.0, "SKU-1")
        assert len(full["payments"]) == 2 and {p["methodLabel"] for p in full["payments"]} == {"تحويل", "نقدي"} and full["payments"][0]["user"]
        assert len(full["trend"]) >= 1 and full["activity"][0]["at"] >= full["activity"][-1]["at"]
        with pytest.raises(HTTPException):
            await overview.supplier_360(CO, str(uuid.uuid4()), {})
        with pytest.raises(HTTPException):
            await overview.supplier_360(CO, "bad", {})
    run(go)


def test_payables_and_activate(world):
    from app.modules.suppliers import overview

    async def go():
        all_ = await overview.payables(CO, {})
        assert [x["invoiceNo"] for x in all_] == ["PINV-1", "PINV-2"] and all_[0]["daysLate"] == 45 and all_[0]["outstanding"] == 600.0
        assert [x["invoiceNo"] for x in await overview.payables(CO, {"overdue": True})] == ["PINV-1"]
        assert [x["invoiceNo"] for x in await overview.payables(CO, {"bucket": "current"})] == ["PINV-2"]
        await overview.activate(CO, world["c"])
        assert (await overview.overview(CO, None, {}))["kpis"]["active"] == 3
        assert await overview.categories(CO) == ["زيوت"]
    run(go)
