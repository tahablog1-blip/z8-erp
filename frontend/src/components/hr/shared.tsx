"use client";
// مكوّنات/أدوات مشتركة لشاشات الموارد البشرية — نفس نظام Z8 الموحّد (لا ألوان خاصة بالـHR)
import { Badge } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

export { Panel, useFetch, fmtN, fmtM, fmtD, fmtDT, qs } from "@/components/inventory/shared";

/** دقائق → "س:د" (أو — عند الغياب) — الحساب نفسه من الخادم، هنا تنسيق فقط */
export const fmtMin = (m: number | null | undefined) => {
  if (m == null) return "—";
  const h = Math.floor(m / 60), r = m % 60;
  return `${h}:${String(r).padStart(2, "0")}`;
};

export const MONTHS_AR = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

/** مبلغ حساس: يظهر "—" حين يحجبه الخادم (null) */
export const Hidden = ({ v, f }: { v: number | null | undefined; f: (n: number) => string }) =>
  v == null ? <span className="text-text-dim" title="لا تملك صلاحية عرض الرواتب">••••</span> : <span className="tnum" dir="ltr">{f(v)}</span>;

export const EVENT_LABELS: Record<string, string> = {
  hire: "تعيين", termination: "إنهاء خدمة", salary_change: "تعديل راتب/بدلات", bank_change: "تعديل بيانات بنكية",
  branch_transfer: "نقل فرع", department_change: "تغيير قسم", position_change: "تغيير وظيفة", job_title_change: "تغيير مسمى وظيفي",
  contract_change: "تغيير نوع العقد", contract_new: "عقد جديد", contract_renewal: "تجديد عقد", contract_end: "إنهاء عقد",
  identity_change: "تعديل بيانات الهوية", gosi_change: "تعديل بيانات التأمينات", violation: "مخالفة",
  leave_approved: "اعتماد إجازة", leave_rejected: "رفض إجازة", document_add: "إضافة مستند", document_update: "تحديث مستند",
};

export const DAY_STATUS: Record<string, { label: string; tone: "success" | "warning" | "danger" | "info" }> = {
  present: { label: "حاضر", tone: "success" }, late: { label: "متأخر", tone: "warning" },
  early_leave: { label: "خروج مبكر", tone: "info" }, absent: { label: "غائب", tone: "danger" },
};

export const DayStatus = ({ s }: { s?: string | null }) => {
  const d = s ? DAY_STATUS[s] : null;
  return d ? <Badge tone={d.tone}>{d.label}</Badge> : <span className="text-text-dim">—</span>;
};

export const DAYS_AR = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];

export const DOC_TYPES = ["الهوية الوطنية", "الإقامة", "عقد العمل", "الشهادة العلمية", "رخصة القيادة", "شهادة صحية", "جواز السفر", "أخرى"];

/** بطاقة موظف للجوال/التابلت */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  const ch = (name || "؟").trim().charAt(0);
  return (
    <span className="grid shrink-0 place-items-center rounded-full bg-petrol-soft font-black text-petrol"
          style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden>{ch}</span>
  );
}

export function Stat({ icon, label, value, tone = "petrol", sub }: {
  icon: string; label: string; value: React.ReactNode; tone?: "petrol" | "emerald" | "ember" | "brass" | "info"; sub?: string;
}) {
  const c = { petrol: "var(--petrol)", emerald: "var(--emerald)", ember: "var(--ember)", brass: "var(--brass)", info: "var(--info, var(--petrol))" }[tone];
  return (
    <div className="min-w-0 rounded-card border border-line bg-ink-2 p-3.5 shadow-card">
      <div className="flex items-center gap-1.5 text-t-sm font-bold text-text-dim">
        <span className="grid h-6 w-6 place-items-center rounded-md" style={{ background: `color-mix(in srgb, ${c} 14%, transparent)`, color: c }}>
          <MIcon name={icon} className="!text-[16px]" />
        </span>
        <span className="truncate">{label}</span>
      </div>
      <div className="tnum mt-1.5 text-t-2xl font-black leading-tight">{value}</div>
      {sub && <div className="mt-0.5 truncate text-t-xs font-bold text-text-dim">{sub}</div>}
    </div>
  );
}
