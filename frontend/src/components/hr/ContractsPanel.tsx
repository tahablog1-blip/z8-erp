"use client";
// العقود: سجل كامل بلا حذف — تجديد عقد يُنهي السابق تلقائياً ويحفظ التاريخ. الراتب في العقد لا يظهر إلا لمن يملك hr.salary.view.
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Textarea } from "@/components/ui";
import { appConfirm } from "@/components/dialog";
import { CONTRACT_LABELS, Employee } from "@/modules/hr/types";
import { Hidden, Panel, fmtD, fmtM, useFetch } from "./shared";

type Contract = { id: string; employee_id: string; employee_name: string; contract_type: Employee["contract_type"]; start_date: string; end_date: string | null;
                  basic_salary: number | null; status: "active" | "ended"; days_remaining: number | null; notes: string | null };

const FILTERS = [["", "الكل"], ["30", "تنتهي خلال 30 يوماً"], ["60", "خلال 60 يوماً"], ["90", "خلال 90 يوماً"]] as const;

export function ContractsPanel({ canManage, employees }: { canManage: boolean; employees: Employee[] }) {
  const [f, setF] = useState("");
  const { data, loading, error, reload } = useFetch<Contract[]>(`/hr/contracts${f ? `?expiringDays=${f}` : ""}`);
  const [m, setM] = useState<null | { employeeId: string; contractType: string; startDate: string; endDate: string; basicSalary: number; notes: string }>(null);
  const [err, setErr] = useState("");

  const cols: Column<Contract>[] = [
    { key: "employee_name", title: "الموظف" },
    { key: "contract_type", title: "نوع العقد", width: "110px", render: (c) => CONTRACT_LABELS[c.contract_type] ?? c.contract_type },
    { key: "start_date", title: "البداية", width: "100px", render: (c) => fmtD(c.start_date) },
    { key: "end_date", title: "النهاية", width: "100px", render: (c) => c.end_date ? fmtD(c.end_date) : "مفتوح" },
    { key: "days_remaining", title: "المتبقي", width: "100px", render: (c) => c.status !== "active" || c.days_remaining == null ? "—" :
      <Badge tone={c.days_remaining < 0 ? "danger" : c.days_remaining <= 30 ? "warning" : "neutral"}>{c.days_remaining < 0 ? `منتهٍ منذ ${-c.days_remaining}` : `${c.days_remaining} يوم`}</Badge> },
    { key: "basic_salary", title: "الراتب", width: "110px", render: (c) => <Hidden v={c.basic_salary} f={fmtM} /> },
    { key: "status", title: "الحالة", width: "90px", render: (c) => c.status === "active" ? <Badge tone="success">ساري</Badge> : <Badge>منتهٍ</Badge> },
    ...(canManage ? [{ key: "a", title: "", width: "90px", render: (c: Contract) => c.status === "active" ?
      <Button variant="danger" size="xs" onClick={async () => { if (await appConfirm(`إنهاء عقد «${c.employee_name}»؟`)) { await api(`/hr/contracts/${c.id}/end`, { method: "POST", body: JSON.stringify({}) }); reload(); } }}>إنهاء</Button> : null } satisfies Column<Contract>] : []),
  ];

  async function save() {
    if (!m) return;
    setErr("");
    try {
      await api("/hr/contracts", { method: "POST", body: JSON.stringify({ ...m, endDate: m.endDate || null, basicSalary: m.basicSalary || null, notes: m.notes || null }) });
      setM(null); reload();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); }
  }

  return (
    <Panel title="العقود" icon="contract" actions={canManage && <Button size="sm" onClick={() => { setErr(""); setM({ employeeId: employees.find((e) => e.is_active)?.id ?? "", contractType: "full_time", startDate: new Date().toISOString().slice(0, 10), endDate: "", basicSalary: 0, notes: "" }); }}>+ عقد / تجديد</Button>}>
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, l]) => <button key={k} type="button" aria-pressed={f === k} onClick={() => setF(k)}
          className={`rounded-none border px-3 py-1 text-t-xs font-bold ${f === k ? "border-petrol bg-petrol-soft text-petrol" : "border-line text-text-dim"}`}>{l}</button>)}
      </div>
      <ErrorNote msg={error} />
      <DataTable columns={cols} rows={data ?? []} loading={loading} searchKeys={["employee_name"]} searchPlaceholder="بحث بالموظف..." emptyText="لا توجد عقود" />
      <Modal open={!!m} title="عقد جديد / تجديد" onClose={() => setM(null)}>
        {m && <div className="space-y-3">
          <p className="rounded-lg bg-ink-3 p-2.5 text-t-xs text-text-dim">إنشاء عقد جديد لموظف له عقد ساري يُنهي العقد السابق تلقائياً ويحفظه في السجل.</p>
          <Field label="الموظف"><Select value={m.employeeId} onChange={(e) => setM({ ...m, employeeId: e.target.value })}>
            {employees.filter((e) => e.is_active).map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}</Select></Field>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="نوع العقد"><Select value={m.contractType} onChange={(e) => setM({ ...m, contractType: e.target.value })}>
              {Object.entries(CONTRACT_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="بداية العقد"><Input type="date" value={m.startDate} onChange={(e) => setM({ ...m, startDate: e.target.value })} /></Field>
            <Field label="نهاية العقد" hint="فارغ = مفتوح المدة"><Input type="date" value={m.endDate} onChange={(e) => setM({ ...m, endDate: e.target.value })} /></Field>
          </div>
          <Field label="الراتب الأساسي في العقد" hint="للسجل فقط — لا يغيّر راتب الموظف الفعلي ولا المسير"><Input type="number" min={0} step="0.01" className="tnum" value={m.basicSalary} onChange={(e) => setM({ ...m, basicSalary: +e.target.value || 0 })} /></Field>
          <Field label="ملاحظات"><Textarea value={m.notes} onChange={(e) => setM({ ...m, notes: e.target.value })} /></Field>
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setM(null)}>إلغاء</Button><Button disabled={!m.employeeId || !m.startDate} onClick={save}>حفظ</Button></div>
        </div>}
      </Modal>
    </Panel>
  );
}
