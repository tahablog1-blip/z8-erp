"use client";
// CommandPalette — بحث شامل وتنقل سريع (Ctrl/⌘+K): صفحات النظام حسب الصلاحيات + فواتير + أصناف + عملاء.
// البحث الديناميكي يشتغل فقط لو المستخدم يملك صلاحية العرض، وبعد 250ms من التوقف عن الكتابة.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { NAV_MODULES } from "@/modules/registry";
import { MIcon } from "@/components/m-icon";

type Item = { id: string; label: string; sub?: string; icon: string; href: string; group: string };
let customersCache: { id: string; name: string; phone?: string | null }[] | null = null;

export function CommandPalette({ open, onClose, titleOf }: { open: boolean; onClose: () => void; titleOf: (m: (typeof NAV_MODULES)[number]) => string }) {
  const router = useRouter();
  const { user, hasPerm } = useAuth();
  const { lang } = useLang();
  const en = lang === "en";
  const [q, setQ] = useState("");
  const [remote, setRemote] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const isAdmin = user?.role === "admin";

  const pages = useMemo<Item[]>(() => NAV_MODULES
    .filter((m) => (m.adminOnly ? isAdmin : m.permissions.length === 0 || hasPerm(...m.permissions)))
    .map((m) => ({ id: `p:${m.path}`, label: titleOf(m), icon: m.icon === "sales" ? "point_of_sale" : "arrow_outward", href: m.path, group: en ? "Pages" : "الصفحات" })),
  [isAdmin, hasPerm, titleOf, en]);

  useEffect(() => { if (open) { setQ(""); setRemote([]); setActive(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  useEffect(() => {
    const term = q.trim();
    if (!open || term.length < 2) { setRemote([]); setBusy(false); return; }
    const ctl = new AbortController();
    const timer = setTimeout(async () => {
      setBusy(true);
      const out: Item[] = [];
      const tasks: Promise<void>[] = [];
      if (hasPerm("invoices.view_today", "invoices.view_all")) tasks.push(
        api<{ id: string; invoice_no: string; customer_name: string | null }[]>(`/invoices?limit=5&q=${encodeURIComponent(term)}`, { signal: ctl.signal })
          .then((r) => r.forEach((i) => out.push({ id: `i:${i.id}`, label: i.invoice_no, sub: i.customer_name ?? undefined, icon: "receipt", href: `/sales/history?invoiceNo=${encodeURIComponent(i.invoice_no)}`, group: en ? "Invoices" : "الفواتير" }))).catch(() => {}));
      if (hasPerm("products.create", "products.edit", "products.view_stock")) tasks.push(
        api<{ id: string; name: string; sku?: string | null }[]>(`/products?search=${encodeURIComponent(term)}`, { signal: ctl.signal })
          .then((r) => r.slice(0, 5).forEach((p) => out.push({ id: `pr:${p.id}`, label: p.name, sub: p.sku ?? undefined, icon: "inventory_2", href: `/products/${p.id}`, group: en ? "Products" : "الأصناف" }))).catch(() => {}));
      if (hasPerm("customers.create", "customers.edit", "customers.view_statement")) tasks.push((async () => {
        try {
          customersCache ??= await api("/customers", { signal: ctl.signal });
          const n = term.toLowerCase();
          customersCache!.filter((c) => c.name?.toLowerCase().includes(n) || c.phone?.includes(term)).slice(0, 5)
            .forEach((c) => out.push({ id: `c:${c.id}`, label: c.name, sub: c.phone ?? undefined, icon: "person", href: `/customers/${c.id}`, group: en ? "Customers" : "العملاء" }));
        } catch { /* */ }
      })());
      await Promise.all(tasks);
      if (!ctl.signal.aborted) { setRemote(out); setBusy(false); }
    }, 250);
    return () => { clearTimeout(timer); ctl.abort(); };
  }, [q, open, hasPerm, en]);

  const results = useMemo(() => {
    const n = q.trim().toLowerCase();
    const p = n ? pages.filter((x) => x.label.toLowerCase().includes(n)) : pages.slice(0, 8);
    return [...p, ...remote];
  }, [q, pages, remote]);
  useEffect(() => setActive(0), [results.length]);

  function go(it: Item) { onClose(); router.push(it.href); }
  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(results.length - 1, a + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
    else if (e.key === "Enter" && results[active]) go(results[active]);
  }
  useEffect(() => { document.getElementById(`cp-${active}`)?.scrollIntoView({ block: "nearest" }); }, [active]);

  if (!open) return null;
  let last = "";
  return (
    <div className="fixed inset-0 z-[90] flex items-start justify-center bg-black/45 px-3 pt-[10vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label={en ? "Search" : "بحث"} onMouseDown={(e) => e.stopPropagation()} onKeyDown={onKey}
        className="w-full max-w-xl overflow-hidden rounded-card border border-line bg-ink-2 shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line px-4">
          <MIcon name="search" className="!text-[20px] text-text-dim" />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} role="combobox" aria-expanded="true" aria-controls="cp-list"
            placeholder={en ? "Search pages, invoices, products, customers…" : "ابحث عن صفحة أو فاتورة أو صنف أو عميل…"}
            className="h-12 min-w-0 flex-1 bg-transparent text-t-md outline-none placeholder:text-text-dim" />
          {busy && <span className="h-4 w-4 animate-spin rounded-full border-2 border-petrol border-t-transparent" aria-hidden />}
          <kbd className="hidden rounded border border-line px-1.5 py-0.5 text-t-xs text-text-dim sm:block">Esc</kbd>
        </div>
        <ul id="cp-list" role="listbox" className="max-h-[50vh] overflow-y-auto p-1.5">
          {results.length === 0 && <li className="px-3 py-8 text-center text-t-sm text-text-dim">{en ? "No results" : "لا توجد نتائج"}</li>}
          {results.map((it, i) => {
            const head = it.group !== last ? (last = it.group) : null;
            return (
              <li key={it.id} role="presentation">
                {head && <div className="px-3 pb-1 pt-2 text-t-xs font-extrabold text-text-dim">{head}</div>}
                <button id={`cp-${i}`} role="option" aria-selected={i === active} onMouseEnter={() => setActive(i)} onClick={() => go(it)}
                  className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-start text-t-sm ${i === active ? "bg-petrol-soft text-petrol" : ""}`}>
                  <MIcon name={it.icon} className="!text-[18px]" />
                  <span className="min-w-0 flex-1 truncate font-bold">{it.label}</span>
                  {it.sub && <span className="shrink-0 truncate text-t-xs text-text-dim">{it.sub}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
