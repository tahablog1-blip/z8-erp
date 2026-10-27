"use client";
// الإعدادات ← النظام — صفحة كاملة، DB-backed بالكامل — 7 إعدادات جديدة
// + حالة الخادم (كانت موجودة من قبل، محتفظ بيها)
import { useEffect, useState } from "react";
import { api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { setFormatSettings } from "@/lib/format";
import { Button, Card, ErrorNote, Field, Input, Select, Switch, PageHeader } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { SaveBar } from "@/components/settings/SettingsContext";
import { toast } from "@/components/toast";
import { NAV_MODULES } from "@/modules/registry";

type SystemSettings = {
  landingAdmin: string | null; landingEmployee: string | null;
  sessionHours: number; minPasswordLength: number;
  maxLoginAttempts: number; lockoutMinutes: number;
  timeFormat: "24" | "12"; fiscalYearStartMonth: number; maintenanceMode: boolean;
  dateCalendar: "gregorian" | "hijri"; numberFormat: "latin" | "arabic";
};

const DEFAULT: SystemSettings = {
  landingAdmin: null, landingEmployee: null,
  sessionHours: 0, minPasswordLength: 8,
  maxLoginAttempts: 0, lockoutMinutes: 15,
  timeFormat: "24", fiscalYearStartMonth: 1, maintenanceMode: false,
  dateCalendar: "gregorian", numberFormat: "latin",
};

type BackupFile = { filename: string; sizeBytes: number; createdAt: string; tableCount: number; rowCount: number };

function fmtSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو",
  "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];

type EmailSettings = {
  enabled: boolean; smtpHost: string | null; smtpPort: number; smtpUser: string | null;
  hasPassword: boolean; fromAddress: string | null; fromName: string | null;
  notifyOnWarnAndDanger: boolean;
};
const EMAIL_DEFAULT: EmailSettings = {
  enabled: false, smtpHost: null, smtpPort: 587, smtpUser: null,
  hasPassword: false, fromAddress: null, fromName: null, notifyOnWarnAndDanger: true,
};

// المسارات المرشّحة لوجهة الدخول: كل الصفحات غير الخاصة بالأدمن فقط (الموظف لازم يملك صلاحية وصول حقيقية)
const EMPLOYEE_LANDING_CANDIDATES = NAV_MODULES.filter((m) => !m.adminOnly);

export default function SystemSettingsPage() {
  const { user } = useAuth();
  const [health, setHealth] = useState<boolean | null>(null);
  const [form, setForm] = useState<SystemSettings>(DEFAULT);
  const [initial, setInitial] = useState(JSON.stringify(DEFAULT));   // آخر حالة محفوظة
  const dirty = JSON.stringify(form) !== initial;
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api("/health").then(() => setHealth(true)).catch(() => setHealth(false));
    api<SystemSettings>("/settings/system").then((r) => { setForm(r); setInitial(JSON.stringify(r)); setLoaded(true); })
      .catch((e) => { setErr(e.message); setLoaded(true); });
  }, []);

  // ── البريد الإلكتروني (SMTP) — جزء محرك الإشعارات ──
  const [emailForm, setEmailForm] = useState<EmailSettings>(EMAIL_DEFAULT);
  const [emailPassword, setEmailPassword] = useState("");
  const [emailLoaded, setEmailLoaded] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailErr, setEmailErr] = useState("");
  const [emailOk, setEmailOk] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    api<EmailSettings>("/settings/email").then((r) => { setEmailForm(r); setEmailLoaded(true); })
      .catch(() => setEmailLoaded(true));
  }, []);

  async function saveEmail() {
    setEmailErr(""); setEmailOk(""); setEmailBusy(true);
    try {
      const saved = await api<EmailSettings>("/settings/email", {
        method: "PUT", body: JSON.stringify({ ...emailForm, smtpPassword: emailPassword || null }),
      });
      setEmailForm(saved); setEmailPassword("");
      setEmailOk("تم الحفظ");
    } catch (e: any) { setEmailErr(e.message); }
    finally { setEmailBusy(false); }
  }

  async function sendTestEmail() {
    setTestMsg(""); setTestBusy(true);
    try {
      await api("/settings/email/test", { method: "POST", body: JSON.stringify({ to: testTo }) });
      setTestMsg("تم الإرسال تفقّد صندوق الوارد");
    } catch (e: any) { setTestMsg(e.message); }
    finally { setTestBusy(false); }
  }

  // ── النسخ الاحتياطي ──
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [backupsLoaded, setBackupsLoaded] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [backupErr, setBackupErr] = useState("");

  function loadBackups() {
    api<BackupFile[]>("/settings/backup").then((r) => { setBackups(r); setBackupsLoaded(true); })
      .catch((e) => { setBackupErr(e.message); setBackupsLoaded(true); });
  }
  useEffect(loadBackups, []);

  async function createBackup() {
    setBackupErr(""); setBackupBusy(true);
    try { await api("/settings/backup", { method: "POST" }); loadBackups(); }
    catch (e: any) { setBackupErr(e.message); }
    finally { setBackupBusy(false); }
  }

  async function downloadBackup(b: BackupFile) {
    try {
      const token = getToken();
      const res = await fetch(`/api/settings/backup/${b.filename}/download`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!res.ok) throw new Error(`تعذّر تحميل النسخة (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url; a.download = b.filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { await appAlert(e.message); }
  }

  async function deleteBackup(b: BackupFile) {
    if (!await appConfirm(`حذف النسخة الاحتياطية «${b.filename}» نهائياً؟`)) return;
    try { await api(`/settings/backup/${b.filename}`, { method: "DELETE" }); loadBackups(); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function save() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const saved = await api<SystemSettings>("/settings/system", { method: "PUT", body: JSON.stringify(form) });
      setForm(saved); setInitial(JSON.stringify(saved));
      setFormatSettings({ dateCalendar: saved.dateCalendar, numberFormat: saved.numberFormat });
      toast.success("تم حفظ التغييرات بنجاح.");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (!loaded) return <Card>جارِ التحميل…</Card>;

  return (
    <div className="space-y-4">
      <PageHeader title="الإعدادات — النظام" description="حالة النظام والتكاملات." />

      <Card>
        <div className="max-w-xl space-y-2 text-t-sm">
          <div className="flex justify-between rounded-lg border border-line p-3">
            <span className="text-text-dim">حالة الخادم</span>
            <b className={health ? "text-emerald" : "text-ember"}>{health === null ? "..." : health ? "متصل" : "غير متصل"}</b>
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
        <h2 className="mb-3 text-t-md font-black">وجهة ما بعد تسجيل الدخول</h2>
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
        <p className="mt-2 text-t-xs text-text-dim">
          لو وجّهت موظفاً لصفحة بلا صلاحية وصول فعلية، الواجهة بتتجاهل الإعداد وترجع للاكتشاف التلقائي أمناً.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-t-md font-black">الأمان والجلسات</h2>
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
        <p className="mt-2 text-t-xs text-text-dim">
          القفل المؤقت وحد محاولات الدخول لا يُطبّقان أبداً على حساب المدير (admin) — حماية من إغلاق الوصول للنظام بالكامل بالخطأ.
        </p>
      </Card>

      <Card>
        <h2 className="mb-3 text-t-md font-black">عام</h2>
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
          <Field label="نظام عرض التاريخ بالواجهة">
            <Select value={form.dateCalendar} onChange={(e) => setForm({ ...form, dateCalendar: e.target.value as "gregorian" | "hijri" })}>
              <option value="gregorian">ميلادي</option>
              <option value="hijri">هجري (أم القرى)</option>
            </Select>
          </Field>
          <Field label="تنسيق الأرقام بالواجهة">
            <Select value={form.numberFormat} onChange={(e) => setForm({ ...form, numberFormat: e.target.value as "latin" | "arabic" })}>
              <option value="latin">أرقام إنجليزية (0123456789)</option>
              <option value="arabic">أرقام عربية هندية (٠١٢٣٤٥٦٧٨٩)</option>
            </Select>
          </Field>
        </div>
        <p className="mt-2 text-t-xs text-text-dim">
          بداية السنة المالية بتُستخدم في زر «السنة المالية الحالية» بشاشة التقارير لحساب نطاق التاريخ تلقائياً.
          التاريخ الهجري وتنسيق الأرقام يُطبَّقان فوراً على كل شاشات النظام لجميع المستخدمين بعد الحفظ.
        </p>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-t-md font-extrabold">البريد الإلكتروني (SMTP)</div>
          <Switch checked={emailForm.enabled} onChange={(v) => setEmailForm({ ...emailForm, enabled: v })} />
        </div>
        <p className="mb-3 text-t-xs text-text-dim">
          لإرسال إشعارات تلقائية بالبريد (نقص مخزون، موافقة معلقة، فرق صندوق...) — جزء من مركز الإشعارات.
        </p>
        {!emailLoaded ? (
          <div className="text-t-sm text-text-dim">جارِ التحميل...</div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid gap-2 sm:grid-cols-3">
              <Field label="خادم SMTP">
                <Input value={emailForm.smtpHost || ""} placeholder="smtp.example.com"
                       onChange={(e) => setEmailForm({ ...emailForm, smtpHost: e.target.value })} />
              </Field>
              <Field label="المنفذ">
                <Input type="number" className="tnum" value={emailForm.smtpPort}
                       onChange={(e) => setEmailForm({ ...emailForm, smtpPort: +e.target.value || 587 })} />
              </Field>
              <Field label="اسم المستخدم">
                <Input value={emailForm.smtpUser || ""}
                       onChange={(e) => setEmailForm({ ...emailForm, smtpUser: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="كلمة السر" hint={emailForm.hasPassword ? "محفوظة — اتركها فاضية إن لم ترد تغييرها" : "لم تُحفظ بعد"}>
                <Input type="password" value={emailPassword} placeholder={emailForm.hasPassword ? "••••••••" : ""}
                       onChange={(e) => setEmailPassword(e.target.value)} />
              </Field>
              <Field label="اسم المرسل">
                <Input value={emailForm.fromName || ""} placeholder="مصدر الزيوت"
                       onChange={(e) => setEmailForm({ ...emailForm, fromName: e.target.value })} />
              </Field>
            </div>
            <Field label="بريد المرسل">
              <Input type="email" value={emailForm.fromAddress || ""} placeholder="notifications@example.com"
                     onChange={(e) => setEmailForm({ ...emailForm, fromAddress: e.target.value })} />
            </Field>
            <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-2.5">
              <div className="text-t-sm font-bold">إرسال بريد تلقائي للتنبيهات المهمة فقط</div>
              <Switch size="sm" checked={emailForm.notifyOnWarnAndDanger}
                      onChange={(v) => setEmailForm({ ...emailForm, notifyOnWarnAndDanger: v })} />
            </label>

            <ErrorNote msg={emailErr} />
            {emailOk && <p className="text-t-sm font-bold text-emerald">{emailOk}</p>}
            <div className="flex justify-end">
              <Button onClick={saveEmail} disabled={emailBusy}>{emailBusy ? "جارِ الحفظ..." : "حفظ إعدادات البريد"}</Button>
            </div>

            <div className="flex items-end gap-2 border-t border-line pt-3">
              <Field label="إرسال رسالة اختبار">
                <Input type="email" value={testTo} placeholder="your@email.com"
                       onChange={(e) => setTestTo(e.target.value)} />
              </Field>
              <Button variant="ghost" onClick={sendTestEmail} disabled={testBusy || !testTo.trim()}>
                {testBusy ? "جارِ الإرسال..." : "إرسال"}
              </Button>
            </div>
            {testMsg && <p className="text-t-xs text-text-dim">{testMsg}</p>}
          </div>
        )}
      </Card>

      <Card>
        <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-3">
          <div>
            <div className="text-t-md font-bold text-ember">وضع الصيانة</div>
            <div className="text-t-xs text-text-dim">يمنع دخول الموظفين مؤقتاً (رسالة «النظام تحت الصيانة») — حساب المدير يفضل يدخل عادي دايماً عشان يقدر يلغي الوضع</div>
          </div>
          <Switch checked={form.maintenanceMode} onChange={(v) => setForm({ ...form, maintenanceMode: v })} tone="ember" />
        </label>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-t-md font-extrabold">النسخ الاحتياطي</div>
          <Button onClick={createBackup} disabled={backupBusy}>{backupBusy ? "جارِ إنشاء النسخة..." : "+ نسخة احتياطية جديدة"}</Button>
        </div>
        <p className="mb-3 text-t-xs text-text-dim">
          تصدير فوري لكل بيانات شركتك (كل الجداول) كملف واحد مضغوط — يمكن تنزيله أو حذفه من هنا.
          التصدير لا يشمل الصور والملفات المرفوعة (الشعار، صور المنتجات...).
        </p>
        <ErrorNote msg={backupErr} />
        {!backupsLoaded ? (
          <div className="text-t-sm text-text-dim">جارِ التحميل...</div>
        ) : backups.length === 0 ? (
          <div className="rounded-lg border border-line p-4 text-center text-t-sm text-text-dim">لا توجد نسخ احتياطية بعد</div>
        ) : (
          <div className="space-y-1.5">
            {backups.map((b) => (
              <div key={b.filename} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-2.5">
                <div className="text-t-sm">
                  <div className="font-bold tnum" dir="ltr">{b.filename}</div>
                  <div className="text-t-xs text-text-dim">
                    {new Date(b.createdAt).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" })}
                    {" — "}{b.tableCount} جدول، {b.rowCount.toLocaleString()} سجل، {fmtSize(b.sizeBytes)}
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="ghost" size="xs" onClick={() => downloadBackup(b)}>تنزيل</Button>
                  <Button variant="danger" size="xs" onClick={() => deleteBackup(b)}>حذف</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {!dirty && <ErrorNote msg={err} />}
      <SaveBar dirty={dirty} busy={busy} error={dirty && err ? err : ""} onSave={save} onCancel={() => setForm(JSON.parse(initial))} />
    </div>
  );
}
