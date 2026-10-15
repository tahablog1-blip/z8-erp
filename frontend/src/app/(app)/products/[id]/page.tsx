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
            <Field label="الاسم"><Input value={form.name} disabled={dis} onChange={(e) => set("name", e.target.value)} /></Field>
            <Field label="الفئة"><Input value={form.category} disabled={dis} onChange={(e) => set("category", e.target.value)} /></Field>
            <Field label="المواصفة / اللزوجة"><Input value={form.spec} disabled={dis} onChange={(e) => set("spec", e.target.value)} /></Field>
            <Field label="الوحدة"><Input value={form.unit} disabled={dis} onChange={(e) => set("unit", e.target.value)} /></Field>
            <Field label="الباركود"><Input dir="ltr" value={form.barcode} disabled={dis} onChange={(e) => set("barcode", e.target.value)} /></Field>
            <Field label="الحد الأدنى للمخزون"><Input inputMode="numeric" value={form.minQty} disabled={dis} onChange={(e) => set("minQty", e.target.value)} /></Field>
            <Field label="سعر البيع (قبل الضريبة)" hint={`شامل الضريبة: ${money(p.price_vat)}`}>
              <Input inputMode="decimal" value={form.price} disabled={dis} onChange={(e) => set("price", e.target.value)} />
            </Field>
            <Field label="التكلفة (آخر سعر شراء)"><Input inputMode="decimal" value={form.costPrice} disabled={dis} onChange={(e) => set("costPrice", e.target.value)} /></Field>
            <Field label="شركة الزيت"><Input value={form.oilBrand} disabled={dis} onChange={(e) => set("oilBrand", e.target.value)} /></Field>
            <Field label="فترة التغيير (كم)"><Input inputMode="numeric" value={form.serviceIntervalKm} disabled={dis} onChange={(e) => set("serviceIntervalKm", e.target.value)} /></Field>
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
