# سجل مراجعة الإعدادات: قيم قبل/بعد للحقول المتغيّرة فقط، تقنيع الأسرار، وعدم التسجيل عند عدم التغيير.
import json
import uuid

import pytest

from conftest import CO, run

pytestmark = pytest.mark.db


def U():
    from app.core.deps import CurrentUser
    return CurrentUser(user_id=str(uuid.UUID(int=5)), company_id=CO, branch_id=None, email="admin@x", full_name="مدير", role="admin", permissions=[])


def test_changes_only_changed_fields_and_masks_secrets():
    from app.modules.settings import audit_diff as A
    old, new = A.changes({"name": "أ", "vat": "300", "waToken": "SECRET-1", "perms": ["a", "b"], "same": 1},
                         {"name": "ب", "vat": "300", "waToken": "SECRET-2", "perms": ["a", "c"], "same": 1})
    assert set(new) == {"name", "waToken", "perms"} and old["name"] == "أ" and new["name"] == "ب"
    assert old["waToken"] == new["waToken"] == "[مخفي]"                      # لا تُسجَّل قيمة السر أبداً
    assert old["perms"] == ["a", "b"] and new["perms"] == ["a", "c"]
    assert A.changes({"x": 1}, {"x": 1}) == ({}, {})
    assert A.changes({"logo_base64": "AAA"}, {"logo_base64": "BBB"})[1] == {"logo_base64": "[مخفي]"}
    o, n = A.changes({"a": 1, "has_logo": False}, {"a": 2, "has_logo": True}, ignore=("has_logo",))
    assert set(n) == {"a"}


def test_log_settings_change_writes_structured_row_and_skips_noops(db_ready):
    from app.core import db
    from app.modules.settings import audit_diff as A

    async def go():
        await db.execute("TRUNCATE audit_log")
        wrote = await A.log_settings_change(U(), "company", "تحديث بيانات المنشأة", {"name": "قديم", "city": "جدة"}, {"name": "جديد", "city": "جدة"})
        skipped = await A.log_settings_change(U(), "company", "x", {"name": "ن"}, {"name": "ن"})
        pwd = await A.log_settings_change(U(), "user:1", "تعديل موظف", {"role": "employee"}, {"role": "employee"}, extra_new={"password_reset": True})
        rows = await db.fetch("SELECT entity, entity_id, action, reason, old_value, new_value, user_email FROM audit_log ORDER BY created_at")
        return wrote, skipped, pwd, rows
    wrote, skipped, pwd, rows = run(go)
    assert wrote is True and skipped is False and pwd is True
    assert len(rows) == 2
    r = rows[0]
    assert (r["entity"], r["entity_id"], r["action"], r["user_email"]) == ("settings", "company", "edit", "admin@x")
    assert json.loads(r["old_value"]) == {"name": "قديم"} and json.loads(r["new_value"]) == {"name": "جديد"}          # city لم يتغيّر فلا يظهر
    assert json.loads(rows[1]["new_value"]) == {"password_reset": True} and "SECRET" not in (rows[1]["new_value"] or "")


def test_audit_viewer_merges_both_column_sets(db_ready):
    """الكود يكتب بمجموعتين من الأعمدة (entity/new_value و scope/details) — العارض يوحّدهما"""
    from app.core import db
    from app.modules.settings import audit_diff as A, service

    async def go():
        await db.execute("TRUNCATE audit_log")
        await A.log_settings_change(U(), "company", "تحديث", {"name": "أ"}, {"name": "ب"})
        await db.execute("INSERT INTO audit_log (company_id, actor_id, actor_name, action, scope, details) VALUES ($1,'x','محاسب','report_open','reports','income-statement')", uuid.UUID(CO))
        listed = await service.list_audit_log(CO)
        ents = await service.audit_log_entities(CO)
        only_reports = await service.list_audit_log(CO, entity="reports")
        found = await service.list_audit_log(CO, q="income-statement")
        return listed, ents, only_reports, found
    listed, ents, only_reports, found = run(go)
    assert {i["entity"] for i in listed["items"]} == {"settings", "reports"}
    rep = next(i for i in listed["items"] if i["entity"] == "reports")
    assert rep["user_email"] == "محاسب" and rep["new_value"] == "income-statement"
    assert set(ents) == {"settings", "reports"} and only_reports["total"] == 1 and found["total"] == 1
