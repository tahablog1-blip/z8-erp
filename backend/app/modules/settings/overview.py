# modules/settings/overview.py — مركز الإعدادات: حالة النظام الفعلية + تنبيهات الأمان + تفضيلات المستخدم (قراءة فقط ما عدا التفضيلات)
# القاعدة: لا نعرض حالة لا نستطيع التحقق منها. كل قسم يُرجع None إذا لم تكن لدى المستخدم صلاحيته أو لم تتوفر بيانته.
# التفضيلات تُحفظ في company_settings (بلا جداول جديدة).
import datetime as dt
import json
import os
import re
import time

from ...core.db import execute, fetch, fetchrow

BACKUP_DB_DIR = os.environ.get("BACKUP_DIR", "/var/backups/z8")      # نفس مجلد tools/backup-db.sh


def _riyadh_now() -> str:
    return (dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=3)).isoformat(timespec="seconds")


async def _db_ping() -> dict:
    t = time.perf_counter()
    try:
        await fetchrow("SELECT 1")
        return {"ok": True, "latencyMs": round((time.perf_counter() - t) * 1000, 1)}
    except Exception as e:
        return {"ok": False, "error": type(e).__name__}


def _latest_db_dump() -> dict | None:
    """آخر نسخة قاعدة بيانات (pg_dump) في مجلد النسخ إن كان موجوداً ومقروءاً — وإلا None (لا نخمّن)"""
    try:
        files = [os.path.join(BACKUP_DB_DIR, f) for f in os.listdir(BACKUP_DB_DIR) if f.endswith(".dump")]
    except OSError:
        return None
    if not files:
        return {"count": 0, "latestAt": None}
    latest = max(files, key=os.path.getmtime)
    return {"count": len(files), "latestAt": dt.datetime.fromtimestamp(os.path.getmtime(latest), dt.timezone.utc).isoformat(timespec="seconds")}


def _app_backups(company_id: str) -> dict:
    from . import service
    try:
        files = [os.path.join(service._company_backup_dir(company_id), f) for f in os.listdir(service._company_backup_dir(company_id)) if f.endswith(".json.gz")]
    except OSError:
        return {"count": 0, "latestAt": None}
    if not files:
        return {"count": 0, "latestAt": None}
    return {"count": len(files), "latestAt": dt.datetime.fromtimestamp(max(os.path.getmtime(f) for f in files), dt.timezone.utc).isoformat(timespec="seconds")}


async def status(user) -> dict:
    cid = user.company_id
    can_company = user.has("settings.company")
    can_wa = user.has("settings.whatsapp")
    can_users = user.has("settings.users")
    out: dict = {"generatedAt": _riyadh_now(), "server": {"ok": True}, "database": await _db_ping()}

    # الطباعة: هل حُفظت إعدادات طباعة للشركة فعلاً؟
    pr = await fetchrow("SELECT COUNT(*)::int AS n FROM company_settings WHERE company_id=$1 AND key LIKE 'print.%'", cid)
    out["printing"] = {"configured": pr["n"] > 0}

    out["backups"] = None
    if can_company:
        out["backups"] = {"app": _app_backups(cid), "database": _latest_db_dump()}

    out["whatsapp"] = None
    out["integrations"] = None
    if can_wa:
        from ...core import wa
        if wa.gateway_enabled():
            st = await wa.gateway_status()
            out["whatsapp"] = {"enabled": True, "state": st.get("state"), "number": st.get("number")}
        else:
            out["whatsapp"] = {"enabled": False, "state": "disabled", "number": None}
        r = await fetchrow(
            """SELECT COUNT(*) FILTER (WHERE status = 'failed' AND created_at > now() - interval '24 hours')::int AS failed24,
                      COUNT(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS total24,
                      MAX(created_at) AS last_at FROM integration_log WHERE company_id=$1""", cid)
        out["integrations"] = {"failed24h": r["failed24"], "total24h": r["total24"], "lastEventAt": r["last_at"]}

    out["security"] = None
    if can_users:
        u = await fetchrow(
            """SELECT COUNT(*) FILTER (WHERE is_active)::int AS active,
                      COUNT(*) FILTER (WHERE is_active AND role='admin')::int AS admins,
                      COUNT(*) FILTER (WHERE is_active AND role='admin' AND NOT totp_enabled)::int AS admins_no2fa,
                      COUNT(*) FILTER (WHERE is_active AND totp_enabled)::int AS with2fa,
                      COUNT(*) FILTER (WHERE locked_until IS NOT NULL AND locked_until > now())::int AS locked
               FROM users WHERE company_id=$1""", cid)
        s = await fetchrow(
            """SELECT COUNT(*) FILTER (WHERE revoked_at IS NULL AND last_seen_at > now() - interval '30 days')::int AS active_sessions
               FROM user_sessions WHERE company_id=$1""", cid)
        out["security"] = {"activeUsers": u["active"], "admins": u["admins"], "adminsWithout2fa": u["admins_no2fa"], "usersWith2fa": u["with2fa"],
                           "lockedAccounts": u["locked"], "activeSessions": s["active_sessions"]}

    out["alerts"] = _alerts(out)
    return out


def _alerts(s: dict) -> list[dict]:
    """تنبيهات مبنية فقط على أرقام فعلية موجودة في الاستجابة (بلا تنبيهات وهمية)"""
    a: list[dict] = []
    sec, integ, bk = s.get("security"), s.get("integrations"), s.get("backups")
    if not s["database"]["ok"]:
        a.append({"key": "db", "severity": "danger", "title": "قاعدة البيانات لا تستجيب", "detail": "فشل فحص الاتصال بقاعدة البيانات.", "path": ""})
    if sec and sec["adminsWithout2fa"] > 0:
        a.append({"key": "admin-2fa", "severity": "warning", "title": f"{sec['adminsWithout2fa']} مدير بلا مصادقة ثنائية",
                  "detail": "تفعيل المصادقة الثنائية للمديرين يقلّل خطر اختراق الحساب.", "path": "/settings/users"})
    if sec and sec["lockedAccounts"] > 0:
        a.append({"key": "locked", "severity": "warning", "title": f"{sec['lockedAccounts']} حساب مقفل مؤقتاً",
                  "detail": "بسبب محاولات دخول فاشلة متكررة.", "path": "/settings/users"})
    if integ and integ["failed24h"] > 0:
        a.append({"key": "integrations", "severity": "danger", "title": f"{integ['failed24h']} عملية تكامل فاشلة خلال 24 ساعة",
                  "detail": "راجع سجل التكاملات لمعرفة السبب.", "path": "/settings/integrations"})
    if s.get("whatsapp") and s["whatsapp"]["enabled"] and s["whatsapp"]["state"] not in ("ready",):
        a.append({"key": "wa", "severity": "warning", "title": "واتساب غير جاهز", "detail": f"الحالة: {s['whatsapp']['state']}", "path": "/settings/integrations"})
    if bk:
        newest = [x for x in ((bk.get("app") or {}).get("latestAt"), (bk.get("database") or {}).get("latestAt") if bk.get("database") else None) if x]
        if not newest:
            a.append({"key": "backup", "severity": "warning", "title": "لا توجد نسخ احتياطية ظاهرة للنظام", "detail": "لم يُعثر على نسخة تطبيق ولا نسخة قاعدة بيانات.", "path": "/settings/system"})
        else:
            last = max(dt.datetime.fromisoformat(x) for x in newest)
            if (dt.datetime.now(dt.timezone.utc) - last).days >= 7:
                a.append({"key": "backup", "severity": "warning", "title": "آخر نسخة احتياطية قديمة", "detail": f"آخر نسخة قبل {(dt.datetime.now(dt.timezone.utc) - last).days} يوماً.", "path": "/settings/system"})
    return a


# ══════════════════ التفضيلات (المفضلة / آخر المستخدم) ══════════════════

_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def _key(user) -> str:
    return f"settings_prefs:{user.user_id}"


async def get_prefs(user) -> dict:
    row = await fetchrow("SELECT value FROM company_settings WHERE company_id=$1 AND key=$2", user.company_id, _key(user))
    try:
        d = json.loads(row["value"]) if row else {}
    except Exception:
        d = {}
    return {"favorites": [x for x in d.get("favorites", []) if isinstance(x, str) and _ID.match(x)][:12],
            "recents": [x for x in d.get("recents", []) if isinstance(x, dict) and _ID.match(str(x.get("id", "")))][:6]}


async def put_prefs(user, favorites: list[str] | None, recent: str | None) -> dict:
    cur = await get_prefs(user)
    if favorites is not None:
        cur["favorites"] = [x for x in dict.fromkeys(favorites) if _ID.match(x)][:12]
    if recent and _ID.match(recent):
        now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        cur["recents"] = ([{"id": recent, "at": now}] + [x for x in cur["recents"] if x["id"] != recent])[:6]
    await execute(
        """INSERT INTO company_settings (company_id, key, value) VALUES ($1,$2,$3)
           ON CONFLICT (company_id, key) DO UPDATE SET value=EXCLUDED.value""",
        user.company_id, _key(user), json.dumps(cur, ensure_ascii=False))
    return cur
