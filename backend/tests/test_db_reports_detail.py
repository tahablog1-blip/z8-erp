# تقارير مركز التقارير التفصيلية: تحليل المبيعات + المقارنة، المرتجعات، حركة المخزون، الموارد البشرية، وفحص التسوية.
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
NOW = dt.datetime.now(dt.timezone.utc)
UID = str(uuid.UUID(int=7))


def U(role="employee", perms=(), branch=None):
    from app.core.deps import CurrentUser
    return CurrentUser(user_id=UID, company_id=CO, branch_id=branch, email="u@x", full_name="مستخدم", role=role, permissions=list(perms))


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE invoices, invoice_items, invoice_returns, products, users, customers, cars, branches, accounts, journal_entries, journal_lines, stock_moves, "
                            "hr_employees, hr_attendance, hr_leave_requests, hr_contracts, hr_work_schedules, hr_departments, hr_payroll_runs, hr_payslips RESTART IDENTITY CASCADE")
            b1, b2, u1, p1, p2, car = (uuid.uuid4() for _ in range(6))
            await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$3,'الرياض'),($2,$3,'جدة')", b1, b2, CID)
            await c.execute("INSERT INTO users (id, company_id, full_name) VALUES ($1,$2,'كاشير أ')", u1, CID)
            await c.execute("INSERT INTO products (id, company_id, name, category, cost_price, oil_brand) VALUES ($1,$3,'زيت 5W30','زيوت',60,'موبيل'),($2,$3,'فلتر','فلاتر',20,NULL)", p1, p2, CID)
            await c.execute("INSERT INTO cars (id, company_id, brand, name) VALUES ($1,$2,'تويوتا','كامري')", car, CID)

            async def inv(no, br, ex, vat, cogs, items, returned=False, car_id=None, when=NOW):
                i = uuid.uuid4()
                await c.execute("INSERT INTO invoices (id,company_id,branch_id,invoice_no,issued_at,total_ex,total_vat,total_inc,cogs_total,is_returned,created_by,car_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
                                i, CID, br, no, when, ex, vat, ex + vat, cogs, returned, u1, car_id)
                for pid, label, q, lex in items:
                    await c.execute("INSERT INTO invoice_items (invoice_id,product_id,label,qty,line_ex,line_vat,line_inc) VALUES ($1,$2,$3,$4,$5,$6,$7)", i, pid, label, q, lex, round(lex * .15, 2), round(lex * 1.15, 2))
                return i
            i1 = await inv("I1", b1, 300, 45, 140, [(p1, "زيت", 2, 200), (p2, "فلتر", 5, 100)], car_id=car)
            await inv("I2", b2, 100, 15, 60, [(p1, "زيت", 1, 100)])
            await inv("I3", b1, 999, 150, 500, [(p1, "زيت", 9, 999)], returned=True)
            await inv("OLD", b1, 150, 22.5, 70, [(p1, "زيت", 1, 150)], when=NOW - dt.timedelta(days=40))       # فترة سابقة للمقارنة
            await c.execute("INSERT INTO invoice_returns (company_id,branch_id,invoice_id,return_no,total_ex,total_vat,total_inc,note) VALUES ($1,$2,$3,'RET-1',50,7.5,57.5,'عيب')", CID, b1, i1)
            # دفتر الأستاذ: إيراد 400 (فرق 50 = مرتجع جزئي مسجّل) — نتعمّد فرق التكلفة
            rev, vat, cg = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO accounts (id,company_id,code,name,type) VALUES ($1,$4,'4010','مبيعات','revenue'),($2,$4,'2010','ضريبة','liability'),($3,$4,'5010','تكلفة','expense')", rev, vat, cg, CID)
            je = uuid.uuid4()
            await c.execute("INSERT INTO journal_entries (id,company_id,entry_date) VALUES ($1,$2,(now() AT TIME ZONE 'Asia/Riyadh')::date)", je, CID)
            await c.execute("INSERT INTO journal_lines (entry_id,account_id,debit,credit) VALUES ($1,$2,0,350),($1,$3,0,52.5),($1,$4,200,0)", je, rev, vat, cg)    # الإيراد 350 = 400-50 ✓، الضريبة 52.5 ✓، التكلفة 200 ✓
            # حركة المخزون
            await c.execute("INSERT INTO stock_moves (company_id,move_type,from_loc_id,to_loc_id,product_id,product_label,qty,move_no,unit_cost) VALUES ($1,'receive',NULL,$2,$3,'زيت',100,'RCV-1',60),($1,'adjust',NULL,$2,$3,'زيت',5,'STI-1',NULL),($1,'adjust',$2,NULL,$3,'زيت',2,'STO-1',NULL),($1,'transfer',$2,$4,$3,'زيت',10,'TRF-1',NULL)", CID, str(b1), p1, str(b2))
            # موارد بشرية
            sch = await c.fetchval("INSERT INTO hr_work_schedules (company_id,name,start_time,end_time,grace_minutes,weekly_off) VALUES ($1,'ص','00:00','23:59',0,'{}') RETURNING id", CID)
            dep = await c.fetchval("INSERT INTO hr_departments (company_id,name) VALUES ($1,'المبيعات') RETURNING id", CID)
            e1 = await c.fetchval("INSERT INTO hr_employees (company_id,branch_id,full_name,is_saudi,schedule_id,department_id) VALUES ($1,$2,'أحمد',true,$3,$4) RETURNING id", CID, b1, sch, dep)
            await c.execute("INSERT INTO hr_employees (company_id,branch_id,full_name,is_saudi) VALUES ($1,$2,'سارة',false)", CID, b2)
            await c.execute("INSERT INTO hr_attendance (company_id,employee_id,work_date,check_in,check_out) VALUES ($1,$2,(now() AT TIME ZONE 'Asia/Riyadh')::date, now(), now() + interval '1 hour')", CID, e1)
            await c.execute("INSERT INTO hr_leave_requests (company_id,employee_id,leave_type,start_date,end_date,days_count,status) VALUES ($1,$2,'annual',CURRENT_DATE,CURRENT_DATE+2,3,'approved')", CID, e1)
            return {"b1": str(b1), "b2": str(b2)}
    return run(go)


def test_sales_breakdown_dims_profit_privacy_and_compare(world):
    from app.modules.reports import detail
    adm = U(role="admin")
    r = run(lambda: detail.sales_breakdown(adm, None, None, None, "product", "prev"))
    by = {x["label"]: x for x in r["rows"]}
    assert by["زيت 5W30"]["revenue"] == 300 and by["زيت 5W30"]["qty"] == 3 and by["فلتر"]["revenue"] == 100       # المرتجعة بالكامل (999) مستثناة
    assert by["زيت 5W30"]["cogs"] == 180 and by["زيت 5W30"]["grossProfit"] == 120 and by["زيت 5W30"]["marginPct"] == 40.0
    assert r["totals"]["revenue"] == 400 and r["totals"]["returnsEx"] == 50 and r["totals"]["netRevenue"] == 350
    assert r["compare"]["mode"] == "prev"
    sales_only = run(lambda: detail.sales_breakdown(U(perms=["reports.sales"]), None, None, None, "category", None))
    assert "cogs" not in sales_only["rows"][0] and sales_only["canCost"] is False                     # الربح لمن يملك الصلاحية المالية فقط
    assert {x["label"] for x in run(lambda: detail.sales_breakdown(adm, None, None, None, "car_brand", None))["rows"]} == {"تويوتا", "بدون سيارة"}
    assert {x["label"] for x in run(lambda: detail.sales_breakdown(adm, None, None, None, "employee", None))["rows"]} == {"كاشير أ"}
    assert {x["label"] for x in run(lambda: detail.sales_breakdown(adm, None, None, None, "brand", None))["rows"]} == {"موبيل", "غير محدد"}
    only_b2 = run(lambda: detail.sales_breakdown(U(perms=["reports.sales"], branch=world["b2"]), None, None, world["b1"], "branch", None))
    assert [x["label"] for x in only_b2["rows"]] == ["جدة"]                                            # فرعه فقط
    with pytest.raises(HTTPException):
        run(lambda: detail.sales_breakdown(adm, None, None, None, "bogus", None))


def test_compare_has_no_trend_without_baseline(world):
    from app.modules.reports import detail
    d = detail.delta(100, 0)
    assert d["pct"] is None                                       # لا نسبة بلا أساس مقارنة
    assert detail.delta(150, 100)["pct"] == 50.0 and detail.delta(50, 100)["pct"] == -50.0
    f, t = dt.date(2026, 3, 10), dt.date(2026, 3, 16)
    assert detail.compare_range(f, t, "prev") == (dt.date(2026, 3, 3), dt.date(2026, 3, 9))
    assert detail.compare_range(f, t, "yoy") == (dt.date(2025, 3, 10), dt.date(2025, 3, 16))
    assert detail.compare_range(f, t, None) is None


def test_returns_report(world):
    from app.modules.reports import detail
    r = run(lambda: detail.returns_report(U(role="admin"), None, None, None))
    assert r["totals"]["partialCount"] == 1 and r["totals"]["partialInc"] == 57.5 and r["totals"]["fullCount"] == 1 and r["totals"]["fullInc"] == 1149.0


def test_stock_movements_report(world):
    from app.modules.reports import detail
    r = run(lambda: detail.stock_movements_report(U(role="admin"), None, None, None))
    t = {x["type"]: x for x in r["byType"]}
    assert t["receive"]["qty"] == 100 and t["receive"]["value"] == 6000 and t["adjust"]["adjustIn"] == 5 and t["adjust"]["adjustOut"] == 2
    assert r["totals"]["count"] == 4 and r["topProducts"][0]["qty"] == 117
    nocost = run(lambda: detail.stock_movements_report(U(perms=["products.view_stock"]), None, None, None))
    assert all(x["value"] is None for x in nocost["byType"])      # القيمة لصاحب الصلاحية المالية فقط


def test_hr_report(world):
    from app.modules.reports import detail
    r = run(lambda: detail.hr_report(U(perms=["hr.view"]), None, None, None))
    assert r["headcount"]["total"] == 2 and r["headcount"]["saudi"] == 1 and r["headcount"]["nonSaudi"] == 1
    assert {x["name"] for x in r["headcount"]["byBranch"]} == {"الرياض", "جدة"}
    assert r["attendance"]["daysPresent"] == 1 and r["attendance"]["lateDays"] == 1 and r["leave"][0]["days"] == 3
    assert r["payroll"] is None                                   # الرواتب لمن يملك صلاحيتها
    scoped = run(lambda: detail.hr_report(U(perms=["hr.view"], branch=world["b2"]), None, None, None))
    assert scoped["headcount"]["total"] == 1


def test_reconciliation_shows_matches_and_never_hides_differences(world):
    from app.modules.reports import detail
    r = run(lambda: detail.reconciliation(U(role="admin"), None, None, None))
    c = {x["key"]: x for x in r["checks"]}
    assert c["revenue"]["invoices"] == 350 and c["revenue"]["ledger"] == 350 and c["revenue"]["ok"]
    assert c["vat"]["ok"]
    assert c["cogs"]["invoices"] == 200 and c["cogs"]["ledger"] == 200 and c["cogs"]["ok"] and r["status"] == "ok" and r["warning"] is None
    # فرق متعمَّد: قيد يدوي إضافي على الإيرادات
    from app.core import db

    async def tweak():
        rev = await db.fetchrow("SELECT id FROM accounts WHERE code='4010'")
        je = await db.fetchrow("SELECT id FROM journal_entries LIMIT 1")
        await db.execute("INSERT INTO journal_lines (entry_id,account_id,debit,credit) VALUES ($1,$2,0,80)", je["id"], rev["id"])
    run(tweak)
    r2 = run(lambda: detail.reconciliation(U(role="admin"), None, None, None))
    assert r2["status"] == "mismatch" and "الإيرادات" in r2["warning"] and {x["key"]: x for x in r2["checks"]}["revenue"]["diff"] == -80
