"use client";
// components/Shell.tsx — هيكل التطبيق: هيدر + القضيب الجانبي البترولي (توقيع Z8 البصري)
// القرار التصميمي المتعمد: الشريط الجانبي بترولي غامق حتى في الوضع النهاري —
// زي الأنظمة الكبيرة، بيرسّي هوية المنصة وبيفصل الملاحة عن مساحة العمل بوضوح.
import { usePathname, useRouter } from "next/navigation";
import { DialogHost } from "@/components/dialog";
import { ToastHost } from "@/components/toast";
import { Tooltip, Breadcrumb } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { useEffect as useRippleEffect } from "react";

/** زارع تموّج اللمس Material — مستمع واحد يخدم كل عناصر .m3 في النظام */
function RippleSeed() {
  useRippleEffect(() => {
    function onDown(e: PointerEvent) {
      const el = (e.target as HTMLElement)?.closest?.(".m3") as HTMLElement | null;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const d = Math.max(r.width, r.height);
      const w = document.createElement("span");
      w.className = "m3-wave";
      w.style.width = w.style.height = `${d}px`;
      w.style.left = `${e.clientX - r.left - d / 2}px`;
      w.style.top = `${e.clientY - r.top - d / 2}px`;
      el.appendChild(w);
      setTimeout(() => w.remove(), 500);
    }
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);
  return null;
}
import Link from "next/link";
import { useEffect, useState } from "react";
import { CommandPalette } from "@/components/CommandPalette";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { refreshCompany } from "@/lib/company";
import { refreshPrinting } from "@/lib/printing";
import { getBackground, onBackgroundUpdate, refreshBackground, type BackgroundInfo } from "@/lib/background";
import { BackgroundLayer, panelBgStyle } from "@/components/BackgroundLayer";
import { getDesign, onDesignUpdate, refreshDesign, applyDesignVars, type DesignInfo } from "@/lib/design";
import { NAV_MODULES, NAV_SECTIONS, SECTION_ICONS } from "@/modules/registry";
import { NavIcon } from "@/components/nav-icons";
import { NAV_TITLE_KEYS, SECTION_TITLE_KEYS, useLang } from "@/lib/i18n";

type NotificationRow = {
  id: string; type: string; title: string; body: string | null; link: string | null;
  severity: "info" | "warn" | "danger"; is_read: boolean; created_at: string;
};

export function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout, hasPerm } = useAuth();
  const { lang, setLang, t } = useLang();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  function toggleTheme() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "";
    localStorage.setItem("z8_theme", next ? "dark" : "light");
  }
  const pathname = usePathname();
  const router = useRouter();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  useEffect(() => {                 // Ctrl/⌘+K يفتح البحث الشامل من أي صفحة
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPaletteOpen((o) => !o); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  // أي انتقال لصفحة جديدة يقفل الدرج تلقائياً على الموبايل
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  // ── انكماش القضيب الجانبي لأيقونات فقط (شاشات سطح المكتب) — تفضيل شخصي محفوظ،
  //    وإلا افتراضي الشركة من إعدادات التصميم (design.sidebarDefault) ──
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("z8_sidebar_collapsed");
      if (saved !== null) setCollapsed(saved === "1");
    } catch { /* */ }
  }, []);
  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try { localStorage.setItem("z8_sidebar_collapsed", next ? "1" : "0"); } catch { /* */ }
      return next;
    });
  }

  // تحديث بيانات المنشأة وإعدادات الطباعة والخلفية والتصميم الموحّد مرة عند فتح التطبيق
  useEffect(() => {
    refreshCompany(api); refreshPrinting(api); refreshBackground(api);
    (async () => {
      await refreshDesign(api);
      setDesign(getDesign());
      // لو مفيش تفضيل شخصي محفوظ للقضيب الجانبي — نطبّق افتراضي الشركة بعد وصوله
      try {
        if (localStorage.getItem("z8_sidebar_collapsed") === null) {
          setCollapsed(getDesign().sidebarDefault === "collapsed");
        }
      } catch { /* */ }
    })();
  }, []);

  // الخلفية الموحدة — شفافية لوحة المحتوى الرئيسية تتحدّث فوراً (نفس التبويب) عند الحفظ من الإعدادات
  const [bg, setBg] = useState<BackgroundInfo>(getBackground());
  useEffect(() => onBackgroundUpdate(() => setBg(getBackground())), []);

  // إعدادات التصميم الموحّدة — ألوان/خط/شكل أزرار/قائمة جانبية، تتحدّث فوراً عند الحفظ من الإعدادات
  const [design, setDesign] = useState<DesignInfo>(getDesign());
  useEffect(() => onDesignUpdate(() => setDesign(getDesign())), []);
  useEffect(() => { applyDesignVars(design, dark, lang); }, [design, dark, lang]);

  // ── الأقسام المنسدلة: مفتوحة افتراضياً + الحالة محفوظة + قسم الصفحة الحالية يفتح تلقائياً ──
  const [openSecs, setOpenSecs] = useState<Record<string, boolean>>({});
  useEffect(() => {
    let saved: Record<string, boolean> = {};
    try { saved = JSON.parse(localStorage.getItem("z8_nav_open") || "{}"); } catch { /* */ }
    const init: Record<string, boolean> = {};
    for (const sec of NAV_SECTIONS) init[sec] = saved[sec] ?? true;
    // القسم اللي فيه الصفحة الحالية يفتح دايماً
    const current = NAV_MODULES.find((m) => pathname.startsWith(m.path))?.section;
    if (current) init[current] = true;
    setOpenSecs(init);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  function toggleSec(sec: string) {
    setOpenSecs((prev) => {
      const next = { ...prev, [sec]: !prev[sec] };
      try { localStorage.setItem("z8_nav_open", JSON.stringify(next)); } catch { /* */ }
      return next;
    });
  }

  // ── عداد الرسائل غير المقروءة (رسائل العملاء) — استطلاع كل 15 ثانية ──
  //    شارة خضراء على "المحادثات" + إشعار متصفح + عداد في عنوان التبويب
  const [unread, setUnread] = useState(0);
  const canChats = hasPerm("service_notes.view", "service_notes.create", "service_notes.manage");
  useEffect(() => {
    if (!canChats) return;
    let last = -1;
    let alive = true;
    async function poll() {
      if (document.hidden) return;
      try {
        const r = await api<{ unread: number }>("/service-notes/unread-count");
        if (!alive) return;
        setUnread(r.unread);
        // إشعار متصفح عند وصول رسائل جديدة (زيادة العدد)
        if (last >= 0 && r.unread > last && typeof Notification !== "undefined") {
          if (Notification.permission === "default") await Notification.requestPermission();
          if (Notification.permission === "granted") {
            new Notification("رسالة جديدة من عميل", {
              body: `لديك ${r.unread} رسالة غير مقروءة — افتح المحادثات`,
              tag: "z8-chat",
            });
          }
        }
        last = r.unread;
      } catch { /* الخادم غير متاح مؤقتاً */ }
    }
    poll();
    const t = setInterval(poll, 15000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canChats]);
  // عداد في عنوان التبويب — يبان حتى والموظف في شاشة تانية
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread]);

  // ── مركز الإشعارات الداخلي (نقص مخزون/موافقات معلقة/فرق صندوق...) ──
  const [notifUnread, setNotifUnread] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifList, setNotifList] = useState<NotificationRow[]>([]);
  const [notifLoading, setNotifLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    async function poll() {
      if (document.hidden) return;
      try {
        const r = await api<{ unread: number }>("/notifications/unread-count");
        if (alive) setNotifUnread(r.unread);
      } catch { /* الخادم غير متاح مؤقتاً */ }
    }
    poll();
    const t = setInterval(poll, 20000);
    const onVisible = () => { if (!document.hidden) poll(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(t); document.removeEventListener("visibilitychange", onVisible); };
  }, []);
  async function openNotifications() {
    const next = !notifOpen;
    setNotifOpen(next);
    if (next) {
      setNotifLoading(true);
      try { setNotifList(await api<NotificationRow[]>("/notifications?limit=30")); }
      catch { /* */ }
      finally { setNotifLoading(false); }
    }
  }
  async function markNotifRead(n: NotificationRow) {
    if (!n.is_read) {
      try { await api(`/notifications/${n.id}/read`, { method: "POST" }); } catch { /* */ }
      setNotifList((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x));
      setNotifUnread((c) => Math.max(0, c - 1));
    }
    if (n.link) router.push(n.link);
  }
  async function markAllNotifRead() {
    try { await api("/notifications/read-all", { method: "POST" }); } catch { /* */ }
    setNotifList((prev) => prev.map((x) => ({ ...x, is_read: true })));
    setNotifUnread(0);
  }

  // الفلترة: adminOnly = لمدير النظام وحده؛ غير كده الصلاحيات هي الحكم
  const isAdmin = user?.role === "admin";
  const visible = NAV_MODULES.filter((m) => {
    if (m.adminOnly) return isAdmin;
    return m.permissions.length === 0 || hasPerm(...m.permissions);
  });

  // العنصر النشط = أطول مسار مطابق (لكي "/sales" و"/sales/history" ما يضيّوش مع بعض)
  const activePath = visible
    .map((m) => m.path)
    .filter((p) => pathname === p || pathname.startsWith(p + "/"))
    .sort((a, b) => b.length - a.length)[0];
  const activeModule = NAV_MODULES.find((m) => m.path === activePath);
  const pageTitle = activeModule ? t(NAV_TITLE_KEYS[activeModule.title] || "", activeModule.title) : "";
  const sectionTitle = activeModule && activeModule.section !== "الرئيسية"
    ? t(SECTION_TITLE_KEYS[activeModule.section] || "", activeModule.section)
    : "";

  return (
    <div className={`flex min-h-screen text-text ${bg.activeImageUrl ? "" : "bg-ink"}`}>
      <BackgroundLayer />
      <DialogHost />
      <ToastHost />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} titleOf={(m) => t(NAV_TITLE_KEYS[m.title] || "", m.title)} />
      <RippleSeed />
      {/* ── القضيب الجانبي — التوقيع البصري ── */}
      {/* خلفية معتمة خلف الدرج — الشاشات الضيقة بس، بتقفله لو ضغط عليها */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      <aside className={`fixed inset-y-0 start-0 z-50 flex z8-h-screen w-72 flex-col overflow-hidden bg-petrol-deep text-white
                        transition-[transform,width] duration-300 md:sticky md:top-0 md:shrink-0 md:!translate-x-0
                        ${collapsed ? "md:w-[72px]" : "md:w-60"}
                        ${mobileNavOpen ? "translate-x-0 shadow-panel" : "ltr:-translate-x-full rtl:translate-x-full"}`}>
        <div className={`flex items-center gap-3 px-5 py-5 ${collapsed ? "md:justify-center md:px-0" : ""}`}>
          <div className="grid h-10 w-10 shrink-0 place-items-center rounded-card bg-white/10 p-1.5">
            <img src="/logo-white.png" alt="مصدر الزيوت" className="h-full w-full object-contain" />
          </div>
          <div className={`leading-tight flex-1 ${collapsed ? "md:hidden" : ""}`}>
            <div className="text-t-md font-extrabold">مصدر الزيوت</div>
            <div className="text-t-xs text-white/60">منصة الإدارة</div>
          </div>
          {/* إغلاق الدرج — الشاشات الضيقة بس */}
          <button onClick={() => setMobileNavOpen(false)} aria-label="إغلاق القائمة"
            className="grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:bg-white/10 md:hidden">
            <MIcon name="close" />
          </button>
        </div>

        <nav className="no-scrollbar mt-2 min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden px-3 pb-3">
          {NAV_SECTIONS.map((sec) => {
            const items = visible.filter((mm) => mm.section === sec);
            if (items.length === 0) return null;
            const sectionLabel = t(SECTION_TITLE_KEYS[sec] || "", sec);
            const sectionOpen = collapsed ? true : (sec === "الرئيسية" || openSecs[sec]);
            return (
              <div key={sec}>
                {/* رأس القسم — حواف حادة، نفس لون القضيب */}
                {sec !== "الرئيسية" && !collapsed && (
                  <button onClick={() => toggleSec(sec)}
                    className={`flex h-10 w-full items-center gap-2.5 px-3 text-t-sm font-extrabold transition
                            ${openSecs[sec] ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                    <NavIcon name={SECTION_ICONS[sec] || "sec_ops"} />
                    <span className="flex-1 text-right">{sectionLabel}</span>
                    <span className={`text-t-xs opacity-60 transition-transform duration-200 ${openSecs[sec] ? "" : "-rotate-90"}`}>▼</span>
                  </button>
                )}
                {sec !== "الرئيسية" && collapsed && (
                  <div className="mx-3 my-2 h-px bg-white/10" role="separator" aria-label={sectionLabel} />
                )}
                {/* القائمة المنسدلة — مستطيل واحد بنفس عرض رأس القسم بالظبط، حواف حادة، درجة رمادي فاتح */}
                <div className={`overflow-hidden transition-all duration-200
                       ${sectionOpen ? "max-h-[1200px] opacity-100" : "max-h-0 opacity-0"}
                       ${sec !== "الرئيسية" && !collapsed ? "bg-white/[0.06]" : ""}`}>
                  {items.map((m) => {
                    const active = m.path === activePath;
                    const label = t(NAV_TITLE_KEYS[m.title] || "", m.title);
                    const linkEl = (
                      <Link href={m.path} onClick={() => setMobileNavOpen(false)}
                        className={`relative mx-2 flex h-10 items-center gap-2.5 px-3.5 text-t-md font-bold transition-all duration-200
                              ${sec !== "الرئيسية" ? "pr-6" : ""} ${collapsed ? "md:mx-auto md:w-10 md:justify-center md:px-0 md:pr-0" : ""}
                              ${active ? "m3 rounded-lg bg-nav-active font-black text-white" : "m3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"}`}>
                        <NavIcon name={m.icon} />
                        <span className={collapsed ? "flex-1 md:hidden" : "flex-1"}>{label}</span>
                        {m.path === "/service-notes" && unread > 0 && (
                          <span className={`grid h-5 min-w-5 place-items-center rounded-full bg-emerald px-1.5 text-t-xs font-black text-white ${collapsed ? "md:absolute md:-left-1 md:-top-1 md:h-4 md:min-w-4 md:text-t-xs" : ""}`}>
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </Link>
                    );
                    return (
                      <div key={m.path} className={collapsed ? "md:hidden" : undefined}>
                        {linkEl}
                      </div>
                    );
                  })}
                  {/* نسخة سطح المكتب المطوي — أيقونات فقط مع تلميح عند التحويم */}
                  {collapsed && (
                    <div className="hidden md:block">
                      {items.map((m) => {
                        const active = m.path === activePath;
                        const label = t(NAV_TITLE_KEYS[m.title] || "", m.title);
                        return (
                          <div key={m.path} className="relative">
                            <Tooltip label={label}>
                              <Link href={m.path}
                                className={`mx-auto flex h-10 w-10 items-center justify-center text-t-md font-bold transition-all duration-200
                                      ${active ? "m3 rounded-lg bg-nav-active font-black text-white" : "m3 rounded-lg text-white/70 hover:bg-white/10 hover:text-white"}`}>
                                <NavIcon name={m.icon} />
                              </Link>
                            </Tooltip>
                            {m.path === "/service-notes" && unread > 0 && (
                              <span className="pointer-events-none absolute -left-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-emerald px-1 text-t-xs font-black text-white">
                                {unread > 99 ? "99+" : unread}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </nav>

        <div className={`border-t border-white/10 px-3 py-2 ${collapsed ? "md:px-0" : ""}`}>
          <Tooltip label={collapsed ? "توسيع القائمة" : "طيّ القائمة"} side="end">
            <button onClick={toggleCollapsed}
              className={`m3 hidden h-9 items-center gap-2 rounded-lg text-t-sm font-bold text-white/60 transition hover:bg-white/10 hover:text-white md:flex ${collapsed ? "md:w-10 md:justify-center md:mx-auto" : "w-full px-3"}`}>
              <MIcon name={collapsed ? "right_panel_open" : "left_panel_close"} />
              {!collapsed && <span>طيّ القائمة</span>}
            </button>
          </Tooltip>
        </div>
        <div className={`border-t border-white/10 px-3 py-3 text-t-xs text-white/45 ${collapsed ? "hidden md:hidden" : ""}`}>
          Z8 Platform · المرحلة 5 · {process.env.NEXT_PUBLIC_BUILD}
        </div>
      </aside>

      {/* ── مساحة العمل ── */}
      <div className="flex min-w-0 flex-1 flex-col z8-h-screen p-2 sm:p-3 md:p-4">
        <div className={`flex min-h-0 flex-1 flex-col overflow-hidden rounded-card border border-line elev-1 ${panelBgStyle(bg) ? "" : "bg-ink-2"}`}
             style={panelBgStyle(bg)}>
          <header className="flex h-14 shrink-0 items-center gap-1.5 border-b border-line px-3 sm:gap-2.5 sm:px-5">
            {/* زر القائمة — الشاشات الضيقة بس (موبايل/تابلت عمودي) */}
            <button onClick={() => setMobileNavOpen(true)} aria-label="القائمة"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol md:hidden">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" className="h-[18px] w-[18px]">
                <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            {/* عنوان الصفحة + فتات الخبز */}
            <div className="min-w-0 flex-1">
              {sectionTitle && <div className="hidden sm:block"><Breadcrumb items={[{ label: sectionTitle }, { label: pageTitle }]} /></div>}
              <div className="truncate text-t-lg font-extrabold leading-6 text-text sm:text-page-title">{pageTitle}</div>
            </div>

            {/* البحث الشامل (Ctrl+K) */}
            <button onClick={() => setPaletteOpen(true)} aria-label="بحث شامل"
              className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-line px-2.5 text-text-dim transition hover:border-petrol hover:text-petrol">
              <MIcon name="search" className="!text-[19px]" />
              <kbd className="hidden text-t-xs lg:block">Ctrl K</kbd>
            </button>

            {/* مركز الإشعارات الداخلي */}
            <div className="relative">
              <Tooltip label="مركز الإشعارات" side="bottom">
                <button onClick={openNotifications} aria-label="مركز الإشعارات"
                  className="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol">
                  <MIcon name="notifications_active" className="!text-[19px]" />
                  {notifUnread > 0 && (
                    <span className="absolute -left-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ember px-1 text-t-xs font-black text-white">
                      {notifUnread > 99 ? "99+" : notifUnread}
                    </span>
                  )}
                </button>
              </Tooltip>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setNotifOpen(false)} />
                  <div role="dialog" aria-label="الإشعارات" className="fixed inset-x-2 top-16 z-50 overflow-hidden rounded-card border border-line bg-ink-2 shadow-panel sm:absolute sm:inset-x-auto sm:left-0 sm:top-11 sm:w-80">
                    <div className="flex items-center justify-between border-b border-line px-3 py-2">
                      <span className="text-t-sm font-bold">الإشعارات</span>
                      {notifUnread > 0 && (
                        <button onClick={markAllNotifRead} className="text-t-xs font-bold text-petrol hover:underline">
                          تعليم الكل كمقروء
                        </button>
                      )}
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto sm:max-h-96">
                      {notifLoading ? (
                        <div className="p-4 text-center text-t-sm text-text-dim">جارِ التحميل...</div>
                      ) : notifList.length === 0 ? (
                        <div className="p-4 text-center text-t-sm text-text-dim">لا توجد إشعارات</div>
                      ) : notifList.map((n) => (
                        <button key={n.id} onClick={() => markNotifRead(n)}
                          className={`block w-full border-b border-line/60 px-3 py-2.5 text-right transition hover:bg-ink-3 ${n.is_read ? "" : "bg-petrol-soft/40"}`}>
                          <div className="flex items-start gap-1.5">
                            <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                              n.severity === "danger" ? "bg-ember" : n.severity === "warn" ? "bg-brass" : "bg-petrol"}`} />
                            <div className="min-w-0 flex-1">
                              <div className={`text-t-sm ${n.is_read ? "text-text-dim" : "font-bold"}`}>{n.title}</div>
                              {n.body && <div className="mt-0.5 text-t-xs text-text-dim">{n.body}</div>}
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* المحادثات */}
            <Tooltip label="المحادثات" side="bottom">
              <button onClick={() => router.push("/service-notes")} aria-label="المحادثات"
                className="relative hidden h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol sm:grid">
                <MIcon name="chat" className="!text-[19px]" />
                {unread > 0 && (
                  <span className="absolute -left-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-ember px-1 text-t-xs font-black text-white">
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </button>
            </Tooltip>

            {/* ع / EN — يظهر لكل الموظفين في كل الأقسام */}
            <button onClick={() => setLang(lang === "ar" ? "en" : "ar")}
              title={lang === "ar" ? "Switch to English" : "التبديل للعربية"}
              className="grid h-9 min-w-9 shrink-0 place-items-center rounded-lg border border-line px-2 text-t-sm font-black text-text-dim transition hover:border-petrol hover:text-petrol">
              {lang === "ar" ? "EN" : "ع"}
            </button>

            {/* الوضع الليلي */}
            <button onClick={toggleTheme} title={dark ? t("top.light") : t("top.dark")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
                {dark
                  ? <><circle cx="12" cy="12" r="4.5" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>
                  : <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z" />}
              </svg>
            </button>

            <div className="mx-1 hidden h-6 w-px shrink-0 bg-line sm:block" />

            <div className="hidden text-t-sm text-text-dim sm:block">
              <span className="font-bold text-text">{user?.fullName}</span>
              <span className="mx-1.5">·</span>
              {user?.role === "admin" ? (lang === "ar" ? "مدير النظام" : "Administrator") : (lang === "ar" ? "موظف" : "Employee")}
            </div>
            <div className="hidden h-9 w-9 shrink-0 place-items-center rounded-full bg-petrol text-t-md font-black text-white sm:grid">
              {user?.fullName?.trim().charAt(0) || "؟"}
            </div>
            <button onClick={logout} aria-label={t("top.logout")} title={t("top.logout")}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-t-sm font-bold text-text-dim hover:border-ember hover:text-ember sm:w-auto sm:px-3">
              <MIcon name="logout" className="!text-[19px] sm:hidden" />
              <span className="hidden sm:inline">{t("top.logout")}</span>
            </button>
          </header>
          <main className="relative min-h-0 min-w-0 flex-1 overflow-y-auto p-3 sm:p-4 md:p-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
