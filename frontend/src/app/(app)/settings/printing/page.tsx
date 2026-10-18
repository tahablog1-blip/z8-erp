"use client";
// الإعدادات ← الطباعة — صفحة كاملة، DB-backed بالكامل (بديل localStorage) — 7 إعدادات جديدة
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { cachePrinting } from "@/lib/printing";
import { Button, Card, ErrorNote, Field, Input, Select } from "@/components/ui";

type Printing = {
  autoPrint: boolean; footer: string; footerReturn: string;
  thermalFontSize: "normal" | "large"; thermalShowLogo: boolean; thermalShowQr: boolean;
  copies: number; previewBeforePrint: boolean;
};

const DEFAULT: Printing = {
  autoPrint: true, footer: "شكراً لتعاملكم معنا",
  footerReturn: "نعتذر عن أي إزعاج، نتمنى لكم تجربة أفضل في المرة القادمة",
  thermalFontSize: "normal", thermalShowLogo: true, thermalShowQr: true,
  copies: 1, previewBeforePrint: false,
};

export default function PrintingSettingsPage() {
  const [form, setForm] = useState<Printing>(DEFAULT);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    api<Printing>("/settings/printing").then((r) => { setForm(r); setLoaded(true); })
      .catch((e) => { setErr(e.message); setLoaded(true); });
  }, []);

  async function save() {
    setErr(""); setOk(""); setBusy(true);
    try {
      const saved = await api<Printing>("/settings/printing", { method: "PUT", body: JSON.stringify(form) });
      setForm(saved);
      cachePrinting(saved); // تحديث فوري للكاش — الفاتورة الجاية تطبّق القيم الجديدة بلا إعادة تحميل الصفحة
      setOk("تم الحفظ — الفواتير الجاية هتطبق الإعدادات دي");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  if (!loaded) return <Card>جارِ التحميل…</Card>;

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — الطباعة</h1>

      <Card>
        <div className="max-w-xl space-y-4">
          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-3">
            <div>
              <div className="text-[13px] font-bold">الطباعة التلقائية عند إصدار الفاتورة</div>
              <div className="text-[11.5px] text-text-dim">نافذة الطباعة الحرارية تفتح لوحدها فور الإصدار</div>
            </div>
            <input type="checkbox" checked={form.autoPrint} className="h-4 w-4 accent-petrol"
                   onChange={(e) => setForm({ ...form, autoPrint: e.target.checked })} />
          </label>

          <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-3">
            <div>
              <div className="text-[13px] font-bold">معاينة قبل الطباعة</div>
              <div className="text-[11.5px] text-text-dim">نافذة الطباعة تُفتح للمراجعة أولاً — الطباعة تنتظر ضغطة زر «🖨 طباعة» بدل التنفيذ التلقائي</div>
            </div>
            <input type="checkbox" checked={form.previewBeforePrint} className="h-4 w-4 accent-petrol"
                   onChange={(e) => setForm({ ...form, previewBeforePrint: e.target.checked })} />
          </label>

          <Field label="نص أسفل الفاتورة العادية (التذييل)">
            <Input value={form.footer} onChange={(e) => setForm({ ...form, footer: e.target.value })} />
          </Field>
          <Field label="نص أسفل فاتورة المرتجع (تذييل مختلف)">
            <Input value={form.footerReturn} onChange={(e) => setForm({ ...form, footerReturn: e.target.value })} />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="عدد نسخ الطباعة الافتراضي">
              <Input type="number" min={1} max={5} className="tnum" value={form.copies}
                     onChange={(e) => setForm({ ...form, copies: Math.min(5, Math.max(1, Number(e.target.value) || 1)) })} />
            </Field>
            <Field label="حجم خط الفاتورة الحرارية">
              <Select value={form.thermalFontSize}
                      onChange={(e) => setForm({ ...form, thermalFontSize: e.target.value as "normal" | "large" })}>
                <option value="normal">عادي</option>
                <option value="large">كبير</option>
              </Select>
            </Field>
          </div>

          <div className="rounded-lg border border-line p-3">
            <div className="mb-2 text-[12px] font-extrabold text-text-dim">خاصة بالفاتورة الحرارية 80مم فقط</div>
            <div className="space-y-2">
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-[12.5px] font-bold">إظهار شعار المنشأة</span>
                <input type="checkbox" checked={form.thermalShowLogo} className="h-4 w-4 accent-petrol"
                       onChange={(e) => setForm({ ...form, thermalShowLogo: e.target.checked })} />
              </label>
              <label className="flex cursor-pointer items-center justify-between">
                <span className="text-[12.5px] font-bold">إظهار رمز QR الضريبي</span>
                <input type="checkbox" checked={form.thermalShowQr} className="h-4 w-4 accent-petrol"
                       onChange={(e) => setForm({ ...form, thermalShowQr: e.target.checked })} />
              </label>
            </div>
            <p className="mt-2 text-[11px] text-text-dim">
              فاتورة A4 الضريبية الرسمية تحتفظ بالشعار و QR دايماً — مفيش تعطيل ليهم على A4 (مطلب ضريبي).
            </p>
          </div>

          <div className="rounded-lg bg-ink-3 p-3 text-[12px] text-text-dim">
            صيغ الطباعة المتاحة في كل النظام: <b>حراري 80مم</b> للكاشير والتذاكر، و<b>A4 رسمي</b> للفواتير الضريبية والتقارير وكشوف الحساب — الاختيار بيظهر عند عرض أي فاتورة.
          </div>

          <ErrorNote msg={err} />
          {ok && <p className="text-[12.5px] font-bold text-emerald">{ok}</p>}
          <div className="flex justify-end">
            <Button onClick={save} disabled={busy}>{busy ? "جارِ الحفظ..." : "حفظ إعدادات الطباعة"}</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
