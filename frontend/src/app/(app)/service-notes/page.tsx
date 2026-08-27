"use client";
// ═══ مركز ملاحظات الخدمة — قسم واحد منظم حول العميل:
//     كل عميل (سيارة) = بطاقة فيها ملاحظاته + زر دردشة بشارة غير المقروء.
//     المحادثات محفوظة بالكامل في قاعدة البيانات — لا تُحذف أبداً.
//     عرضان: 👥 العملاء (الافتراضي) | 📋 جدول الملاحظات (للفلترة الدقيقة) ═══
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input } from "@/components/ui";

/* ═══════ الأنواع ═══════ */
type Counts = {
  total: number; new: number; follow_up: number; closed: number;
  out_of_stock: number; technical: number; needs_management: number;
};
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

/* ═══════ ثوابت العرض (module scope) ═══════ */
const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "info"> = {
  new: "warn", in_progress: "info", awaiting_customer: "info",
  awaiting_management: "warn", handled: "good", closed: "neutral", rejected: "neutral",
};
const STATUS_DOT: Record<string, string> = {
  new: "🔴", in_progress: "🟡", awaiting_customer: "🔵",
  awaiting_management: "🟠", handled: "🟢", closed: "⚫", rejected: "⚫",
};

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <Card className="!p-4 text-center">
      <div className="text-[24px] font-black" style={accent ? { color: accent } : undefined}>{value}</div>
      <div className="text-[11px] text-text-dim">{label}</div>
    </Card>
  );
}

function threadNotes(t: Thread): ThreadNote[] {
  if (!t.notes) return [];
  if (typeof t.notes === "string") { try { return JSON.parse(t.notes); } catch { return []; } }
  return t.notes;
}

function lastPreview(t: Thread): string {
  if (!t.last_message) return "لا رسائل بعد — ابدأ الدردشة مع العميل";
  if (t.last_type === "voice") return "🎤 رسالة صوتية";
  if (t.last_type === "note_internal") return "📋 " + t.last_message.split("\n")[0];
  return t.last_message;
}

function timeLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("ar-SA-u-nu-latn", { day: "2-digit", month: "2-digit" });
}

export default function ServiceNotesPage() {
  const router = useRouter();
  const [view, setView] = useState<"customers" | "table">("customers");
  const [counts, setCounts] = useState<Counts | null>(null);
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});
  const [threads, setThreads] = useState<Thread[]>([]);
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // فلاتر
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const dash = await api<{ counts: Counts; typeLabels: Record<string, string>;
        statusLabels: Record<string, string> }>("/service-notes/dashboard");
      setCounts(dash.counts); setTypeLabels(dash.typeLabels); setStatusLabels(dash.statusLabels);
      // خيوط العملاء (ملاحظات + محادثة لكل سيارة)
      setThreads(await api<Thread[]>("/service-notes/customer-threads"));
      // جدول الملاحظات (للعرض الجدولي)
      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status", status);
      if (type) p.set("type", type);
      setRows(await api<NoteRow[]>(`/service-notes?${p.toString()}`));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذر التحميل");
    } finally { setLoading(false); }
  }, [q, status, type]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);

  const ql = q.trim();
  const shownThreads = ql
    ? threads.filter((t) =>
        [t.customer_name, t.customer_phone, t.plate, t.brand, t.car_name]
          .some((v) => (v || "").includes(ql)) ||
        threadNotes(t).some((n) => n.note_number.includes(ql)))
    : threads;
  const totalUnread = threads.reduce((s, t) => s + (t.unread || 0), 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[18px] font-black">
          🔔 مركز ملاحظات الخدمة
          {totalUnread > 0 && (
            <span className="mr-2 rounded-full bg-emerald px-2.5 py-0.5 text-[12px] font-black text-white">
              💬 {totalUnread} غير مقروءة
            </span>
          )}
        </h1>
        <div className="flex items-center gap-1.5">
          {/* مفتاح العرض */}
          <div className="flex rounded-full border border-line bg-ink-2 p-0.5">
            <button onClick={() => setView("customers")}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-black transition
                ${view === "customers" ? "bg-petrol text-white" : "text-text-dim hover:text-text"}`}>
              👥 العملاء
            </button>
            <button onClick={() => setView("table")}
              className={`rounded-full px-3.5 py-1.5 text-[12px] font-black transition
                ${view === "table" ? "bg-petrol text-white" : "text-text-dim hover:text-text"}`}>
              📋 جدول الملاحظات
            </button>
          </div>
          <Button variant="ghost" onClick={load}>تحديث</Button>
        </div>
      </div>

      {/* ═══ بطاقات الإحصائيات ═══ */}
      {counts && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
          <StatCard label="إجمالي الملاحظات" value={counts.total} />
          <StatCard label="جديدة" value={counts.new} accent="#DC2626" />
          <StatCard label="تحتاج متابعة" value={counts.follow_up} accent="#D97706" />
          <StatCard label="مغلقة" value={counts.closed} />
          <StatCard label="منتجات غير متوفرة" value={counts.out_of_stock} accent="#DC2626" />
          <StatCard label="ملاحظات فنية" value={counts.technical} accent="#2563EB" />
          <StatCard label="تحتاج قرار الإدارة" value={counts.needs_management} accent="#D97706" />
        </div>
      )}

      {/* ═══ البحث (+ فلاتر الجدول) ═══ */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <Input placeholder="بحث: عميل / جوال / لوحة / منتج / رقم ملاحظة"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {view === "table" && (
            <>
              <select className="rounded-xl border border-line bg-ink-2 px-3 py-2.5 text-[13px]"
                value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">كل الحالات</option>
                {Object.entries(statusLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <select className="rounded-xl border border-line bg-ink-2 px-3 py-2.5 text-[13px]"
                value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">كل الأنواع</option>
                {Object.entries(typeLabels).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </>
          )}
        </div>
      </Card>

      {err && <p className="rounded-lg bg-ember-bg px-3 py-2 text-[12px] font-bold text-ember">{err}</p>}

      {/* ═══ عرض العملاء — بطاقة لكل عميل: ملاحظاته + زر الدردشة ═══ */}
      {view === "customers" && (
        <div className="space-y-2.5">
          {loading && <Card><p className="py-6 text-center text-text-dim">جارٍ التحميل…</p></Card>}
          {!loading && shownThreads.length === 0 && (
            <Card>
              <p className="py-8 text-center text-[12.5px] text-text-dim">
                {ql ? "لا نتائج مطابقة للبحث" : "لا عملاء بعد — أول ملاحظة أو رسالة هتظهر هنا"}
              </p>
            </Card>
          )}
          {shownThreads.map((t) => {
            const notes = threadNotes(t);
            const unread = t.unread || 0;
            return (
              <Card key={t.work_order_id} className="!p-0 overflow-hidden">
                {/* رأس البطاقة: العميل + السيارة + الدردشة */}
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className={`grid h-11 w-11 shrink-0 place-items-center rounded-full text-[15px] font-black text-white
                       ${unread > 0 ? "bg-emerald" : "bg-petrol"}`}>
                    {(t.customer_name || t.plate || "؟").trim().charAt(0)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[13.5px] font-black">{t.customer_name || "عميل"}</span>
                      {t.plate && (
                        <span className="rounded bg-petrol-soft px-1.5 py-0.5 text-[10.5px] font-black text-petrol tnum">{t.plate}</span>
                      )}
                      <span className="text-[11px] text-text-dim">
                        {[t.brand, t.car_name].filter(Boolean).join(" ")}
                        {t.customer_phone && <span className="tnum"> · {t.customer_phone}</span>}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-2">
                      <span className={`truncate text-[12px] ${unread > 0 ? "font-bold text-text" : "text-text-dim"}`}>
                        {t.last_sender === "customer" ? "" : t.last_message ? "أنت: " : ""}{lastPreview(t)}
                      </span>
                      {t.last_at && (
                        <span className="tnum shrink-0 text-[10.5px] text-text-dim">{timeLabel(t.last_at)}</span>
                      )}
                    </div>
                  </div>
                  {/* زر الدردشة — الرسائل محفوظة دائماً */}
                  <button onClick={() => router.push(`/service-notes/chats/${t.work_order_id}`)}
                    className="relative flex shrink-0 items-center gap-1.5 rounded-full bg-emerald px-4 py-2 text-[12.5px] font-black text-white transition hover:brightness-110 active:scale-95">
                    💬 دردشة
                    {unread > 0 && (
                      <span className="grid h-5 min-w-5 place-items-center rounded-full bg-white px-1 text-[10.5px] font-black text-emerald">
                        {unread}
                      </span>
                    )}
                  </button>
                </div>
                {/* ملاحظات العميل — شرائح قابلة للضغط */}
                {notes.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-line/60 bg-ink-2/40 px-4 py-2.5">
                    {notes.slice(0, 4).map((n) => (
                      <button key={n.id} onClick={() => router.push(`/service-notes/${n.id}`)}
                        className="flex items-center gap-1.5 rounded-full border border-line bg-ink px-3 py-1.5 text-[11px] font-bold transition hover:border-petrol">
                        <span>{STATUS_DOT[n.status] ?? ""}</span>
                        <span className="tnum">{n.note_number}</span>
                        <span className="text-text-dim">· {typeLabels[n.type] ?? n.type}</span>
                      </button>
                    ))}
                    {notes.length > 4 && (
                      <span className="text-[11px] font-bold text-text-dim">+{notes.length - 4} أخرى</span>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* ═══ عرض الجدول — الفلترة الدقيقة بالحالة والنوع ═══ */}
      {view === "table" && (
        <Card className="!p-0 overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-ink-3 text-text-dim">
                <th className="px-3 py-2.5 text-right">الرقم</th>
                <th className="px-3 py-2.5 text-right">الحالة</th>
                <th className="px-3 py-2.5 text-right">النوع</th>
                <th className="px-3 py-2.5 text-right">العميل</th>
                <th className="px-3 py-2.5 text-right">السيارة</th>
                <th className="px-3 py-2.5 text-right">المنتج</th>
                <th className="px-3 py-2.5 text-right">المطلوب/المتوفر</th>
                <th className="px-3 py-2.5 text-right">الموظف</th>
                <th className="px-3 py-2.5 text-right">الفرع</th>
                <th className="px-3 py-2.5 text-right">التاريخ</th>
                <th className="px-3 py-2.5 text-right">مرفقات</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-text-dim">جارٍ التحميل…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-text-dim">لا توجد ملاحظات مطابقة</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.id}
                  className="cursor-pointer border-b border-line/60 transition-colors hover:bg-ink-3"
                  onClick={() => router.push(`/service-notes/${r.id}`)}>
                  <td className="px-3 py-2.5 font-bold tnum">{r.note_number}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[r.status] ?? "neutral"}>
                      {STATUS_DOT[r.status] ?? ""} {statusLabels[r.status] ?? r.status}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5">{typeLabels[r.type] ?? r.type}</td>
                  <td className="px-3 py-2.5">{r.customer_name ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    {[r.brand, r.car_name, r.model_year].filter(Boolean).join(" ") || r.plate || "—"}
                  </td>
                  <td className="px-3 py-2.5">{r.product_name ?? "—"}</td>
                  <td className="px-3 py-2.5 tnum">
                    {r.required_quantity != null
                      ? `${r.required_quantity} / ${r.available_quantity ?? "؟"}`
                      : "—"}
                  </td>
                  <td className="px-3 py-2.5">{r.employee_name ?? "—"}</td>
                  <td className="px-3 py-2.5">{r.branch_name ?? "—"}</td>
                  <td className="px-3 py-2.5 tnum">{new Date(r.created_at).toLocaleDateString("ar-SA")}</td>
                  <td className="px-3 py-2.5 tnum">{r.attachments_count > 0 ? `📷 ${r.attachments_count}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
