"use client";
// لوحة الموارد البشرية — أول شاشة لمدير الـHR. كل الأرقام من GET /hr/overview (الخادم يحسبها من البيانات الفعلية).
import { Badge, Button, EmptyState, ErrorNote, Grid, Col } from "@/components/ui";
import { KpiSkeleton } from "@/components/dashboard/KpiCard";
import { MIcon } from "@/components/m-icon";
import { LEAVE_TYPE_LABELS } from "@/modules/hr/types";
import { EVENT_LABELS, MONTHS_AR, Panel, Stat, fmtD, fmtDT, fmtM, fmtN, useFetch } from "./shared";

type Overview = {
  employees: { total: number; active: number; terminated: number; saudi: number; non_saudi: number; no_schedule: number };
  today: { present: number; late: number; absent: number; onLeave: number; noSchedule: number };
  contracts: { expired: number; d30: number; d60: number; d90: number };
  documents: { expired: number; d30: number; d60: number };
  leave: { pending: number; recent: { id: string; employee_name: string; leave_type: string; start_date: string; end_date: string; days_count: number; status: string }[] };
  payroll: { lastMonth: number | null; lastYear: number | null; lastStatus: string | null; slips: number; lastNetTotal: number | null;
             nextMonth: number; nextYear: number; activeEmployees: number } | null;
  advances: { available: boolean; count: number; total: number | null; balance: number | null };
  activity: { id: string; event_type: string; employee_name: string; actor_name: string | null; reason: string | null; created_at: string }[];
};

const RUN_STATUS: Record<string, string> = { draft: "مسودة", finalized: "معتمد", paid: "مدفوع" };

export function HrDashboard({ onGo }: { onGo: (tab: string) => void }) {
  const { data: d, loading, error, reload } = useFetch<Overview>("/hr/overview");
  if (error) return <div className="space-y-2"><ErrorNote msg="تعذر تحميل لوحة الموارد البشرية" /><Button variant="ghost" onClick={reload}>إعادة المحاولة</Button></div>;
  if (loading || !d) return <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">{Array.from({ length: 6 }).map((_, i) => <KpiSkeleton key={i} />)}</div>;

  const t = d.today, c = d.contracts, doc = d.documents, p = d.payroll;
  const soon = c.d30 + c.d60 + c.d90;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Stat icon="groups" label="الموظفون النشطون" value={fmtN(d.employees.active)} tone="petrol"
              sub={`${fmtN(d.employees.saudi)} سعودي · ${fmtN(d.employees.non_saudi)} غير سعودي`} />
        <Stat icon="how_to_reg" label="الحاضرون اليوم" value={fmtN(t.present)} tone="emerald" sub={t.late ? `${fmtN(t.late)} منهم متأخر` : undefined} />
        <Stat icon="person_off" label="الغائبون اليوم" value={fmtN(t.absent)} tone="ember" />
        <Stat icon="beach_access" label="في إجازة" value={fmtN(t.onLeave)} tone="info" sub={d.leave.pending ? `${fmtN(d.leave.pending)} طلب معلّق` : undefined} />
        <Stat icon="contract" label="عقود تنتهي قريباً" value={fmtN(soon)} tone="brass" sub={c.expired ? `${fmtN(c.expired)} منتهٍ` : "خلال 90 يوماً"} />
        <Stat icon="payments" label="الرواتب القادمة"
              value={p ? `${MONTHS_AR[p.nextMonth - 1]}` : "—"} tone="petrol"
              sub={p ? (p.lastStatus ? `آخر مسير: ${RUN_STATUS[p.lastStatus] ?? p.lastStatus}` : "لا مسير سابق") : "لا صلاحية"} />
      </div>

      {t.noSchedule > 0 && (
        <div className="rounded-lg border border-brass/30 bg-brass-bg px-4 py-2.5 text-t-sm font-bold text-brass">
          {fmtN(t.noSchedule)} موظف بلا جدول دوام — لا يُحتسبون في الحضور والغياب والتأخير حتى تُعيَّن لهم جداول من «الهيكل والدوام».
        </div>
      )}

      <Grid>
        <Col span={6}>
          <Panel title="الحضور اليوم" icon="schedule" actions={<Button variant="ghost" size="xs" onClick={() => onGo("attendance")}>التفاصيل</Button>}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {([["حاضر", t.present, "success"], ["متأخر", t.late, "warning"], ["غائب", t.absent, "danger"], ["إجازة", t.onLeave, "info"]] as const).map(([l, n, tone]) => (
                <div key={l} className="rounded-lg bg-ink-3 p-3 text-center"><Badge tone={tone}>{l}</Badge><div className="tnum mt-1.5 text-t-xl font-black">{fmtN(n)}</div></div>
              ))}
            </div>
            <p className="mt-2 text-t-xs text-text-dim">الغائب = موظف له جدول دوام، لم يسجّل حضوراً، ولا إجازة معتمدة، وتجاوز وقت البداية.</p>
          </Panel>
        </Col>
        <Col span={6}>
          <Panel title="العقود والمستندات" icon="folder_managed" actions={<Button variant="ghost" size="xs" onClick={() => onGo("contracts")}>العقود</Button>}>
            <ul className="space-y-1.5 text-t-sm">
              <Row label="عقود منتهية" n={c.expired} tone="danger" /><Row label="عقود تنتهي خلال 30 يوماً" n={c.d30} tone="warning" />
              <Row label="خلال 31–60 يوماً" n={c.d60} tone="warning" /><Row label="خلال 61–90 يوماً" n={c.d90} tone="neutral" />
              <li className="my-1 border-t border-line" />
              <Row label="مستندات/إقامات منتهية" n={doc.expired} tone="danger" /><Row label="تنتهي خلال 30 يوماً" n={doc.d30} tone="warning" />
              <Row label="خلال 31–60 يوماً" n={doc.d60} tone="neutral" />
            </ul>
          </Panel>
        </Col>
        <Col span={6}>
          <Panel title="آخر طلبات الإجازة" icon="event_available" actions={<Button variant="ghost" size="xs" onClick={() => onGo("leave")}>كل الطلبات</Button>}>
            {!d.leave.recent.length ? <EmptyState icon="event_available" title="لا توجد طلبات إجازة بعد" /> : (
              <ul className="divide-y divide-line">
                {d.leave.recent.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 py-2 text-t-sm">
                    <span className="min-w-0 truncate"><b>{l.employee_name}</b> <span className="text-text-dim">· {LEAVE_TYPE_LABELS[l.leave_type] ?? l.leave_type} · {fmtN(l.days_count)} يوم · {fmtD(l.start_date)}</span></span>
                    <Badge tone={l.status === "approved" ? "success" : l.status === "rejected" ? "danger" : "warning"}>{l.status === "approved" ? "معتمدة" : l.status === "rejected" ? "مرفوضة" : "معلّقة"}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Col>
        <Col span={6}>
          <Panel title="الرواتب والسلف" icon="account_balance_wallet" actions={<Button variant="ghost" size="xs" onClick={() => onGo("payroll")}>الرواتب</Button>}>
            <ul className="space-y-1.5 text-t-sm">
              <li className="flex justify-between"><span className="text-text-dim">المسير القادم</span><b><bdi>{p ? `${MONTHS_AR[p.nextMonth - 1]} ${p.nextYear}` : "—"}</bdi></b></li>
              <li className="flex justify-between"><span className="text-text-dim">آخر مسير</span><b><bdi>{p?.lastMonth ? `${MONTHS_AR[p.lastMonth - 1]} ${p.lastYear} — ${RUN_STATUS[p.lastStatus ?? ""] ?? ""}` : "—"}</bdi></b></li>
              <li className="flex justify-between"><span className="text-text-dim">صافي آخر مسير</span><b className="tnum" dir="ltr">{p?.lastNetTotal == null ? "••••" : fmtM(p.lastNetTotal)}</b></li>
              <li className="my-1 border-t border-line" />
              <li className="flex justify-between"><span className="text-text-dim">سلف قائمة</span><b>{d.advances.available ? fmtN(d.advances.count) : "—"}</b></li>
              <li className="flex justify-between"><span className="text-text-dim">المتبقي منها</span><b className="tnum" dir="ltr">{d.advances.balance == null ? "••••" : fmtM(d.advances.balance)}</b></li>
            </ul>
          </Panel>
        </Col>
        <Col span={12}>
          <Panel title="آخر نشاط الموارد البشرية" icon="history">
            {!d.activity.length ? <EmptyState icon="history" title="لا يوجد نشاط مسجّل بعد" description="تعديلات الراتب والعقود والنقل وإنهاء الخدمة تظهر هنا." /> : (
              <ul className="divide-y divide-line">
                {d.activity.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-t-sm">
                    <span className="flex items-center gap-1.5"><MIcon name="radio_button_checked" className="!text-[14px] text-petrol" />
                      <b>{EVENT_LABELS[a.event_type] ?? a.event_type}</b> — {a.employee_name}{a.reason ? <span className="text-text-dim"> ({a.reason})</span> : null}</span>
                    <span className="text-t-xs text-text-dim">{a.actor_name ?? "—"} · {fmtDT(a.created_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </Col>
      </Grid>
    </div>
  );
}

function Row({ label, n, tone }: { label: string; n: number; tone: "danger" | "warning" | "neutral" }) {
  return <li className="flex items-center justify-between"><span className="text-text-dim">{label}</span><Badge tone={n ? tone : "neutral"}>{fmtN(n)}</Badge></li>;
}
