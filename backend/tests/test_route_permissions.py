# حراسة الصلاحيات على كل مسارات الـ API (بلا قاعدة بيانات): يفحص شجرة التبعيات لكل مسار.
# أي مسار جديد بلا حماية، أو أي عملية كتابة «لأي مستخدم مسجّل»، يفشل هنا فيُجبر المطوّر على قرار صريح (يضيفه للقوائم أدناه مع السبب).
import pytest
from fastapi.routing import APIRoute

from app.core.permissions import PERMISSIONS

# مسارات عامة عمداً (بلا تسجيل دخول): الدخول، الحجز العام للعملاء، روابط الحالة/المحادثة بالرمز، صور الشعارات، الفحص الصحي، ومزوّد الدفع (موقّع)
PUBLIC_PREFIXES = ("/api/cars/public/", "/api/service-notes/public/", "/api/products/public/")
PUBLIC_EXACT = {
    ("POST", "/api/auth/login"), ("POST", "/api/auth/2fa/verify-login"),
    ("POST", "/api/auth/logout"),                              # يمسح الكوكي ويعمل حتى بجلسة منتهية
    ("GET", "/api/health"), ("GET", "/api/modules"),
    ("POST", "/api/payments/webhook"),                         # موقّع بـ PAYMENTS_WEBHOOK_SECRET داخل الخدمة (501 قبل الضبط)
    ("GET", "/api/shortage-overrides"), ("POST", "/api/shortage-overrides"),   # مفتاح X-API-Key اختياري
    ("GET", "/api/service-notes/attachments/file/{fname}"),   # اسم uuid غير قابل للتخمين + منع الخروج من المجلد
    ("GET", "/api/settings/company/logo/{company_id}"), ("GET", "/api/settings/backgrounds/{company_id}/{bg_id}/image"),
    ("GET", "/api/cameras/public-live/{camera_id}.jpg"),       # ⚠ بث بلا تسجيل دخول — موثّق كمخاطرة معروفة
}
# كتابة مسموحة لأي مستخدم مسجّل لأنها تخص المستخدم نفسه أو إعداد واجهة خفيف
AUTH_ONLY_WRITES_OK = {
    ("DELETE", "/api/auth/sessions/{session_id}"), ("POST", "/api/auth/2fa/setup"), ("POST", "/api/auth/2fa/confirm"), ("POST", "/api/auth/2fa/disable"),
    ("POST", "/api/notifications/read-all"), ("POST", "/api/notifications/{notification_id}/read"),
    ("PUT", "/api/reports/prefs"), ("POST", "/api/reports/open/{report_id}"), ("PUT", "/api/settings/prefs"),
    ("PUT", "/api/settings/printing/quick-toggle"),            # قرار منتج: الكاشير يبدّل الطباعة التلقائية
    ("POST", "/api/shortage-sync/orders"),                     # تطبيق ماسح النواقص (توكن موظف)
    ("POST", "/api/auto-checkin/manual"), ("POST", "/api/auto-checkin/confirm/{scan_id}"),   # عمل البوابة اليومي — مراجعة لاحقة
}
# مسارات كانت مفتوحة لأي مستخدم وخطرة — لازم تبقى محمية (انحدار)
MUST_BE_GATED = [
    ("POST", "/api/auto-checkin/import-images"), ("POST", "/api/auto-checkin/import-images-csv"),
    ("POST", "/api/auto-checkin/sync-products-v2"), ("POST", "/api/auto-checkin/sync-products-v3"),
    ("POST", "/api/auto-checkin/backfill-plate-keys"), ("POST", "/api/auto-checkin/clear-unknown"),
    ("POST", "/api/auto-checkin/watcher-toggle"), ("POST", "/api/auto-checkin/camera-toggle"), ("POST", "/api/auto-checkin/vision-model"),
    ("POST", "/api/cameras/health-check"),
]


def _calls(dep, out):
    for d in dep.dependencies:
        out.append(d.call)
        _calls(d, out)
    return out


def _keys(fn):
    for c in fn.__closure__ or ():
        v = c.cell_contents
        if isinstance(v, tuple) and v and all(isinstance(x, str) for x in v):
            return list(v)
    return []


@pytest.fixture(scope="module")
def routes():
    from app.main import LOADED_MODULES, app
    out = []

    def add(prefix, r, base):
        calls = _calls(r.dependant, []) + base
        names = [getattr(c, "__qualname__", "") for c in calls]
        perm = [c for c, n in zip(calls, names) if n.startswith(("require_permission", "require_role"))]
        kind = "gated" if perm else ("auth" if "get_current_user" in names else ("other" if names else "none"))
        keys = [k for c, n in zip(calls, names) if n.startswith("require_permission") for k in _keys(c)]
        for m in sorted(r.methods - {"HEAD", "OPTIONS"}):
            out.append({"m": m, "p": prefix + r.path, "kind": kind, "keys": keys})
    for mod in LOADED_MODULES:
        for r in mod.router.routes:
            if isinstance(r, APIRoute):
                add(mod.prefix, r, [d.dependency for d in mod.router.dependencies])
    for r in app.routes:
        if isinstance(r, APIRoute):
            add("", r, [])
    assert len(out) > 300, "لم تُحمَّل الموديولات"
    return out


def test_no_unprotected_route_outside_explicit_public_list(routes):
    bad = [(r["m"], r["p"]) for r in routes if r["kind"] == "none"
           and (r["m"], r["p"]) not in PUBLIC_EXACT and not r["p"].startswith(PUBLIC_PREFIXES)]
    assert not bad, f"مسارات بلا أي حماية ولم تُسجَّل كعامة عمداً: {bad}"


def test_write_routes_need_permission_unless_self_service(routes):
    bad = [(r["m"], r["p"]) for r in routes if r["kind"] == "auth" and r["m"] != "GET" and (r["m"], r["p"]) not in AUTH_ONLY_WRITES_OK]
    assert not bad, f"عمليات كتابة لأي مستخدم مسجّل بلا صلاحية: {bad}"


def test_previously_open_dangerous_routes_are_gated(routes):
    idx = {(r["m"], r["p"]): r for r in routes}
    for k in MUST_BE_GATED:
        assert k in idx, f"المسار اختفى أو غيّر اسمه: {k}"
        assert idx[k]["kind"] == "gated", f"مسار خطر أصبح مفتوحاً: {k}"


def test_all_permission_keys_exist_in_catalog(routes):
    catalog = {i["key"] for g in PERMISSIONS for i in g["items"]}
    used = {k for r in routes for k in r["keys"]}
    assert not (used - catalog), f"مفاتيح صلاحيات غير موجودة في الكتالوج (خطأ إملائي يعني قفل أو فتح بالغلط): {sorted(used - catalog)}"


def test_public_routes_are_get_or_known_post(routes):
    posts = sorted(r["p"] for r in routes if r["kind"] == "none" and r["m"] != "GET" and r["p"].startswith(PUBLIC_PREFIXES))
    allowed = {"/api/cars/public/book/{branch_id}", "/api/cars/public/booking/{branch_id}", "/api/cars/public/booking/{branch_id}/otp/send",
               "/api/cars/public/booking/{branch_id}/otp/verify", "/api/cars/public/booking/{branch_id}/lookup",
               "/api/cars/public/booking-invoices/{branch_id}", "/api/cars/public/booking-selection/{car_id}", "/api/service-notes/public/{token}/messages", "/api/service-notes/public/{token}/voice"}
    assert set(posts) <= allowed, f"عمليات كتابة عامة جديدة تحتاج مراجعة أمنية: {sorted(set(posts) - allowed)}"
