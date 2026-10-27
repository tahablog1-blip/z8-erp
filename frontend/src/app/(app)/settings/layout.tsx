"use client";
// (app)/settings/layout.tsx — مركز الإعدادات: قائمة جانبية مُجمّعة خاصة بالإعدادات
// (منفصلة عن القضيب البترولي العام) + مساحة محتوى. كل عنصر هنا صفحة شغالة فعلياً
// بلا أي Placeholder — القسم يكبر مرحلة بمرحلة مع كل جزء جديد من مركز الإعدادات.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";

type SettingsLink = { path: string; label: string; icon: string; perms: string[]; adminOnly?: boolean };
type SettingsGroup = { title: string; items: SettingsLink[] };

const GROUPS: SettingsGroup[] = [
  {
    title: "عام",
    items: [
      { path: "/settings/company", label: "المنشأة", icon: "apartment", perms: ["settings.company"] },
      { path: "/settings/system", label: "النظام", icon: "dns", perms: [], adminOnly: true },
      { path: "/settings/background", label: "الخلفية", icon: "wallpaper", perms: ["settings.company"] },
      { path: "/settings/design", label: "التصميم", icon: "palette", perms: ["settings.company"] },
    ],
  },
  {
    title: "الإدارة",
    items: [
      { path: "/settings/users", label: "المستخدمون والصلاحيات", icon: "group", perms: ["settings.users"] },
      { path: "/settings/roles", label: "الأدوار والصلاحيات", icon: "shield_person", perms: ["settings.users"] },
      { path: "/settings/price-lists", label: "قوائم الأسعار", icon: "sell", perms: ["products.price_lists"] },
    ],
  },
  {
    title: "الأمان",
    items: [
      { path: "/settings/security", label: "الأمان وتسجيل الدخول", icon: "verified_user", perms: [] },
      { path: "/settings/audit-log", label: "سجل المراجعة", icon: "history", perms: ["audit.view"] },
    ],
  },
  {
    title: "الأجهزة",
    items: [
      { path: "/settings/cameras", label: "كاميرات المحطات", icon: "videocam", perms: ["settings.company"] },
      { path: "/settings/printing", label: "الطباعة", icon: "print", perms: [], adminOnly: true },
    ],
  },
  {
    title: "التكاملات",
    items: [
      { path: "/settings/integrations", label: "واتساب وسجل التكاملات", icon: "hub", perms: ["settings.whatsapp"] },
    ],
  },
];

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, hasPerm } = useAuth();
  const isAdmin = user?.role === "admin";
  const [drawerOpen, setDrawerOpen] = useState(false);
  useEffect(() => { setDrawerOpen(false); }, [pathname]);

  const visibleGroups = GROUPS
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => it.adminOnly ? isAdmin : (it.perms.length === 0 || isAdmin || hasPerm(...it.perms))),
    }))
    .filter((g) => g.items.length > 0);

  const NavList = () => (
    <nav className="space-y-4">
      {visibleGroups.map((g) => (
        <div key={g.title}>
          <div className="mb-1.5 px-2 text-t-xs font-extrabold tracking-wide text-text-dim">{g.title}</div>
          <div className="space-y-0.5">
            {g.items.map((it) => {
              const active = pathname === it.path || pathname.startsWith(it.path + "/");
              return (
                <button key={it.path} onClick={() => router.push(it.path)}
                        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-right text-t-sm font-bold transition
                          ${active ? "bg-petrol text-white" : "text-text-dim hover:bg-ink-3 hover:text-text"}`}>
                  <MIcon name={it.icon} className="!text-[18px]" />
                  <span className="flex-1">{it.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4 lg:items-start">
      {/* ── الدرج — الشاشات الضيقة ── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)} />
      )}
      <aside className={`fixed inset-y-0 right-0 z-50 w-64 overflow-y-auto border-l border-line bg-ink-2 p-4
                        transition-transform duration-200 lg:sticky lg:top-0 lg:z-0 lg:block lg:w-56 lg:shrink-0 lg:translate-x-0 lg:rounded-card lg:border lg:p-3
                        ${drawerOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}>
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <span className="text-t-md font-extrabold">الإعدادات</span>
          <button onClick={() => setDrawerOpen(false)} aria-label="إغلاق" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-ink-3">
            <MIcon name="close" />
          </button>
        </div>
        <NavList />
      </aside>

      <div className="min-w-0 flex-1 space-y-3">
        <button onClick={() => setDrawerOpen(true)}
                className="flex items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2 text-t-sm font-bold text-text-dim lg:hidden">
          <MIcon name="tune" className="!text-[18px]" /> أقسام الإعدادات
        </button>
        {children}
      </div>
    </div>
  );
}
