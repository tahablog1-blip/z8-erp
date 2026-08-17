"use client";
// الإعدادات ← المنشأة — صفحة كاملة: بيانات الشركة + إشعارات واتساب
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cacheCompany } from "@/lib/company";
import { Button, Card, ErrorNote, Field, Input } from "@/components/ui";

type Company = {
  name: string; vat_number: string | null; cr_number: string | null;
  address: string | null; phone: string | null;
};

export default function CompanySettingsPage() {
  const { hasPerm } = useAuth();
  const canCompany = hasPerm("settings.company");

  const [form, setForm] = useState<Company>({ name: "", vat_number: "", cr_number: "", address: "", phone: "" });
  const [coBusy, setCoBusy] = useState(false);
  const [coErr, setCoErr] = useState("");
  const [coOk, setCoOk] = useState("");

  // ── 📲 إعداد واتساب (UltraMsg) ──
  const [waInstance, setWaInstance] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waMsg, setWaMsg] = useState("");

  useEffect(() => {
    if (!canCompany) return;
    api<Company>("/settings/company")
      .then((c) => setForm({ ...c, vat_number: c.vat_number || "", cr_number: c.cr_number || "", address: c.address || "", phone: c.phone || "" }))
      .catch((e) => setCoErr(e.message));
    api<{ waInstance: string; waToken: string }>("/auth/wa-settings")
      .then((r) => { setWaInstance(r.waInstance); setWaToken(r.waToken); }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function saveCompany() {
    setCoErr(""); setCoOk(""); setCoBusy(true);
    try {
      const saved = await api<Company>("/settings/company", { method: "PUT", body: JSON.stringify(form) });
      cacheCompany({
        name: saved.name, vat: saved.vat_number || "", cr: saved.cr_number || "",
        address: saved.address || "", phone: saved.phone || "",
      });
      setCoOk("تم الحفظ — كل المطبوعات هتستخدم البيانات الجديدة فوراً");
    } catch (e: any) { setCoErr(e.message); }
    finally { setCoBusy(false); }
  }

  async function saveWa() {
    try {
      await api("/auth/wa-settings", { method: "PUT", body: JSON.stringify({ waInstance, waToken }) });
      setWaMsg("✅ تم الحفظ — إشعارات العميل والفواتير ستُرسل تلقائياً");
    } catch (e) { setWaMsg(`❌ ${e instanceof Error ? e.message : "فشل الحفظ"}`); }
  }

  if (!canCompany) return <Card>لا تملك صلاحية «بيانات الشركة والمظهر».</Card>;

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — المنشأة</h1>

      <Card>
        <h2 className="mb-2 text-[14px] font-black">🏢 بيانات المنشأة</h2>
        <p className="mb-3 text-[12px] text-text-dim">البيانات دي بتظهر في ترويسة كل الفواتير والتقارير المطبوعة.</p>
        <div className="max-w-2xl space-y-3">
          <Field label="اسم المنشأة">
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الرقم الضريبي (VAT)">
              <Input className="tnum" value={form.vat_number || ""} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
            </Field>
            <Field label="السجل التجاري (CR)">
              <Input className="tnum" value={form.cr_number || ""} onChange={(e) => setForm({ ...form, cr_number: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الهاتف (يظهر بالفاتورة)">
              <Input className="tnum" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="العنوان">
              <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>
          <ErrorNote msg={coErr} />
          {coOk && <p className="text-[12.5px] font-bold text-emerald">{coOk}</p>}
          <div className="flex justify-end">
            <Button onClick={saveCompany} disabled={coBusy || !form.name.trim()}>
              {coBusy ? "جارِ الحفظ..." : "حفظ البيانات"}
            </Button>
          </div>
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 text-[14px] font-black">📲 إشعارات واتساب للعملاء</h2>
        <p className="mb-3 text-[11.5px] text-text-dim">
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
          {waMsg && <span className="text-[12px] font-bold">{waMsg}</span>}
        </div>
      </Card>
    </div>
  );
}
