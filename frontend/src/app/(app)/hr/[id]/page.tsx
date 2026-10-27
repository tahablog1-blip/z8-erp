"use client";
// ملف الموظف 360° — كل ما يخص الموظف في مكان واحد. الخادم يحجب الراتب/الهوية/الآيبان حسب الصلاحيات (hr.salary.view / hr.identity.view).
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, EmptyState, ErrorNote, PageHeader, Tabs } from "@/components/ui";
import { LoadingScreen } from "@/components/LoadingScreen";
import { Avatar, DayStatus, EVENT_LABELS, Hidden, Panel, Stat, fmtD, fmtDT, fmtM, fmtMin, fmtN, MONTHS_AR, useFetch } from "@/components/hr/shared";
import { CONTRACT_LABELS, CUSTODY_STATUS_LABELS, Employee, LEAVE_TYPE_LABELS } from "@/modules/hr/types";

type Row = Record<string, any>;
type Data = {
  employee: Employee & { manager_name?: string | null; schedule_name?: string | null; schedule_start?: string | null; schedule_end?: string | null; service_years: number };
  contracts: Row[]; documents: Row[];
  attendance: { summary: { days: number; late: number; earlyLeave: number; workedMinutes: number; overtimeMinutes: number; lateMinutes: number }; rows: Row[] };
  leave: { balance: { annualEntitlement: number; used: number; remaining: number; note: string; byType?: Row[] }; requests: Row[] };
  advances: { available: boolean; count: number; total: number | null; balance: number | null; items: Row[] };
  violations: Row[]; custody: Row[]; payslips: Row[]; history: Row[];
};
type Tab = "basic" | "job" | "contract" | "salary" | "attendance" | "leave" | "advances" | "violations" | "documents" | "custody" | "history";
const TABS: { key: Tab; label: string }[] = [
  { key: "basic", label: "البيانات الأساسية" }, { key: "job", label: "الوظيفة" }, { key: "contract", label: "العقد" }, { key: "salary", label: "الراتب" },
  { key: "attendance", label: "الحضور" }, { key: "leave", label: "الإجازات" }, { key: "advances", label: "السلف" }, { key: "violations", label: "الخصومات" },
  { key: "documents", label: "المستندات" }, { key: "custody", label: "العهد" }, { key: "history", label: "سجل الموظف" },
];

const KV = ({ items }: { items: [string, React.ReactNode][] }) => (
  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
    {items.map(([k, v]) => <div key={k} className="min-w-0"><dt className="text-t-xs font-bold text-text-dim">{k}</dt><dd className="mt-0.5 break-words text-t-md font-bold">{v ?? "—"}</dd></div>)}
  </dl>
);
const Table = ({ head, rows, empty }: { head: string[]; rows: React.ReactNode[][]; empty: string }) => !rows.length ? <EmptyState icon="inbox" title={empty} /> : (
  <div className="overflow-x-auto rounded-lg border border-line">
    <table className="w-full min-w-[520px] text-t-sm">
      <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{head.map((h) => <th key={h} className="p-2.5 text-start font-bold">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="p-2.5">{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

export default function Employee360() {
  const { id } = useParams<{ id: string }>();
  const { data: d, loading, error, reload } = useFetch<Data>(`/hr/employees/${id}/360`);
  const [tab, setTab] = useState<Tab>("basic");
  useEffect(() => {   // رابط مباشر لتبويب معيّن: /hr/{id}?tab=attendance
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    if (t && TABS.some((x) => x.key === t)) setTab(t);
  }, []);
  if (loading && !d) return <LoadingScreen />;
  if (error || !d) return <div className="space-y-3"><ErrorNote msg={error || "تعذر تحميل ملف الموظف"} /><div className="flex gap-2"><Button variant="ghost" onClick={reload}>إعادة المحاولة</Button><Link href="/hr" className="inline-flex"><Button variant="ghost">عودة للموظفين</Button></Link></div></div>;

  const e = d.employee, s = d.attendance.summary;
  const gender = e.gender === "male" ? "ذكر" : e.gender === "female" ? "أنثى" : "—";
  return (
    <div className="space-y-4">
      <PageHeader
        title={<span className="flex items-center gap-3"><Avatar name={e.full_name} size={44} />{e.full_name}</span>}
        description={<span className="flex flex-wrap items-center gap-2">{e.position_name ?? e.job_title ?? "—"} · {e.branch_name ?? "بدون فرع"}
          {e.is_active ? <Badge tone="success">على رأس العمل</Badge> : <Badge>منتهي الخدمة</Badge>}
          <Badge tone={e.is_saudi ? "info" : "neutral"}>{e.is_saudi ? "سعودي" : "غير سعودي"}</Badge></span>}
        actions={<Link href="/hr"><Button variant="ghost">← الموظفون</Button></Link>} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat icon="work_history" label="مدة الخدمة" value={`${e.service_years} سنة`} tone="petrol" />
        <Stat icon="beach_access" label="رصيد الإجازة المتبقي" value={fmtN(d.leave.balance.remaining)} tone="info" sub={`من ${fmtN(d.leave.balance.annualEntitlement)} يوماً`} />
        <Stat icon="schedule" label="تأخير آخر 30 يوماً" value={fmtN(s.late)} tone="brass" sub={`${fmtMin(s.lateMinutes)} ساعة`} />
        <Stat icon="account_balance_wallet" label="سلف قائمة" value={d.advances.balance == null ? "••••" : fmtM(d.advances.balance)} tone="ember" sub={`${fmtN(d.advances.count)} سلفة`} />
      </div>

      <section className="rounded-card border border-line bg-ink-2 shadow-card">
        <div className="px-5 pt-3"><Tabs value={tab} onChange={setTab} items={TABS} /></div>
        <div className="p-5">
          {tab === "basic" && <KV items={[["الاسم", e.full_name], ["الجنس", gender], ["تاريخ الميلاد", fmtD(e.birth_date)], ["الجنسية", e.nationality],
            ["رقم الهوية / الإقامة", <span key="i" className="tnum" dir="ltr">{e.national_id ?? e.iqama_number ?? "—"}</span>], ["انتهاء الإقامة", fmtD(e.iqama_expiry_date)],
            ["الجوال", <span key="p" className="tnum" dir="ltr">{e.phone ?? "—"}</span>], ["البريد الإلكتروني", e.email], ["العنوان", e.address]]} />}
          {tab === "job" && <KV items={[["الفرع", e.branch_name], ["القسم", e.department_name], ["المسمى الوظيفي", e.position_name ?? e.job_title], ["المدير المباشر", e.manager_name],
            ["تاريخ التعيين", fmtD(e.hire_date)], ["نوع العقد", CONTRACT_LABELS[e.contract_type]], ["جدول الدوام", e.schedule_name ? `${e.schedule_name} (${e.schedule_start?.slice(0, 5)}–${e.schedule_end?.slice(0, 5)})` : "غير محدد"],
            ["الحالة", e.is_active ? "على رأس العمل" : `منتهي الخدمة ${fmtD(e.termination_date)}`],
            ["التأمينات الاجتماعية", e.gosi_status ? `${e.gosi_status}${e.gosi_number ? " — " + e.gosi_number : ""}` : "غير مسجّل"]]} />}
          {tab === "contract" && <Table empty="لا توجد عقود مسجّلة — يمكن إضافتها من تبويب «العقود» في الموارد البشرية"
            head={["النوع", "البداية", "النهاية", "الراتب", "الحالة"]}
            rows={d.contracts.map((c) => [CONTRACT_LABELS[c.contract_type as Employee["contract_type"]] ?? c.contract_type, fmtD(c.start_date), c.end_date ? fmtD(c.end_date) : "مفتوح", <Hidden key="s" v={c.basic_salary} f={fmtM} />, c.status === "active" ? <Badge key="b" tone="success">ساري</Badge> : <Badge key="b">منتهٍ</Badge>])} />}
          {tab === "salary" && (e.basic_salary == null ? <EmptyState icon="lock" title="الراتب محجوب" description="لا تملك صلاحية عرض الرواتب (hr.salary.view)." /> : (
            <div className="space-y-4">
              <KV items={[["الراتب الأساسي", <span key="a" className="tnum" dir="ltr">{fmtM(e.basic_salary)}</span>], ["بدل السكن", fmtM(e.housing_allowance ?? 0)], ["بدل النقل", fmtM(e.transport_allowance ?? 0)],
                ["بدلات أخرى", fmtM(e.other_allowance ?? 0)], ["إجمالي البدلات", fmtM(e.allowances ?? 0)], ["الآيبان", <span key="ib" className="tnum" dir="ltr">{e.iban ?? "—"}</span>]]} />
              <h3 className="text-t-md font-black">آخر القسائم</h3>
              <Table empty="لا توجد قسائم رواتب بعد" head={["الشهر", "الأساسي", "البدلات", "العمولة", "خصم مخالفات", "سلف", "تأمينات", "الصافي", "الحالة"]}
                rows={d.payslips.map((p) => [`${MONTHS_AR[p.period_month - 1]} ${p.period_year}`, fmtM(p.basic_salary), fmtM(p.allowances), fmtM(p.commission_amount), fmtM(p.violations_deduction), fmtM(p.advance_deduction), fmtM(p.gosi_employee), <b key="n">{fmtM(p.net_pay)}</b>, p.status === "paid" ? "مدفوع" : p.status === "finalized" ? "معتمد" : "مسودة"])} />
            </div>))}
          {tab === "attendance" && (
            <div className="space-y-3">
              <p className="text-t-sm text-text-dim">آخر 30 يوماً — {fmtN(s.days)} يوم مسجّل · ساعات العمل {fmtMin(s.workedMinutes)} · إضافي {fmtMin(s.overtimeMinutes)} · تأخير {fmtMin(s.lateMinutes)}</p>
              <Table empty="لا توجد سجلات حضور" head={["التاريخ", "الحضور", "الانصراف", "ساعات العمل", "التأخير", "الإضافي", "الحالة"]}
                rows={d.attendance.rows.map((a) => [fmtD(a.work_date), a.check_in ? fmtDT(a.check_in) : "—", a.check_out ? fmtDT(a.check_out) : "—", fmtMin(a.worked_minutes), a.late_minutes ? `${a.late_minutes} د` : "—", a.overtime_minutes ? fmtMin(a.overtime_minutes) : "—", <DayStatus key="s" s={a.day_status} />])} />
            </div>)}
          {tab === "leave" && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {(d.leave.balance.byType ?? []).map((t) => <div key={t.code} className="rounded-lg bg-ink-3 p-3"><div className="text-t-xs font-bold text-text-dim">{t.name}</div>
                  <div className="tnum text-t-lg font-black">{fmtN(t.used)}{t.entitlement != null ? ` / ${fmtN(t.entitlement)}` : ""} <span className="text-t-xs font-bold text-text-dim">يوم مستخدم</span></div></div>)}
              </div>
              <p className="text-t-xs text-text-dim">{d.leave.balance.note}</p>
              <Table empty="لا توجد طلبات إجازة" head={["النوع", "من", "إلى", "الأيام", "الحالة"]}
                rows={d.leave.requests.map((l) => [LEAVE_TYPE_LABELS[l.leave_type] ?? l.leave_type, fmtD(l.start_date), fmtD(l.end_date), fmtN(l.days_count), <Badge key="s" tone={l.status === "approved" ? "success" : l.status === "rejected" ? "danger" : "warning"}>{l.status === "approved" ? "معتمدة" : l.status === "rejected" ? "مرفوضة" : "معلّقة"}</Badge>])} />
            </div>)}
          {tab === "advances" && (!d.advances.available ? <EmptyState icon="info" title="وحدة السلف غير متاحة" /> : d.advances.balance == null ? <EmptyState icon="lock" title="محجوبة" description="لا تملك صلاحية عرض الأرقام المالية." /> :
            <Table empty="لا توجد سلف قائمة" head={["تاريخ السلفة", "المبلغ", "القسط الشهري", "المتبقي"]}
              rows={d.advances.items.map((a) => [fmtD(a.createdAt), fmtM(a.amount), fmtM(a.installment), <b key="b">{fmtM(a.balance)}</b>])} />)}
          {tab === "violations" && <Table empty="لا توجد خصومات أو مخالفات" head={["التاريخ", "النوع", "الوصف", "الخصم"]}
            rows={d.violations.map((v) => [fmtD(v.violation_date), v.violation_type, v.description ?? "—", <Hidden key="a" v={v.deduction_amount} f={fmtM} />])} />}
          {tab === "documents" && (
            <div className="space-y-2">
              {e.iqama_expiry_date && <p className="rounded-lg bg-ink-3 p-2.5 text-t-sm">إقامة الموظف تنتهي في <b>{fmtD(e.iqama_expiry_date)}</b></p>}
              <Table empty="لا توجد مستندات" head={["المستند", "الرقم", "الإصدار", "الانتهاء", "المتبقي"]}
                rows={d.documents.map((x) => [x.doc_type, x.doc_number ?? "—", fmtD(x.issue_date), fmtD(x.expiry_date), x.days_remaining == null ? "—" : <Badge key="d" tone={x.days_remaining < 0 ? "danger" : x.days_remaining <= 30 ? "warning" : "neutral"}>{x.days_remaining < 0 ? "منتهٍ" : `${x.days_remaining} يوم`}</Badge>])} />
            </div>)}
          {tab === "custody" && <Table empty="لا توجد عهد" head={["العهدة", "القيمة التقديرية", "التسليم", "الإرجاع", "الحالة"]}
            rows={d.custody.map((c) => [c.item_name, fmtM(c.estimated_value), fmtD(c.assigned_date), c.returned_date ? fmtD(c.returned_date) : "—", CUSTODY_STATUS_LABELS[c.status as keyof typeof CUSTODY_STATUS_LABELS] ?? c.status])} />}
          {tab === "history" && <Table empty="لا توجد أحداث مسجّلة بعد" head={["الحدث", "بواسطة", "السبب", "التاريخ"]}
            rows={d.history.map((h) => [<b key="e">{EVENT_LABELS[h.event_type] ?? h.event_type}</b>, h.actor_name ?? "—", h.reason ?? "—", fmtDT(h.created_at)])} />}
        </div>
      </section>
    </div>
  );
}
