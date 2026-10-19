"use client";
// lib/auth.tsx — سياق الهوية: المستخدم، الصلاحيات، الدخول/الخروج
// نفس قاعدة النظام القديم: الأدمن يملك كل الصلاحيات ضمنياً
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, setToken, clearToken, getToken } from "./api";

export type User = {
  id: string; email: string; fullName: string;
  role: "admin" | "employee";
  companyId: string; branchId: string | null;
  permissions: string[];
};

export type LoginResult =
  | { requiresTotp: true; tempToken: string }
  | { requiresTotp?: false; user: User; landingPath: string | null };

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeTotp: (tempToken: string, code: string) => Promise<{ user: User; landingPath: string | null }>;
  logout: () => void;
  hasPerm: (...keys: string[]) => boolean;
};

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // استعادة الجلسة بعد الريفريش — التوكن شايل الهوية والباقي بييجي Live من /me
    if (!getToken()) { setLoading(false); return; }
    api<{ user: User }>("/auth/me")
      .then((d) => setUser(d.user))
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string): Promise<LoginResult> {
    // ملاحظة: كانت login() القديمة بلا return صريح (بترجع undefined دايماً) —
    // وده كان بيكسر وجهة ما بعد الدخول المخصّصة لصفحة login (landingPath(u) كان
    // يستقبل undefined دايماً فيرجّع "/dashboard" بصرف النظر عن الدور الحقيقي).
    // بقى بيرجّع المستخدم + وجهة الدخول المحسوبة من السيرفر (إعداد 8) —
    // أو requiresTotp+tempToken لو الحساب مفعّل عليه مصادقة ثنائية (خطوة ثانية).
    const d = await api<{ token?: string; user?: User; landingPath?: string | null;
                          requiresTotp?: boolean; tempToken?: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    if (d.requiresTotp) return { requiresTotp: true, tempToken: d.tempToken! };
    setToken(d.token!);
    setUser(d.user!);
    return { user: d.user!, landingPath: d.landingPath ?? null };
  }

  async function completeTotp(tempToken: string, code: string) {
    const d = await api<{ token: string; user: User; landingPath: string | null }>("/auth/2fa/verify-login", {
      method: "POST",
      body: JSON.stringify({ tempToken, code }),
    });
    setToken(d.token);
    setUser(d.user);
    return { user: d.user, landingPath: d.landingPath ?? null };
  }

  function logout() { clearToken(); setUser(null); location.href = "/login"; }

  function hasPerm(...keys: string[]) {
    if (!user) return false;
    if (user.role === "admin") return true;
    return keys.some((k) => user.permissions.includes(k));
  }

  return <Ctx.Provider value={{ user, loading, login, completeTotp, logout, hasPerm }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
