"use client";
// صفحة الصنف — بيانات كاملة + أرصدة كل موقع + آخر الحركات
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, Card, ErrorNote, Field, Input } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Product, money } from "@/modules/products/types";

type Stock = { locType: string; locId: string; locName: string; qty: number };
type Move = {
  type: string; qty: number; moveNo: string | null; note: string | null;
  supplier: string | null; unitCost: number | null; createdAt: string | null;
  fromLoc: string; toLoc: string;
};
type Detail = { product: Product; stock: Stock[]; totalStock: number; moves: Move[] };

type Form = {
  category: string; name: string; spec: string; unit: string; barcode: string;
  price: string; costPrice: string; minQty: string; serviceIntervalKm: string;
  isService: boolean; isOil: boolean; isOilFilter: boolean; oilBrand: string;
};

const MOVE_TYPE: Record<string, string> = { receive: "استلام", transfer: "تحويل" };

function toForm(p: Product): Form {
  return {
    category: p.category || "", name: p.name || "", spec: p.spec || "",
    unit: p.unit || "", barcode: p.barcode || "",
    price: String(p.price ?? 0), costPrice: String(p.cost_price ?? 0),
    minQty: String(p.min_qty ?? 0),
    serviceIntervalKm: p.service_interval_km == null ? "" : String(p.service_interval_km),
    isService: !!p.is_service, isOil: !!p.is_oil, isOilFilter: !!p.is_oil_filter,
    oilBrand: p.oil_brand || "",
  };
}

function EditCopyInput({
  value,
  disabled,
  onChange,
  ...rest
}: {
  value: string;
  disabled?: boolean;
  onChange: (v: string) => void;
} & Omit<React.ComponentProps<typeof Input>, "value" | "onChange" | "disabled">) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    const text = String(value ?? "");
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        // fallback للسياقات اللي الـ Clipboard API مش متاحة فيها (http أو بدون صلاحية)
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // المتصفح مانع النسخ
    }
  };

  return (
    <div className="relative">
      <Input
        {...rest}
        value={value}
        disabled={!!disabled || !editing}
        onChange={(e) => onChange(e.target.value)}
        className="pe-16 text-right"
      />

      <div className="absolute inset-y-0 end-1.5 flex items-center gap-0.5">
        <button
          type="button"
          title={editing ? "إغلاق التعديل" : "تعديل"}
          disabled={!!disabled}
          onClick={() => setEditing((v) => !v)}
          className={`rounded-md p-1 transition hover:bg-ink-3 disabled:cursor-not-allowed disabled:opacity-40 ${
            editing ? "text-petrol" : "text-text-dim"
          }`}
        >
          <MIcon
            name={editing ? "lock_open" : "edit"}
            className="!text-[18px]"
          />
        </button>

        <button
          type="button"
          title="نسخ"
          onClick={copy}
          className={`rounded-md p-1 transition hover:bg-ink-3 ${
            copied ? "text-emerald" : "text-text-dim"
          }`}
        >
          <MIcon
            name={copied ? "check" : "content_copy"}
            className="!text-[18px]"
          />
        </button>
      </div>
    </div>
  );
}

export default function ProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasPerm } = useAuth();
  const canEdit = hasPerm("products.edit");
  const canDelete = hasPerm("products.delete");

  const [d, setD] = useState<Detail | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api<Detail>(`/products/${id}/detail`);
      setD(r);
      setForm(toForm(r.product));
      setErr("");
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  function set<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((f) => (f ? { ...f, [k]: v } : f));
  }

  async function save() {
    if (!form || !canEdit || busy) return;
    const price = Number(form.price);
    const cost = Number(form.costPrice);
    const minQty = Number(form.minQty);
    if (!form.name.trim() || !form.category.trim()) { setErr("الاسم والفئة مطلوبان"); return; }
    if (![price, cost, minQty].every((n) => Number.isFinite(n) && n >= 0)) {
      setErr("السعر والتكلفة والحد الأدنى لازم يكونوا أرقاماً غير سالبة"); return;
    }
    const interval = form.serviceIntervalKm.trim() === "" ? null : Number(form.serviceIntervalKm);
    if (interval !== null && (!Number.isFinite(interval) || interval < 0)) {
      setErr("فترة التغيير لازم تكون رقماً غير سالب"); return;
    }
    setBusy(true); setErr(""); setOkMsg("");
    try {
      await api(`/products/${id}`, {
        method: "PUT",
        body: JSON.stringify({
          category: form.category.trim(),
          name: form.name.trim(),
          spec: form.spec.trim() || null,
          unit: form.unit.trim() || "قطعة",
          barcode: form.barcode.trim() || null,
          price, costPrice: cost, minQty: Math.round(minQty),
          serviceIntervalKm: interval,
          isService: form.isService, isOil: form.isOil, isOilFilter: form.isOilFilter,
          oilBrand: form.oilBrand.trim() || null,
        }),
      });
      setOkMsg("تم الحفظ");
      await load();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!d || !canDelete) return;
    if (!await appConfirm(`حذف الصنف «${d.product.name}»؟ الفواتير والحركات القديمة تبقى محفوظة.`)) return;
    try {
      await api(`/products/${id}`, { method: "DELETE" });
      router.push("/products");
    } catch (e: any) {
      await appAlert(e.message);
    }
  }

  const back = (
    <Link href="/products" className="inline-flex items-center gap-1 text-[12.5px] font-bold text-petrol">
      <MIcon name="arrow_forward" className="!text-[16px]" /> الأصناف
    </Link>
  );

  if (loading && !d) return <div className="space-y-3">{back}<p className="text-[13px] text-text-dim">جارِ التحميل...</p></div>;
  if (!d || !form) return <div className="space-y-3">{back}<ErrorNote msg={err || "الصنف غير موجود"} /></div>;

  const p = d.product;
  const names = new Map(d.stock.map((s) => [`${s.locType}:${s.locId}`, s.locName]));
  const locLabel = (s: string) =>
    !s ? "—" : names.get(s) || (s.startsWith("warehouse") ? "المستودع" : s.startsWith("branch") ? "فرع" : s);
  const dis = !canEdit;

  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[19px] font-extrabold">{p.name}{p.spec ? ` — ${p.spec}` : ""}</h1>
        <div className="flex gap-2">
          {canEdit && <Button onClick={save} disabled={busy}>{busy ? "جارِ الحفظ..." : "حفظ"}</Button>}
          {canDelete && <Button variant="ghost" onClick={remove} disabled={busy}>حذف</Button>}
        </div>
      </div>

      <ErrorNote msg={err} />
      {okMsg && <div className="rounded-lg bg-emerald-bg px-4 py-2.5 text-[12.5px] font-bold text-emerald">{okMsg}</div>}

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="space-y-3 p-4 md:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الاسم"><EditCopyInput value={form.name} disabled={dis} onChange={(v) => set("name", v)} /></Field>
            <Field label="الفئة"><EditCopyInput value={form.category} disabled={dis} onChange={(v) => set("category", v)} /></Field>
            <Field label="المواصفة / اللزوجة"><EditCopyInput value={form.spec} disabled={dis} onChange={(v) => set("spec", v)} /></Field>
            <Field label="الوحدة"><EditCopyInput value={form.unit} disabled={dis} onChange={(v) => set("unit", v)} /></Field>
            <Field label="الباركود"><EditCopyInput dir="ltr" value={form.barcode} disabled={dis} onChange={(v) => set("barcode", v)} /></Field>
            <Field label="الحد الأدنى للمخزون"><EditCopyInput inputMode="numeric" value={form.minQty} disabled={dis} onChange={(v) => set("minQty", v)} /></Field>
            <Field label="سعر البيع (قبل الضريبة)" hint={`شامل الضريبة: ${money(p.price_vat)}`}>
              <EditCopyInput inputMode="decimal" value={form.price} disabled={dis} onChange={(v) => set("price", v)} />
            </Field>
            <Field label="التكلفة (آخر سعر شراء)"><EditCopyInput inputMode="decimal" value={form.costPrice} disabled={dis} onChange={(v) => set("costPrice", v)} /></Field>
            <Field label="شركة الزيت"><EditCopyInput value={form.oilBrand} disabled={dis} onChange={(v) => set("oilBrand", v)} /></Field>
            <Field label="فترة التغيير (كم)"><EditCopyInput inputMode="numeric" value={form.serviceIntervalKm} disabled={dis} onChange={(v) => set("serviceIntervalKm", v)} /></Field>
          </div>
          <div className="flex flex-wrap gap-4 pt-1 text-[12.5px] font-bold">
            <label className="flex items-center gap-2"><input type="checkbox" disabled={dis} checked={form.isService} onChange={(e) => set("isService", e.target.checked)} /> صنف خدمة (بدون مخزون)</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={dis} checked={form.isOil} onChange={(e) => set("isOil", e.target.checked)} /> زيت (بوابة العميل)</label>
            <label className="flex items-center gap-2"><input type="checkbox" disabled={dis} checked={form.isOilFilter} onChange={(e) => set("isOilFilter", e.target.checked)} /> فلتر زيت</label>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="flex items-center justify-center p-4">
            {p.has_image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/products/public/product-image/${p.id}`} alt={p.name} className="max-h-48 rounded-xl object-contain" />
            ) : (
              <div className="flex h-32 w-full items-center justify-center rounded-xl bg-ink-3">
                <MIcon name="inventory_2" className="!text-[44px] text-text-dim" />
              </div>
            )}
          </Card>
          <Card className="space-y-2 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-extrabold">المخزون</h2>
              {p.is_service ? <Badge>خدمة</Badge> : <b className="tnum text-[15px]">{d.totalStock}</b>}
            </div>
            {p.is_service ? (
              <p className="text-[12px] text-text-dim">صنف خدمة — لا يُتتبع له مخزون.</p>
            ) : d.stock.length === 0 ? (
              <p className="text-[12px] text-text-dim">لا توجد أرصدة مسجلة.</p>
            ) : (
              <ul className="divide-y divide-line text-[12.5px]">
                {d.stock.map((s) => (
                  <li key={`${s.locType}:${s.locId}`} className="flex justify-between py-1.5">
                    <span>{s.locName}</span><b className="tnum">{s.qty}</b>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <Card className="p-4">
        <h2 className="mb-2 text-[13px] font-extrabold">آخر حركات المخزون</h2>
        {d.moves.length === 0 ? (
          <p className="text-[12px] text-text-dim">لا توجد حركات.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line text-text-dim">
                  <th className="p-2 text-right">التاريخ</th>
                  <th className="p-2 text-right">النوع</th>
                  <th className="p-2 text-right">الكمية</th>
                  <th className="p-2 text-right">من</th>
                  <th className="p-2 text-right">إلى</th>
                  <th className="p-2 text-right">ملاحظة</th>
                </tr>
              </thead>
              <tbody>
                {d.moves.map((m, i) => (
                  <tr key={i} className="border-b border-line/60">
                    <td className="p-2 tnum">{m.createdAt ? new Date(m.createdAt).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn")) : "—"}</td>
                    <td className="p-2">{MOVE_TYPE[m.type] || m.type}</td>
                    <td className="p-2 font-bold tnum">{m.qty}</td>
                    <td className="p-2">{locLabel(m.fromLoc)}</td>
                    <td className="p-2">{locLabel(m.toLoc)}</td>
                    <td className="p-2">{m.supplier || m.note || m.moveNo || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
