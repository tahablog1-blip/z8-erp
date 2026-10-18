"use client";
// الإعدادات ← النظام — صفحة كاملة، DB-backed بالكامل — 7 إعدادات جديدة
// + حالة الخادم (كانت موجودة من قبل، محتفظ بيها)
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Field, Input, Select } from "@/components/ui";
import { NAV_MODULES } from "@/modules/registry";

type SystemSettings = {
  landingAdmin: string | null; landingEmployee: string | null;
  sessionHours: number; minPasswordLength: number;
  maxLoginAttempts: number; lockoutMinutes: number;
  timeFormat: "24" | "12"; fiscalYearStartMonth: number; maintenanceMode: boolean;
};

const DEFAULT: SystemSettings = {
  landingAdmin: null, landingEmployee: null,
  sessionHours: 0, minPasswordLength: 8,
  maxLoginAttempts: 0, lockoutMinutes: 15,
  timeFormat: "24", fiscalYearStartMonth: 1, maintenanceMode: false,
};

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

// المسارات المرشّحة لوجهة الدخول: كل الصفحات غير الخاصة بالأدمن فقط (الموظف لازم يملك صلاحية وصول حقيقية)
const EMPLOYEE_LANDING_CANDIDATES = NAV_MODULES.filter((m) => !m.adminOnly);

export default function SystemSettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<boolean | null>(null);
  const [form, setForm] = useState<SystemSettings>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api("/health").then(() => setHealth(true)).catch(() => setHealth(false));
    api<SystemSettings>("/settings/system").then((r) => { setForm(r); setLoaded(true); })
      .catch((e) => { setErr(e.message); setLoaded(true); });
  }, []);

  async function save() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const saved = await api<SystemSettings>("/settings/system", { method: "PUT", body: JSON.stringify(form) });
      setForm(saved);
      setOk("تم الحفظ");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (!loaded) return <Card>جارِ التحميل…</Card>;

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — النظام</h1>

      <Card>
        <div className="max-w-xl space-y-2 text-[12.5px]">
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">حالة الخادم</span>
            <b className={health ? "text-emerald" : "text-ember"}>{health === null ? "..." : health ? "متصل ✓" : "غير متصل ✗"}</b>
          </div>
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">المستخدم الحالي</span><b>{user?.fullName} ({user?.email})</b>
          </div>
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">الدور</span><b>{user?.role === "admin" ? "مدير النظام" : "موظف"}</b>
          </div>
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">المنصة</span><b>Z8 Platform — FastAPI + Next.js + PostgreSQL</b>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-black">وجهة ما بعد تسجيل الدخول</h2>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="وجهة المدير (admin) — فاضي = لوحة القيادة">
            <Select value={form.landingAdmin || ""} onChange={(e) => setForm({ ...form, landingAdmin: e.target.value || null })}>
              <option value="">لوحة القيادة (الافتراضي)</option>
              {NAV_MODULES.map((m) => <option key={m.path} value={m.path}>{m.title}</option>)}
            </Select>
          </Field>
          <Field label="وجهة الموظف — فاضي = أول شاشة مسموحة له تلقائياً">
            <Select value={form.landingEmployee || ""} onChange={(e) => setForm({ ...form, landingEmployee: e.target.value || null })}>
              <option value="">اكتشاف تلقائي (الافتراضي)</option>
              {EMPLOYEE_LANDING_CANDIDATES.map((m) => <option key={m.path} value={m.path}>{m.title}</option>)}
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-text-dim">
          لو وجّهت موظفاً لصفحة بلا صلاحية وصول فعلية، الواجهة بتتجاهل الإعداد وترجع للاكتشاف التلقائي أمناً.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-black">الأمان والجلسات</h2>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="مدة الجلسة بالساعات — 0 = الافتراضي الأصلي للنظام">
            <Input type="number" min={0} max={720} className="tnum" value={form.sessionHours}
                   onChange={(e) => setForm({ ...form, sessionHours: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="أقل طول لكلمة المرور">
            <Input type="number" min={6} max={32} className="tnum" value={form.minPasswordLength}
                   onChange={(e) => setForm({ ...form, minPasswordLength: Math.min(32, Math.max(6, Number(e.target.value) || 8)) })} />
          </Field>
          <Field label="حد محاولات الدخول الفاشلة — 0 = تعطيل القفل المؤقت">
            <Input type="number" min={0} max={20} className="tnum" value={form.maxLoginAttempts}
                   onChange={(e) => setForm({ ...form, maxLoginAttempts: Math.max(0, Number(e.target.value) || 0) })} />
          </Field>
          <Field label="مدة القفل المؤقت بالدقائق">
            <Input type="number" min={1} max={1440} className="tnum" value={form.lockoutMinutes}
                   onChange={(e) => setForm({ ...form, lockoutMinutes: Math.max(1, Number(e.target.value) || 15) })} />
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-text-dim">
          القفل المؤقت وحد محاولات الدخول لا يُطبّقان أبداً على حساب المدير (admin) — حماية من إغلاق الوصول للنظام بالكامل بالخطأ.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-black">عام</h2>
        <div className="grid max-w-xl gap-3 sm:grid-cols-2">
          <Field label="تنسيق الوقت في الفواتير المطبوعة">
            <Select value={form.timeFormat} onChange={(e) => setForm({ ...form, timeFormat: e.target.value as "24" | "12" })}>
              <option value="24">24 ساعة</option>
              <option value="12">12 ساعة (ص/م)</option>
            </Select>
          </Field>
          <Field label="بداية السنة المالية">
            <Select value={String(form.fiscalYearStartMonth)}
                    onChange={(e) => setForm({ ...form, fiscalYearStartMonth: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-[11px] text-text-dim">
          بداية السنة المالية بتُستخدم في زر «السنة المالية الحالية» بشاشة التقارير لحساب نطاق التاريخ تلقائياً.
        </p>
      </Card>

      <Card>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-3">
          <div>
            <div className="text-[13px] font-bold text-ember">وضع الصيانة</div>
            <div className="text-[11.5px] text-text-dim">يمنع دخول الموظفين مؤقتاً (رسالة «النظام تحت الصيانة») — حساب المدير يفضل يدخل عادي دايماً عشان يقدر يلغي الوضع</div>
          </div>
          <input type="checkbox" checked={form.maintenanceMode} className="h-4 w-4 accent-ember"
                 onChange={(e) => setForm({ ...form, maintenanceMode: e.target.checked })} />
        </label>
      </Card>

      <ErrorNote msg={err} />
      {ok && <p className="text-[12.5px] font-bold text-emerald">{ok}</p>}
      <div className="flex justify-end pb-6">
        <Button onClick={save} disabled={busy}>{busy ? "جارِ الحفظ..." : "حفظ إعدادات النظام"}</Button>
      </div>
    </div>
  );
}
