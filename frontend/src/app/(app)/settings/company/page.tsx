"use client";
// الإعدادات ← المنشأة — صفحة كاملة: بيانات الشركة (كاملة) + الشعار + إشعارات واتساب
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cacheCompany } from "@/lib/company";
import { Button, Card, ErrorNote, Field, Input, PageHeader } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { SaveBar } from "@/components/settings/SettingsContext";
import { toast } from "@/components/toast";

type Company = {
  name: string; name_en: string | null; trade_name: string | null;
  vat_number: string | null; cr_number: string | null;
  unified_number: string | null; establishment_number: string | null;
  phone: string | null; mobile: string | null; email: string | null; website: string | null;
  address: string | null; building_no: string | null; street: string | null;
  district: string | null; city: string | null; postal_code: string | null; additional_no: string | null;
  country: string; currency: string; default_lang: string;
  has_logo: boolean; logo_url: string | null;
};

const EMPTY: Company = {
  name: "", name_en: null, trade_name: null, vat_number: null, cr_number: null,
  unified_number: null, establishment_number: null, phone: null, mobile: null,
  email: null, website: null, address: null, building_no: null, street: null,
  district: null, city: null, postal_code: null, additional_no: null,
  country: "SA", currency: "SAR", default_lang: "ar", has_logo: false, logo_url: null,
};

export default function CompanySettingsPage() {
  const { hasPerm } = useAuth();
  const canCompany = hasPerm("settings.company");

  const [form, setForm] = useState<Company>(EMPTY);
  const [initial, setInitial] = useState<string>(JSON.stringify(EMPTY));   // لقطة آخر حالة محفوظة — لكشف التغييرات غير المحفوظة
  const dirty = JSON.stringify(form) !== initial;
  const [coBusy, setCoBusy] = useState(false);
  const [coErr, setCoErr] = useState("");
  const [coOk, setCoOk] = useState("");

  // ── الشعار ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoErr, setLogoErr] = useState("");

  // ── إعداد واتساب (UltraMsg) ──
  const [waInstance, setWaInstance] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waMsg, setWaMsg] = useState("");

  // ── برنامج نقاط الولاء ──
  const [loyalty, setLoyalty] = useState({ earnPerSar: "0", redeemValue: "0" });
  const [loyaltyBusy, setLoyaltyBusy] = useState(false);
  const [loyaltyMsg, setLoyaltyMsg] = useState("");

  function set<K extends keyof Company>(k: K, v: Company[K]) { setForm((f) => ({ ...f, [k]: v })); }

  useEffect(() => {
    if (!canCompany) return;
    api<Company>("/settings/company").then((c) => { setForm(c); setInitial(JSON.stringify(c)); }).catch((e) => setCoErr(e.message));
    api<{ waInstance: string; waToken: string }>("/auth/wa-settings")
      .then((r) => { setWaInstance(r.waInstance); setWaToken(r.waToken); }).catch(() => {});
    api<{ earnPerSar: number; redeemValue: number }>("/settings/loyalty")
      .then((r) => setLoyalty({ earnPerSar: String(r.earnPerSar), redeemValue: String(r.redeemValue) })).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveLoyalty() {
    setLoyaltyMsg(""); setLoyaltyBusy(true);
    try {
      const r = await api<{ earnPerSar: number; redeemValue: number }>("/settings/loyalty", {
        method: "PUT",
        body: JSON.stringify({ earnPerSar: Number(loyalty.earnPerSar) || 0, redeemValue: Number(loyalty.redeemValue) || 0 }),
      });
      setLoyalty({ earnPerSar: String(r.earnPerSar), redeemValue: String(r.redeemValue) });
      setLoyaltyMsg("تم الحفظ");
    } catch (e: any) { setLoyaltyMsg(e.message); }
    finally { setLoyaltyBusy(false); }
  }

  async function saveCompany() {
    setCoErr(""); setCoOk(""); setCoBusy(true);
    try {
      const saved = await api<Company>("/settings/company", { method: "PUT", body: JSON.stringify(form) });
      setForm(saved); setInitial(JSON.stringify(saved));
      cacheCompany({
        name: saved.name, vat: saved.vat_number || "", cr: saved.cr_number || "",
        address: saved.address || "", phone: saved.phone || "",
        logoUrl: saved.logo_url || "",
      });
      toast.success("تم حفظ التغييرات بنجاح — ستستخدم المطبوعات البيانات الجديدة فوراً.");
    } catch (e: any) { setCoErr(e.message); }
    finally { setCoBusy(false); }
  }

  function pickLogo() { fileRef.current?.click(); }

  async function onLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setLogoErr("الملف المختار مش صورة"); return; }
    // السيرفر بيصغّر وبيضغط أي شعار تلقائياً مهما كانت صيغته أو دقته (PNG بشفافية، JPG، ..)،
    // فالسقف هنا للحماية من ملف ضخم جداً بس — مش قيد حقيقي على الاستخدام العادي
    if (file.size > 15_000_000) { setLogoErr("حجم الملف أكبر من 15 ميجابايت — اختر صورة أصغر"); return; }
    setLogoErr(""); setLogoBusy(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const r = await api<{ has_logo: boolean; logo_url: string | null }>(
        "/settings/company/logo", { method: "PUT", body: JSON.stringify({ logoBase64: b64 }) });
      setForm((f) => ({ ...f, has_logo: r.has_logo, logo_url: r.logo_url }));
      cacheCompany({ logoUrl: r.logo_url || "" });
    } catch (err: any) { setLogoErr(err.message || "تعذر رفع الشعار"); }
    finally { setLogoBusy(false); }
  }

  async function removeLogo() {
    setLogoBusy(true); setLogoErr("");
    try {
      await api("/settings/company/logo", { method: "PUT", body: JSON.stringify({ logoBase64: null }) });
      setForm((f) => ({ ...f, has_logo: false, logo_url: null }));
      cacheCompany({ logoUrl: "" });
    } catch (err: any) { setLogoErr(err.message || "تعذر حذف الشعار"); }
    finally { setLogoBusy(false); }
  }

  async function saveWa() {
    try {
      await api("/auth/wa-settings", { method: "PUT", body: JSON.stringify({ waInstance, waToken }) });
      setWaMsg("تم الحفظ — إشعارات العميل والفواتير ستُرسل تلقائياً");
    } catch (e) { setWaMsg(`${e instanceof Error ? e.message : "فشل الحفظ"}`); }
  }

  if (!canCompany) return <Card>لا تملك صلاحية «بيانات الشركة والمظهر».</Card>;

  return (
    <div className="space-y-4">
      <PageHeader title="الإعدادات — المنشأة" description="بيانات المنشأة والشعار والتواصل." />

      <Card>
        <h2 className="mb-2 text-t-md font-black">الشعار</h2>
        <p className="mb-3 text-t-sm text-text-dim">يظهر في ترويسة الفواتير المطبوعة (حراري وA4) بدل الشعار الافتراضي.</p>
        <div className="flex flex-wrap items-center gap-4">
          <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-card border border-line bg-ink-3">
            {form.has_logo && form.logo_url
              ? <img src={form.logo_url} alt="شعار المنشأة" className="h-full w-full object-contain" />
              : <MIcon name="apartment" className="!text-[28px] text-text-dim" />}
          </div>
          <div className="space-y-1.5">
            <div className="flex gap-2">
              <Button variant="outline" onClick={pickLogo} disabled={logoBusy}>
                {logoBusy ? "جارِ المعالجة..." : form.has_logo ? "تغيير الشعار" : "رفع شعار"}
              </Button>
              {form.has_logo && (
                <Button variant="ghost" onClick={removeLogo} disabled={logoBusy}>إزالة</Button>
              )}
            </div>
            <p className="text-t-xs text-text-dim">PNG أو JPG — أقل من 1.5 ميجابايت</p>
            <ErrorNote msg={logoErr} />
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onLogoFile} />
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-t-md font-black">بيانات أساسية</h2>
        <div className="max-w-3xl space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="اسم المنشأة (عربي)">
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="اسم المنشأة (إنجليزي)">
              <Input dir="ltr" value={form.name_en || ""} onChange={(e) => set("name_en", e.target.value)} />
            </Field>
          </div>
          <Field label="الاسم التجاري">
            <Input value={form.trade_name || ""} onChange={(e) => set("trade_name", e.target.value)} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="الرقم الضريبي (VAT)" hint="15 رقماً يبدأ بـ3">
              <Input className="tnum" dir="ltr" value={form.vat_number || ""} onChange={(e) => set("vat_number", e.target.value)} />
            </Field>
            <Field label="السجل التجاري (CR)">
              <Input className="tnum" dir="ltr" value={form.cr_number || ""} onChange={(e) => set("cr_number", e.target.value)} />
            </Field>
            <Field label="الرقم الموحّد">
              <Input className="tnum" dir="ltr" value={form.unified_number || ""} onChange={(e) => set("unified_number", e.target.value)} />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-t-md font-black">التواصل</h2>
        <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
          <Field label="الهاتف (يظهر بالفاتورة)">
            <Input className="tnum" dir="ltr" value={form.phone || ""} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field label="الجوال" hint="05xxxxxxxx">
            <Input className="tnum" dir="ltr" value={form.mobile || ""} onChange={(e) => set("mobile", e.target.value)} />
          </Field>
          <Field label="البريد الإلكتروني">
            <Input dir="ltr" type="email" value={form.email || ""} onChange={(e) => set("email", e.target.value)} />
          </Field>
          <Field label="الموقع الإلكتروني">
            <Input dir="ltr" value={form.website || ""} onChange={(e) => set("website", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-t-md font-black">العنوان</h2>
        <div className="grid max-w-3xl gap-2 sm:grid-cols-2">
          <Field label="العنوان المختصر (يظهر بالفاتورة)">
            <Input value={form.address || ""} onChange={(e) => set("address", e.target.value)} />
          </Field>
          <Field label="المدينة">
            <Input value={form.city || ""} onChange={(e) => set("city", e.target.value)} />
          </Field>
          <Field label="الحي">
            <Input value={form.district || ""} onChange={(e) => set("district", e.target.value)} />
          </Field>
          <Field label="الشارع">
            <Input value={form.street || ""} onChange={(e) => set("street", e.target.value)} />
          </Field>
          <Field label="رقم المبنى">
            <Input className="tnum" value={form.building_no || ""} onChange={(e) => set("building_no", e.target.value)} />
          </Field>
          <Field label="الرمز البريدي">
            <Input className="tnum" dir="ltr" value={form.postal_code || ""} onChange={(e) => set("postal_code", e.target.value)} />
          </Field>
          <Field label="الرقم الإضافي">
            <Input className="tnum" dir="ltr" value={form.additional_no || ""} onChange={(e) => set("additional_no", e.target.value)} />
          </Field>
        </div>
      </Card>

      <SaveBar dirty={dirty} busy={coBusy} error={coErr && dirty ? coErr : ""} onSave={saveCompany} onCancel={() => setForm(JSON.parse(initial))} />
      {coErr && !dirty && <ErrorNote msg={coErr} />}

      <Card>
        <h2 className="mb-2 text-t-md font-black">إشعارات واتساب للعملاء</h2>
        <p className="mb-3 text-t-xs text-text-dim">
          عند التفعيل: العميل يستلم "سيارتك جاهزة" فور اعتماد أمر العمل، وفاتورته PDF فور إتمام الدفع.
          البيانات من حسابك في ultramsg.com (Instance ID + Token).
        </p>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Field label="Instance ID">
            <Input value={waInstance} onChange={(e) => setWaInstance(e.target.value)} placeholder="instance186155" />
          </Field>
          <Field label="Token">
            <Input value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="xxxxxxxx" />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveWa}>حفظ إعداد واتساب</Button>
          {waMsg && <span className="text-t-sm font-bold">{waMsg}</span>}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-t-md font-black">برنامج نقاط الولاء</h2>
        <p className="mb-3 text-t-xs text-text-dim">
          صفر في أي خانة = ميزتها معطّلة. الاكتساب يحصل تلقائياً عند إصدار أي فاتورة لعميل مسجّل،
          والاستبدال يتم من صفحة العميل نفسه. البرنامج مستقل عن كشف الحساب ولا يُنشئ قيوداً محاسبية.
        </p>
        <div className="grid max-w-2xl gap-3 sm:grid-cols-2">
          <Field label="معدّل الاكتساب (نقطة لكل 1 ر.س)" hint="مثال: 0.1 = نقطة واحدة كل 10 ر.س">
            <Input type="number" min={0} step="0.01" className="tnum" value={loyalty.earnPerSar}
                   onChange={(e) => setLoyalty({ ...loyalty, earnPerSar: e.target.value })} />
          </Field>
          <Field label="قيمة النقطة عند الاستبدال (ر.س)" hint="مثال: 0.05 = كل نقطة تساوي 5 هللات">
            <Input type="number" min={0} step="0.01" className="tnum" value={loyalty.redeemValue}
                   onChange={(e) => setLoyalty({ ...loyalty, redeemValue: e.target.value })} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveLoyalty} disabled={loyaltyBusy}>{loyaltyBusy ? "جارِ الحفظ..." : "حفظ إعداد النقاط"}</Button>
          {loyaltyMsg && <span className="text-t-sm font-bold">{loyaltyMsg}</span>}
        </div>
      </Card>
    </div>
  );
}
