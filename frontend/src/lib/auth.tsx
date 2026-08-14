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

type AuthCtx = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

  async function login(email: string, password: string) {
    const d = await api<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    setToken(d.token);
    setUser(d.user);
  }

  function logout() { clearToken(); setUser(null); location.href = "/login"; }

  function hasPerm(...keys: string[]) {
    if (!user) return false;
    if (user.role === "admin") return true;
    return keys.some((k) => user.permissions.includes(k));
  }

  return <Ctx.Provider value={{ user, loading, login, logout, hasPerm }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
