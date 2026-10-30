# core/terminal_scopes.py — نطاقات توكنات تابلت الكاشير: كل نطاق يصل لمسارات محددة فقط
# (لو سُرق تابلت أو توكنه لا يفتح بقية النظام: التقارير، الموارد البشرية، الإعدادات ...).
_COMMON = ("/api/auth/me", "/api/auth/logout", "/api/terminal/", "/api/notifications")

SCOPE_PREFIXES: dict[str, tuple[str, ...]] = {
    "pos": _COMMON + ("/api/invoices", "/api/products", "/api/customers", "/api/shifts", "/api/cars", "/api/branches",
                      "/api/price-lists", "/api/inventory/qty", "/api/inventory/levels", "/api/settings/printing", "/api/settings/company",
                      "/api/settings/system", "/api/settings/design", "/api/service-notes/unread-count", "/api/treasury/summary"),
    "service_notes": _COMMON + ("/api/service-notes", "/api/customers", "/api/cars", "/api/branches", "/api/products"),
    "cars": _COMMON + ("/api/cars", "/api/customers", "/api/branches", "/api/products", "/api/auto-checkin", "/api/settings/printing"),
    "workorder": _COMMON + ("/api/invoices", "/api/cars", "/api/customers", "/api/products", "/api/branches", "/api/price-lists"),
}


def path_allowed(scope: str, path: str) -> bool:
    prefixes = SCOPE_PREFIXES.get(scope)
    if prefixes is None:
        return False                   # نطاق غير معروف = مرفوض
    return any(path == p.rstrip("/") or path.startswith(p if p.endswith("/") else p + "/") for p in prefixes)
