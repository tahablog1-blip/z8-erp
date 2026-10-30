# تابلت الكاشير: رموز الدخول (9 أرقام)، بطاقات الكاشيرين، رمز كل كاشير، توكنات مقيَّدة، وجلسة تتبع الجهاز لا المستخدم.
import json
import uuid
from decimal import Decimal

import jwt
import pytest
from fastapi import HTTPException

from conftest import CO, run
from test_db_sales_treasury import CID, D, inv_body, item, q, stock, w   # noqa: F401  (w = عالم المبيعات: فرع + صنف + مخزون)

pytestmark = pytest.mark.db
CASH_PERMS = ["invoices.create_direct", "shifts.manage_own"]


@pytest.fixture
def t(w):
    """فرع الرئيسي + كاشيران (أحمد برمز 1234، سارة برمز 5678) + كاشير في فرع آخر + موظف خدمة؛ ويُضاف DDL التابلت"""
    from app.core import db
    from app.core.security import hash_password
    from app.modules.terminal import service
    from app.modules.terminal.schema import TERMINAL_ENSURE_SQL

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("DROP TABLE IF EXISTS pos_access_codes, pos_devices CASCADE")
            for stmt in TERMINAL_ENSURE_SQL:
                await c.execute(stmt)
            await c.execute("TRUNCATE users, user_sessions, shifts, invoices, invoice_items, invoice_payments, journal_entries, journal_lines, customer_ledger, document_counters, invoice_counters RESTART IDENTITY CASCADE")
            await c.execute("UPDATE inventory SET qty=10")
            other_br, a, s, x, gone, notes_emp = (uuid.uuid4() for _ in range(6))
            await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$2,'فرع آخر')", other_br, CID)
            br = uuid.UUID(w["br"])
            for uid, name, branch, perms, active, pin in [
                (a, "أحمد", br, CASH_PERMS, True, "1234"), (s, "سارة", br, CASH_PERMS, True, "5678"),
                (x, "كاشير فرع آخر", other_br, CASH_PERMS, True, "1111"), (gone, "موقوف", br, CASH_PERMS, False, "2222"),
                (notes_emp, "موظف ملاحظات", br, ["service_notes.create"], True, "3333"),
            ]:
                await c.execute("INSERT INTO users (id, company_id, full_name, email, branch_id, permissions, is_active, pos_pin_hash) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)",
                                uid, CID, name, f"{uuid.uuid4().hex[:6]}@x", branch, perms, active, hash_password(pin))
            await c.execute("UPDATE users SET pos_pin_hash=NULL WHERE id=$1", s)      # سارة بلا رمز بعد
            return {"a": str(a), "s": str(s), "x": str(x), "n": str(notes_emp), "other_br": str(other_br)}
    ids = run(go)
    service._FAILS.clear()
    return {**w, **ids}


def svc():
    from app.modules.terminal import service
    return service


def set_code(t, kind="cashier", acts=None, branch=None):
    return run(lambda: svc().admin_set_code(CO, branch or t["br"], kind, acts))["code"]


def enter(code, key="dev-key-0001", name="تابلت 1"):
    return run(lambda: svc().enter(code, key, name, "1.1.1.1"))


# ══════════════════ الرموز ══════════════════

def test_generated_codes_are_nine_digits_and_not_trivial(t):
    for _ in range(300):
        c = svc().generate_code()
        assert len(c) == 9 and c.isdigit() and len(set(c)) >= 4 and c != c[::-1]


def test_code_is_stored_hashed_and_rotation_invalidates_old(t):
    code = set_code(t)
    assert code not in json.dumps([dict(r) for r in q("SELECT * FROM pos_access_codes")], default=str)    # لا نص صريح
    assert enter(code)["kind"] == "cashier"
    new = set_code(t)
    assert new != code
    with pytest.raises(HTTPException) as e:
        enter(code)
    assert e.value.status_code == 401
    assert enter(new)["branch"]["name"] == "الرئيسي"


def test_wrong_codes_are_throttled(t):
    set_code(t)
    for i in range(8):
        with pytest.raises(HTTPException) as e:
            enter(f"99999999{i}", key="brute-key-01")
        assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e:                                  # المحاولة التاسعة تُحجب حتى بالرمز الصحيح
        enter(set_code(t, branch=t["other_br"]), key="brute-key-01")
    assert e.value.status_code == 429


def test_bad_format_rejected(t):
    for bad in ("12345678", "abcdefghi", "", "1234567890"):
        with pytest.raises(HTTPException) as e:
            enter(bad)
        assert e.value.status_code == 400


# ══════════════════ بطاقات الكاشيرين ══════════════════

def test_cashier_cards_only_active_cashiers_of_that_branch(t):
    r = enter(set_code(t))
    names = {c["fullName"]: c["hasPin"] for c in r["cashiers"]}
    assert names == {"أحمد": True, "سارة": False}                            # لا موقوف ولا فرع آخر ولا موظف ملاحظات
    assert r["deviceToken"] and "token" not in r


def test_cards_refresh_with_device_token_and_follow_new_cashiers(t):
    r = enter(set_code(t))
    again = run(lambda: svc().cashiers_for_device(r["deviceToken"]))
    assert len(again["cashiers"]) == 2 and again["branch"]["name"] == "الرئيسي"


# ══════════════════ رمز الكاشير ══════════════════

def login(t, uid, pin, device_token):
    return run(lambda: svc().cashier_login(device_token, uid, pin, "1.1.1.1"))


def test_cashier_login_issues_scoped_device_token(t):
    r = enter(set_code(t))
    out = login(t, t["a"], "1234", r["deviceToken"])
    claims = jwt.decode(out["token"], options={"verify_signature": False})
    assert claims["userId"] == t["a"] and claims["scope"] == "pos" and claims["dev"] == r["deviceId"] and claims["sid"]
    assert out["user"]["fullName"] == "أحمد"
    assert q("SELECT pos_device_id::text AS d FROM user_sessions")[0]["d"] == r["deviceId"]


def test_wrong_pin_locks_after_five_and_pin_reset_unlocks(t):
    r = enter(set_code(t))
    for _ in range(4):
        with pytest.raises(HTTPException) as e:
            login(t, t["a"], "0000", r["deviceToken"])
        assert e.value.status_code == 401
    with pytest.raises(HTTPException) as e:
        login(t, t["a"], "0000", r["deviceToken"])                           # الخامسة تقفل
    assert e.value.status_code == 401
    svc()._FAILS.clear()
    with pytest.raises(HTTPException) as e:
        login(t, t["a"], "1234", r["deviceToken"])                           # حتى الرمز الصحيح مرفوض أثناء القفل
    assert e.value.status_code == 429
    run(lambda: svc().admin_set_pin(CO, t["a"], "4321"))                     # المدير يعيد ضبط الرمز فيفتح القفل
    assert login(t, t["a"], "4321", r["deviceToken"])["token"]


def test_login_rejects_other_branch_inactive_and_no_pin(t):
    r = enter(set_code(t))
    with pytest.raises(HTTPException) as e:
        login(t, t["x"], "1111", r["deviceToken"])
    assert e.value.status_code == 404
    with pytest.raises(HTTPException) as e:
        login(t, t["s"], "5678", r["deviceToken"])                           # سارة بلا رمز
    assert e.value.status_code == 403
    with pytest.raises(HTTPException) as e:
        login(t, t["n"], "3333", r["deviceToken"])                           # ليس كاشيراً
    assert e.value.status_code == 404


def test_pin_format_and_forged_device_token(t):
    with pytest.raises(HTTPException) as e:
        run(lambda: svc().admin_set_pin(CO, t["a"], "12"))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        login(t, t["a"], "1234", "not-a-token")
    assert e.value.status_code == 401
    forged = jwt.encode({"purpose": "terminal-device", "dev": str(uuid.uuid4()), "co": CO, "br": t["br"]}, "wrong-secret", algorithm="HS256")
    with pytest.raises(HTTPException):
        login(t, t["a"], "1234", forged)


def test_revoked_device_is_cut_immediately(t):
    r = enter(set_code(t))
    out = login(t, t["a"], "1234", r["deviceToken"])
    run(lambda: svc().admin_revoke_device(CO, r["deviceId"], True))
    with pytest.raises(HTTPException) as e:
        login(t, t["a"], "1234", r["deviceToken"])
    assert e.value.status_code == 403
    with pytest.raises(HTTPException):
        enter(set_code(t), key="dev-key-0001")                               # ولا يعود بإدخال الرمز
    assert q("SELECT revoked_at IS NOT NULL AS r FROM user_sessions")[0]["r"] is True      # وجلساته أُنهيت
    assert out["token"]


# ══════════════════ أقسام بلا كاشير ══════════════════

def test_section_codes_need_bound_user_and_get_scoped_token(t):
    with pytest.raises(HTTPException) as e:                                  # بلا مستخدم
        run(lambda: svc().admin_set_code(CO, t["br"], "service_notes", None))
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:                                  # مستخدم بلا صلاحية القسم
        run(lambda: svc().admin_set_code(CO, t["br"], "cars", t["n"]))
    assert e.value.status_code == 422
    code = set_code(t, "service_notes", t["n"])
    r = enter(code)
    claims = jwt.decode(r["token"], options={"verify_signature": False})
    assert r["kind"] == "service_notes" and claims["scope"] == "service_notes" and claims["userId"] == t["n"] and "cashiers" not in r


# ══════════════════ نطاق التوكن ══════════════════

def test_scope_paths():
    from app.core.terminal_scopes import path_allowed
    assert path_allowed("pos", "/api/invoices") and path_allowed("pos", "/api/invoices/abc/pdf") and path_allowed("pos", "/api/shifts/current")
    assert not path_allowed("pos", "/api/hr/employees") and not path_allowed("pos", "/api/settings/users") and not path_allowed("pos", "/api/accounting/entries")
    assert not path_allowed("pos", "/api/invoices-evil") and not path_allowed("bogus", "/api/auth/me")
    assert path_allowed("service_notes", "/api/service-notes/templates/list") and not path_allowed("service_notes", "/api/invoices")


def test_scoped_token_blocked_outside_scope(t):
    from starlette.requests import Request
    from app.core.deps import get_current_user
    r = enter(set_code(t))
    tok = login(t, t["a"], "1234", r["deviceToken"])["token"]

    def req(path):
        return Request({"type": "http", "method": "GET", "headers": [(b"authorization", f"Bearer {tok}".encode())], "scheme": "http",
                        "path": path, "query_string": b"", "server": ("t", 80), "client": ("1.1.1.1", 1)})
    assert run(lambda: get_current_user(req("/api/shifts/current"))).device_id == r["deviceId"]
    with pytest.raises(HTTPException) as e:
        run(lambda: get_current_user(req("/api/hr/employees")))
    assert e.value.status_code == 403


# ══════════════════ الجلسة تتبع الجهاز ══════════════════

def test_shift_belongs_to_device_and_any_cashier_continues_it(t):
    from app.modules.invoices import service as inv
    from app.modules.shifts import service as shifts
    r = enter(set_code(t)); dev = r["deviceId"]
    run(lambda: svc().admin_set_pin(CO, t["s"], "5678"))
    # أحمد يفتح الجلسة على الجهاز
    sh = run(lambda: shifts.open_shift(CO, t["a"], t["br"], 100, dev))
    with pytest.raises(HTTPException) as e:                                   # جلسة ثانية على نفس الجهاز مرفوضة
        run(lambda: shifts.open_shift(CO, t["s"], t["br"], 50, dev))
    assert e.value.status_code == 409
    # سارة (كاشير آخر على نفس الجهاز) ترى الجلسة نفسها
    cur = run(lambda: shifts.get_current(CO, t["s"], dev))
    assert cur["shift"]["id"] == sh["id"]
    # وتبيع عليها: الفاتورة باسمها وفي جلسة الجهاز
    body = inv_body(t, [item(t["oil"], 1)], [{"method": "cash", "amount": 115}]); body["deviceId"] = dev
    i = run(lambda: inv.create_invoice(CO, t["s"], "s@x", body))
    row = q("SELECT created_by::text AS c, shift_id::text AS s FROM invoices")[0]
    assert row["c"] == t["s"] and row["s"] == sh["id"] and i["shift_id"] == sh["id"]
    # جهاز آخر لا يرى هذه الجلسة ولا يبيع عليها
    assert run(lambda: shifts.get_current(CO, t["s"], str(uuid.uuid4()))) is None
    body2 = dict(body); body2["deviceId"] = str(uuid.uuid4())
    with pytest.raises(HTTPException) as e:
        run(lambda: inv.create_invoice(CO, t["s"], "s@x", body2))
    assert e.value.status_code == 409
    # أي كاشير على الجهاز يغلقها؛ كاشير من جهاز آخر لا يستطيع
    with pytest.raises(HTTPException) as e:
        run(lambda: shifts.close_shift(CO, sh["id"], 215, None, caller_id=t["s"], can_close_any=False, device_id=str(uuid.uuid4())))
    assert e.value.status_code == 403
    closed = run(lambda: shifts.close_shift(CO, sh["id"], 215, None, caller_id=t["s"], can_close_any=False, device_id=dev))
    assert closed["cash"]["difference"] == 0 and closed["sales"]["totalInc"] == 115
    assert run(lambda: shifts.get_current(CO, t["a"], dev)) is None


def test_web_sessions_without_device_still_per_user(t):
    from app.modules.shifts import service as shifts
    run(lambda: shifts.open_shift(CO, t["a"], t["br"], 10, None))
    assert run(lambda: shifts.get_current(CO, t["a"], None)) is not None
    assert run(lambda: shifts.get_current(CO, t["s"], None)) is None          # سلوك الويب القديم بلا تغيير


# ══════════════════ الإدارة ══════════════════

def test_admin_overview_and_devices(t):
    set_code(t, "cashier"); set_code(t, "service_notes", t["n"])
    ov = run(lambda: svc().admin_overview(CO))
    main = next(b for b in ov["branches"] if b["branchName"] == "الرئيسي")
    got = {c["kind"]: c["hasCode"] for c in main["codes"]}
    assert got == {"cashier": True, "service_notes": True, "cars": False, "workorder": False}
    assert all("code" not in c and "codeHash" not in c for c in main["codes"])      # الرمز لا يُرجَع أبداً
    assert {c["fullName"]: c["hasPin"] for c in main["cashiers"]} == {"أحمد": True, "سارة": False}      # بطاقات الفرع مع حالة الرمز
    assert [u["fullName"] for u in main["candidates"]["service_notes"]] == ["موظف ملاحظات"]            # من يصلح لقسم الملاحظات فقط
    enter(set_code(t))
    devs = run(lambda: svc().admin_devices(CO))
    assert devs[0]["name"] == "تابلت 1" and devs[0]["revoked"] is False
