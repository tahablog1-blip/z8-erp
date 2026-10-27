# modules/settings/audit_diff.py — سجل مراجعة منظّم للإعدادات الحساسة: القيمة القديمة والجديدة للحقول التي تغيّرت فقط.
# الأسرار (توكنات/كلمات مرور/أرقام سرية) لا تُسجَّل قيمها أبداً — يُسجَّل فقط أنها تغيّرت.
import json

from ...core.audit import log

_SECRET_HINTS = ("token", "password", "secret", "pin", "apikey", "api_key", "logo_base64", "base64")
MASK = "[مخفي]"


def _is_secret(key: str) -> bool:
    k = key.lower()
    return any(h in k for h in _SECRET_HINTS)


def changes(before: dict | None, after: dict | None, fields: list[str] | None = None, ignore: tuple[str, ...] = ()) -> tuple[dict, dict]:
    """يُرجع (قديم، جديد) للحقول التي تغيّرت فقط. الحقول السرّية تُقنَّع."""
    before, after = before or {}, after or {}
    keys = fields or sorted(set(before) | set(after))
    old: dict = {}
    new: dict = {}
    for k in keys:
        if k in ignore:
            continue
        b, a = before.get(k), after.get(k)
        if json.dumps(b, sort_keys=True, default=str) == json.dumps(a, sort_keys=True, default=str):
            continue
        old[k], new[k] = (MASK, MASK) if _is_secret(k) else (b, a)
    return old, new


async def log_settings_change(user, entity_id: str, label: str, before: dict | None, after: dict | None,
                              fields: list[str] | None = None, ignore: tuple[str, ...] = (), extra_new: dict | None = None) -> bool:
    """يسجّل عملية تعديل إعداد في audit_log بقيم قبل/بعد. لو لم يتغيّر شيء لا يسجّل. يرجع True إذا سُجِّل."""
    old, new = changes(before, after, fields, ignore)
    if extra_new:
        new.update(extra_new)
    if not new:
        return False
    await log(
        company_id=user.company_id, user_id=user.user_id, user_email=user.email, action="edit", entity="settings",
        entity_id=entity_id, old_value=json.dumps(old, ensure_ascii=False, default=str),
        new_value=json.dumps(new, ensure_ascii=False, default=str), reason=label, branch_id=getattr(user, "branch_id", None))
    return True
