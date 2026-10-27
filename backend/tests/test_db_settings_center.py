# مركز الإعدادات: حالة النظام الفعلية، حجب الأقسام بالصلاحيات، تنبيهات الأمان المبنية على أرقام حقيقية، التفضيلات، وإعداد المنصة.
import uuid

import pytest

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def U(role="employee", perms=(), uid=None):
    from app.core.deps import CurrentUser
    return CurrentUser(user_id=uid or str(uuid.UUID(int=9)), company_id=CO, branch_id=None, email="u@x", full_name="مستخدم", role=role, permissions=list(perms))


@pytest.fixture
def world(db_ready):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE users, user_sessions, integration_log, roles, company_settings, branches, companies RESTART IDENTITY CASCADE")
            await c.execute("INSERT INTO companies (id,name,vat_number,cr_number) VALUES ($1,'شركة','300000000000003','1010')", CID)
            await c.execute("INSERT INTO users (company_id,full_name,role,totp_enabled) VALUES ($1,'مدير أ','admin',false),($1,'مدير ب','admin',true),($1,'موظف','employee',false)", CID)
            await c.execute("INSERT INTO users (company_id,full_name,role,locked_until) VALUES ($1,'مقفل','employee', now() + interval '10 minutes')", CID)
            uid = await c.fetchval("SELECT id FROM users LIMIT 1")
            await c.execute("INSERT INTO user_sessions (user_id,company_id) VALUES ($1,$2),($1,$2)", uid, CID)
            await c.execute("INSERT INTO user_sessions (user_id,company_id,revoked_at) VALUES ($1,$2,now())", uid, CID)
            await c.execute("INSERT INTO integration_log (company_id,provider,event,status) VALUES ($1,'whatsapp','send','failed'),($1,'whatsapp','send','ok'),($1,'email','send','failed')", CID)
            await c.execute("INSERT INTO branches (company_id,name) VALUES ($1,'الرياض')", CID)
    run(go)
    return True


def test_status_is_real_and_sections_are_permission_gated(world):
    from app.modules.settings import overview
    r = run(lambda: overview.status(U()))
    assert r["database"]["ok"] and r["database"]["latencyMs"] >= 0 and r["server"]["ok"]
    assert r["security"] is None and r["integrations"] is None and r["backups"] is None and r["whatsapp"] is None      # بلا صلاحيات: لا شيء
    assert r["alerts"] == []                                                                                          # لا تنبيهات لما لا يراه
    full = run(lambda: overview.status(U(role="admin")))
    s = full["security"]
    assert s["activeUsers"] == 4 and s["admins"] == 2 and s["adminsWithout2fa"] == 1 and s["usersWith2fa"] == 1 and s["lockedAccounts"] == 1 and s["activeSessions"] == 2
    assert full["integrations"]["failed24h"] == 2 and full["integrations"]["total24h"] == 3
    keys = {a["key"] for a in full["alerts"]}
    assert {"admin-2fa", "locked", "integrations"} <= keys
    assert next(a for a in full["alerts"] if a["key"] == "admin-2fa")["title"].startswith("1 مدير")
    only_users = run(lambda: overview.status(U(perms=["settings.users"])))
    assert only_users["security"] is not None and only_users["integrations"] is None and {a["key"] for a in only_users["alerts"]} == {"admin-2fa", "locked"}


def test_prefs_validation_and_isolation(world):
    from app.modules.settings import overview
    u = U()
    p = run(lambda: overview.put_prefs(u, ["company", "bad id!", "company", "users"], "printing"))
    assert p["favorites"] == ["company", "users"] and p["recents"][0]["id"] == "printing"
    p = run(lambda: overview.put_prefs(u, None, "company"))
    p = run(lambda: overview.put_prefs(u, None, "printing"))
    assert [x["id"] for x in p["recents"]] == ["printing", "company"] and p["favorites"] == ["company", "users"]
    other = U(uid=str(uuid.UUID(int=10)))
    assert run(lambda: overview.get_prefs(other)) == {"favorites": [], "recents": []}
    big = run(lambda: overview.put_prefs(u, [f"s{i}" for i in range(40)], None))
    assert len(big["favorites"]) == 12


def test_setup_checklist_is_real_not_hardcoded(world):
    from app.core import db
    from app.modules.settings import service
    d = run(lambda: service.dashboard_status(CO))
    by = {x["key"]: x for x in d["setup"]}
    assert by["company"]["ok"] and by["branches"]["ok"] and by["users"]["ok"] and not by["roles"]["ok"]       # لا أدوار
    assert not by["printing"]["ok"] and by["printing"]["path"] == "/settings/printing"                          # لم تُحفظ إعدادات طباعة
    run(lambda: db.execute("INSERT INTO company_settings (company_id,key,value) VALUES ($1,'print.copies','1')", CID))
    run(lambda: db.execute("INSERT INTO roles (company_id,name) VALUES ($1,'مبيعات')", CID))
    d2 = run(lambda: service.dashboard_status(CO))
    by2 = {x["key"]: x for x in d2["setup"]}
    assert by2["printing"]["ok"] and by2["roles"]["ok"]
    run(lambda: db.execute("UPDATE companies SET vat_number=NULL WHERE id=$1", CID))
    assert not {x["key"]: x for x in run(lambda: service.dashboard_status(CO))["setup"]}["company"]["ok"]       # الرقم الضريبي ناقص
