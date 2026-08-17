"use client";
// الإعدادات ← النظام — صفحة كاملة
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui";

export default function SystemSettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<boolean | null>(null);

  useEffect(() => {
    api("/health").then(() => setHealth(true)).catch(() => setHealth(false));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — النظام</h1>
      <Card>
        <div className="max-w-xl space-y-2 text-[12.5px]">
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">حالة الخادم</span>
            <b className={health ? "text-emerald" : "text-ember"}>{health === null ? "..." : health ? "متصل ✓" : "غير متصل ✗"}</b>
          </div>
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">المستخدم الحالي</span><b>{user?.fullName} ({user?.email})</b>
          </div>
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">الدور</span><b>{user?.role === "admin" ? "مدير النظام" : "موظف"}</b>
          </div>
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">المنصة</span><b>Z8 Platform — FastAPI + Next.js + PostgreSQL</b>
          </div>
        </div>
      </Card>
    </div>
  );
}
