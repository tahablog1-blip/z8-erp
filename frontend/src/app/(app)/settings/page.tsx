"use client";
// (app)/settings/page.tsx — داشبورد الإعدادات الحقيقي: حالة حية من القاعدة + روابط سريعة + Progress
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type SetupStatus = { key: string; label: string; ok: boolean };
type DashboardData = {
  companyName: string; branchesCount: number; usersCount: number;
  usersActive: number; rolesCount: number; setup: SetupStatus[];
};

function StatCard({ icon, label, value, tone = "default" }:
  { icon: string; label: string; value: string; tone?: "default" | "good" | "warn" }) {
  const toneCls = tone === "good" ? "text-emerald" : tone === "warn" ? "text-ember" : "text-text";
  return (
    <Card className="!p-4">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-petrol-soft text-petrol">
          <MIcon name={icon} className="!text-[20px]" />
        </span>
        <div className="min-w-0">
          <div className="text-[11px] font-bold text-text-dim">{label}</div>
          <div className={`text-[17px] font-extrabold ${toneCls}`}>{value}</div>
        </div>
      </div>
    </Card>
  );
}

export default function SettingsDashboard() {
  const router = useRouter();
  const { user, hasPerm } = useAuth();
  const isAdmin = user?.role === "admin";
  const [data, setData] = useState<DashboardData | null>(null);
  const [health, setHealth] = useState<boolean | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<DashboardData>("/settings/dashboard").then(setData).catch((e) => setErr(e.message));
    api("/health").then(() => setHealth(true)).catch(() => setHealth(false));
  }, []);

  const quickLinks = [
    { path: "/settings/company", label: "بيانات المنشأة", icon: "apartment", perm: "settings.company" },
    { path: "/branches", label: "الفروع", icon: "store", perm: "branches.manage" },
    { path: "/settings/users", label: "المستخدمون", icon: "group", perm: "settings.users" },
    { path: "/settings/roles", label: "الأدوار والصلاحيات", icon: "shield_person", perm: "settings.users" },
    { path: "/settings/printing", label: "الطباعة", icon: "print", perm: "" },
    { path: "/settings/cameras", label: "كاميرات المحطات", icon: "videocam", perm: "settings.company" },
    { path: "/settings/security", label: "الأمان", icon: "verified_user", perm: "" },
    { path: "/settings/audit-log", label: "سجل المراجعة", icon: "history", perm: "audit.view" },
  ].filter((l) => !l.perm || isAdmin || hasPerm(l.perm));

  const doneCount = data?.setup.filter((s) => s.ok).length || 0;
  const totalCount = data?.setup.length || 0;
  const pct = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[19px] font-extrabold">الإعدادات</h1>
        <p className="mt-0.5 text-[12.5px] text-text-dim">
          إدارة إعدادات منصة Z8 ERP والفروع والمستخدمين والصلاحيات والأجهزة المتصلة.
        </p>
      </div>

      {err && <Card className="border-ember/30 bg-ember-bg text-[12.5px] font-bold text-ember">{err}</Card>}

      {/* ── بطاقات الحالة ── */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard icon="dns" label="حالة الخادم"
                  value={health === null ? "جارِ الفحص…" : health ? "متصل" : "غير متصل"}
                  tone={health === null ? "default" : health ? "good" : "warn"} />
        <StatCard icon="store" label="الفروع" value={data ? String(data.branchesCount) : "—"} />
        <StatCard icon="group" label="المستخدمون"
                  value={data ? `${data.usersActive} / ${data.usersCount}` : "—"} />
        <StatCard icon="shield_person" label="الأدوار" value={data ? String(data.rolesCount) : "—"} />
        <StatCard icon="person" label="المستخدم الحالي" value={user?.fullName || "—"} />
      </div>

      {/* ── الإعدادات السريعة ── */}
      <div>
        <h2 className="mb-2 text-[13.5px] font-extrabold">الإعدادات السريعة</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
          {quickLinks.map((l) => (
            <button key={l.path} onClick={() => router.push(l.path)}
                    className="flex flex-col items-center gap-1.5 rounded-xl border border-line bg-ink-2 p-3.5 text-center transition hover:border-petrol">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-petrol-soft text-petrol">
                <MIcon name={l.icon} className="!text-[18px]" />
              </span>
              <span className="text-[11.5px] font-bold text-text">{l.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── حالة إعداد المنصة ── */}
      {data && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[13.5px] font-extrabold">حالة إعداد المنصة</h2>
            <span className="text-[12px] font-bold text-text-dim">{doneCount} / {totalCount} مكتمل</span>
          </div>
          <div className="mb-3 h-2 w-full overflow-hidden rounded-full bg-ink-3">
            <div className="h-full rounded-full bg-emerald transition-all" style={{ width: `${pct}%` }} />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {data.setup.map((s) => (
              <div key={s.key} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                <span className={`text-[14px] ${s.ok ? "text-emerald" : "text-ember"}`}>{s.ok ? "✓" : "⚠"}</span>
                <span className="text-[12.5px] font-bold">{s.label}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
