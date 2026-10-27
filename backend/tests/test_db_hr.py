# الموارد البشرية: خصوصية الراتب/الهوية، نطاق الفرع، سجل الحركة، حساب الحضور بالباك-إند، لوحة التحكم، العقود، الإعدادات القابلة للضبط.
import datetime as dt
import uuid

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
FULL = {"salary": True, "identity": True, "manage": True, "payroll": True}
LIMITED = {"salary": False, "identity": False, "manage": False, "payroll": False}
ACTOR = ("11111111-1111-1111-1111-111111111111", "مدير")


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE hr_employees, hr_attendance, hr_leave_requests, hr_violations, hr_payroll_runs, hr_payslips, hr_custody_items, "
                            "hr_employee_requests, hr_contracts, hr_documents, hr_leave_types, hr_employee_history, hr_departments, hr_positions, "
                            "hr_work_schedules, companies, branches, audit_log, employee_advances, advance_repayments RESTART IDENTITY CASCADE")
            await c.execute("INSERT INTO companies (id, name) VALUES ($1,'شركة')", CID)
            b1, b2 = uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$3,'الرياض'),($2,$3,'جدة')", b1, b2, CID)
            # دوام يبدأ منتصف الليل بلا سماح وبلا عطلة أسبوعية → أي موظف بلا تسجيل اليوم يُعدّ غائباً، ومن سجّل الآن متأخراً
            s = await c.fetchval("INSERT INTO hr_work_schedules (company_id,name,start_time,end_time,grace_minutes,weekly_off) VALUES ($1,'صباحي','00:00','23:59',0,'{}') RETURNING id", CID)
            mk = lambda name, br, sched, saudi=True: c.fetchval(
                """INSERT INTO hr_employees (company_id,branch_id,full_name,national_id,iqama_number,iban,is_saudi,basic_salary,allowances,approval_pin,schedule_id,hire_date)
                   VALUES ($1,$2,$3,'1234567890','2111111111','SA0380000000608010167519',$4,5000,1000,'1234',$5,$6) RETURNING id""",
                CID, br, name, saudi, sched, dt.date.today() - dt.timedelta(days=800))
            a = await mk("أحمد", b1, s)          # فرع الرياض، حاضر متأخر
            b = await mk("بدر", b1, s)           # فرع الرياض، غائب
            cc = await mk("خالد", b2, s, False)  # فرع جدة، في إجازة
            d = await mk("داود", b2, None)       # بلا جدول دوام
            await c.execute("INSERT INTO hr_attendance (company_id,employee_id,work_date,check_in) VALUES ($1,$2,(now() AT TIME ZONE 'Asia/Riyadh')::date, now())", CID, a)
            await c.execute("INSERT INTO hr_leave_requests (company_id,employee_id,leave_type,start_date,end_date,days_count,status) VALUES ($1,$2,'annual',CURRENT_DATE-1,CURRENT_DATE+1,3,'approved')", CID, cc)
            return {k: str(v) for k, v in dict(a=a, b=b, c=cc, d=d, b1=b1, b2=b2, s=s).items()}
    return run(go)


def test_privacy_masks_salary_identity_pin(world):
    from app.modules.hr import service as S
    rows = run(lambda: S.list_employees(CO, None, None, LIMITED))
    e = next(r for r in rows if r["full_name"] == "أحمد")
    assert e["basic_salary"] is None and e["allowances"] is None and e["iban"] is None and e["commission_pct"] is None
    assert e["approval_pin"] is None
    assert e["national_id"] == "••••••7890" and e["iqama_number"].endswith("1111") and "211" not in e["iqama_number"]
    full = run(lambda: S.list_employees(CO, None, None, FULL))
    f = next(r for r in full if r["full_name"] == "أحمد")
    assert f["basic_salary"] == 5000 and f["national_id"] == "1234567890" and f["approval_pin"] == "1234"


def test_update_ignores_unauthorized_fields_and_logs_changes(world):
    from app.core import db
    from app.modules.hr import service as S
    # بلا صلاحية راتب/هوية: الراتب والهوية لا تتغيّر حتى لو أُرسلت
    run(lambda: S.update_employee(CO, world["a"], {"basicSalary": 99999, "nationalId": "0000000000", "phone": "0500000000"},
                                  None, ACTOR, LIMITED))
    # مع الصلاحية: تغيير راتب وهوية يُسجَّل
    run(lambda: S.update_employee(CO, world["a"], {"basicSalary": 6000, "nationalId": "9999999999"}, None, ACTOR, FULL, "ترقية"))

    async def chk():
        e = await db.fetchrow("SELECT basic_salary, national_id, phone FROM hr_employees WHERE id=$1::text::uuid", world["a"])
        hist = await db.fetch("SELECT event_type, detail::text AS d, reason FROM hr_employee_history WHERE employee_id=$1::text::uuid", world["a"])
        aud = await db.fetch("SELECT action, details FROM audit_log WHERE scope='hr'")
        return e, hist, aud
    e, hist, aud = run(chk)
    assert float(e["basic_salary"]) == 6000 and e["national_id"] == "9999999999" and e["phone"] == "0500000000"
    kinds = {h["event_type"] for h in hist}
    assert {"salary_change", "identity_change"} <= kinds
    sal = next(h for h in hist if h["event_type"] == "salary_change")
    assert "5000" in sal["d"] and "6000" in sal["d"] and sal["reason"] == "ترقية"
    ident = next(h for h in hist if h["event_type"] == "identity_change")
    assert "9999999999" not in ident["d"] and "1234567890" not in ident["d"]          # لا أرقام هوية في السجل
    assert all("9999999999" not in (a["details"] or "") for a in aud)


def test_branch_scope_isolation(world):
    from app.modules.hr import service as S
    rows = run(lambda: S.list_employees(CO, world["b1"], None, FULL))
    assert {r["full_name"] for r in rows} == {"أحمد", "بدر"}
    with pytest.raises(HTTPException) as ex:
        run(lambda: S.update_employee(CO, world["c"], {"phone": "1"}, world["b1"], ACTOR, FULL))
    assert ex.value.status_code == 404
    with pytest.raises(HTTPException):
        run(lambda: S.terminate_employee(CO, world["c"], None, world["b1"], ACTOR, FULL))
    with pytest.raises(HTTPException):
        run(lambda: S.check_in(CO, ACTOR[0], world["c"], world["b1"]))
    leaves = run(lambda: S.list_leave_requests(CO, None, None, world["b1"]))
    assert leaves == []          # إجازة خالد في فرع جدة


def test_attendance_calculated_from_schedule(world):
    from app.core import db
    from app.modules.hr import org, service as S

    async def setup():
        sid = (await db.fetchrow("INSERT INTO hr_work_schedules (company_id,name,start_time,end_time,grace_minutes) VALUES ($1,'ثمانية',$2,$3,10) RETURNING id",
                                 CID, dt.time(8, 0), dt.time(16, 0)))["id"]
        await db.execute("UPDATE hr_employees SET schedule_id=$1 WHERE id=$2::text::uuid", sid, world["b"])
        day = dt.date(2026, 3, 2)
        # 08:30 و17:00 بتوقيت الرياض = 05:30 و14:00 UTC
        await db.execute("INSERT INTO hr_attendance (company_id,employee_id,work_date,check_in,check_out) VALUES ($1,$2::text::uuid,$3,$4,$5)",
                         CID, world["b"], day, dt.datetime(2026, 3, 2, 5, 30, tzinfo=dt.timezone.utc), dt.datetime(2026, 3, 2, 14, 0, tzinfo=dt.timezone.utc))
    run(setup)
    rows = run(lambda: S.list_attendance(CO, "2026-03-02", "2026-03-02", world["b"]))
    r = rows[0]
    assert r["late_minutes"] == 20 and r["overtime_minutes"] == 60 and r["early_minutes"] == 0
    assert r["worked_minutes"] == 510 and r["day_status"] == "late"


def test_dashboard_counts_are_real(world):
    from app.modules.hr import overview
    d = run(lambda: overview.dashboard(CO, None, {**FULL}))
    assert d["employees"]["active"] == 4 and d["employees"]["saudi"] == 3 and d["employees"]["non_saudi"] == 1
    t = d["today"]
    assert t["present"] == 1 and t["late"] == 1          # أحمد سجّل الآن بعد بداية 00:00
    assert t["absent"] == 1                              # بدر (خالد في إجازة، وداود بلا دوام فلا يُحتسب غائباً)
    assert t["onLeave"] == 1 and t["noSchedule"] == 1
    scoped = run(lambda: overview.dashboard(CO, world["b2"], FULL))
    assert scoped["employees"]["active"] == 2 and scoped["today"]["onLeave"] == 1
    assert scoped["advances"]["available"] is True


def test_contract_renewal_expiry_and_salary_privacy(world):
    from app.modules.hr import org
    today = dt.date.today()
    c1 = run(lambda: org.create_contract(CO, {"employeeId": world["a"], "contractType": "full_time", "startDate": str(today - dt.timedelta(days=300)),
                                              "endDate": str(today + dt.timedelta(days=20)), "basicSalary": 5000}, None, ACTOR, FULL))
    assert c1["status"] == "active" and c1["days_remaining"] == 20
    c2 = run(lambda: org.create_contract(CO, {"employeeId": world["a"], "startDate": str(today), "endDate": None, "basicSalary": 5500}, None, ACTOR, FULL))
    rows = run(lambda: org.list_contracts(CO, world["a"], None, FULL))
    st = {r["id"]: r["status"] for r in rows}
    assert st[c1["id"]] == "ended" and st[c2["id"]] == "active"               # التجديد يُنهي السابق ويحفظ التاريخ
    hidden = run(lambda: org.list_contracts(CO, world["a"], None, LIMITED))
    assert all(r["basic_salary"] is None for r in hidden)
    # لا عقد ينتهي قريباً بعد التجديد (الجديد بلا نهاية)
    assert run(lambda: org.list_contracts(CO, None, None, FULL, "active", 30)) == []
    with pytest.raises(HTTPException):
        run(lambda: org.create_contract(CO, {"employeeId": world["a"], "startDate": "2026-05-01", "endDate": "2026-04-01"}, None, ACTOR, FULL))


def test_documents_and_dashboard_expiry(world):
    from app.modules.hr import org, overview
    today = dt.date.today()
    run(lambda: org.save_document(CO, {"employeeId": world["a"], "docType": "شهادة", "expiryDate": str(today + dt.timedelta(days=10))}, None, ACTOR))
    run(lambda: org.save_document(CO, {"employeeId": world["b"], "docType": "رخصة", "expiryDate": str(today - dt.timedelta(days=3))}, None, ACTOR))
    d = run(lambda: overview.dashboard(CO, None, FULL))
    assert d["documents"]["d30"] == 1 and d["documents"]["expired"] == 1
    assert len(run(lambda: org.list_documents(CO, None, None, 30))) == 2


def test_leave_balance_and_eos_are_configurable(world):
    from app.core import db
    from app.modules.hr import org, service as S
    before = run(lambda: S.leave_balance(CO, world["a"]))
    assert before["annualEntitlement"] == 21                       # الافتراضي = السلوك القديم (خدمة ~2.2 سنة)
    run(lambda: org.update_settings(CO, {"leaveDaysBefore": 25, "eosFirstYearsMonths": 1}, ACTOR))
    run(lambda: org.save_leave_type(CO, {"code": "hajj", "name": "حج", "annualDays": 10}))
    after = run(lambda: S.leave_balance(CO, world["a"]))
    assert after["annualEntitlement"] == 25
    assert any(t["code"] == "hajj" and t["remaining"] == 10 for t in after["byType"])
    lv = run(lambda: S.create_leave_request(CO, {"employeeId": world["a"], "leaveType": "hajj", "startDate": "2026-06-01", "endDate": "2026-06-03"}))
    assert lv["leave_type"] == "hajj"
    with pytest.raises(HTTPException):
        run(lambda: S.create_leave_request(CO, {"employeeId": world["a"], "leaveType": "invented", "startDate": "2026-06-01", "endDate": "2026-06-03"}))
    out = run(lambda: S.terminate_employee(CO, world["a"], None, None, ACTOR, FULL))
    eos = out["endOfServiceEstimate"]
    assert eos["amount"] == pytest.approx(eos["totalYears"] * 5000 * 1, rel=0.01)    # شهر لكل سنة بعد الضبط
    hidden = run(lambda: S.terminate_employee(CO, world["b"], None, None, ACTOR, LIMITED))
    assert hidden["endOfServiceEstimate"]["amount"] is None
    with pytest.raises(HTTPException):
        run(lambda: org.update_settings(CO, {"gosiSaudiEmployeePct": 150}, ACTOR))


def test_gosi_basis_setting_changes_payroll(world):
    from app.core import db
    from app.modules.hr import org, service as S
    r1 = run(lambda: S.run_payroll(CO, ACTOR[0], 1, 2026))
    a1 = next(p for p in r1["payslips"] if p["employee_id"] == world["a"])
    assert a1["gosi_employee"] == pytest.approx(5000 * 0.0975)                 # الافتراضي: الأساسي فقط
    run(lambda: org.update_settings(CO, {"gosiBasis": "basic_allowances"}, ACTOR))
    r2 = run(lambda: S.run_payroll(CO, ACTOR[0], 2, 2026))
    a2 = next(p for p in r2["payslips"] if p["employee_id"] == world["a"])
    assert a2["gosi_employee"] == pytest.approx(6000 * 0.0975)                 # الأساسي + البدلات


def test_hierarchy_and_allowance_components(world):
    from app.modules.hr import org, service as S
    dep = run(lambda: org.save_department(CO, {"name": "المبيعات"}))
    pos = run(lambda: org.save_position(CO, {"name": "محاسب", "departmentId": dep["id"]}))
    with pytest.raises(HTTPException):
        run(lambda: org.save_department(CO, {"name": "المبيعات"}))               # مكرر
    e = run(lambda: S.update_employee(CO, world["a"], {"departmentId": dep["id"], "positionId": pos["id"],
                                                        "housingAllowance": 1500, "transportAllowance": 500}, None, ACTOR, FULL))
    rows = run(lambda: S.list_employees(CO, None, None, FULL))
    r = next(x for x in rows if x["id"] == world["a"])
    assert r["department_name"] == "المبيعات" and r["position_name"] == "محاسب"
    assert r["allowances"] == 2000 and r["housing_allowance"] == 1500          # الإجمالي = مجموع المكوّنات
    with pytest.raises(HTTPException):
        run(lambda: S.update_employee(CO, world["a"], {"departmentId": str(uuid.uuid4())}, None, ACTOR, FULL))
    deps = run(lambda: org.list_departments(CO))
    assert deps[0]["employees"] == 1
