"use client";
// الإعدادات ← التكاملات — إعداد مفاتيح واتساب (UltraMsg) من الشاشة بدل الضبط اليدوي
// في قاعدة البيانات مباشرة + سجل أحداث التكاملات الخارجية (واتساب، بوابة الدفع...)
import { useEffect, useState } from "react";
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
