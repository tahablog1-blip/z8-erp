"use client";
// الإعدادات ← سجل المراجعة — عرض/تصفية audit_log (كان يُكتب فعلياً من كل الموديولات
// بلا أي شاشة لعرضه؛ هنا أول واجهة له: فلاتر + جدول + صفحات)
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Select, PageHeader } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type LogRow = {
  id: string; branch_id: string | null; user_id: string | null; user_email: string | null;
  action: string; entity: string; entity_id: string | null;
  old_value: string | null; new_value: string | null; reason: string | null; created_at: string;
};
type ListResp = { items: LogRow[]; total: number; page: number; pageSize: number };

const ACTION_LABELS: Record<string, string> = {
  create: "إضافة", edit: "تعديل", delete: "حذف", discount: "خصم",
  credit_sale: "بيع آجل", cancel: "إلغاء", return: "مرتجع",
};

const FIELD_AR: Record<string, string> = {
  name: "الاسم", name_en: "الاسم بالإنجليزية", trade_name: "الاسم التجاري", vat_number: "الرقم الضريبي", cr_number: "السجل التجاري", city: "المدينة", address: "العنوان",
  phone: "الهاتف", mobile: "الجوال", email: "البريد", currency: "العملة", default_lang: "اللغة", permissions: "الصلاحيات", role: "الدور", role_id: "معرّف الدور", branch_id: "الفرع",
  is_active: "نشط", full_name: "الاسم الكامل", password_reset: "إعادة تعيين كلمة المرور", icon: "الأيقونة", description: "الوصف", autoPrint: "الطباعة التلقائية",
  copies: "عدد النسخ", footer: "تذييل الفاتورة", previewBeforePrint: "المعاينة قبل الطباعة",
};
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "نعم" : "لا") : Array.isArray(v) ? `${v.length} عنصر` : typeof v === "object" ? JSON.stringify(v) : String(v));
/** قراءة قبل/بعد المنظّمة (JSON) إن وُجدت — وإلا null (سجلات قديمة نصية) */
function parseDiff(r: LogRow): { old: Record<string, unknown>; neu: Record<string, unknown> } | null {
  try {
    const o = r.old_value ? JSON.parse(r.old_value) : {}; const n = r.new_value ? JSON.parse(r.new_value) : null;
    return n && typeof n === "object" && !Array.isArray(n) && typeof o === "object" ? { old: o, neu: n } : null;
  } catch { return null; }
}

function fmt(d: string) {
  try { return new Date(d).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return d; }
}

export default function AuditLogPage() {
  const [items, setItems] = useState<LogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const [entities, setEntities] = useState<string[]>([]);
  const [entity, setEntity] = useState("");
  const [q, setQ] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<LogRow | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    api<string[]>("/settings/audit-log/entities").then(setEntities).catch(() => {});
  }, []);

  function load() {
    setLoading(true); setErr("");
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (entity) params.set("entity", entity);
    if (q) params.set("q", q);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    api<ListResp>(`/settings/audit-log?${params}`)
      .then((r) => { setItems(r.items); setTotal(r.total); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(load, [page]); // eslint-disable-line react-hooks/exhaustive-deps

  function search(e: React.FormEvent) { e.preventDefault(); setPage(1); load(); }

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="سجل المراجعة" description="سجل العمليات الحساسة." />
        <p className="page-desc">كل العمليات الحساسة المسجَّلة تلقائياً — من سجّلها ومتى وماذا تغيّر.</p>
      </div>

      <Card>
        <form onSubmit={search} className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="بحث (بريد/إجراء/تفاصيل)">
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث..." />
          </Field>
          <Field label="النوع">
            <Select value={entity} onChange={(e) => setEntity(e.target.value)}>
              <option value="">الكل</option>
              {entities.map((x) => <option key={x} value={x}>{x}</option>)}
            </Select>
          </Field>
          <Field label="من تاريخ">
            <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </Field>
          <Field label="إلى تاريخ">
            <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button type="submit" className="w-full justify-center">تصفية</Button>
          </div>
        </form>
      </Card>

      <ErrorNote msg={err} />

      <Card className="!p-0">
        {loading ? (
          <div className="p-6 text-center text-t-sm text-text-dim">جارِ التحميل...</div>
        ) : items.length === 0 ? (
          <EmptyState icon="history" title="لا توجد سجلات" description="لا توجد عمليات مطابقة للفلاتر المحددة." />
        ) : (
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full border-collapse text-t-sm">
              <thead>
                <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
                  <th className="px-3 py-2 text-right">الوقت</th>
                  <th className="px-2 py-2 text-right">المستخدم</th>
                  <th className="px-2 py-2 text-right">الإجراء</th>
                  <th className="px-2 py-2 text-right">النوع</th>
                  <th className="px-3 py-2 text-right">التفاصيل</th>
                  <th className="w-16 px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id} className="border-t border-line/70">
                    <td className="whitespace-nowrap px-3 py-1.5 text-text-dim">{fmt(r.created_at)}</td>
                    <td className="px-2 py-1.5">{r.user_email || "—"}</td>
                    <td className="px-2 py-1.5">{ACTION_LABELS[r.action] || r.action}</td>
                    <td className="px-2 py-1.5">{r.entity}</td>
                    <td className="max-w-[320px] truncate px-3 py-1.5 text-text-dim" title={r.new_value || r.reason || ""}>
                      {parseDiff(r) ? `${r.reason || "تعديل"} — ${Object.keys(parseDiff(r)!.neu).length} حقل` : (r.new_value || r.reason || "—")}
                    </td>
                    <td className="px-2 py-1.5"><Button size="xs" variant="ghost" onClick={() => setOpen(r)}>عرض</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={!!open} size="lg" title="تفاصيل العملية" onClose={() => setOpen(null)}>
        {open && (() => {
          const d = parseDiff(open);
          return (
            <div className="space-y-3 text-t-sm">
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                <div><dt className="text-t-xs text-text-dim">من قام بالتعديل</dt><dd className="font-bold">{open.user_email || "—"}</dd></div>
                <div><dt className="text-t-xs text-text-dim">متى</dt><dd className="font-bold">{fmt(open.created_at)}</dd></div>
                <div><dt className="text-t-xs text-text-dim">الإجراء</dt><dd className="font-bold">{ACTION_LABELS[open.action] || open.action}</dd></div>
                <div><dt className="text-t-xs text-text-dim">الوحدة</dt><dd className="font-bold">{open.entity}{open.entity_id ? ` / ${open.entity_id}` : ""}</dd></div>
                {open.reason && <div className="sm:col-span-2"><dt className="text-t-xs text-text-dim">الوصف / السبب</dt><dd className="font-bold">{open.reason}</dd></div>}
              </dl>
              {d ? (
                <div className="overflow-x-auto rounded-lg border border-line">
                  <table className="w-full min-w-[420px] border-collapse">
                    <thead className="bg-ink-3 text-t-xs text-text-dim"><tr><th className="p-2 text-start">الحقل</th><th className="p-2 text-start">القيمة القديمة</th><th className="p-2 text-start">القيمة الجديدة</th></tr></thead>
                    <tbody>{Object.keys(d.neu).map((k) => {
                      const a = d.old[k], b = d.neu[k];
                      const lists = Array.isArray(a) && Array.isArray(b) ? { add: (b as string[]).filter((x) => !(a as string[]).includes(x)), rem: (a as string[]).filter((x) => !(b as string[]).includes(x)) } : null;
                      return (
                        <tr key={k} className="border-t border-line align-top">
                          <td className="p-2 font-bold">{FIELD_AR[k] ?? k}</td>
                          {lists ? <td colSpan={2} className="p-2">
                            {lists.add.length > 0 && <div className="mb-1 flex flex-wrap items-center gap-1"><Badge tone="success">أُضيف</Badge>{lists.add.map((x) => <code key={x} className="rounded bg-ink-3 px-1.5 py-0.5 text-t-xs" dir="ltr">{x}</code>)}</div>}
                            {lists.rem.length > 0 && <div className="flex flex-wrap items-center gap-1"><Badge tone="danger">أُزيل</Badge>{lists.rem.map((x) => <code key={x} className="rounded bg-ink-3 px-1.5 py-0.5 text-t-xs" dir="ltr">{x}</code>)}</div>}
                          </td> : <>
                            <td className="p-2 text-text-dim">{show(a)}</td><td className="p-2 font-bold">{show(b)}</td></>}
                        </tr>);
                    })}</tbody>
                  </table>
                </div>
              ) : <p className="rounded-lg bg-ink-3 p-3 text-text-dim">{open.new_value || "لا توجد تفاصيل إضافية لهذه العملية (سجل بصيغة نصية قديمة)."}</p>}
            </div>);
        })()}
      </Modal>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <MIcon name="chevron_right" className="!text-[16px]" /> السابق
          </Button>
          <span className="text-t-sm font-bold text-text-dim">صفحة {page} من {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            التالي <MIcon name="chevron_left" className="!text-[16px]" />
          </Button>
        </div>
      )}
    </div>
  );
}
