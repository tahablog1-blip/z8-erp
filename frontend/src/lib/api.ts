// lib/api.ts — عميل API موحّد: توكن + تطبيع الأخطاء لرسالة عربية واحدة
// الجلسة الآن في كوكي HttpOnly يضبطه الخادم عند الدخول (لا يقرؤه JavaScript فلا تسرقه XSS).
// z8_token القديم في localStorage يبقى مدعوماً فقط لمن سجّل دخوله قبل هذا التحديث، ويُحذف عند أول دخول جديد.
const LEGACY_TOKEN_KEY = "z8_token";
const SESSION_HINT_KEY = "z8_session";   // علامة غير سرّية: «غالباً عندي جلسة» — لتفادي طلب /auth/me في الصفحات العامة

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(LEGACY_TOKEN_KEY);
}
export function hasSession(): boolean {
  if (typeof window === "undefined") return false;
  return !!(localStorage.getItem(SESSION_HINT_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY));
}
export function setToken(_t?: string) {   // الكوكي يضبطه الخادم؛ هنا نسجّل العلامة ونحذف التوكن القديم
  localStorage.removeItem(LEGACY_TOKEN_KEY);
  localStorage.setItem(SESSION_HINT_KEY, "1");
}
export function clearToken() { localStorage.removeItem(LEGACY_TOKEN_KEY); localStorage.removeItem(SESSION_HINT_KEY); }

/** ترويسات للطلبات اليدوية (fetch مباشر): هيدر CSRF المطلوب مع كوكي الجلسة + Bearer للجلسات القديمة فقط */
export function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const t = getToken();
  return { "X-Z8-CSRF": "1", ...(t ? { Authorization: `Bearer ${t}` } : {}), ...extra };
}

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const isForm = typeof FormData !== "undefined" && options.body instanceof FormData;
  const headers: Record<string, string> = {
    ...(isForm ? {} : { "Content-Type": "application/json" }),
    ...authHeaders(),
    ...(options.headers as Record<string, string>),
  };

  const res = await fetch(`/api${path}`, { ...options, headers });
  if (res.status === 204) return undefined as T;

  let data: any = null;
  try { data = await res.json(); } catch { /* رد بدون جسم */ }

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      clearToken();
      if (!location.pathname.startsWith("/login")) location.href = "/login";
    }
    throw new Error(data?.error || data?.detail || `خطأ غير متوقع (${res.status})`);
  }
  return data as T;
}
