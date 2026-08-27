"use client";
// مركز ملاحظات الخدمة — Dashboard إحصائية + جدول بفلاتر وبحث (بنود 4/5/18)
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

/* ═══════ ثوابت العرض (module scope — ثابتة الهوية) ═══════ */
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

export default function ServiceNotesPage() {
  const router = useRouter();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [typeLabels, setTypeLabels] = useState<Record<string, string>>({});
  const [statusLabels, setStatusLabels] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<NoteRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // فلاتر (بند 18)
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      const dash = await api<{ counts: Counts; typeLabels: Record<string, string>;
        statusLabels: Record<string, string> }>("/service-notes/dashboard");
      setCounts(dash.counts); setTypeLabels(dash.typeLabels); setStatusLabels(dash.statusLabels);
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
  useEffect(() => { const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[18px] font-black">🔔 مركز ملاحظات الخدمة</h1>
        <Button variant="ghost" onClick={load}>تحديث</Button>
      </div>

      {/* ═══ بطاقات الإحصائيات (بند 4) ═══ */}
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

      {/* ═══ البحث والفلترة (بند 18) ═══ */}
      <Card className="!p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-[220px] flex-1">
            <Input placeholder="بحث: عميل / جوال / لوحة / منتج / رقم ملاحظة / موظف"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
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
        </div>
      </Card>

      {err && <p className="rounded-lg bg-ember-bg px-3 py-2 text-[12px] font-bold text-ember">{err}</p>}

      {/* ═══ الجدول (بند 5) ═══ */}
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
    </div>
  );
}
