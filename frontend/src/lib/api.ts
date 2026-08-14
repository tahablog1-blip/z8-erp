// lib/api.ts — عميل API موحّد: توكن + تطبيع الأخطاء لرسالة عربية واحدة
const TOKEN_KEY = "z8_token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string) { localStorage.setItem(TOKEN_KEY, t); }
export function clearToken() { localStorage.removeItem(TOKEN_KEY); }

export async function api<T = unknown>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };
  const token = getToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

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
