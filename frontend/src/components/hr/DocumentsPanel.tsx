"use client";
// مستندات الموظفين وتواريخ انتهائها (إقامة، رخصة، شهادة...) — التنبيه داخل النظام فقط (لا رسائل خارجية)
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { Employee } from "@/modules/hr/types";
import { DOC_TYPES, Panel, fmtD, useFetch } from "./shared";

type Doc = { id: string; employee_id: string; employee_name: string; doc_type: string; doc_number: string | null; issue_date: string | null; expiry_date: string | null; days_remaining: number | null; notes: string | null };
const FILTERS = [["", "الكل"], ["0", "منتهية"], ["30", "تنتهي خلال 30 يوماً"], ["60", "خلال 60 يوماً"]] as const;

export function DocumentsPanel({ canManage, employees }: { canManage: boolean; employees: Employee[] }) {
  const [f, setF] = useState("");
  const { data, loading, error, reload } = useFetch<Doc[]>(`/hr/documents${f ? `?expiringDays=${f}` : ""}`);
  const [m, setM] = useState<null | { id?: string; employeeId: string; docType: string; docNumber: string; issueDate: string; expiryDate: string; notes: string }>(null);
  const [err, setErr] = useState("");

  const cols: Column<Doc>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "doc_type", title: "المستند" },
    { key: "doc_number", title: "الرقم", width: "120px", render: (d) => <span className="tnum">{d.doc_number ?? "—"}</span> },
    { key: "issue_date", title: "الإصدار", width: "100px", render: (d) => fmtD(d.issue_date) },
    { key: "expiry_date", title: "الانتهاء", width: "100px", render: (d) => fmtD(d.expiry_date) },
    { key: "days_remaining", title: "المتبقي", width: "110px", render: (d) => d.days_remaining == null ? "—" :
      <Badge tone={d.days_remaining < 0 ? "danger" : d.days_remaining <= 30 ? "warning" : "neutral"}>{d.days_remaining < 0 ? `منتهٍ منذ ${-d.days_remaining}` : `${d.days_remaining} يوم`}</Badge> },
    ...(canManage ? [{ key: "a", title: "", width: "80px", render: (d: Doc) => <Button variant="ghost" size="xs" onClick={() => { setErr(""); setM({ id: d.id, employeeId: d.employee_id, docType: d.doc_type, docNumber: d.doc_number ?? "", issueDate: d.issue_date ?? "", expiryDate: d.expiry_date ?? "", notes: d.notes ?? "" }); }}>تعديل</Button> } satisfies Column<Doc>] : []),
  ];

  async function save() {
    if (!m) return;
    setErr("");
    try {
      const { id, ...b } = m;
      await api(`/hr/documents${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify({ ...b, docNumber: b.docNumber || null, issueDate: b.issueDate || null, expiryDate: b.expiryDate || null, notes: b.notes || null }) });
      setM(null); reload();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); }
  }

  return (
    <Panel title="مستندات الموظفين" icon="folder_managed" actions={canManage && <Button size="sm" onClick={() => { setErr(""); setM({ employeeId: employees.find((e) => e.is_active)?.id ?? "", docType: DOC_TYPES[0], docNumber: "", issueDate: "", expiryDate: "", notes: "" }); }}>+ مستند</Button>}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}
          className={`rounded-full border px-3 py-1 text-t-xs font-bold ${f === k ? "border-petrol bg-petrol-soft text-petrol" : "border-line text-text-dim"}`}>{l}</button>)}
      </div>
      <ErrorNote msg={error} />
      <DataTable columns={cols} rows={data ?? []} loading={loading} searchKeys={["employee_name", "doc_type"]} searchPlaceholder="بحث بالموظف أو نوع المستند..." emptyText="لا توجد مستندات" />
      <p className="mt-2 text-t-xs text-text-dim">إقامة الموظف المسجّلة في ملفه تظهر تلقائياً في تنبيهات الانتهاء أعلى الصفحة وفي لوحة الموارد البشرية.</p>
      <Modal open={!!m} title={m?.id ? "تعديل مستند" : "مستند جديد"} onClose={() => setM(null)}>
        {m && <div className="space-y-3">
          <Field label="الموظف"><Select value={m.employeeId} disabled={!!m.id} onChange={(e) => setM({ ...m, employeeId: e.target.value })}>
            {employees.filter((e) => e.is_active || e.id === m.employeeId).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="نوع المستند"><Input list="hr-doc-types" value={m.docType} onChange={(e) => setM({ ...m, docType: e.target.value })} />
              <datalist id="hr-doc-types">{DOC_TYPES.map((t) => <option key={t} value={t} />)}</datalist></Field>
            <Field label="رقم المستند"><Input className="tnum" value={m.docNumber} onChange={(e) => setM({ ...m, docNumber: e.target.value })} /></Field>
            <Field label="تاريخ الإصدار"><Input type="date" value={m.issueDate} onChange={(e) => setM({ ...m, issueDate: e.target.value })} /></Field>
            <Field label="تاريخ الانتهاء"><Input type="date" value={m.expiryDate} onChange={(e) => setM({ ...m, expiryDate: e.target.value })} /></Field>
          </div>
          <Field label="ملاحظات"><Textarea value={m.notes} onChange={(e) => setM({ ...m, notes: e.target.value })} /></Field>
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setM(null)}>إلغاء</Button><Button disabled={!m.employeeId || !m.docType.trim()} onClick={save}>حفظ</Button></div>
        </div>}
      </Modal>
    </Panel>
  );
}
