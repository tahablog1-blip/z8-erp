"use client";
// إعدادات الموارد البشرية: قواعد نهاية الخدمة والإجازة ونسب/وعاء التأمينات + أنواع الإجازات.
// لا نسب ثابتة في الواجهة: كلها من إعدادات الشركة في الخادم، وكل تعديل يُسجَّل في سجل التدقيق.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, ErrorNote, Field, Input, Modal, Select, Switch } from "@/components/ui";
import { Panel, fmtN, useFetch } from "./shared";

type Settings = {
  eos_first_years_months: number; eos_after_months: number; eos_threshold_years: number;
  leave_days_before: number; leave_days_after: number; leave_threshold_years: number; gosi_basis: "basic" | "basic_allowances";
  gosi_saudi_employee_pct: number; gosi_saudi_employer_pct: number; gosi_nonsaudi_employer_pct: number;
};
type LeaveTypeRow = { id: string; code: string; name: string; annual_days: number | null; is_paid: boolean; is_active: boolean };

export function HrSettingsPanel({ canManage, canEditRules }: { canManage: boolean; canEditRules: boolean }) {
  const st = useFetch<Settings>("/hr/settings");
  const lt = useFetch<LeaveTypeRow[]>("/hr/leave-types");
  const [f, setF] = useState<Settings | null>(null);
  const [err, setErr] = useState(""); const [ok, setOk] = useState(false);
  const [m, setM] = useState<null | { id?: string; code: string; name: string; annualDays: string; isPaid: boolean; isActive: boolean }>(null);
  useEffect(() => { if (st.data) setF(st.data); }, [st.data]);

  async function saveRules() {
    if (!f) return;
    setErr(""); setOk(false);
    try {
      await api("/hr/settings", { method: "PUT", body: JSON.stringify({
        eosFirstYearsMonths: f.eos_first_years_months, eosAfterMonths: f.eos_after_months, eosThresholdYears: f.eos_threshold_years,
        leaveDaysBefore: f.leave_days_before, leaveDaysAfter: f.leave_days_after, leaveThresholdYears: f.leave_threshold_years,
        gosiSaudiEmployeePct: f.gosi_saudi_employee_pct, gosiSaudiEmployerPct: f.gosi_saudi_employer_pct,
        gosiNonsaudiEmployerPct: f.gosi_nonsaudi_employer_pct, gosiBasis: f.gosi_basis }) });
      setOk(true); st.reload();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); }
  }
  async function saveType() {
    if (!m) return;
    setErr("");
    try {
      const { id, ...b } = m;
      await api(`/hr/leave-types${id ? `/${id}` : ""}`, { method: id ? "PUT" : "POST", body: JSON.stringify({ code: b.code || undefined, name: b.name, annualDays: b.annualDays === "" ? null : +b.annualDays, isPaid: b.isPaid, isActive: b.isActive }) });
      setM(null); lt.reload();
    } catch (e: unknown) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); }
  }

  const num = (k: keyof Settings, label: string, hint?: string, step = "0.01") => f && (
    <Field label={label} hint={hint}>
      <Input type="number" step={step} min={0} className="tnum" disabled={!canEditRules} value={f[k] as number}
             onChange={(e) => { setOk(false); setF({ ...f, [k]: e.target.value === "" ? 0 : +e.target.value }); }} />
    </Field>
  );

  const cols: Column<LeaveTypeRow>[] = [
    { key: "name", title: "نوع الإجازة" },
    { key: "code", title: "الرمز", width: "110px", render: (r) => <span dir="ltr" className="tnum">{r.code}</span> },
    { key: "annual_days", title: "الحصة السنوية", width: "110px", render: (r) => r.annual_days == null ? "بلا حد" : fmtN(r.annual_days) },
    { key: "is_paid", title: "الأجر", width: "90px", render: (r) => r.is_paid ? <Badge tone="success">مدفوعة</Badge> : <Badge>بدون أجر</Badge> },
    { key: "is_active", title: "الحالة", width: "90px", render: (r) => r.is_active ? <Badge tone="success">نشط</Badge> : <Badge>موقوف</Badge> },
    ...(canManage ? [{ key: "a", title: "", width: "80px", render: (r: LeaveTypeRow) => <Button variant="ghost" size="xs" onClick={() => { setErr(""); setM({ id: r.id, code: r.code, name: r.name, annualDays: r.annual_days == null ? "" : String(r.annual_days), isPaid: r.is_paid, isActive: r.is_active }); }}>تعديل</Button> } satisfies Column<LeaveTypeRow>] : []),
  ];

  return (
    <div className="space-y-4">
      <Panel title="قواعد الإجازة ونهاية الخدمة والتأمينات" icon="gavel">
        <div className="mb-3 rounded-lg border border-brass/30 bg-brass-bg px-3 py-2 text-t-xs font-bold text-brass">
          هذه القيم تُطبَّق على المسيرات وأرصدة الإجازات القادمة. القيم الافتراضية تطابق السلوك السابق للنظام — راجع نسب التأمينات ومكافأة نهاية الخدمة مع محاسبك/مستشارك القانوني قبل أي تغيير. {!canEditRules && "التعديل يحتاج صلاحية الرواتب."}
        </div>
        {!f ? <p className="text-t-sm text-text-dim">جارٍ التحميل…</p> : (
          <div className="space-y-4">
            <div><h3 className="mb-2 text-t-sm font-black">الإجازة السنوية</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {num("leave_days_before", "أيام الإجازة قبل الحد الفاصل", undefined, "1")}
                {num("leave_days_after", "أيام الإجازة بعد الحد الفاصل", undefined, "1")}
                {num("leave_threshold_years", "الحد الفاصل (سنوات الخدمة)")}
              </div></div>
            <div><h3 className="mb-2 text-t-sm font-black">مكافأة نهاية الخدمة (تقدير)</h3>
              <div className="grid gap-2 sm:grid-cols-3">
                {num("eos_first_years_months", "أشهر الراتب لكل سنة قبل الحد الفاصل")}
                {num("eos_after_months", "أشهر الراتب لكل سنة بعد الحد الفاصل")}
                {num("eos_threshold_years", "الحد الفاصل (سنوات)")}
              </div></div>
            <div><h3 className="mb-2 text-t-sm font-black">التأمينات الاجتماعية</h3>
              <div className="grid gap-2 sm:grid-cols-4">
                {num("gosi_saudi_employee_pct", "حصة الموظف السعودي %")}
                {num("gosi_saudi_employer_pct", "حصة المنشأة عن السعودي %")}
                {num("gosi_nonsaudi_employer_pct", "حصة المنشأة عن غير السعودي %")}
                <Field label="وعاء الاحتساب"><Select disabled={!canEditRules} value={f.gosi_basis} onChange={(e) => { setOk(false); setF({ ...f, gosi_basis: e.target.value as Settings["gosi_basis"] }); }}>
                  <option value="basic">الراتب الأساسي فقط</option><option value="basic_allowances">الأساسي + البدلات</option></Select></Field>
              </div></div>
            <ErrorNote msg={err} />
            {ok && <p className="text-t-sm font-bold text-emerald">تم الحفظ وسُجّل التغيير في سجل التدقيق.</p>}
            {canEditRules && <div className="flex justify-end"><Button onClick={saveRules}>حفظ القواعد</Button></div>}
          </div>
        )}
      </Panel>

      <Panel title="أنواع الإجازات" icon="beach_access" actions={canManage && <Button size="sm" onClick={() => { setErr(""); setM({ code: "", name: "", annualDays: "", isPaid: true, isActive: true }); }}>+ نوع إجازة</Button>}>
        <p className="mb-2 text-t-xs text-text-dim">الأنواع الأساسية (سنوية، مرضية، بدون راتب، أخرى) موجودة دائماً. أضف هنا أنواعاً خاصة بشركتك (حج، زواج، وفاة...) وحصتها السنوية إن وُجدت.</p>
        <DataTable columns={cols} rows={lt.data ?? []} loading={lt.loading} emptyText="لا توجد أنواع إضافية" />
      </Panel>

      <Modal open={!!m} title={m?.id ? "تعديل نوع إجازة" : "نوع إجازة جديد"} onClose={() => setM(null)}>
        {m && <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الاسم"><Input value={m.name} autoFocus onChange={(e) => setM({ ...m, name: e.target.value })} /></Field>
            <Field label="الرمز (إنجليزي)" hint="لا يتغيّر بعد الإنشاء"><Input dir="ltr" disabled={!!m.id} value={m.code} onChange={(e) => setM({ ...m, code: e.target.value })} /></Field>
            <Field label="الحصة السنوية (أيام)" hint="فارغ = بلا حد"><Input type="number" min={0} max={365} className="tnum" value={m.annualDays} onChange={(e) => setM({ ...m, annualDays: e.target.value })} /></Field>
          </div>
          <label className="flex items-center gap-2 text-t-sm font-bold text-text-dim"><Switch checked={m.isPaid} onChange={(v) => setM({ ...m, isPaid: v })} />إجازة مدفوعة الأجر</label>
          {m.id && <label className="flex items-center gap-2 text-t-sm font-bold text-text-dim"><Switch checked={m.isActive} onChange={(v) => setM({ ...m, isActive: v })} />نوع نشط</label>}
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setM(null)}>إلغاء</Button><Button disabled={m.name.trim().length < 2 || (!m.id && !m.code.trim())} onClick={saveType}>حفظ</Button></div>
        </div>}
      </Modal>
    </div>
  );
}
