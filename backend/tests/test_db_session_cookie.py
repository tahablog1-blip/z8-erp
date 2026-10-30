# جلسة المتصفح بكوكي HttpOnly: الأولوية للهيدر، حماية CSRF للكوكي في عمليات التغيير فقط، خصائص الكوكي، وإنهاء الجلسة عند الخروج.
import uuid

import pytest
from fastapi import HTTPException, Response
from starlette.requests import Request

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)


def req(method="GET", headers=None, cookie=None, scheme="http"):
    h = [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()]
    if cookie:
        h.append((b"cookie", f"z8_session={cookie}".encode()))
    return Request({"type": "http", "method": method, "headers": h, "scheme": scheme, "path": "/", "query_string": b"", "server": ("t", 80), "client": ("1.1.1.1", 1)})


@pytest.fixture
def sess(db_ready):
    from app.core import db
    from app.core.security import create_token

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("TRUNCATE users, user_sessions RESTART IDENTITY CASCADE")
            u, s = uuid.uuid4(), uuid.uuid4()
            await c.execute("INSERT INTO users (id, company_id, full_name, email, role) VALUES ($1,$2,'أحمد','a@x','employee')", u, CID)
            await c.execute("INSERT INTO user_sessions (id, user_id, company_id) VALUES ($1,$2,$3)", s, u, CID)
            return {"u": str(u), "s": str(s), "token": create_token(str(u), None, session_id=str(s))}
    return run(go)


def who(request):
    from app.core.deps import get_current_user
    return run(lambda: get_current_user(request))


def test_cookie_authenticates_safe_requests(sess):
    assert who(req(cookie=sess["token"])).user_id == sess["u"]


def test_cookie_write_requires_csrf_header(sess):
    with pytest.raises(HTTPException) as e:
        who(req("POST", cookie=sess["token"]))
    assert e.value.status_code == 403
    for m in ("POST", "PUT", "PATCH", "DELETE"):
        assert who(req(m, headers={"X-Z8-CSRF": "1"}, cookie=sess["token"])).user_id == sess["u"]
    with pytest.raises(HTTPException):                       # قيمة غير صحيحة للهيدر لا تكفي
        who(req("POST", headers={"X-Z8-CSRF": "0"}, cookie=sess["token"]))


def test_bearer_header_works_for_writes_without_csrf(sess):      # تطبيقات الموبايل والبوابات
    assert who(req("POST", headers={"Authorization": f"Bearer {sess['token']}"})).user_id == sess["u"]


def test_header_wins_over_cookie_and_empty_bearer_falls_back(sess):
    other = req("GET", headers={"Authorization": "Bearer garbage"}, cookie=sess["token"])
    with pytest.raises(HTTPException) as e:                  # الهيدر الفاسد لا يُتجاهل بصمت لصالح الكوكي
        who(other)
    assert e.value.status_code == 401
    assert who(req("GET", headers={"Authorization": "Bearer "}, cookie=sess["token"])).user_id == sess["u"]


def test_missing_or_bad_credentials_rejected(sess):
    for r in (req(), req(cookie="not-a-jwt")):
        with pytest.raises(HTTPException) as e:
            who(r)
        assert e.value.status_code == 401


def test_revoked_session_cookie_rejected(sess):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("UPDATE user_sessions SET revoked_at=now()")
    run(go)
    with pytest.raises(HTTPException) as e:
        who(req(cookie=sess["token"]))
    assert e.value.status_code == 401


def test_cookie_attributes(sess):
    from app.modules.auth.api import set_session_cookie
    r = Response()
    set_session_cookie(r, req(headers={"x-forwarded-proto": "https"}), sess["token"])
    c = r.headers["set-cookie"].lower()
    assert "httponly" in c and "secure" in c and "samesite=lax" in c and "path=/api" in c and "max-age=" in c
    r2 = Response()
    set_session_cookie(r2, req(), sess["token"])             # HTTP محلي: بلا Secure وإلا لن يُحفظ
    assert "secure" not in r2.headers["set-cookie"].lower() and "httponly" in r2.headers["set-cookie"].lower()


def test_logout_revokes_session_and_clears_cookie(sess):
    from app.core import db
    from app.modules.auth.api import logout
    r = Response()
    run(lambda: logout(req("POST", cookie=sess["token"]), r))
    assert "z8_session=" in r.headers["set-cookie"] and "max-age=0" in r.headers["set-cookie"].lower()

    async def go():
        async with db.pool().acquire() as c:
            return await c.fetchval("SELECT revoked_at IS NOT NULL FROM user_sessions")
    assert run(go) is True
