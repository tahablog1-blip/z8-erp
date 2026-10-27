"use client";
// الهيكل والدوام: الأقسام + الوظائف + جداول الدوام (حساب التأخير/الإضافي يتم في الخادم حسب جدول الموظف)
import { useState } from "react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Switch } from "@/components/ui";
import { DAYS_AR, Panel, useFetch } from "./shared";

type Dept = { id: string; name: string; is_active: boolean; employees: number };
type Pos = { id: string; name: string; department_id: string | null; department_name: string | null; is_active: boolean; employees: number };
type Sched = { id: string; name: string; start_time: string; end_time: string; grace_minutes: number; weekly_off: number[]; is_active: boolean; employees: number };

export function OrgPanel({ canManage }: { canManage: boolean }) {
  const deps = useFetch<Dept[]>("/hr/departments");
  const poss = useFetch<Pos[]>("/hr/positions");
  const scheds = useFetch<Sched[]>("/hr/schedules");
  const [dep, setDep] = useState<null | { id?: string; name: string; isActive: boolean }>(null);
  const [pos, setPos] = useState<null | { id?: string; name: string; departmentId: string; isActive: boolean }>(null);
  const [sch, setSch] = useState<null | { id?: string; name: string; startTime: string; endTime: string; graceMinutes: number; weeklyOff: number[]; isActive: boolean }>(null);
  const [err, setErr] = useState("");

  async function save(kind: "departments" | "positions" | "schedules", body: Record<string, unknown> & { id?: string }, close: () => void, reload: () => void) {
    setErr("");
    try {
      const { id, ...rest } = body;
      await api(`/hr/${kind}${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify(rest) });
      close(); reload();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); }
  }

  const depCols: Column<Dept>[] = [
    { key: "name", title: "القسم" },
    { key: "employees", title: "الموظفون", width: "90px", render: (r) => <span className="tnum">{r.employees}</span> },
    { key: "is_active", title: "الحالة", width: "90px", render: (r) => r.is_active ? <Badge tone="success">نشط</Badge> : <Badge>موقوف</Badge> },
    ...(canManage ? [{ key: "a", title: "", width: "80px", render: (r: Dept) => <Button variant="ghost" size="xs" onClick={() => { setErr(""); setDep({ id: r.id, name: r.name, isActive: r.is_active }); }}>تعديل</Button> } satisfies Column<Dept>] : []),
  ];
  const posCols: Column<Pos>[] = [
    { key: "name", title: "المسمى الوظيفي" },
    { key: "department_name", title: "القسم", render: (r) => r.department_name ?? "—" },
    { key: "employees", title: "الموظفون", width: "90px", render: (r) => <span className="tnum">{r.employees}</span> },
    { key: "is_active", title: "الحالة", width: "90px", render: (r) => r.is_active ? <Badge tone="success">نشط</Badge> : <Badge>موقوف</Badge> },
    ...(canManage ? [{ key: "a", title: "", width: "80px", render: (r: Pos) => <Button variant="ghost" size="xs" onClick={() => { setErr(""); setPos({ id: r.id, name: r.name, departmentId: r.department_id ?? "", isActive: r.is_active }); }}>تعديل</Button> } satisfies Column<Pos>] : []),
  ];
  const schCols: Column<Sched>[] = [
    { key: "name", title: "الجدول" },
    { key: "start_time", title: "الدوام", width: "130px", render: (r) => <span className="tnum" dir="ltr">{r.start_time} → {r.end_time}</span> },
    { key: "grace_minutes", title: "السماح", width: "80px", render: (r) => <span className="tnum">{r.grace_minutes} د</span> },
    { key: "weekly_off", title: "العطلة الأسبوعية", render: (r) => r.weekly_off.length ? r.weekly_off.map((d) => DAYS_AR[d]).join("، ") : "—" },
    { key: "employees", title: "الموظفون", width: "90px", render: (r) => <span className="tnum">{r.employees}</span> },
    ...(canManage ? [{ key: "a", title: "", width: "80px", render: (r: Sched) => <Button variant="ghost" size="xs" onClick={() => { setErr(""); setSch({ id: r.id, name: r.name, startTime: r.start_time, endTime: r.end_time, graceMinutes: r.grace_minutes, weeklyOff: r.weekly_off, isActive: r.is_active }); }}>تعديل</Button> } satisfies Column<Sched>] : []),
  ];

  return (
    <div className="space-y-4">
      <Panel title="جداول الدوام" icon="schedule" actions={canManage && <Button size="sm" onClick={() => { setErr(""); setSch({ name: "", startTime: "08:00", endTime: "16:00", graceMinutes: 10, weeklyOff: [5], isActive: true }); }}>+ جدول</Button>}>
        <p className="mb-2 text-t-xs text-text-dim">يُحسب التأخير والخروج المبكر والإضافي وساعات العمل في الخادم من جدول كل موظف (بتوقيت الرياض). الإضافي للعرض والمتابعة ولا يدخل المسير تلقائياً.</p>
        <DataTable columns={schCols} rows={scheds.data ?? []} loading={scheds.loading} emptyText="لا توجد جداول دوام — أنشئ جدولاً ثم اربطه بالموظفين من شاشة تعديل الموظف" />
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="الأقسام" icon="account_tree" actions={canManage && <Button size="sm" onClick={() => { setErr(""); setDep({ name: "", isActive: true }); }}>+ قسم</Button>}>
          <DataTable columns={depCols} rows={deps.data ?? []} loading={deps.loading} emptyText="لا توجد أقسام" />
        </Panel>
        <Panel title="الوظائف" icon="badge" actions={canManage && <Button size="sm" onClick={() => { setErr(""); setPos({ name: "", departmentId: "", isActive: true }); }}>+ وظيفة</Button>}>
          <DataTable columns={posCols} rows={poss.data ?? []} loading={poss.loading} emptyText="لا توجد وظائف" />
        </Panel>
      </div>

      <Modal open={!!dep} title={dep?.id ? "تعديل قسم" : "قسم جديد"} onClose={() => setDep(null)}>
        {dep && <div className="space-y-3">
          <Field label="اسم القسم"><Input value={dep.name} autoFocus onChange={(e) => setDep({ ...dep, name: e.target.value })} /></Field>
          {dep.id && <label className="flex items-center gap-2 text-t-sm font-bold text-text-dim"><Switch checked={dep.isActive} onChange={(v) => setDep({ ...dep, isActive: v })} />قسم نشط</label>}
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setDep(null)}>إلغاء</Button>
            <Button disabled={dep.name.trim().length < 2} onClick={() => save("departments", dep, () => setDep(null), deps.reload)}>حفظ</Button></div>
        </div>}
      </Modal>
      <Modal open={!!pos} title={pos?.id ? "تعديل وظيفة" : "وظيفة جديدة"} onClose={() => setPos(null)}>
        {pos && <div className="space-y-3">
          <Field label="المسمى الوظيفي"><Input value={pos.name} autoFocus onChange={(e) => setPos({ ...pos, name: e.target.value })} /></Field>
          <Field label="القسم"><Select value={pos.departmentId} onChange={(e) => setPos({ ...pos, departmentId: e.target.value })}>
            <option value="">— بدون قسم —</option>{(deps.data ?? []).filter((d) => d.is_active).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
          {pos.id && <label className="flex items-center gap-2 text-t-sm font-bold text-text-dim"><Switch checked={pos.isActive} onChange={(v) => setPos({ ...pos, isActive: v })} />وظيفة نشطة</label>}
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPos(null)}>إلغاء</Button>
            <Button disabled={pos.name.trim().length < 2} onClick={() => save("positions", { ...pos, departmentId: pos.departmentId || null }, () => setPos(null), poss.reload)}>حفظ</Button></div>
        </div>}
      </Modal>
      <Modal open={!!sch} title={sch?.id ? "تعديل جدول دوام" : "جدول دوام جديد"} onClose={() => setSch(null)}>
        {sch && <div className="space-y-3">
          <Field label="اسم الجدول"><Input value={sch.name} autoFocus placeholder="مثال: صباحي" onChange={(e) => setSch({ ...sch, name: e.target.value })} /></Field>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="بداية الدوام"><Input type="time" dir="ltr" value={sch.startTime} onChange={(e) => setSch({ ...sch, startTime: e.target.value })} /></Field>
            <Field label="نهاية الدوام" hint="أصغر من البداية = دوام ليلي يمتد لليوم التالي"><Input type="time" dir="ltr" value={sch.endTime} onChange={(e) => setSch({ ...sch, endTime: e.target.value })} /></Field>
            <Field label="سماح التأخير (دقيقة)"><Input type="number" min={0} max={240} className="tnum" value={sch.graceMinutes} onChange={(e) => setSch({ ...sch, graceMinutes: +e.target.value || 0 })} /></Field>
          </div>
          <Field label="العطلة الأسبوعية">
            <div className="flex flex-wrap gap-1.5">
              {DAYS_AR.map((d, i) => {
                const on = sch.weeklyOff.includes(i);
                return <button key={d} type="button" aria-pressed={on}
                  onClick={() => setSch({ ...sch, weeklyOff: on ? sch.weeklyOff.filter((x) => x !== i) : [...sch.weeklyOff, i] })}
                  className={`rounded-full border px-3 py-1 text-t-xs font-bold ${on ? "border-petrol bg-petrol-soft text-petrol" : "border-line text-text-dim"}`}>{d}</button>;
              })}
            </div>
          </Field>
          {sch.id && <label className="flex items-center gap-2 text-t-sm font-bold text-text-dim"><Switch checked={sch.isActive} onChange={(v) => setSch({ ...sch, isActive: v })} />جدول نشط</label>}
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setSch(null)}>إلغاء</Button>
            <Button disabled={sch.name.trim().length < 2} onClick={() => save("schedules", sch, () => setSch(null), scheds.reload)}>حفظ</Button></div>
        </div>}
      </Modal>
    </div>
  );
}
