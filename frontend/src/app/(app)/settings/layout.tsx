"use client";
// (app)/settings/layout.tsx — مركز الإعدادات: قائمة جانبية مجمّعة (حالة نشطة، مفضلة، مجموعات) + مسار تنقّل + بحث.
// كل عنصر صفحة فعلية. الإخفاء بحسب الصلاحية للعرض فقط — الحماية الحقيقية في الـ endpoints.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { MIcon } from "@/components/m-icon";
import { SettingsProvider, SettingsSearch, useSettings } from "@/components/settings/SettingsContext";
import { GROUPS, itemFor } from "@/lib/settings/registry";

function Shell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { items, prefs, toggleFav, noteVisit, go } = useSettings();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const current = itemFor(pathname);
  const isHome = pathname === "/settings";
  useEffect(() => { setDrawerOpen(false); }, [pathname]);
  useEffect(() => { if (current) noteVisit(current.id); }, [current, noteVisit]);

  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length);
  const favs = items.filter((i) => prefs.favorites.includes(i.id));

  const NavItem = ({ id, path, title, icon, plain }: { id: string; path: string; title: string; icon: string; plain?: boolean }) => {
    const active = !plain && (pathname === path || pathname.startsWith(path + "/"));
    const fav = prefs.favorites.includes(id);
    return (
      <div className={`group flex items-center rounded-lg ${active ? "bg-petrol text-white" : "text-text-dim hover:bg-ink-3 hover:text-text"}`}>
        <button type="button" onClick={() => void go(path)} aria-current={active ? "page" : undefined}
                className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-2 text-start text-t-sm font-bold">
          <MIcon name={icon} className="!text-[18px]" /><span className="truncate">{title}</span>
        </button>
        <button type="button" aria-pressed={fav} aria-label={fav ? `إزالة ${title} من المفضلة` : `إضافة ${title} للمفضلة`} onClick={() => toggleFav(id)}
                className={`me-1 grid h-7 w-7 shrink-0 place-items-center rounded-md ${fav ? "opacity-100" : "opacity-0 focus:opacity-100 group-hover:opacity-100"} ${active ? "hover:bg-white/15" : "hover:bg-ink-4"}`}>
          <MIcon name="star" className={`!text-[16px] ${fav ? "text-brass" : ""}`} style={fav ? { fontVariationSettings: "'FILL' 1" } : undefined} />
        </button>
      </div>
    );
  };

  const Nav = () => (
    <nav className="space-y-4" aria-label="أقسام الإعدادات">
      <button type="button" onClick={() => void go("/settings")} aria-current={isHome ? "page" : undefined}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start text-t-sm font-bold ${isHome ? "bg-petrol text-white" : "text-text-dim hover:bg-ink-3 hover:text-text"}`}>
        <MIcon name="home" className="!text-[18px]" />لوحة الإعدادات
      </button>
      {favs.length > 0 && (
        <div>
          <div className="mb-1 px-2 text-t-xs font-extrabold tracking-wide text-text-dim">المفضلة</div>
          <div className="space-y-0.5">{favs.map((i) => <NavItem key={`f-${i.id}`} {...i} plain />)}</div>
        </div>)}
      {groups.map((g) => (
        <div key={g.id}>
          <div className="mb-1 flex items-center gap-1.5 px-2 text-t-xs font-extrabold tracking-wide text-text-dim"><MIcon name={g.icon} className="!text-[14px]" />{g.title}</div>
          <div className="space-y-0.5">{g.items.map((i) => <NavItem key={i.id} {...i} />)}</div>
        </div>))}
    </nav>
  );

  return (
    <div className="flex min-h-0 flex-1 gap-4 lg:items-start">
      {drawerOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setDrawerOpen(false)} />}
      <aside className={`fixed inset-y-0 right-0 z-50 w-72 overflow-y-auto border-l border-line bg-ink-2 p-4 transition-transform duration-200
                        lg:sticky lg:top-0 lg:z-0 lg:block lg:max-h-[calc(100vh-6rem)] lg:w-64 lg:shrink-0 lg:translate-x-0 lg:rounded-card lg:border lg:p-3
                        ${drawerOpen ? "translate-x-0" : "translate-x-full lg:translate-x-0"}`}>
        <div className="mb-3 flex items-center justify-between lg:hidden">
          <span className="text-t-md font-extrabold">الإعدادات</span>
          <button onClick={() => setDrawerOpen(false)} aria-label="إغلاق" className="grid h-8 w-8 place-items-center rounded-lg hover:bg-ink-3"><MIcon name="close" /></button>
        </div>
        <Nav />
      </aside>

      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => setDrawerOpen(true)} className="flex items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-2 text-t-sm font-bold text-text-dim lg:hidden">
            <MIcon name="tune" className="!text-[18px]" /> أقسام الإعدادات
          </button>
          <div className="min-w-[14rem] flex-1"><SettingsSearch /></div>
        </div>
        {!isHome && (
          <nav aria-label="مسار التنقل" className="flex items-center gap-1.5 text-t-xs font-bold text-text-dim">
            <Link href="/settings" className="hover:text-petrol">الإعدادات</Link>
            {current && <><MIcon name="chevron_left" className="!text-[14px] rtl:rotate-0" />
              <span>{GROUPS.find((g) => g.id === current.group)?.title}</span>
              <MIcon name="chevron_left" className="!text-[14px]" /><span className="text-text" aria-current="page">{current.title}</span></>}
          </nav>)}
        {children}
      </div>
    </div>
  );
}

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return <SettingsProvider><Shell>{children}</Shell></SettingsProvider>;
}
