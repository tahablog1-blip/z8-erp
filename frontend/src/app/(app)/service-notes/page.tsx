"use client";
// ═══ مركز ملاحظات الخدمة — صندوق وارد (Inbox) حول العميل:
//     كل صف = عميل/سيارة فيها آخر رسالة + ملاحظاته + عدّاد غير المقروء. الأهم (غير المقروء) أولاً بوضوح.
//     المحادثات محفوظة بالكامل في قاعدة البيانات — لا تُحذف أبداً.
//     وضعان لنفس السجلات: المحادثات (الافتراضي) | جدول الملاحظات (للفلترة الدقيقة).
//     بطاقات الإحصاء القديمة بقت فلاتر قابلة للضغط بدل أرقام ثابتة. ═══
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, IconButton, Input, Select } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { PlateBadge } from "@/components/PlateBadge";
import { CarBrandMark } from "@/components/CarBrandMark";

/* ═══════ الأنواع ═══════ */
type Counts = Record<string, number>;
type NoteRow = {
  id: string; note_number: string; type: string; status: string; priority: string;
  title: string | null; description: string;
  required_quantity: number | null; available_quantity: number | null;
  created_at: string; updated_at: string;
  plate: string | null; brand: string | null; car_name: string | null; model_year: string | null;
  customer_name: string | null; customer_phone: string | null;
  product_name: string | null; employee_name: string | null; branch_name: string | null;
  attachments_count: number;
};
type ThreadNote = { id: string; note_number: string; type: string; status: string; created_at: string };
type Thread = {
  work_order_id: string;
  plate: string | null; brand: string | null; car_name: string | null;
  customer_name: string | null; customer_phone: string | null;
  notes: ThreadNote[] | string | null; notes_count: number | null; open_count: number | null;
  last_message: string | null; last_sender: string | null; last_type: string | null;
  last_at: string | null; unread: number | null;
};

/* ═══════ الفلاتر (نفس تعريفات الباك اند في dashboard_counts) ═══════ */
type FilterKey = "all" | "unread" | "new" | "follow_up" | "needs_management" | "out_of_stock" | "technical" | "closed";
const FOLLOW_UP = ["in_progress", "awaiting_customer", "awaiting_management"];
const DONE = ["closed", "handled"];
const STOCK_TYPES = ["out_of_stock", "low_stock"];

function noteMatches(f: FilterKey, n: { status: string; type: string }): boolean {
  switch (f) {
    case "new": return n.status === "new";
    case "follow_up": return FOLLOW_UP.includes(n.status);
    case "needs_management": return n.status === "awaiting_management";
    case "out_of_stock": return STOCK_TYPES.includes(n.type);
    case "technical": return n.type === "technical";
    case "closed": return DONE.includes(n.status);
    default: return true;
  }
}

const FILTERS: { key: FilterKey; label: string; tone: string; threadsOnly?: boolean }[] = [
  { key: "all", label: "الكل", tone: "bg-text-dim" },
  { key: "unread", label: "غير مقروءة", tone: "bg-emerald", threadsOnly: true },
  { key: "new", label: "جديدة", tone: "bg-ember" },
  { key: "follow_up", label: "تحتاج متابعة", tone: "bg-brass" },
  { key: "needs_management", label: "قرار الإدارة", tone: "bg-brass" },
  { key: "out_of_stock", label: "منتجات غير متوفرة", tone: "bg-ember" },
  { key: "technical", label: "ملاحظات فنية", tone: "bg-petrol" },
  { key: "closed", label: "مغلقة", tone: "bg-emerald" },
];

const STATUS_DOT: Record<string, string> = {
  new: "bg-ember", in_progress: "bg-brass", awaiting_customer: "bg-petrol",
  awaiting_management: "bg-brass", handled: "bg-emerald", closed: "bg-text-dim", rejected: "bg-text-dim",
};

/* ═══════ أدوات عرض (module scope) ═══════ */
function threadNotes(t: Thread): ThreadNote[] {
  if (!t.notes) return [];
  if (typeof t.notes === "string") { try { return JSON.parse(t.notes); } catch { return []; } }
  return t.notes;
}

const loc = () => (typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn");

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString(loc(), { hour: "2-digit", minute: "2-digit" });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "أمس";
  return d.toLocaleDateString(loc(), { day: "2-digit", month: "2-digit" });
}

function Preview({ t }: { t: Thread }) {
  if (t.last_type === "voice")
    return <span className="inline-flex items-center gap-1"><MIcon name="mic" className="!text-[15px]" /> رسالة صوتية</span>;
  if (!t.last_message)
    return <span className="text-text-dim">لا رسائل بعد — ابدأ المحادثة مع العميل</span>;
  if (t.last_type === "note_internal")
    return <span className="inline-flex items-center gap-1"><MIcon name="sticky_note_2" className="!text-[15px]" /> {t.last_message.split("\n")[0]}</span>;
  return <>{t.last_sender === "customer" ? "" : "أنت: "}{t.last_message}</>;
}

/* ── صف المحادثة: الصف كله يفتح المحادثة، وشرائح الملاحظات فوقه تفتح الملاحظة ── */
function ThreadRow({ t, typeLabels, onOpen, onOpenNote }: {
  t: Thread; typeLabels: Record<string, string>;
  onOpen: () => void; onOpenNote: (id: string) => void;
}) {
  const notes = threadNotes(t);
  const unread = t.unread || 0;
  const name = t.customer_name || "عميل";
  return (
    <li className="group relative transition hover:bg-ink-3">
      {/* أكسنت بداية الصف للرسائل غير المقروءة — مش اللون وحده: الوزن + العدّاد كمان */}
      {unread > 0 && <span className="absolute inset-y-0 right-0 w-1 bg-emerald" aria-hidden />}
      <button onClick={onOpen} className="absolute inset-0 z-0" aria-label={`فتح محادثة ${name}${unread ? ` — ${unread} غير مقروءة` : ""}`} />
      <div className="pointer-events-none relative z-[1] flex items-start gap-3 px-4 py-3.5 sm:gap-4">
        <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[16px] font-black text-white ${unread > 0 ? "bg-emerald" : "bg-petrol"}`} aria-hidden>
          {(t.customer_name || t.plate || "؟").trim().charAt(0)}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <span className={`text-[14px] ${unread > 0 ? "font-black" : "font-bold"}`}>{name}</span>
            {t.plate && <PlateBadge plate={t.plate} size="sm" />}
            <CarBrandMark brand={t.brand} model={t.car_name} size="md" />
            {t.customer_phone && <span dir="ltr" className="tnum text-[12px] text-text-dim">{t.customer_phone}</span>}
          </div>
          <div className={`mt-1 truncate text-[13px] ${unread > 0 ? "font-bold text-text" : "text-text-dim"}`}>
            <Preview t={t} />
          </div>
          {notes.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {notes.slice(0, 4).map((n) => (
                <button key={n.id} onClick={() => onOpenNote(n.id)}
                  className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-line bg-ink-2 px-2.5 py-1 text-[11.5px] font-bold transition hover:border-petrol hover:text-petrol">
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[n.status] ?? "bg-text-dim"}`} aria-hidden />
                  <span className="tnum">{n.note_number}</span>
                  <span className="font-medium text-text-dim">{typeLabels[n.type] ?? n.type}</span>
                </button>
              ))}
              {notes.length > 4 && <span className="text-[11.5px] font-bold text-text-dim">+{notes.length - 4} أخرى</span>}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="tnum text-[11.5px] text-text-dim">{timeLabel(t.last_at)}</span>
          {unread > 0 ? (
            <span className="grid h-6 min-w-6 place-items-center rounded-full bg-emerald px-1.5 text-[12px] font-black text-white" aria-hidden>{unread}</span>
          ) : (
            <MIcon name="chevron_left" className="!text-[20px] text-text-dim opacity-0 transition group-hover:opacity-100" />
          )}
        </div>
      </div>
    </li>
  );
}

function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <ul className="divide-y divide-line" aria-hidden>
      {Array.from({ length: n }).map((_, i) => (
        <li key={i} className="flex items-center gap-4 px-4 py-4">
          <div className="h-11 w-11 animate-pulse rounded-full bg-ink-4/70" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-1/3 animate-pulse rounded-full bg-ink-4/70" />
            <div className="h-3 w-2/3 animate-pulse rounded-full bg-ink-4/50" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyInFrame({ icon, title, hint }: { icon: string; title: string; hint: string }) {
  return (
    <div className="px-6 py-14 text-center">
      <MIcon name={icon} className="!text-[32px] text-text-dim" />
      <div className="mt-2 text-[14px] font-extrabold">{title}</div>
      <p className="mx-auto mt-1 max-w-sm text-[12.5px] leading-relaxed text-text-dim">{hint}</p>
    </div>
  );
}

const PAGE = 40;

export default function ServiceNotesPage() {
  const router = useRouter();
  const [view, setView] = useState<"threads" | "table">("threads");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState<Thread[]>([]);
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState("");
  const [limit, setLimit] = useState(PAGE);

  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    setErr("");
    try {
      const dash = await api<{ counts: Counts; typeLabels: Record<string, string>; statusLabels: Record<string, string> }>("/service-notes/dashboard");
      setCounts(dash.counts); setTypeLabels(dash.typeLabels); setStatusLabels(dash.statusLabels);
      setThreads(await api<Thread[]>("/service-notes/customer-threads"));
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status", status);
      if (type) p.set("type", type);
      setRows(await api<NoteRow[]>(`/service-notes?${p.toString()}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذّر تحميل البيانات");
    } finally { setLoading(false); setRefreshing(false); }
  }, [q, status, type]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) load(); }, 10000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => { setLimit(PAGE); }, [q, filter, view]);

  const ql = q.trim();
  const totalUnread = threads.reduce((s, t) => s + (t.unread || 0), 0);
  const unreadThreads = threads.filter((t) => (t.unread || 0) > 0).length;

  const shownThreads = useMemo(() => {
    let list = threads;
    if (ql) list = list.filter((t) =>
      [t.customer_name, t.customer_phone, t.plate, t.brand, t.car_name].some((v) => (v || "").includes(ql)) ||
      threadNotes(t).some((n) => n.note_number.includes(ql)));
    if (filter === "unread") list = list.filter((t) => (t.unread || 0) > 0);
    else if (filter !== "all") list = list.filter((t) => threadNotes(t).some((n) => noteMatches(filter, n)));
    // غير المقروء أولاً، وبعده الأحدث
    return [...list].sort((a, b) => ((b.unread || 0) > 0 ? 1 : 0) - ((a.unread || 0) > 0 ? 1 : 0)
      || (new Date(b.last_at || 0).getTime() - new Date(a.last_at || 0).getTime()));
  }, [threads, ql, filter]);

  const shownRows = useMemo(
    () => (filter === "all" || filter === "unread" ? rows : rows.filter((r) => noteMatches(filter, r))),
    [rows, filter]);

  // أرقام الشرائح: ملاحظات من لوحة الإحصاء، وغير المقروء من الرسائل
  const num = (...keys: string[]) => { for (const k of keys) if (counts && counts[k] != null) return Number(counts[k]); return 0; };
  const chipCount: Record<FilterKey, number> = {
    all: view === "threads" ? threads.length : num("total"),
    unread: totalUnread,
    new: num("new"),
    follow_up: num("follow_up", "followUp"),
    needs_management: num("needs_management", "managementDecision"),
    out_of_stock: num("out_of_stock", "outOfStock"),
    technical: num("technical"),
    closed: num("closed"),
  };
  const visibleChips = FILTERS.filter((f) => !(f.threadsOnly && view === "table"));
  const openChat = (id: string) => router.push(`/service-notes/chats/${id}`);
  const openNote = (id: string) => router.push(`/service-notes/${id}`);

  return (
    <div className="mx-auto max-w-[1200px] space-y-4">
      {/* ═══ العنوان ═══ */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2.5 text-[20px] font-black">
            المحادثات والملاحظات
            {totalUnread > 0 && (
              <span className="rounded-full bg-emerald px-2.5 py-0.5 text-[12px] font-black text-white tnum">{totalUnread} غير مقروءة</span>
            )}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-text-dim">
            محادثات العملاء وملاحظات الخدمة في مكان واحد. الرسائل غير المقروءة تظهر أولاً.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-line bg-ink-2 p-0.5" role="tablist" aria-label="طريقة العرض">
            {([["threads", "المحادثات", "forum"], ["table", "جدول الملاحظات", "table_rows"]] as const).map(([k, label, icon]) => (
              <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                className={`inline-flex items-center gap-1.5 rounded-[10px] px-3.5 py-2 text-[12.5px] font-bold transition
                  ${view === k ? "bg-petrol text-white" : "text-text-dim hover:text-text"}`}>
                <MIcon name={icon} className="!text-[17px]" />{label}
              </button>
            ))}
          </div>
          <IconButton label="تحديث" onClick={() => load(true)} disabled={refreshing}>
            <MIcon name="refresh" className={`!text-[19px] ${refreshing ? "animate-spin" : ""}`} />
          </IconButton>
        </div>
      </div>

      {/* ═══ البحث + الفلاتر ═══ */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[240px] flex-1">
            <MIcon name="search" className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 !text-[19px] text-text-dim" />
            <Input aria-label="بحث" placeholder="ابحث بالعميل أو الجوال أو اللوحة" value={q}
              onChange={(e) => setQ(e.target.value)} className="!py-3 !pr-11" />
          </div>
          {view === "table" && (
            <>
              <Select aria-label="الحالة" className="!w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">كل الحالات</option>
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
              <Select aria-label="النوع" className="!w-auto" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">كل الأنواع</option>
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </Select>
            </>
          )}
        </div>
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="تصفية">
          {visibleChips.map((f) => {
            const on = filter === f.key;
            return (
              <button key={f.key} role="tab" aria-selected={on} onClick={() => setFilter(f.key)}
                className={`inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-2 text-[12.5px] font-bold transition
                  ${on ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol"}`}>
                {f.key !== "all" && <span className={`h-2 w-2 rounded-full ${on ? "bg-white" : f.tone}`} aria-hidden />}
                {f.label}
                <span className={`tnum rounded-full px-1.5 text-[11.5px] ${on ? "bg-white/20" : "bg-ink-3"}`}>{chipCount[f.key]}</span>
              </button>
            );
          })}
        </div>
      </div>

      {err && (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-xl border border-ember/30 bg-ember-bg px-4 py-3 text-[13px] font-bold text-ember">
          <span>{err}</span>
          <Button size="sm" variant="danger" onClick={() => load(true)}>إعادة المحاولة</Button>
        </div>
      )}

      {/* ═══ المحادثات ═══ */}
      {view === "threads" && (
        <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
          {loading ? <SkeletonRows /> : shownThreads.length === 0 ? (
            <EmptyInFrame icon={ql || filter !== "all" ? "search_off" : "forum"}
              title={ql || filter !== "all" ? "لا توجد نتائج مطابقة" : "لا توجد محادثات بعد"}
              hint={ql || filter !== "all" ? "غيّر البحث أو اختر «الكل» لعرض كل المحادثات." : "أول ملاحظة أو رسالة من عميل ستظهر هنا."} />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {shownThreads.slice(0, limit).map((t) => (
                  <ThreadRow key={t.work_order_id} t={t} typeLabels={typeLabels}
                    onOpen={() => openChat(t.work_order_id)} onOpenNote={openNote} />
                ))}
              </ul>
              <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-text-dim">
                <span className="tnum">
                  {Math.min(limit, shownThreads.length)} من {shownThreads.length} محادثة
                  {unreadThreads > 0 && ` · ${unreadThreads} فيها رسائل جديدة`}
                </span>
                {shownThreads.length > limit && (
                  <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>عرض المزيد</Button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ═══ جدول الملاحظات ═══ */}
      {view === "table" && (
        <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-ink-3 text-text-dim">
                  {["الرقم", "الحالة", "النوع", "العميل", "السيارة", "المنتج", "المطلوب / المتوفر", "الموظف", "الفرع", "التاريخ", "مرفقات"].map((h) => (
                    <th key={h} className="whitespace-nowrap px-3 py-3 text-right text-[12px] font-extrabold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={11} className="p-0"><SkeletonRows n={5} /></td></tr>}
                {!loading && shownRows.length === 0 && (
                  <tr><td colSpan={11} className="p-0">
                    <EmptyInFrame icon="search_off" title="لا توجد ملاحظات مطابقة" hint="غيّر الفلاتر أو البحث لعرض ملاحظات أخرى." />
                  </td></tr>
                )}
                {shownRows.slice(0, limit).map((r) => (
                  <tr key={r.id} tabIndex={0} onClick={() => openNote(r.id)}
                    onKeyDown={(e) => { if (e.key === "Enter") openNote(r.id); }}
                    className="cursor-pointer border-b border-line/60 transition-colors hover:bg-ink-3 focus-visible:bg-ink-3 focus-visible:outline-none">
                    <td className="px-3 py-3 font-bold tnum">{r.note_number}</td>
                    <td className="px-3 py-3">
                      <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold">
                        <span className={`h-2 w-2 rounded-full ${STATUS_DOT[r.status] ?? "bg-text-dim"}`} aria-hidden />
                        {statusLabels[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="px-3 py-3">{typeLabels[r.type] ?? r.type}</td>
                    <td className="px-3 py-3">{r.customer_name ?? "—"}</td>
                    <td className="px-3 py-3">
                      {r.plate || r.brand || r.car_name ? (
                        <span className="inline-flex items-center gap-2">
                          {r.plate && <PlateBadge plate={r.plate} size="sm" />}
                          <CarBrandMark brand={r.brand} model={r.car_name} year={r.model_year} size="sm" />
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-3 py-3">{r.product_name ?? "—"}</td>
                    <td className="px-3 py-3 tnum">{r.required_quantity != null ? `${r.required_quantity} / ${r.available_quantity ?? "؟"}` : "—"}</td>
                    <td className="px-3 py-3">{r.employee_name ?? "—"}</td>
                    <td className="px-3 py-3">{r.branch_name ?? "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3 tnum">{new Date(r.created_at).toLocaleDateString(loc())}</td>
                    <td className="px-3 py-3 tnum">
                      {r.attachments_count > 0 ? <span className="inline-flex items-center gap-1"><MIcon name="attach_file" className="!text-[15px]" />{r.attachments_count}</span> : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!loading && shownRows.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5 text-[12px] text-text-dim">
              <span className="tnum">{Math.min(limit, shownRows.length)} من {shownRows.length} ملاحظة</span>
              {shownRows.length > limit && <Button size="sm" variant="ghost" onClick={() => setLimit((l) => l + PAGE)}>عرض المزيد</Button>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
