"use client";
// الإعدادات ← التكاملات — إعداد مفاتيح واتساب (UltraMsg) من الشاشة بدل الضبط اليدوي
// في قاعدة البيانات مباشرة + سجل أحداث التكاملات الخارجية (واتساب، بوابة الدفع...)
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { api } from "@/lib/api";
import { Badge, Button, Card, EmptyState, ErrorNote, Field, Input } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type WhatsAppSettings = { waInstance: string | null; hasToken: boolean };
const WA_DEFAULT: WhatsAppSettings = { waInstance: null, hasToken: false };

type LogRow = {
  id: string; provider: string; event: string; status: string; detail: string | null; created_at: string;
};

const PROVIDER_LABELS: Record<string, string> = { whatsapp: "واتساب", payment_gateway: "بوابة الدفع" };
const STATUS_TONE: Record<string, "good" | "warn" | "neutral"> = {
  success: "good", skipped: "neutral", failed: "warn", paid: "good", refunded: "neutral",
};
const STATUS_LABELS: Record<string, string> = {
  success: "نجح", skipped: "تم التجاوز", failed: "فشل", paid: "دُفعت", refunded: "مُرتجعة",
};

function fmt(d: string) {
  try { return new Date(d).toLocaleString("ar-SA", { dateStyle: "medium", timeStyle: "short" }); }
  catch { return d; }
}

type GatewayStatus = { enabled: boolean; state: string; number?: string | null; qr?: string; sentToday?: number };
const GW_LABELS: Record<string, [string, "good" | "warn" | "neutral"]> = {
  ready: ["مربوط", "good"], qr: ["بانتظار مسح الـ QR", "warn"], starting: ["جارِ التشغيل", "neutral"],
  disconnected: ["منقطع", "warn"], unreachable: ["البوابة لا تستجيب", "warn"], disabled: ["غير مفعّلة", "neutral"],
};

/** بوابة واتساب المحلية (whatsapp-web.js): ربط رقم الشركة بمسح QR — بدون اشتراك */
function WhatsAppGatewayCard() {
  const [gw, setGw] = useState<GatewayStatus | null>(null);
  const [qrImg, setQrImg] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const r = await api<GatewayStatus>("/settings/whatsapp/gateway");
        if (!alive) return;
        setGw(r);
        if (r.qr) setQrImg(await QRCode.toDataURL(r.qr, { width: 260, margin: 1 })); else setQrImg("");
      } catch { /* ما نعرضش خطأ في الاستطلاع الدوري */ }
    }
    load();
    const t = setInterval(() => { if (!document.hidden) load(); }, 4000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function logout() {
    if (!window.confirm("فصل الرقم الحالي لربط رقم آخر؟")) return;
    setErr(""); setBusy(true);
    try { await api("/settings/whatsapp/gateway/logout", { method: "POST" }); }
    catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (!gw || !gw.enabled) return null;   // مش مفعّلة على السيرفر — الكارت يختفي
  const [label, tone] = GW_LABELS[gw.state] || [gw.state, "neutral" as const];
  return (
    <Card>
      <div className="flex items-center justify-between">
        <div className="text-[14px] font-extrabold">واتساب — ربط مباشر (بدون اشتراك)</div>
        <Badge tone={tone}>{label}</Badge>
      </div>
      <p className="mt-1 text-[12px] leading-5 text-text-dim">
        رمز التحقق للحجز والفواتير وإشعارات العملاء بتتبعت من رقم الشركة المربوط هنا. استخدم رقماً مخصصاً للشركة
        (مش رقمك الشخصي) — واتساب ممكن يقيّد الأرقام اللي بترسل بكثرة.
      </p>
      {gw.state === "ready" && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
          <span>الرقم المربوط: <b dir="ltr" className="tnum">{gw.number ? `+${gw.number}` : "—"}</b>
            <span className="mx-2 text-text-dim">·</span>رسائل اليوم: <b className="tnum">{gw.sentToday ?? 0}</b></span>
          <Button variant="danger" size="sm" onClick={logout} loading={busy}>فصل الرقم</Button>
        </div>
      )}
      {gw.state === "qr" && qrImg && (
        <div className="mt-3 flex flex-col items-center gap-2">
          <img src={qrImg} alt="QR ربط واتساب" className="h-[260px] w-[260px] rounded-xl border border-line bg-white p-2" />
          <ol className="list-decimal space-y-0.5 pe-5 text-[12px] leading-5 text-text-dim">
            <li>افتح واتساب على جوال الشركة</li>
            <li>الإعدادات ← الأجهزة المرتبطة ← ربط جهاز</li>
            <li>امسح الرمز (بيتجدد تلقائياً)</li>
          </ol>
        </div>
      )}
      {(gw.state === "starting" || gw.state === "disconnected" || gw.state === "unreachable") && (
        <p className="mt-3 text-[12px] text-text-dim">
          {gw.state === "unreachable"
            ? "البوابة مش بتستجيب — تأكد إن الخدمة z8-wa شغّالة على السيرفر."
            : "جارِ تجهيز الاتصال… الصفحة بتتحدّث تلقائياً."}
        </p>
      )}
      <ErrorNote msg={err} />
    </Card>
  );
}

export default function IntegrationsPage() {
  // ── واتساب ──
  const [waForm, setWaForm] = useState<WhatsAppSettings>(WA_DEFAULT);
  const [waToken, setWaToken] = useState("");
  const [waLoaded, setWaLoaded] = useState(false);
  const [waBusy, setWaBusy] = useState(false);
  const [waErr, setWaErr] = useState("");
  const [waOk, setWaOk] = useState("");
  const [testPhone, setTestPhone] = useState("");
  const [testBusy, setTestBusy] = useState(false);
  const [testMsg, setTestMsg] = useState("");

  useEffect(() => {
    api<WhatsAppSettings>("/settings/whatsapp").then((r) => { setWaForm(r); setWaLoaded(true); })
      .catch(() => setWaLoaded(true));
  }, []);

  async function saveWa() {
    setWaErr(""); setWaOk(""); setWaBusy(true);
    try {
      const saved = await api<WhatsAppSettings>("/settings/whatsapp", {
        method: "PUT", body: JSON.stringify({ waInstance: waForm.waInstance, waToken: waToken || null }),
      });
      setWaForm(saved); setWaToken("");
      setWaOk("تم الحفظ");
    } catch (e: any) { setWaErr(e.message); }
    finally { setWaBusy(false); }
  }

  async function sendTestWa() {
    setTestMsg(""); setTestBusy(true);
    try {
      await api("/settings/whatsapp/test", { method: "POST", body: JSON.stringify({ phone: testPhone }) });
      setTestMsg("تم الإرسال ✓ تفقّد واتساب الرقم");
      loadLog();
    } catch (e: any) { setTestMsg(e.message); }
    finally { setTestBusy(false); }
  }

  // ── سجل التكاملات ──
  const [log, setLog] = useState<LogRow[]>([]);
  const [logLoading, setLogLoading] = useState(true);
  const [logErr, setLogErr] = useState("");

  function loadLog() {
    setLogLoading(true); setLogErr("");
    api<LogRow[]>("/settings/integration-log?limit=100")
      .then(setLog).catch((e) => setLogErr(e.message)).finally(() => setLogLoading(false));
  }
  useEffect(loadLog, []);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[19px] font-extrabold">التكاملات</h1>
        <p className="mt-0.5 text-[12.5px] text-text-dim">مفاتيح واتساب (UltraMsg) وسجل أحداث كل التكاملات الخارجية.</p>
      </div>

      <WhatsAppGatewayCard />

      <Card>
        <div className="flex items-center justify-between">
          <div className="text-[14px] font-extrabold">واتساب (UltraMsg)</div>
          {waForm.waInstance && waForm.hasToken ? <Badge tone="good">مُهيّأ</Badge> : <Badge tone="neutral">غير مُهيّأ</Badge>}
        </div>
        <p className="mt-1 text-[12px] leading-5 text-text-dim">
          تُستخدم لإشعارات العملاء وإرسال الفواتير عبر واتساب (مركز ملاحظات الخدمة والفواتير).
          بيانات حسابك على <span dir="ltr" className="tnum">ultramsg.com</span>.
        </p>
        {waLoaded && (
          <div className="mt-3 space-y-3">
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Field label="رقم الـ Instance">
                <Input value={waForm.waInstance || ""} className="tnum" dir="ltr" placeholder="instance12345"
                       onChange={(e) => setWaForm({ ...waForm, waInstance: e.target.value })} />
              </Field>
              <Field label="التوكن (Token)" hint={waForm.hasToken ? "محفوظ — اتركه فاضياً إن لم ترد تغييره" : "لم يُحفظ بعد"}>
                <Input type="password" value={waToken} dir="ltr" placeholder={waForm.hasToken ? "••••••••" : ""}
                       onChange={(e) => setWaToken(e.target.value)} />
              </Field>
            </div>
            <ErrorNote msg={waErr} />
            <div className="flex items-center gap-2">
              <Button onClick={saveWa} disabled={waBusy}>{waBusy ? "جارِ الحفظ..." : "حفظ إعدادات واتساب"}</Button>
              {waOk && <span className="text-[12px] font-bold text-emerald">{waOk}</span>}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <Input value={testPhone} className="!w-56 tnum" dir="ltr" placeholder="05xxxxxxxx"
                     onChange={(e) => setTestPhone(e.target.value)} />
              <Button variant="ghost" onClick={sendTestWa} disabled={testBusy || !testPhone.trim()}>
                {testBusy ? "جارِ الإرسال..." : "إرسال رسالة اختبار"}
              </Button>
              {testMsg && <span className="text-[12px] font-bold text-text-dim">{testMsg}</span>}
            </div>
          </div>
        )}
      </Card>

      <Card className="!p-0">
        <div className="flex items-center justify-between px-5 pt-4">
          <div className="text-[14px] font-extrabold">سجل أحداث التكاملات</div>
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={loadLog}>
            <MIcon name="refresh" className="!text-[16px]" /> تحديث
          </Button>
        </div>
        <div className="p-5 pt-3">
          <ErrorNote msg={logErr} />
          {logLoading ? (
            <div className="py-6 text-center text-[12.5px] text-text-dim">جارِ التحميل...</div>
          ) : log.length === 0 ? (
            <EmptyState icon="hub" title="لا توجد أحداث بعد" description="هتظهر هنا كل محاولات إرسال واتساب وتأكيدات بوابة الدفع تلقائياً." />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-ink-3 text-[11px] font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الوقت</th>
                    <th className="px-2 py-2 text-right">المزوّد</th>
                    <th className="px-2 py-2 text-right">الحدث</th>
                    <th className="px-2 py-2 text-right">الحالة</th>
                    <th className="px-3 py-2 text-right">التفاصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {log.map((r) => (
                    <tr key={r.id} className="border-t border-line/70">
                      <td className="whitespace-nowrap px-3 py-1.5 text-text-dim">{fmt(r.created_at)}</td>
                      <td className="px-2 py-1.5 font-bold">{PROVIDER_LABELS[r.provider] || r.provider}</td>
                      <td className="px-2 py-1.5 text-text-dim">{r.event}</td>
                      <td className="px-2 py-1.5">
                        <Badge tone={STATUS_TONE[r.status] || "neutral"}>{STATUS_LABELS[r.status] || r.status}</Badge>
                      </td>
                      <td className="max-w-[320px] truncate px-3 py-1.5 text-text-dim" title={r.detail || ""}>{r.detail || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
