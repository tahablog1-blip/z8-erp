"use client";
// الإعدادات ← الأمان — المصادقة الثنائية (TOTP) لحساب المستخدم الحالي + الجلسات/الأجهزة النشطة
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { Button, Card, ErrorNote, Field, Input, PageHeader } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type TotpStatus = { enabled: boolean; backupCodesLeft: number };
type Session = {
  id: string; deviceLabel: string | null; ip: string | null;
  createdAt: string; lastSeenAt: string; isCurrent: boolean;
};

function fmt(d: string) {
  try { return new Date(d).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return d; }
}

export default function SecuritySettingsPage() {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [err, setErr] = useState("");

  // تدفق التفعيل: idle → setup (QR + سر) → confirm (أدخل الكود) → backupCodes (تظهر مرة واحدة)
  const [step, setStep] = useState<"idle" | "setup" | "backupCodes">("idle");
  const [qrUrl, setQrUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [code, setCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [disablePwd, setDisablePwd] = useState("");
  const [showDisable, setShowDisable] = useState(false);
  const [busy, setBusy] = useState(false);

  function load() {
    api<TotpStatus>("/auth/2fa/status").then(setStatus).catch((e) => setErr(e.message));
    api<Session[]>("/auth/sessions").then(setSessions).catch(() => {});
  }
  useEffect(load, []);

  async function startSetup() {
    setErr(""); setBusy(true);
    try {
      const r = await api<{ secret: string; otpauthUrl: string }>("/auth/2fa/setup", { method: "POST" });
      setSecret(r.secret);
      setQrUrl(await QRCode.toDataURL(r.otpauthUrl));
      setStep("setup");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function confirmSetup(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await api<{ backupCodes: string[] }>("/auth/2fa/confirm", {
        method: "POST", body: JSON.stringify({ code: code.trim() }),
      });
      setBackupCodes(r.backupCodes);
      setStep("backupCodes");
      setCode("");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  function finishBackupCodes() { setStep("idle"); load(); }

  async function disable(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      await api("/auth/2fa/disable", { method: "POST", body: JSON.stringify({ password: disablePwd }) });
      setShowDisable(false); setDisablePwd("");
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function revoke(id: string) {
    if (!confirm("إنهاء هذه الجلسة؟ الجهاز ده هيحتاج يسجّل دخول من جديد.")) return;
    try {
      await api(`/auth/sessions/${id}`, { method: "DELETE" });
      setSessions((s) => s.filter((x) => x.id !== id));
    } catch (e: any) { setErr(e.message); }
  }

  return (
    <div className="space-y-5">
      <div>
        <PageHeader title="الأمان" description="أمان الحساب." />
        <p className="page-desc">المصادقة الثنائية وإدارة الجلسات المفتوحة على حسابك.</p>
      </div>

      <ErrorNote msg={err} />

      {/* ── المصادقة الثنائية ── */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <MIcon name="verified_user" className="!text-[20px] text-petrol" />
          <h2 className="text-t-md font-extrabold">المصادقة الثنائية (2FA)</h2>
        </div>

        {step === "idle" && status && (
          status.enabled ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 rounded-lg bg-emerald-bg px-3 py-2 text-t-sm font-bold text-emerald">
                <MIcon name="check_circle" className="!text-[16px]" /> مفعّلة على حسابك
              </div>
              <p className="text-t-sm text-text-dim">
                أكواد الاسترجاع الاحتياطية المتبقية: <b className="text-text">{status.backupCodesLeft}</b> من 8
              </p>
              {!showDisable ? (
                <Button variant="secondary" onClick={() => setShowDisable(true)}>تعطيل المصادقة الثنائية</Button>
              ) : (
                <form onSubmit={disable} className="max-w-xs space-y-2.5 rounded-lg border border-line p-3">
                  <Field label="أدخل كلمة المرور للتأكيد">
                    <Input dir="ltr" type="password" value={disablePwd} required
                           onChange={(e) => setDisablePwd(e.target.value)} />
                  </Field>
                  <div className="flex gap-2">
                    <Button type="submit" variant="danger" disabled={busy}>تعطيل</Button>
                    <Button type="button" variant="secondary" onClick={() => setShowDisable(false)}>إلغاء</Button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-t-sm text-text-dim">
                بعد التفعيل، هيُطلب منك كود من تطبيق مصادقة (زي Google Authenticator) كل مرة تسجّل دخول.
              </p>
              <Button onClick={startSetup} disabled={busy}>تفعيل المصادقة الثنائية</Button>
            </div>
          )
        )}

        {step === "setup" && (
          <form onSubmit={confirmSetup} className="space-y-3">
            <p className="text-t-sm text-text-dim">افتح تطبيق المصادقة ومسح الكود، أو أدخل السر يدوياً:</p>
            <div className="flex flex-wrap items-center gap-4">
              {qrUrl && <img src={qrUrl} alt="QR" className="h-40 w-40 rounded-lg border border-line bg-white p-2" />}
              <div className="min-w-0">
                <div className="text-t-xs font-bold text-text-dim">السر (إدخال يدوي)</div>
                <code dir="ltr" className="mt-1 block max-w-[220px] break-all rounded-lg bg-ink-3 px-2 py-1.5 text-t-xs">
                  {secret}
                </code>
              </div>
            </div>
            <Field label="أدخل الكود المكوّن من 6 أرقام للتأكيد">
              <Input dir="ltr" value={code} required maxLength={6} autoFocus
                     className="max-w-[160px] text-center text-t-lg tracking-[0.3em]"
                     onChange={(e) => setCode(e.target.value)} />
            </Field>
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>تأكيد وتفعيل</Button>
              <Button type="button" variant="secondary" onClick={() => setStep("idle")}>إلغاء</Button>
            </div>
          </form>
        )}

        {step === "backupCodes" && (
          <div className="space-y-3">
            <div className="rounded-lg bg-brass-soft px-3 py-2 text-t-sm font-bold text-brass">
              احفظ أكواد الاسترجاع دي في مكان آمن — هتظهر مرة واحدة بس، وبتسمحلك تدخل لو ضيّعت جهاز المصادقة.
            </div>
            <div dir="ltr" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {backupCodes.map((c) => (
                <code key={c} className="rounded-lg bg-ink-3 px-2 py-1.5 text-center text-t-sm font-bold">{c}</code>
              ))}
            </div>
            <Button onClick={finishBackupCodes}>حفظتها — تم</Button>
          </div>
        )}
      </Card>

      {/* ── الجلسات والأجهزة النشطة ── */}
      <Card>
        <div className="mb-3 flex items-center gap-2">
          <MIcon name="devices" className="!text-[20px] text-petrol" />
          <h2 className="text-t-md font-extrabold">الجلسات والأجهزة النشطة</h2>
        </div>
        <div className="space-y-2">
          {sessions.length === 0 && <p className="text-t-sm text-text-dim">لا توجد جلسات مسجّلة.</p>}
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-t-sm font-bold">
                  {s.deviceLabel || "جهاز غير معروف"}
                  {s.isCurrent && (
                    <span className="rounded-full bg-emerald-bg px-2 py-0.5 text-t-xs font-extrabold text-emerald">هذا الجهاز</span>
                  )}
                </div>
                <div className="mt-0.5 text-t-xs text-text-dim" dir="ltr">
                  {s.ip || "—"} · آخر ظهور {fmt(s.lastSeenAt)}
                </div>
              </div>
              {!s.isCurrent && (
                <Button size="sm" variant="secondary" onClick={() => revoke(s.id)}>إنهاء</Button>
              )}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
