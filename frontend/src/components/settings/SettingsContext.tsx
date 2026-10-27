"use client";
// مركز الإعدادات: سياق مشترك (العناصر المتاحة + المفضلة/الأخيرة + حارس التغييرات غير المحفوظة) + شريط حفظ لاصق + بحث.
import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { appConfirm } from "@/components/dialog";
import { GROUPS, ITEMS, searchItems, type SettingsItem } from "@/lib/settings/registry";

type Prefs = { favorites: string[]; recents: { id: string; at: string }[] };
type Ctx = {
  items: SettingsItem[];                                   // ما يحق للمستخدم رؤيته فقط
  prefs: Prefs; toggleFav: (id: string) => void; noteVisit: (id: string) => void;
  setDirty: (d: boolean) => void; go: (path: string) => Promise<void>;   // تنقّل يحترم التغييرات غير المحفوظة
};
const C = createContext<Ctx | null>(null);
export const useSettings = () => { const c = useContext(C); if (!c) throw new Error("useSettings خارج مركز الإعدادات"); return c; };

export function SettingsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, hasPerm } = useAuth();
  const isAdmin = user?.role === "admin";
  const items = useMemo(() => ITEMS.filter((it) => (it.adminOnly ? isAdmin : (it.perms.length === 0 || isAdmin || hasPerm(...it.perms)))), [isAdmin, hasPerm]);
  const [prefs, setPrefs] = useState<Prefs>({ favorites: [], recents: [] });
  useEffect(() => { api<Prefs>("/settings/prefs").then(setPrefs).catch(() => undefined); }, []);
  const toggleFav = useCallback((id: string) => {
    setPrefs((p) => {
      const next = p.favorites.includes(id) ? p.favorites.filter((x) => x !== id) : [...p.favorites, id];
      api<Prefs>("/settings/prefs", { method: "PUT", body: JSON.stringify({ favorites: next }) }).then(setPrefs).catch(() => undefined);
      return { ...p, favorites: next };
    });
  }, []);
  const lastNoted = useRef("");
  const noteVisit = useCallback((id: string) => {
    if (lastNoted.current === id) return;
    lastNoted.current = id;
    api<Prefs>("/settings/prefs", { method: "PUT", body: JSON.stringify({ recent: id }) }).then(setPrefs).catch(() => undefined);
  }, []);
  // حارس التغييرات غير المحفوظة: التنقل داخل الإعدادات + إغلاق التبويب/إعادة التحميل
  const dirty = useRef(false);
  const setDirty = useCallback((d: boolean) => { dirty.current = d; }, []);
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);
  const go = useCallback(async (path: string) => {
    if (dirty.current && !(await appConfirm("لديك تغييرات غير محفوظة. هل تريد مغادرة الصفحة؟"))) return;
    dirty.current = false;
    router.push(path);
  }, [router]);
  return <C.Provider value={{ items, prefs, toggleFav, noteVisit, setDirty, go }}>{children}</C.Provider>;
}

/** شريط حفظ لاصق أسفل المحتوى: يظهر فقط عند وجود تغييرات؛ يمنع الضغط المزدوج أثناء الحفظ */
export function SaveBar({ dirty, busy, onSave, onCancel, error }: { dirty: boolean; busy: boolean; onSave: () => void; onCancel: () => void; error?: string }) {
  const { setDirty } = useSettings();
  useEffect(() => { setDirty(dirty); return () => setDirty(false); }, [dirty, setDirty]);
  if (!dirty && !error) return null;
  return (
    <div className="sticky bottom-3 z-30 mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-ink-2 px-4 py-3 shadow-lg" role="region" aria-label="حفظ التغييرات">
      <span className={`flex items-center gap-2 text-t-sm font-bold ${error ? "text-ember" : "text-text"}`}>
        <MIcon name={error ? "error" : "edit_note"} className="!text-[18px]" />
        {error || "لديك تغييرات غير محفوظة"}
      </span>
      <span className="flex items-center gap-2">
        <Button variant="ghost" onClick={onCancel} disabled={busy}>إلغاء</Button>
        <Button onClick={onSave} disabled={busy || !dirty}>{busy ? "جارٍ الحفظ…" : error ? "إعادة المحاولة" : "حفظ التغييرات"}</Button>
      </span>
    </div>
  );
}

/** بحث في الإعدادات (الاسم والوصف والقسم والكلمات المفتاحية) مع تنقل بالأسهم وEnter */
export function SettingsSearch({ autoFocus }: { autoFocus?: boolean }) {
  const { items, go } = useSettings();
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const res = useMemo(() => searchItems(items, q), [items, q]);
  useEffect(() => setI(0), [q]);
  const open = q.trim().length > 0;
  return (
    <div className="relative">
      <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 focus-within:border-petrol focus-within:ring-2 focus-within:ring-petrol/15">
        <MIcon name="search" className="!text-[18px] text-text-dim" />
        <input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث في الإعدادات" placeholder="ابحث عن إعداد: طابعة، الرقم الضريبي، كلمة المرور…"
               role="combobox" aria-expanded={open} aria-controls="settings-search-results"
               onKeyDown={(e) => {
                 if (e.key === "ArrowDown") { e.preventDefault(); setI((x) => Math.min(x + 1, res.length - 1)); }
                 else if (e.key === "ArrowUp") { e.preventDefault(); setI((x) => Math.max(x - 1, 0)); }
                 else if (e.key === "Enter" && res[i]) { setQ(""); void go(res[i].path); }
                 else if (e.key === "Escape") setQ("");
               }}
               className="h-full min-w-0 flex-1 bg-transparent text-t-md outline-none placeholder:text-text-dim/60" />
        {q && <button type="button" aria-label="مسح البحث" onClick={() => setQ("")} className="grid h-6 w-6 place-items-center rounded-md text-text-dim hover:bg-ink-3"><MIcon name="close" className="!text-[16px]" /></button>}
      </label>
      {open && (
        <ul id="settings-search-results" role="listbox" className="absolute inset-x-0 top-full z-40 mt-1 max-h-80 overflow-auto rounded-card border border-line bg-ink-2 p-1 shadow-lg">
          {res.length === 0 ? <li className="px-3 py-3 text-t-sm text-text-dim">لا توجد إعدادات مطابقة لـ «{q}».</li> : res.map((r, k) => (
            <li key={r.id} role="option" aria-selected={k === i}>
              <button type="button" onMouseEnter={() => setI(k)} onClick={() => { setQ(""); void go(r.path); }}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start ${k === i ? "bg-petrol-soft" : "hover:bg-ink-3"}`}>
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-petrol-soft text-petrol"><MIcon name={r.icon} className="!text-[18px]" /></span>
                <span className="min-w-0"><span className="block text-t-sm font-extrabold">{r.title}</span>
                  <span className="block truncate text-t-xs text-text-dim">{GROUPS.find((g) => g.id === r.group)?.title} — {r.desc}</span></span>
              </button>
            </li>))}
        </ul>)}
    </div>
  );
}
