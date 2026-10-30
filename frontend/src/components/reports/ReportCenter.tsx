"use client";
// مركز التقارير: بحث + تصنيفات + الأكثر استخدامًا (المفضلة وآخر التقارير) + تقاريري المحفوظة.
// الفهرس يأتي من الخادم وهو يحجب ما لا يملك المستخدم صلاحيته؛ التفضيلات تُحفظ على حسابه في الخادم.
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, EmptyState, ErrorNote, PageHeader } from "@/components/ui";
import { Skeleton } from "@/components/dashboard/Widget";
import { MIcon } from "@/components/m-icon";

type Report = { id: string; cat: string; title: string; desc: string; icon: string; route: string; tags: string; sensitive: boolean };
type Cat = { id: string; title: string; icon: string };
type Prefs = { favorites: string[]; recents: { id: string; at: string }[]; saved: { id: string | null; reportId: string; name: string; filters: Record<string, string> }[] };

export function ReportCenter() {
  const router = useRouter();
  const { hasPerm, user } = useAuth() as ReturnType<typeof useAuth> & { user?: { role?: string } };
  const [cat, setCat] = useState<{ categories: Cat[]; reports: Report[] } | null>(null);
  const [prefs, setPrefs] = useState<Prefs>({ favorites: [], recents: [], saved: [] });
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");
  const [active, setActive] = useState("all");

  function load() {
    setErr(""); setCat(null);
    api<{ categories: Cat[]; reports: Report[] }>("/reports/catalog").then(setCat).catch((e: unknown) => setErr(e instanceof Error ? e.message : "تعذر تحميل مركز التقارير"));
    api<Prefs>("/reports/prefs").then(setPrefs).catch(() => undefined);
  }
  useEffect(load, []);

  const byId = useMemo(() => new Map((cat?.reports ?? []).map((r) => [r.id, r])), [cat]);
  const needle = q.trim().toLowerCase();
  const visible = (cat?.reports ?? []).filter((r) => (active === "all" || r.cat === active) &&
    (!needle || `${r.title} ${r.desc} ${r.tags} ${cat?.categories.find((c) => c.id === r.cat)?.title ?? ""}`.toLowerCase().includes(needle)));

  // ترتيب الأقسام حسب دور المستخدم: المحاسب → المالية، المخزني → المخزون، غير ذلك → ترتيب الفهرس
  const lead = hasPerm("accounting.view_reports") ? "financial" : hasPerm("products.view_stock") && !hasPerm("reports.sales") ? "inventory" : hasPerm("reports.sales") ? "sales" : "";
  const cats = useMemo(() => {
    const all = cat?.categories ?? [];
    return [...all].sort((a, b) => (a.id === lead ? -1 : b.id === lead ? 1 : 0));
  }, [cat, lead]);

  function open(r: Report, filters?: Record<string, string>) {
    if (filters) { try { localStorage.setItem("z8_report_filters", JSON.stringify(filters)); } catch { /* تجاهل */ } }
    api(`/reports/open/${r.id}`, { method: "POST" }).catch(() => undefined);
    router.push(r.route);
  }
  async function toggleFav(id: string) {
    const next = prefs.favorites.includes(id) ? prefs.favorites.filter((x) => x !== id) : [...prefs.favorites, id];
    setPrefs({ ...prefs, favorites: next });
    try { setPrefs(await api<Prefs>("/reports/prefs", { method: "PUT", body: JSON.stringify({ favorites: next }) })); } catch { setPrefs(prefs); }
  }
  async function removeSaved(i: number) {
    const next = prefs.saved.filter((_, k) => k !== i);
    try { setPrefs(await api<Prefs>("/reports/prefs", { method: "PUT", body: JSON.stringify({ saved: next }) })); } catch { /* تجاهل */ }
  }

  const Card = ({ r }: { r: Report }) => {
    const fav = prefs.favorites.includes(r.id);
    return (
      <div className="group relative flex min-w-0 flex-col rounded-card border border-line bg-ink-2 p-4 shadow-card transition hover:border-petrol/50">
        <button type="button" aria-pressed={fav} aria-label={fav ? "إزالة من المفضلة" : "إضافة للمفضلة"} onClick={() => toggleFav(r.id)}
                className={`absolute end-3 top-3 grid h-7 w-7 place-items-center rounded-md hover:bg-ink-3 ${fav ? "text-brass" : "text-text-dim"}`}>
          <MIcon name="star" className="!text-[18px]" style={fav ? { fontVariationSettings: "'FILL' 1" } : undefined} />
        </button>
        <span className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-petrol-soft text-petrol"><MIcon name={r.icon} className="!text-[20px]" /></span>
        <h3 className="pe-8 text-t-md font-black leading-snug">{r.title}</h3>
        <p className="mt-1 flex-1 text-t-sm leading-relaxed text-text-dim">{r.desc}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          {r.sensitive ? <Badge tone="warning">مالي حساس</Badge> : <span />}
          <Button size="sm" variant="outline" onClick={() => open(r)}>فتح التقرير</Button>
        </div>
      </div>
    );
  };

  const quick = [...prefs.favorites.map((id) => byId.get(id)), ...prefs.recents.map((x) => byId.get(x.id))]
    .filter((r, i, a): r is Report => !!r && a.findIndex((x) => x?.id === r.id) === i).slice(0, 8);
  const grouped = cats.map((c) => ({ c, rows: visible.filter((r) => r.cat === c.id) })).filter((g) => g.rows.length);
  const isAdmin = (user as { role?: string } | undefined)?.role === "admin";

  return (
    <div className="space-y-4">
      <PageHeader title="التقارير" description="مركز التقارير والتحليلات — ما يظهر هنا هو ما تملك صلاحيته فقط." />
      <ErrorNote msg={err} />
      <div className="rounded-card border border-line bg-ink-2 p-3 shadow-card">
        <label className="flex h-10 items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 focus-within:border-petrol focus-within:ring-2 focus-within:ring-petrol/15">
          <MIcon name="search" className="!text-[18px] text-text-dim" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن تقرير: مبيعات، ضريبة، مخزون، كشف حساب…" aria-label="بحث في التقارير"
                 className="h-full min-w-0 flex-1 bg-transparent text-t-md outline-none placeholder:text-text-dim/60" />
        </label>
        <div className="no-scrollbar mt-3 flex gap-1.5 overflow-x-auto" role="tablist" aria-label="تصنيفات التقارير">
          {[{ id: "all", title: "الكل" }, ...cats].map((c) => (
            <button key={c.id} role="tab" aria-selected={active === c.id} onClick={() => setActive(c.id)}
                    className={`shrink-0 rounded-none border px-3.5 py-1.5 text-t-sm font-bold ${active === c.id ? "border-petrol bg-petrol text-white" : "border-line text-text-dim hover:border-petrol"}`}>{c.title}</button>
          ))}
        </div>
      </div>

      {!cat && !err && <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="rounded-card border border-line bg-ink-2 p-4"><Skeleton className="mb-3 w-10" height={36} /><Skeleton className="mb-2 w-3/4" height={16} /><Skeleton className="w-full" height={40} /></div>)}</div>}

      {cat && !needle && active === "all" && (quick.length > 0 || prefs.saved.length > 0) && (
        <section className="space-y-2" aria-label="الأكثر استخدامًا">
          {quick.length > 0 && (<>
            <h2 className="text-t-md font-black">الأكثر استخدامًا</h2>
            <div className="flex flex-wrap gap-2">{quick.map((r) => (
              <button key={r.id} onClick={() => open(r)} className="inline-flex items-center gap-1.5 rounded-none border border-line bg-ink-2 px-3 py-1.5 text-t-sm font-bold hover:border-petrol">
                <MIcon name={r.icon} className="!text-[16px] text-petrol" />{r.title}{prefs.favorites.includes(r.id) && <MIcon name="star" className="!text-[14px] text-brass" />}</button>))}</div>
          </>)}
          {prefs.saved.length > 0 && (<>
            <h2 className="pt-1 text-t-md font-black">تقاريري المحفوظة</h2>
            <div className="flex flex-wrap gap-2">{prefs.saved.map((s, i) => {
              const r = byId.get(s.reportId); if (!r) return null;
              return (
                <span key={`${s.id}-${i}`} className="inline-flex items-center gap-1 rounded-none border border-petrol/40 bg-petrol-soft ps-3 pe-1 text-t-sm font-bold text-petrol">
                  <button onClick={() => open(r, s.filters)} className="py-1.5">{s.name}</button>
                  <button aria-label={`حذف ${s.name}`} onClick={() => removeSaved(i)} className="grid h-6 w-6 place-items-center rounded-full hover:bg-ink-2"><MIcon name="close" className="!text-[14px]" /></button>
                </span>);
            })}</div>
          </>)}
        </section>
      )}

      {cat && !grouped.length && <EmptyState icon="search_off" title="لا توجد تقارير مطابقة" description={needle ? "جرّب كلمة بحث أخرى أو غيّر التصنيف." : "لا تملك صلاحية عرض أي تقرير حالياً."} />}
      {grouped.map(({ c, rows }) => (
        <section key={c.id} className="space-y-2" aria-label={c.title}>
          <h2 className="flex items-center gap-1.5 text-t-md font-black"><MIcon name={c.icon} className="!text-[18px] text-petrol" />{c.title}<span className="text-t-xs font-bold text-text-dim">({rows.length})</span></h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">{rows.map((r) => <Card key={r.id} r={r} />)}</div>
        </section>
      ))}
      {isAdmin && cat && <p className="text-t-xs text-text-dim">أنت مدير النظام: تظهر لك كل التقارير. فتح التقارير المالية الحساسة يُسجَّل في سجل التدقيق.</p>}
    </div>
  );
}
