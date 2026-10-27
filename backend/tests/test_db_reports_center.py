# مركز التقارير: الفهرس حسب الصلاحية، التفضيلات والتدقيق، وتقارير طرق الدفع/المشتريات/الخزينة/الفواتير الضريبية على قاعدة اختبار حقيقية.
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
UID = str(uuid.UUID(int=7))
TODAY = dt.datetime.now(dt.timezone.utc)


def U(role="employee", perms=(), branch=None):
    from app.core.deps import CurrentUser
    return CurrentUser(user_id=UID, company_id=CO, branch_id=branch, email="u@x", full_name="مستخدم", role=role, permissions=list(perms))


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE invoices, invoice_payments, invoice_items, treasury_vouchers, purchase_invoices, suppliers, company_settings, audit_log, branches RESTART IDENTITY CASCADE")
            b1, b2, sup = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$3,'الرياض'),($2,$3,'جدة')", b1, b2, CID)
            await c.execute("INSERT INTO suppliers (id, company_id, name) VALUES ($1,$2,'مورد أ')", sup, CID)

            async def inv(no, br, total, pays, credit=0, returned=False, qr="QR"):
                i = uuid.uuid4()
                await c.execute("INSERT INTO invoices (id,company_id,branch_id,invoice_no,issued_at,total_inc,total_ex,paid_total,credit_total,is_returned,qr_tlv,zatca_status) VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,'pending')",
                                i, CID, br, no, TODAY, total, sum(a for _, a in pays), credit, returned, qr)
                for m, a in pays:
                    await c.execute("INSERT INTO invoice_payments (invoice_id,company_id,method,amount) VALUES ($1,$2,$3,$4)", i, CID, m, a)
            await inv("I1", b1, 300, [("cash", 200), ("card", 100)])
            await inv("I2", b1, 500, [("card", 300)], credit=200)
            await inv("I3", b2, 100, [("transfer", 100)], qr=None)
            await inv("I4", b2, 999, [("cash", 999)], returned=True)       # مرتجعة: تُستثنى
            await c.execute("INSERT INTO treasury_vouchers (company_id,branch_id,voucher_no,type,amount,method,category,status) VALUES ($1,$2,'R1','receipt',1000,'cash','إيرادات','active'),($1,$2,'P1','payment',400,'cash','إيجار','active'),($1,$3,'P2','payment',50,'card','إيجار','cancelled')", CID, b1, b2)
            await c.execute("INSERT INTO purchase_invoices (company_id,supplier_id,invoice_no,invoice_date,subtotal,vat_total,total,paid_total,status) VALUES ($1,$2,'P-1',CURRENT_DATE,1000,150,1150,500,'partially_paid'),($1,$2,'P-2',CURRENT_DATE,100,15,115,0,'cancelled')", CID, sup)
            return {"b1": str(b1), "b2": str(b2)}
    return run(go)


def test_catalog_is_permission_filtered():
    from app.modules.reports import center
    ids = lambda u: {r["id"] for r in center.catalog_for(u)["reports"]}
    assert "executive" in ids(U())                                   # التنفيذي متاح للجميع (أقسامه تُحجب داخله)
    sales_only = ids(U(perms=["reports.sales"]))
    assert "payment-methods" in sales_only and "income-statement" not in sales_only and "hr-payroll" not in sales_only
    fin = ids(U(perms=["accounting.view_reports"]))
    assert {"income-statement", "profitability", "treasury-report"} <= fin and "hr-payroll" not in fin
    assert ids(U(role="admin")) == {r["id"] for r in center.CATALOG}
    cats = {c["id"] for c in center.catalog_for(U(perms=["reports.sales"]))["categories"]}
    assert "hr" not in cats and "sales" in cats


def test_prefs_favorites_recents_and_audit(world):
    from app.core import db
    from app.modules.reports import center
    u = U(perms=["accounting.view_reports"])
    p = run(lambda: center.put_prefs(u, ["income-statement", "hr-payroll", "income-statement"], [{"reportId": "profitability", "name": "ربحية الشهر", "filters": {"period": "month"}}, {"reportId": "hr-payroll", "name": "x", "filters": {}}]))
    assert p["favorites"] == ["income-statement"]                    # غير المسموح يُسقَط والمكرر يُدمج
    assert [s["reportId"] for s in p["saved"]] == ["profitability"]
    run(lambda: center.record_open(u, "income-statement"))            # حساس → تدقيق
    run(lambda: center.record_open(u, "chart-of-accounts"))           # غير حساس → بلا تدقيق
    with pytest.raises(HTTPException) as ex:
        run(lambda: center.record_open(u, "hr-payroll"))
    assert ex.value.status_code == 404
    got = run(lambda: center.get_prefs(u))
    assert [r["id"] for r in got["recents"]] == ["chart-of-accounts", "income-statement"]
    aud = run(lambda: db.fetch("SELECT action, details FROM audit_log WHERE scope='reports'"))
    assert [(a["action"], a["details"]) for a in aud] == [("report_open", "income-statement")]
    # تفضيلات مستخدم آخر معزولة
    other = U(perms=["accounting.view_reports"]); other.user_id = str(uuid.UUID(int=8))
    assert run(lambda: center.get_prefs(other))["favorites"] == []


def test_payment_methods_totals_shares_and_branch_lock(world):
    from app.modules.reports import center
    r = run(lambda: center.payment_methods(U(perms=["reports.sales"]), None, None, None))
    by = {x["method"]: x for x in r["rows"]}
    assert by["cash"]["amount"] == 200 and by["card"]["amount"] == 400 and by["transfer"]["amount"] == 100 and by["credit"]["amount"] == 200
    assert r["totals"]["amount"] == 900                              # المرتجعة (999) مستثناة
    assert abs(sum(x["sharePct"] for x in r["rows"]) - 100) < 0.2
    locked = run(lambda: center.payment_methods(U(perms=["reports.sales"], branch=world["b2"]), None, None, world["b1"]))
    assert locked["meta"]["branchId"] == world["b2"] and locked["totals"]["amount"] == 100   # طلب فرع آخر يُتجاهل
    assert run(lambda: center.payment_methods(U(role="admin"), "2000-01-01", "2000-01-31", None))["rows"] == []


def test_date_validation():
    from app.modules.reports import center
    with pytest.raises(HTTPException):
        center.parse_range("2026-02-01", "2026-01-01")
    with pytest.raises(HTTPException):
        center.parse_range("بلا", None)
    with pytest.raises(HTTPException):
        center.parse_range("2000-01-01", "2026-01-01")


def test_purchases_report_excludes_cancelled_and_blocks_branch_users(world):
    from app.modules.reports import center
    r = run(lambda: center.purchases_report(U(role="admin"), None, None, None))
    assert r["totals"]["total"] == 1150 and r["totals"]["paid"] == 500 and r["totals"]["remaining"] == 650
    assert r["bySupplier"][0]["name"] == "مورد أ" and len(r["byMonth"]) == 1
    with pytest.raises(HTTPException) as ex:
        run(lambda: center.purchases_report(U(perms=["purchasing.invoices"], branch=world["b1"]), None, None, None))
    assert ex.value.status_code == 403


def test_treasury_report_nets_and_skips_cancelled(world):
    from app.modules.reports import center
    r = run(lambda: center.treasury_report(U(role="admin"), None, None, None))
    assert r["totals"] == {"receipts": 1000.0, "payments": 400.0, "net": 600.0, "count": 2}
    assert {b["branch"]: b["net"] for b in r["byBranch"]} == {"الرياض": 600.0}
    only_b2 = run(lambda: center.treasury_report(U(perms=["treasury.view"], branch=world["b2"]), None, None, None))
    assert only_b2["totals"]["count"] == 0                           # سند فرع جدة ملغى


def test_zatca_status_counts_without_claiming_compliance(world):
    from app.modules.reports import center
    r = run(lambda: center.zatca_status(U(role="admin"), None, None, None))
    assert r["totals"]["invoices"] == 4 and r["totals"]["withoutQr"] == 1 and r["missingQr"][0]["invoiceNo"] == "I3"
    assert "امتثالاً" in r["note"]
