"use client";
// الإعدادات ← سجل المراجعة — عرض/تصفية audit_log (كان يُكتب فعلياً من كل الموديولات
// بلا أي شاشة لعرضه؛ هنا أول واجهة له: فلاتر + جدول + صفحات)
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Select } from "@/components/ui";
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
        <h1 className="text-[19px] font-extrabold">سجل المراجعة</h1>
        <p className="mt-0.5 text-[12.5px] text-text-dim">كل العمليات الحساسة المسجَّلة تلقائياً — من سجّلها ومتى وماذا تغيّر.</p>
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
          <div className="p-6 text-center text-[12.5px] text-text-dim">جارِ التحميل...</div>
        ) : items.length === 0 ? (
          <EmptyState icon="history" title="لا توجد سجلات" description="لا توجد عمليات مطابقة للفلاتر المحددة." />
        ) : (
          <div className="overflow-x-auto rounded-lg">
            <table className="w-full border-collapse text-[12px]">
              <thead>
                <tr className="bg-ink-3 text-[11px] font-extrabold text-text-dim">
                  <th className="px-3 py-2 text-right">الوقت</th>
                  <th className="px-2 py-2 text-right">المستخدم</th>
                  <th className="px-2 py-2 text-right">الإجراء</th>
                  <th className="px-2 py-2 text-right">النوع</th>
                  <th className="px-3 py-2 text-right">التفاصيل</th>
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
                      {r.new_value || r.reason || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            <MIcon name="chevron_right" className="!text-[16px]" /> السابق
          </Button>
          <span className="text-[12px] font-bold text-text-dim">صفحة {page} من {totalPages}</span>
          <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            التالي <MIcon name="chevron_left" className="!text-[16px]" />
          </Button>
        </div>
      )}
    </div>
  );
}
