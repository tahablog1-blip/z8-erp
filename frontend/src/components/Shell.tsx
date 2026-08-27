"use client";
// components/Shell.tsx — هيكل التطبيق: هيدر + القضيب الجانبي البترولي (توقيع Z8 البصري)
// القرار التصميمي المتعمد: الشريط الجانبي بترولي غامق حتى في الوضع النهاري —
// زي الأنظمة الكبيرة، بيرسّي هوية المنصة وبيفصل الملاحة عن مساحة العمل بوضوح.
import { usePathname, useRouter } from "next/navigation";
import { DialogHost } from "@/components/dialog";
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
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { refreshCompany } from "@/lib/company";
import { NAV_MODULES, NAV_SECTIONS, SECTION_ICONS } from "@/modules/registry";
import { NavIcon } from "@/components/nav-icons";
import { NAV_TITLE_KEYS, SECTION_TITLE_KEYS, useLang } from "@/lib/i18n";

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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // أي انتقال لصفحة جديدة يقفل الدرج تلقائياً على الموبايل
  useEffect(() => { setMobileNavOpen(false); }, [pathname]);

  // تحديث بيانات المنشأة (لترويسات الطباعة) مرة عند فتح التطبيق
  useEffect(() => { refreshCompany(api); }, []);

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

  // ── 💬 عداد الرسائل غير المقروءة (رسائل العملاء) — استطلاع كل 15 ثانية ──
  //    شارة خضراء على "المحادثات" + إشعار متصفح + عداد في عنوان التبويب
  const [unread, setUnread] = useState(0);
  const canChats = hasPerm("service_notes.view", "service_notes.create", "service_notes.manage");
  useEffect(() => {
    if (!canChats) return;
    let last = -1;
    let alive = true;
    async function poll() {
      try {
        const r = await api<{ unread: number }>("/service-notes/unread-count");
        if (!alive) return;
        setUnread(r.unread);
        // إشعار متصفح عند وصول رسائل جديدة (زيادة العدد)
        if (last >= 0 && r.unread > last && typeof Notification !== "undefined") {
          if (Notification.permission === "default") await Notification.requestPermission();
          if (Notification.permission === "granted") {
            new Notification("💬 رسالة جديدة من عميل", {
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
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canChats]);
  // عداد في عنوان التبويب — يبان حتى والموظف في شاشة تانية
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\) /, "");
    document.title = unread > 0 ? `(${unread}) ${base}` : base;
  }, [unread]);

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

  return (
    <div className="flex min-h-screen bg-ink text-text">
      <DialogHost />
      <RippleSeed />
      {/* ── القضيب الجانبي — التوقيع البصري ── */}
      {/* خلفية معتمة خلف الدرج — الشاشات الضيقة بس، بتقفله لو ضغط عليها */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMobileNavOpen(false)} />
      )}
      <aside className={`fixed inset-y-0 right-0 z-50 flex w-72 shrink-0 flex-col bg-petrol-deep text-white
                transition-transform duration-300 md:static md:z-auto md:w-60 md:translate-x-0
                ${mobileNavOpen ? "translate-x-0" : "translate-x-full"}`}>
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/10 p-1.5">
            <img src="/logo-white.png" alt="مصدر الزيوت" className="h-full w-full object-contain" />
          </div>
          <div className="leading-tight flex-1">
            <div className="text-[13.5px] font-extrabold">مصدر الزيوت</div>
            <div className="text-[10.5px] text-white/60">منصة الإدارة</div>
          </div>
          {/* إغلاق الدرج — الشاشات الضيقة بس */}
          <button onClick={() => setMobileNavOpen(false)}
                  className="grid h-8 w-8 place-items-center rounded-lg text-white/70 hover:bg-white/10 md:hidden">
            ✕
          </button>
        </div>

        <nav className="mt-2 flex-1 space-y-2 overflow-y-auto px-3 pb-3">
          {NAV_SECTIONS.map((sec) => {
            const items = visible.filter((mm) => mm.section === sec);
            if (items.length === 0) return null;
            return (
              <div key={sec}>
                {/* رأس القسم — حواف حادة، نفس لون القضيب */}
                {sec !== "الرئيسية" && (
                  <button onClick={() => toggleSec(sec)}
                          className={`flex h-10 w-full items-center gap-2.5 px-3 text-[12.5px] font-extrabold transition
                            ${openSecs[sec] ? "bg-white/10 text-white" : "text-white/60 hover:bg-white/5 hover:text-white"}`}>
                    <NavIcon name={SECTION_ICONS[sec] || "sec_ops"} />
                    <span className="flex-1 text-right">{t(SECTION_TITLE_KEYS[sec] || "", sec)}</span>
                    <span className={`text-[9px] opacity-60 transition-transform duration-200 ${openSecs[sec] ? "" : "-rotate-90"}`}>▼</span>
                  </button>
                )}
                {/* القائمة المنسدلة — مستطيل واحد بنفس عرض رأس القسم بالظبط، حواف حادة، درجة رمادي فاتح */}
                <div className={`overflow-hidden transition-all duration-200
                       ${sec === "الرئيسية" || openSecs[sec] ? "max-h-96 opacity-100" : "max-h-0 opacity-0"}
                       ${sec !== "الرئيسية" ? "bg-white/[0.06]" : ""}`}>
                  {items.map((m) => {
                    const active = m.path === activePath;
                    return (
                      <Link key={m.path} href={m.path} onClick={() => setMobileNavOpen(false)}
                            className={`mx-2 flex h-10 items-center gap-2.5 px-3.5 text-[13px] font-bold transition-all duration-200
                              ${sec !== "الرئيسية" ? "pr-6" : ""}
                              ${active ? "m3 rounded-full bg-white/[0.22] font-black text-white" : "m3 rounded-full text-white/70 hover:text-white"}`}>
                        <NavIcon name={m.icon} />
                        <span className="flex-1">{t(NAV_TITLE_KEYS[m.title] || "", m.title)}</span>
                        {m.path === "/service-notes" && unread > 0 && (
                          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-emerald px-1.5 text-[10.5px] font-black text-white">
                            {unread > 99 ? "99+" : unread}
                          </span>
                        )}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-3 py-3 text-[10.5px] text-white/45">
          Z8 Platform · المرحلة 5
        </div>
      </aside>

      {/* ── مساحة العمل ── */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2.5 border-b border-line bg-ink-2 px-5 shadow-card">
          {/* زر القائمة — الشاشات الضيقة بس (موبايل/تابلت عمودي) */}
          <button onClick={() => setMobileNavOpen(true)} aria-label="القائمة"
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol md:hidden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                 strokeLinecap="round" className="h-[18px] w-[18px]">
              <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          <div className="flex-1" />

          {/* ع / EN — يظهر لكل الموظفين في كل الأقسام */}
          <button onClick={() => setLang(lang === "ar" ? "en" : "ar")}
                  title={lang === "ar" ? "Switch to English" : "التبديل للعربية"}
                  className="grid h-9 min-w-9 place-items-center rounded-lg border border-line px-2 text-[12px] font-black text-text-dim transition hover:border-petrol hover:text-petrol">
            {lang === "ar" ? "EN" : "ع"}
          </button>

          {/* الوضع الليلي */}
          <button onClick={toggleTheme} title={dark ? t("top.light") : t("top.dark")}
                  className="grid h-9 w-9 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                 strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
              {dark
                ? <><circle cx="12" cy="12" r="4.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>
                : <path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11z"/>}
            </svg>
          </button>

          <div className="mx-1 h-6 w-px bg-line" />

          <div className="text-[12.5px] text-text-dim">
            <span className="font-bold text-text">{user?.fullName}</span>
            <span className="mx-1.5">·</span>
            {user?.role === "admin" ? (lang === "ar" ? "مدير النظام" : "Administrator") : (lang === "ar" ? "موظف" : "Employee")}
          </div>
          <div className="grid h-9 w-9 place-items-center rounded-full bg-petrol text-[13px] font-black text-white">
            {user?.fullName?.trim().charAt(0) || "؟"}
          </div>
          <button onClick={logout}
            className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-bold text-text-dim hover:border-ember hover:text-ember">
            {t("top.logout")}
          </button>
        </header>
        <main className="min-w-0 flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
