"use client";
// شاشة الأصناف — كتالوج المنتجات (زيوت، فلاتر، سوائل...)
// مبنية على نفس نمط شاشة الفروع: DataTable موحّد + Modal + أفعال محكومة بالصلاحيات
import { useEffect, useState, useMemo, useRef } from "react";
import { api, getToken } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal , Select } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Product, productLabel, money } from "@/modules/products/types";

const EMPTY = {
  category: "", name: "", spec: "", unit: "قطعة", barcode: "",
  price: 0, costPrice: 0, minQty: 0, serviceIntervalKm: "", isService: false, isOil: false, isOilFilter: false, oilBrand: null as string | null,
};

export default function ProductsPage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm("products.create");

  // ── استيراد Excel (تصدير Odoo): الاسم/مرجع داخلي/سعر البيع (شامل الضريبة)/التكلفة/وحدة القياس/الفئة ──
  const importRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  // ── مرحلتان إلزاميتان: معاينة (بلا كتابة) ← اعتماد — لكي مصيبة الأسعار الغلط ما تتكررش ──
  type ImportPreview = {
    totalRows: number;
    columns: Record<string, string>;
    sample: { name: string; barcode: string; priceVat: string; priceEx: string | number; cost: string; unit: string; category: string }[];
    rawHeaders?: string[];
  };
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);

  async function callImport(file: File, dryRun: boolean) {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch(`/api/products/import-excel?dryRun=${dryRun}`, {
      method: "POST", body: fd,
      headers: { Authorization: `Bearer ${getToken() || ""}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || data.error || `فشل الاستيراد (${res.status})`);
    return data;
  }

  async function importExcel(file: File) {
    setImportBusy(true); setImportMsg("");
    try {
      const p = await callImport(file, true);   // معاينة فقط — صفر كتابة
      setPreview(p); setPendingFile(file);
    } catch (e) {
      setImportMsg(`❌ ${e instanceof Error ? e.message : "فشل قراءة الملف"}`);
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!pendingFile) return;
    setImportBusy(true);
    try {
      const data = await callImport(pendingFile, false);
      setImportMsg(`✅ استيراد ناجح: ${data.added} صنف جديد + ${data.updated} تحديث` +
        (data.errorsTotal ? ` — ⚠ ${data.errorsTotal} صف فيه مشكلة: ${(data.errors || []).slice(0, 3).join(" | ")}` : ""));
      setPreview(null); setPendingFile(null);
      load();
    } catch (e) {
      setImportMsg(`❌ ${e instanceof Error ? e.message : "فشل الاستيراد"}`);
    } finally { setImportBusy(false); }
  }

  async function wipeAll() {
    setWipeBusy(true);
    try {
      const res = await fetch("/api/products/wipe-all?confirm=WIPE", {
        method: "POST", headers: { Authorization: `Bearer ${getToken() || ""}` },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "فشل المسح");
      setImportMsg(`🗑 تم مسح ${data.deactivated} صنف — تاريخ الفواتير محفوظ. ارفع الملف الصحيح الآن.`);
      setWipeOpen(false); load();
    } catch (e) {
      setImportMsg(`❌ ${e instanceof Error ? e.message : "فشل المسح"}`);
    } finally { setWipeBusy(false); }
  }
  const canEdit = hasPerm("products.edit");
  const canDelete = hasPerm("products.delete");

  const [rows, setRows] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");
  const [modal, setModal] = useState<null | { mode: "create" } | { mode: "edit"; id: string }>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { setRows(await api<Product[]>("/products")); setPageErr(""); }
    catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ ...EMPTY }); setErr(""); setProdImage(null); setModal({ mode: "create" });
  }
  function openEdit(p: Product) {
    setForm({
      category: p.category || "", name: p.name, spec: p.spec || "",
      unit: p.unit || "قطعة", barcode: p.barcode || "",
      price: Number(p.price), costPrice: Number(p.cost_price), minQty: p.min_qty,
      serviceIntervalKm: p.service_interval_km == null ? "" : String(p.service_interval_km),
      isService: !!p.is_service, isOil: !!p.is_oil, isOilFilter: !!p.is_oil_filter, oilBrand: p.oil_brand,
    });
    setErr(""); setProdImage(undefined); setModal({ mode: "edit", id: p.id });
  }

  async function save() {
    setErr(""); setBusy(true);
    // الحقول الفاضية بتتبعت null مش "" — الباركود عمود فريد،
    // ولو بعتنا "" لأكتر من صنف هيرفضهم كتكرار.
    const body = {
      ...form,
      barcode: form.barcode.trim() || null,
      spec: form.spec.trim(),
      serviceIntervalKm: form.serviceIntervalKm === "" ? null : Number(form.serviceIntervalKm),
      isService: form.isService, isOil: form.isOil, isOilFilter: form.isOilFilter, oilBrand: form.oilBrand,
    };
    try {
      let savedId: string | null = null;
      if (modal?.mode === "create") {
        const created = await api<Product>("/products", { method: "POST", body: JSON.stringify(body) });
        savedId = created.id;
      } else if (modal?.mode === "edit") {
        await api(`/products/${modal.id}`, { method: "PUT", body: JSON.stringify(body) });
        savedId = modal.id;
      }
      // صورة المنتج: بتتبعت لو المستخدم غيّرها (undefined = بدون تغيير)
      if (savedId && prodImage !== undefined) {
        await api(`/products/${savedId}/image`, {
          method: "PUT", body: JSON.stringify({ imageBase64: prodImage }),
        });
      }
      setModal(null);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(p: Product) {
    if (!await appConfirm(`حذف الصنف «${productLabel(p)}»؟ الفواتير والحركات القديمة تبقى محفوظة.`)) return;
    try { await api(`/products/${p.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }

  const columns: Column<Product>[] = [
    {
      key: "name", title: "الصنف",
      render: (p) => (
        <div>
          <div className="font-extrabold">{p.name}{p.spec ? ` — ${p.spec}` : ""}</div>
          <div className="text-[11px] text-text-dim">{p.category}</div>
        </div>
      ),
    },
    { key: "unit", title: "الوحدة", width: "80px", render: (p) => p.unit || "—" },
    {
      key: "barcode", title: "الباركود", width: "130px",
      render: (p) => p.barcode
        ? <span className="tnum text-[12px]">{p.barcode}</span>
        : <span className="text-text-dim">—</span>,
    },
    {
      key: "price", title: "السعر", width: "100px",
      render: (p) => <span className="tnum font-bold">{money(p.price)}</span>,
    },
    {
      key: "price_vat", title: "شامل الضريبة", width: "110px",
      render: (p) => <span className="tnum text-text-dim">{money(p.price_vat)}</span>,
    },
    {
      key: "cost_price", title: "التكلفة", width: "100px",
      render: (p) => <span className="tnum text-text-dim">{money(p.cost_price)}</span>,
    },
    {
      key: "min_qty", title: "حد الانخفاض", width: "100px",
      render: (p) => p.min_qty > 0
        ? <span className="tnum">{p.min_qty}</span>
        : <span className="text-text-dim">—</span>,
    },
    {
      key: "service_interval_km", title: "فترة التغيير", width: "110px",
      render: (p) => p.service_interval_km
        ? <Badge tone="info">{p.service_interval_km.toLocaleString("ar-SA-u-nu-latn")} كم</Badge>
        : <span className="text-text-dim">—</span>,
    },
    ...((canEdit || canDelete) ? [{
      key: "actions", title: "", width: "150px",
      render: (p: Product) => (
        <div className="flex justify-end gap-1.5">
          {canEdit && (
            <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={() => openEdit(p)}>تعديل</Button>
          )}
          {canDelete && (
            <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={() => remove(p)}>حذف</Button>
          )}
        </div>
      ),
    } satisfies Column<Product>] : []),
  ];

  // ══════════ صور المنتجات وشركات الزيوت ══════════
  type OilBrand = { id: string; name: string; logo_base64: string | null };
  const [brands, setBrands] = useState<OilBrand[]>([]);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [brandName, setBrandName] = useState("");
  const [brandLogo, setBrandLogo] = useState<string | null>(null);
  const [brandBusy, setBrandBusy] = useState(false);
  const [brandErr, setBrandErr] = useState("");
  // تعيين المنتجات لشركة
  const [assignFor, setAssignFor] = useState<OilBrand | null>(null);
  const [assignSel, setAssignSel] = useState<Set<string>>(new Set());
  // صورة المنتج في نموذج التعديل
  const [prodImage, setProdImage] = useState<string | null | undefined>(undefined); // undefined = بدون تغيير

  async function loadBrands() {
    try { setBrands(await api<OilBrand[]>("/products/oil-brands")); } catch { /* */ }
  }
  useEffect(() => { loadBrands(); }, []);

  // مطبّع الشعارات: مربع موحد بخلفية شفافة — كل الشعارات تطلع بنفس المقاس والتوسيط
  function fileToSquareLogo(file: File, size: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = size; cv.height = size;
        const ctx = cv.getContext("2d")!;
        // احتواء الصورة في المربع مع هامش 8% موحد
        const pad = size * 0.08;
        const scale = Math.min((size - pad * 2) / img.width, (size - pad * 2) / img.height);
        const w = img.width * scale, h = img.height * scale;
        ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
        resolve(cv.toDataURL("image/png").split(",")[1]);
      };
      img.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
      img.src = URL.createObjectURL(file);
    });
  }

  // ضغط أي صورة (لوجو/منتج) لمقاس مناسب base64
  function fileToBase64(file: File, maxSide: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
        resolve(cv.toDataURL("image/jpeg", 0.85).split(",")[1]);
      };
      img.onerror = () => reject(new Error("تعذّر قراءة الصورة"));
      img.src = URL.createObjectURL(file);
    });
  }

  async function saveBrand() {
    setBrandErr(""); setBrandBusy(true);
    try {
      await api("/products/oil-brands", {
        method: "POST",
        body: JSON.stringify({ name: brandName, logoBase64: brandLogo }),
      });
      setBrandName(""); setBrandLogo(null);
      await loadBrands();
    } catch (e: any) { setBrandErr(e.message); }
    finally { setBrandBusy(false); }
  }

  async function removeBrand(b: OilBrand) {
    if (!await appConfirm(`حذف شركة «${b.name}»؟ (المنتجات المرتبطة هتفضل بدون شركة)`)) return;
    try { await api(`/products/oil-brands/${b.id}`, { method: "DELETE" }); await loadBrands(); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }

  function openAssign(b: OilBrand) {
    // تحديد مسبق ذكي: المعيّن للشركة + اللي اسمه فيه اسم الشركة
    const pre = new Set<string>();
    rows.filter((r) => r.is_oil).forEach((r) => {
      if (r.oil_brand === b.name || r.name.includes(b.name)) pre.add(r.id);
    });
    setAssignSel(pre);
    setAssignFor(b);
  }

  async function saveAssign() {
    if (!assignFor) return;
    setBrandBusy(true);
    try {
      await api(`/products/oil-brands/${assignFor.id}/assign`, {
        method: "POST", body: JSON.stringify({ productIds: Array.from(assignSel) }),
      });
      setAssignFor(null);
      await load();
    } catch (e: any) { await appAlert(e.message); }
    finally { setBrandBusy(false); }
  }

  // ══════════ منظف الأسماء الذكي ══════════
  const [cleanOpen, setCleanOpen] = useState(false);
  const [cleanBusy, setCleanBusy] = useState(false);
  const [cleanErr, setCleanErr] = useState("");
  const [cleanRes, setCleanRes] = useState<null | { scanned: number; changed: number; applied: boolean;
    remaining: number; items: { id: string; old: string; name: string; spec: string | null }[] }>(null);

  async function runClean(apply: boolean) {
    setCleanErr(""); setCleanBusy(true);
    try {
      const r = await api<typeof cleanRes>("/products/ai-clean-names", {
        method: "POST", body: JSON.stringify({ apply, onlyOils: true }),
      });
      setCleanRes(r);
      if (apply) await load();
    } catch (e: any) { setCleanErr(e.message); }
    finally { setCleanBusy(false); }
  }

  // ══════════ قواعد تسعير الخدمة حسب السيارة ══════════
  type ServiceRule = { id: string; service_product_id: string; product_name: string; product_category: string | null;
                       brand: string | null; model: string | null; year_from: number | null; year_to: number | null; price: number };
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<ServiceRule[]>([]);
  const [ruleForm, setRuleForm] = useState({ serviceProductId: "", brand: "", model: "", yearFrom: "", yearTo: "", price: "" });
  const [ruleBusy, setRuleBusy] = useState(false);
  const [ruleErr, setRuleErr] = useState("");
  const serviceProducts = useMemo(() => rows.filter((r) => r.is_service), [rows]);

  async function loadRules() {
    try { setRules(await api<ServiceRule[]>("/products/service-price-rules")); } catch { /* */ }
  }
  async function addRule() {
    setRuleErr(""); setRuleBusy(true);
    try {
      await api("/products/service-price-rules", {
        method: "POST",
        body: JSON.stringify({
          serviceProductId: ruleForm.serviceProductId,
          brand: ruleForm.brand.trim() || null, model: ruleForm.model.trim() || null,
          yearFrom: ruleForm.yearFrom ? Number(ruleForm.yearFrom) : null,
          yearTo: ruleForm.yearTo ? Number(ruleForm.yearTo) : null,
          price: Number(ruleForm.price),
        }),
      });
      setRuleForm({ ...ruleForm, brand: "", model: "", yearFrom: "", yearTo: "", price: "" });
      await loadRules();
    } catch (e: any) { setRuleErr(e.message); }
    finally { setRuleBusy(false); }
  }
  async function removeRule(id: string) {
    try { await api(`/products/service-price-rules/${id}`, { method: "DELETE" }); await loadRules(); }
    catch (e: any) { await appAlert(e.message); }
  }

  // ══════════ المصنّف الذكي الجماعي ══════════
  const [clsOpen, setClsOpen] = useState(false);
  const [clsBusy, setClsBusy] = useState(false);
  const [clsErr, setClsErr] = useState("");
  const [clsPreview, setClsPreview] = useState<null | {
    scanned: number; classified: number; aiClassified?: number; unclassified: number;
    unclassifiedSamples?: string[]; applied: boolean;
    byCategory: { category: string; count: number; samples: string[]; isOil: boolean; isOilFilter: boolean }[];
  }>(null);

  // ── توزيع شركات الزيوت التلقائي ──
  const [autoBrand, setAutoBrand] = useState<null | {
    scanned: number; assigned: number; aiAssigned: number; unassigned: number;
    unassignedSamples: string[]; applied: boolean; byBrand: { brand: string; count: number }[]; error?: string;
  }>(null);
  const [autoBrandBusy, setAutoBrandBusy] = useState(false);
  async function runAutoBrand(apply: boolean) {
    setAutoBrandBusy(true);
    try {
      setAutoBrand(await api("/products/oil-brands/auto-assign", { method: "POST", body: JSON.stringify({ apply }) }));
    } catch (e) { setAutoBrand({ scanned: 0, assigned: 0, aiAssigned: 0, unassigned: 0, unassignedSamples: [], applied: false, byBrand: [], error: e instanceof Error ? e.message : "فشل" }); }
    finally { setAutoBrandBusy(false); }
  }

  async function runClassify(apply: boolean) {
    setClsErr(""); setClsBusy(true);
    try {
      const r = await api<typeof clsPreview>("/products/auto-classify", {
        method: "POST", body: JSON.stringify({ apply, onlyUncategorized: true }),
      });
      setClsPreview(r);
      if (apply) await load();
    } catch (e: any) { setClsErr(e.message); }
    finally { setClsBusy(false); }
  }

  return (
    <div className="space-y-4">
      {importMsg && (
        <div className={`rounded-lg px-4 py-2.5 text-[12.5px] font-bold ${importMsg.startsWith("✅") ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>
          {importMsg}
          <button onClick={() => setImportMsg("")} className="mr-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">الأصناف</h1>
        <span className="text-[12px] text-text-dim tnum">{rows.length} صنف نشط</span>
      </div>

      <ErrorNote msg={pageErr} />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          searchKeys={["name", "category", "spec", "barcode"]}
          searchPlaceholder="بحث بالاسم أو الفئة أو الباركود..."
          emptyText="لا توجد أصناف بعد — أضف أول صنف"
          toolbar={canCreate && <div className="flex gap-2">
            <input ref={importRef} type="file" accept=".xlsx" hidden
                   onChange={(e) => e.target.files?.[0] && importExcel(e.target.files[0])} />
            <Button variant="ghost" disabled={importBusy} onClick={() => importRef.current?.click()}>
              {importBusy ? "جارٍ القراءة…" : "📥 استيراد Excel"}
            </Button>
            {hasPerm("products.delete") && (
              <Button variant="danger" onClick={() => setWipeOpen(true)}>🗑 مسح كل الأصناف</Button>
            )}
            <Button variant="ghost" onClick={() => { setCleanOpen(true); setCleanRes(null); setCleanErr(""); }}>
              🧽 تنظيف الأسماء AI
            </Button>
            <Button variant="ghost" onClick={() => { setRulesOpen(true); setRuleErr(""); loadRules(); }}>
              💼 أسعار الخدمة
            </Button>
            <Button variant="ghost" onClick={() => { setBrandsOpen(true); setBrandErr(""); }}>
              🏷️ شركات الزيوت
            </Button>
            <Button variant="ghost" onClick={() => { setClsOpen(true); setClsPreview(null); setClsErr(""); }}>
              🪄 تصنيف ذكي
            </Button>
            <Button onClick={openCreate}>+ صنف جديد</Button>
          </div>}
        />
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)}
             title={modal?.mode === "create" ? "صنف جديد" : "تعديل الصنف"}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="الاسم / الشركة المصنعة">
              <Input value={form.name} autoFocus
                     onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="اللزوجة / المواصفة">
              <Input value={form.spec} placeholder="5W-30"
                     onChange={(e) => setForm({ ...form, spec: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="الفئة" hint="اتركها فارغة وتُستنتج من الاسم">
              <Input value={form.category} placeholder="زيوت"
                     onChange={(e) => setForm({ ...form, category: e.target.value })} />
            </Field>
            <Field label="الوحدة">
              <Input value={form.unit}
                     onChange={(e) => setForm({ ...form, unit: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="سعر البيع (قبل الضريبة)">
              <Input type="number" min={0} step="0.01" className="tnum" value={form.price}
                     onChange={(e) => setForm({ ...form, price: +e.target.value || 0 })} />
            </Field>
            <Field label="سعر التكلفة">
              <Input type="number" min={0} step="0.01" className="tnum" value={form.costPrice}
                     onChange={(e) => setForm({ ...form, costPrice: +e.target.value || 0 })} />
            </Field>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <Field label="الباركود">
              <Input value={form.barcode} className="tnum"
                     onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </Field>
            <Field label="حد الانخفاض">
              <Input type="number" min={0} className="tnum" value={form.minQty}
                     onChange={(e) => setForm({ ...form, minQty: +e.target.value || 0 })} />
            </Field>
            <Field label="فترة التغيير (كم)">
              <Input type="number" min={0} className="tnum" value={form.serviceIntervalKm}
                     placeholder="للزيوت فقط"
                     onChange={(e) => setForm({ ...form, serviceIntervalKm: e.target.value })} />
            </Field>
            <label className="col-span-full flex cursor-pointer items-center justify-between rounded-lg border border-line bg-ink-3 px-3 py-2.5">
              <div>
                <div className="text-[12.5px] font-bold">صنف خدمة (بدون مخزون)</div>
                <div className="text-[11px] text-text-dim">
                  خدمة تُقدَّم وليست بضاعة تُشترى — تُباع بكمية ثابتة، ولا تظهر في المشتريات أو التحويلات المخزنية
                </div>
              </div>
              <input type="checkbox" checked={form.isService} className="h-4 w-4 shrink-0 accent-petrol"
                     onChange={(e) => setForm({ ...form, isService: e.target.checked })} />
            </label>
            <label className="col-span-full flex cursor-pointer items-center justify-between rounded-lg border border-line bg-ink-3 px-3 py-2.5">
              <div>
                <div className="text-[12.5px] font-bold">صنف زيت 🛢️</div>
                <div className="text-[11px] text-text-dim">يظهر كخيار في بوابة اختيار الزيت الذاتية للعميل</div>
              </div>
              <input type="checkbox" checked={form.isOil} className="h-4 w-4 shrink-0 accent-petrol"
                     onChange={(e) => setForm({ ...form, isOil: e.target.checked })} />
            </label>
            <div className="col-span-full grid gap-2 sm:grid-cols-2">
              <Field label="صورة المنتج (تظهر للعميل في بوابة الزيت)">
                <div className="flex items-center gap-2">
                  {prodImage ? (
                    <img src={`data:image/jpeg;base64,${prodImage}`} alt="صورة" className="h-12 w-12 rounded-lg border border-line object-contain" />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-line text-[20px]"
                          title={prodImage === undefined ? "الصورة الحالية محفوظة — ارفع لتغييرها" : ""}>🖼️</span>
                  )}
                  <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-[11.5px] font-bold hover:border-petrol">
                    رفع صورة
                    <input type="file" accept="image/*" hidden
                           onChange={async (e) => {
                             const f = e.target.files?.[0]; if (!f) return;
                             try { setProdImage(await fileToBase64(f, 400)); } catch { /* */ }
                             e.target.value = "";
                           }} />
                  </label>
                  {prodImage && (
                    <button type="button" onClick={() => setProdImage(null)}
                            className="text-[11px] font-bold text-ember hover:underline">حذف</button>
                  )}
                </div>
              </Field>
              {form.isOil && (
                <Field label="شركة الزيت">
                  <Select value={form.oilBrand || ""} onChange={(e) => setForm({ ...form, oilBrand: e.target.value || null })}>
                    <option value="">— بدون شركة —</option>
                    {brands.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <label className="col-span-full flex cursor-pointer items-center justify-between rounded-lg border border-line bg-ink-3 px-3 py-2.5">
              <div>
                <div className="text-[12.5px] font-bold">فلتر زيت 🔧</div>
                <div className="text-[11px] text-text-dim">يُضاف تلقائياً لو العميل اختار "مع فلتر" في بوابة الزيت</div>
              </div>
              <input type="checkbox" checked={form.isOilFilter} className="h-4 w-4 shrink-0 accent-petrol"
                     onChange={(e) => setForm({ ...form, isOilFilter: e.target.checked })} />
            </label>
          </div>

          <p className="text-[11px] leading-5 text-text-dim">
            السعر شامل الضريبة بيتحسب تلقائياً في قاعدة البيانات من سعر البيع ونسبة ضريبة الشركة.
          </p>

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button>
            <Button onClick={save} disabled={busy || form.name.trim().length < 1}>
              {busy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ المصنّف الذكي الجماعي ══════════ */}
      <Modal open={clsOpen} size="lg" onClose={() => setClsOpen(false)} title="🪄 التصنيف الذكي الجماعي">
        <div className="space-y-3">
          {!clsPreview && (
            <>
              <p className="text-[12.5px] leading-relaxed text-text-dim">
                بيقرأ أسماء كل الأصناف غير المصنفة (تصنيفها "أخرى" أو فارغ) ويصنفها تلقائياً بقواعد
                مفردات قطاع خدمة السيارات: زيوت، فلاتر زيت/هواء/مكيف، قير ودفرنس، مناشف، سوائل تبريد،
                بواجي، بطاريات... — <b>وبيفعّل "صنف زيت" و"فلتر زيت" تلقائياً لبوابة اختيار الزيت</b>.
                ستشاهد المعاينة أولاً ولن يحدث أي تغيير قبل الضغط على تطبيق.
              </p>
              <Button className="w-full justify-center" disabled={clsBusy} onClick={() => runClassify(false)}>
                {clsBusy ? "جارِ الفحص..." : "🔍 معاينة التصنيف (بدون تغيير)"}
              </Button>
            </>
          )}

          {clsPreview && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-ink-3 p-2">
                  <div className="tnum text-[17px] font-black">{clsPreview.scanned}</div>
                  <div className="text-[10.5px] text-text-dim">تم فحصها</div>
                </div>
                <div className="rounded-lg bg-emerald-bg p-2">
                  <div className="tnum text-[17px] font-black text-emerald">{clsPreview.classified}</div>
                  <div className="text-[10.5px] text-text-dim">{clsPreview.applied ? "اتصنفت ✓" : "هتتصنف"}</div>
                </div>
                <div className="rounded-lg bg-ink-3 p-2">
                  <div className="tnum text-[17px] font-black text-text-dim">{clsPreview.unclassified}</div>
                  <div className="text-[10.5px] text-text-dim">تحتاج تصنيفاً يدوياً</div>
                </div>
              </div>
              {(clsPreview.aiClassified ?? 0) > 0 && (
                <p className="rounded-lg bg-petrol-soft px-3 py-1.5 text-[11.5px] font-bold">
                  🤖 حسم الذكاء الاصطناعي {clsPreview.aiClassified} صنف لم تطابق القواعد — باختيار مغلق من فئاتك
                </p>
              )}
              {clsPreview.unclassified > 0 && clsPreview.unclassifiedSamples && clsPreview.unclassifiedSamples.length > 0 && (
                <p className="text-[11px] text-text-dim">أمثلة المتبقي: {clsPreview.unclassifiedSamples.join(" · ")}</p>
              )}

              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-line p-2">
                {clsPreview.byCategory.map((c) => (
                  <div key={c.category} className="rounded-lg bg-ink-3 px-3 py-2">
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="font-black">
                        {c.category}
                        {c.isOil && <span className="mr-1.5 rounded-full bg-brass-soft px-2 py-0.5 text-[9.5px] font-bold text-brass">🛢️ زيت</span>}
                        {c.isOilFilter && <span className="mr-1.5 rounded-full bg-petrol-soft px-2 py-0.5 text-[9.5px] font-bold text-petrol">🔧 فلتر زيت</span>}
                      </span>
                      <span className="tnum font-black text-petrol">{c.count}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10.5px] text-text-dim">
                      أمثلة: {c.samples.join(" · ")}
                    </div>
                  </div>
                ))}
              </div>

              <ErrorNote msg={clsErr} />
              {clsPreview.applied ? (
                <div className="rounded-lg bg-emerald-bg px-3 py-2.5 text-center text-[13px] font-black text-emerald">
                  ✓ تم التطبيق — {clsPreview.classified} صنف اتصنفوا، والمتبقي {clsPreview.unclassified} تصنفهم يدوياً براحتك
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 justify-center" onClick={() => setClsPreview(null)}>رجوع</Button>
                  <Button className="flex-[2] justify-center" disabled={clsBusy} onClick={() => runClassify(true)}>
                    {clsBusy ? "جارِ التطبيق..." : `✓ تطبيق التصنيف على ${clsPreview.classified} صنف`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* ══════════ مدير شركات الزيوت ══════════ */}
      <Modal open={brandsOpen} size="lg" onClose={() => setBrandsOpen(false)} title="🏷️ شركات الزيوت (لبوابة العميل)">
        <div className="space-y-3">
          <p className="text-[12px] text-text-dim">
            العميل في بوابة اختيار الزيت بيشوف الشركات دي بشعاراتها أولاً، وبعدها منتجات الشركة اللي يختارها.
          </p>

          {/* ── التوزيع التلقائي: كل زيت إلى شركته — قواعد ثم ذكاء ── */}
          <div className="rounded-xl border border-line bg-ink-3/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[12.5px] font-black">⚡ توزيع الزيوت على الشركات تلقائياً</div>
              <Button variant="ghost" className="!py-1.5 !text-[11.5px]" disabled={autoBrandBusy}
                      onClick={() => runAutoBrand(false)}>
                {autoBrandBusy ? "جارِ الفحص…" : "معاينة التوزيع"}
              </Button>
            </div>
            {autoBrand && (
              <div className="mt-2 space-y-2 text-[11.5px]">
                {autoBrand.error ? <p className="font-bold text-ember">{autoBrand.error}</p> : (
                  <>
                    <p className="font-bold">
                      {autoBrand.scanned} زيت بلا شركة → <span className="text-emerald">{autoBrand.assigned} سيتم توزيعها</span>
                      {autoBrand.aiAssigned > 0 && <span> (منهم 🤖 {autoBrand.aiAssigned} بالذكاء)</span>}
                      {autoBrand.unassigned > 0 && <span className="text-text-dim"> · {autoBrand.unassigned} يحتاجون تصنيفاً يدوياً</span>}
                    </p>
                    {autoBrand.byBrand.length > 0 && (
                      <p className="text-text-dim">{autoBrand.byBrand.map((b) => `${b.brand}: ${b.count}`).join(" · ")}</p>
                    )}
                    {autoBrand.unassigned > 0 && autoBrand.unassignedSamples.length > 0 && (
                      <p className="text-text-dim">أمثلة: {autoBrand.unassignedSamples.join(" · ")}</p>
                    )}
                    {autoBrand.applied ? (
                      <p className="font-black text-emerald">✓ اتطبق التوزيع</p>
                    ) : autoBrand.assigned > 0 && (
                      <Button className="!py-1.5 !text-[11.5px]" disabled={autoBrandBusy}
                              onClick={() => runAutoBrand(true)}>
                        ✓ تطبيق التوزيع على {autoBrand.assigned} صنف
                      </Button>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
          {brands.length > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {brands.map((b) => (
                <div key={b.id} className="rounded-xl border border-line p-2.5 text-center">
                  <div className="grid h-12 w-full place-items-center">
                    {b.logo_base64
                      ? <img src={`data:image/png;base64,${b.logo_base64}`} alt={b.name} loading="lazy" decoding="async"
                             className="max-h-full max-w-[80%] object-contain" />
                      : <MIcon name="verified" className="!text-[26px] text-[#64748B]" />}
                  </div>
                  <div className="mt-1 text-[12.5px] font-black">{b.name}</div>
                  <div className="mt-1.5 flex justify-center gap-1">
                    <button onClick={() => openAssign(b)}
                            className="rounded-md bg-petrol px-2 py-1 text-[10.5px] font-bold text-white hover:brightness-110">
                      تعيين المنتجات
                    </button>
                    <button onClick={() => removeBrand(b)}
                            className="rounded-md px-2 py-1 text-[10.5px] font-bold text-ember hover:bg-ember-bg">حذف</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="grid gap-2 rounded-xl border border-dashed border-line p-3 sm:grid-cols-[1fr_auto_auto]">
            <Input value={brandName} placeholder="اسم الشركة — مثال: شيل، موبيل، كاسترول"
                   onChange={(e) => setBrandName(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-[11.5px] font-bold hover:border-petrol">
              {brandLogo ? "✓ الشعار جاهز" : "رفع الشعار"}
              <input type="file" accept="image/*" hidden
                     onChange={async (e) => {
                       const f = e.target.files?.[0]; if (!f) return;
                       try { setBrandLogo(await fileToSquareLogo(f, 240)); } catch { /* */ }
                       e.target.value = "";
                     }} />
            </label>
            <Button onClick={saveBrand} disabled={brandBusy || !brandName.trim()}>
              {brandBusy ? "..." : "+ إضافة"}
            </Button>
          </div>
          <ErrorNote msg={brandErr} />
        </div>
      </Modal>

      {/* ══════════ تعيين منتجات لشركة ══════════ */}
      <Modal open={!!assignFor} size="lg" onClose={() => setAssignFor(null)}
             title={`تعيين الزيوت لشركة «${assignFor?.name || ""}»`}>
        <div className="space-y-3">
          <p className="text-[12px] text-text-dim">
            حدّد المنتجات التابعة للشركة — المطابق لاسم الشركة اتحدد تلقائياً، راجع وعدّل ثم احفظ.
            المحدد: <b className="tnum">{assignSel.size}</b>
          </p>
          <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.filter((r) => r.is_oil).map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[12.5px] hover:bg-ink-3">
                <input type="checkbox" checked={assignSel.has(r.id)} className="h-4 w-4 accent-petrol"
                       onChange={(e) => {
                         const next = new Set(assignSel);
                         e.target.checked ? next.add(r.id) : next.delete(r.id);
                         setAssignSel(next);
                       }} />
                <span className="flex-1 font-bold">{productLabel(r)}</span>
                {r.oil_brand && r.oil_brand !== assignFor?.name && (
                  <span className="rounded-full bg-ink-3 px-2 py-0.5 text-[10px] text-text-dim">حالياً: {r.oil_brand}</span>
                )}
              </label>
            ))}
            {rows.filter((r) => r.is_oil).length === 0 && (
              <p className="p-6 text-center text-[12px] text-text-dim">
                لا توجد أصناف زيت بعد — شغّل "🪄 تصنيف ذكي" أولاً أو فعّل "صنف زيت" على المنتجات
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAssignFor(null)}>إلغاء</Button>
            <Button onClick={saveAssign} disabled={brandBusy}>
              {brandBusy ? "جارِ الحفظ..." : `✓ حفظ التعيين (${assignSel.size})`}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ قواعد تسعير الخدمة حسب السيارة ══════════ */}
      <Modal open={rulesOpen} size="lg" onClose={() => setRulesOpen(false)} title="💼 أسعار الخدمة حسب السيارة">
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-text-dim">
            حدد سعر الخدمة لكل نوع سيارة — والنظام بينزّل الخدمة <b>تلقائياً بالسعر الصح</b> في طلب العميل
            حسب ماركته وموديله وسنة صنعه. <b>الأخص بيكسب</b>: (تويوتا + كامري + 2020-2024) بتغلب (تويوتا) العامة،
            وقاعدة بدون ماركة = السعر الافتراضي لكل السيارات.
          </p>

          <div className="grid gap-2 rounded-xl border border-dashed border-line p-3 sm:grid-cols-2">
            <Field label="الخدمة (من أصنافك المعلّمة 🛠 خدمة)">
              <Select value={ruleForm.serviceProductId} onChange={(e) => setRuleForm({ ...ruleForm, serviceProductId: e.target.value })}>
                <option value="">— اختر الخدمة —</option>
                {serviceProducts.map((p: Product) => <option key={p.id} value={p.id}>{productLabel(p)}</option>)}
              </Select>
            </Field>
            <Field label="السعر شامل الضريبة (ر.س)">
              <Input value={ruleForm.price} inputMode="decimal" placeholder="مثال: 40"
                     onChange={(e) => setRuleForm({ ...ruleForm, price: e.target.value.replace(/[^0-9.]/g, "") })} />
            </Field>
            <Field label="الماركة (فارغ = كل السيارات)">
              <Input value={ruleForm.brand} placeholder="تويوتا" onChange={(e) => setRuleForm({ ...ruleForm, brand: e.target.value })} />
            </Field>
            <Field label="الموديل (اختياري)">
              <Input value={ruleForm.model} placeholder="كامري" onChange={(e) => setRuleForm({ ...ruleForm, model: e.target.value })} />
            </Field>
            <Field label="من سنة (اختياري)">
              <Input value={ruleForm.yearFrom} inputMode="numeric" placeholder="2015"
                     onChange={(e) => setRuleForm({ ...ruleForm, yearFrom: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </Field>
            <Field label="إلى سنة (اختياري)">
              <Input value={ruleForm.yearTo} inputMode="numeric" placeholder="2024"
                     onChange={(e) => setRuleForm({ ...ruleForm, yearTo: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </Field>
            <div className="sm:col-span-2">
              <Button className="w-full justify-center" disabled={ruleBusy || !ruleForm.serviceProductId || !ruleForm.price}
                      onClick={addRule}>
                {ruleBusy ? "..." : "+ إضافة القاعدة"}
              </Button>
            </div>
          </div>
          <ErrorNote msg={ruleErr} />

          <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rules.length === 0 && <p className="p-5 text-center text-[12px] text-text-dim">لا قواعد بعد — ابدأ بقاعدة افتراضية بدون ماركة</p>}
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2 text-[12.5px]">
                <span>
                  <b>{r.brand || "كل السيارات"}</b>
                  {r.model && <span className="text-text-dim"> · {r.model}</span>}
                  {(r.year_from || r.year_to) && (
                    <span className="tnum text-text-dim"> · {r.year_from || "..."}-{r.year_to || "..."}</span>
                  )}
                  <span className="mr-2 rounded-full bg-ink-3 px-2 py-0.5 text-[10px] text-text-dim">{r.product_name}</span>
                </span>
                <span className="flex items-center gap-2">
                  <b className="tnum text-petrol">{r.price.toFixed(2)} ر.س</b>
                  <button onClick={() => removeRule(r.id)} className="mi-hover rounded-md px-1.5 py-1 text-text-dim hover:bg-ember-bg hover:text-ember">
                    <MIcon name="delete" className="!text-[16px]" />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      </Modal>

      {/* ══════════ منظف الأسماء الذكي ══════════ */}
      <Modal open={cleanOpen} size="lg" onClose={() => setCleanOpen(false)} title="🧽 تنظيف أسماء الأصناف بالذكاء">
        <div className="space-y-3">
          <p className="text-[12px] leading-relaxed text-text-dim">
            بيعيد صياغة الأسماء المستوردة الفوضوية لأسماء عربية نظيفة ويستخرج اللزوجة والسعة —
            <b> دفعة 120 صنف في المرة</b> (الزيوت أولاً). الاسم الأصلي بيتحفظ ومش بيضيع،
            وبتشوف المعاينة قبل التطبيق. كرر العملية لحد ما "المتبقي" يوصل صفر.
          </p>
          {!cleanRes && (
            <Button className="w-full justify-center" disabled={cleanBusy} onClick={() => runClean(false)}>
              {cleanBusy ? "الذكاء بيشتغل... (نص دقيقة تقريباً)" : "🔍 معاينة الدفعة الأولى"}
            </Button>
          )}
          <ErrorNote msg={cleanErr} />
          {cleanRes && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-ink-3 p-2"><div className="tnum text-[16px] font-black">{cleanRes.scanned}</div><div className="text-[10px] text-text-dim">اتفحصت</div></div>
                <div className="rounded-lg bg-emerald-bg p-2"><div className="tnum text-[16px] font-black text-emerald">{cleanRes.changed}</div><div className="text-[10px] text-text-dim">{cleanRes.applied ? "اتنظفت ✓" : "هتتنظف"}</div></div>
                <div className="rounded-lg bg-ink-3 p-2"><div className="tnum text-[16px] font-black text-text-dim">{cleanRes.remaining}</div><div className="text-[10px] text-text-dim">متبقي</div></div>
              </div>
              <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-line p-2">
                {cleanRes.items.map((it) => (
                  <div key={it.id} className="rounded-lg bg-ink-3 px-3 py-1.5 text-[11.5px]">
                    <div className="truncate text-text-dim line-through">{it.old}</div>
                    <div className="font-black">{it.name}{it.spec ? <span className="mr-2 text-petrol">{it.spec}</span> : null}</div>
                  </div>
                ))}
                {cleanRes.items.length === 0 && <p className="p-4 text-center text-[12px] text-text-dim">لا تغييرات في الدفعة دي</p>}
              </div>
              {cleanRes.applied ? (
                <Button className="w-full justify-center" disabled={cleanBusy} onClick={() => runClean(false)}>
                  {cleanBusy ? "..." : `↻ الدفعة التالية (متبقي ${cleanRes.remaining})`}
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 justify-center" onClick={() => setCleanRes(null)}>إلغاء</Button>
                  <Button className="flex-[2] justify-center" disabled={cleanBusy || cleanRes.changed === 0} onClick={() => runClean(true)}>
                    {cleanBusy ? "..." : `✓ تطبيق التنظيف (${cleanRes.changed})`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>
      {/* ══════════ معاينة الاستيراد — القرار قبل الكتابة ══════════ */}
      <Modal open={!!preview} onClose={() => { setPreview(null); setPendingFile(null); }}
             title={`معاينة الاستيراد — ${preview?.totalRows ?? 0} صنف في الملف`}>
        {preview && (
          <div className="space-y-3">
            <div className="rounded-lg bg-ink-2 p-3 text-[12px]">
              <div className="mb-1 font-black">الأعمدة اللي اتقرت من ملفك:</div>
              <div className="grid grid-cols-2 gap-1 text-text-dim">
                <span>الاسم ← {preview.columns.name}</span>
                <span>الباركود ← {preview.columns.barcode}</span>
                <span>السعر شامل الضريبة ← {preview.columns.price_vat}</span>
                <span>التكلفة ← {preview.columns.cost}</span>
                <span>الوحدة ← {preview.columns.unit}</span>
                <span>الفئة ← {preview.columns.category}</span>
              </div>
            </div>
            {Object.values(preview.columns).some((v) => v.startsWith("❌")) && (
              <div className="rounded-lg bg-ember-bg p-3 text-[11.5px]">
                <div className="mb-1 font-black text-ember">⚠ يوجد عمود غير متعرف عليه — هذه عناوين ملفك حرفياً:</div>
                <div className="tnum flex flex-wrap gap-1.5">
                  {(preview.rawHeaders || []).map((h, i) => (
                    <span key={i} className="rounded-md bg-white px-2 py-0.5 font-bold text-slate-700">{h || "(فارغ)"}</span>
                  ))}
                </div>
                <div className="mt-1.5 text-text-dim">صوّر هذا الصندوق وأرسله — إضافة الاسم الناقص للمطابقة سطر واحد.</div>
              </div>
            )}
            <div className="overflow-hidden rounded-lg border border-line">
              <table className="w-full text-[11.5px]">
                <thead className="bg-ink-2 font-black text-text-dim">
                  <tr>
                    <th className="px-2 py-1.5 text-right">الاسم</th>
                    <th className="px-2 py-1.5">شامل الضريبة</th>
                    <th className="px-2 py-1.5">الصافي</th>
                    <th className="px-2 py-1.5">التكلفة</th>
                    <th className="px-2 py-1.5 text-left">الباركود</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.sample.map((s, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="px-2 py-1.5 font-bold">{s.name}</td>
                      <td className="tnum px-2 py-1.5 text-center font-black text-emerald">{s.priceVat}</td>
                      <td className="tnum px-2 py-1.5 text-center text-text-dim">{s.priceEx}</td>
                      <td className="tnum px-2 py-1.5 text-center">{s.cost}</td>
                      <td className="tnum px-2 py-1.5 text-left text-text-dim">{s.barcode}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11.5px] text-text-dim">
              ⚠ راجع عمود "شامل الضريبة" — إذا كانت هذه الأرقام مطابقة لأسعار البيع الفعلية لديك، فاعتمد.
              الموجود بنفس الباركود سيتم تحديثه، والجديد سيُضاف — دون أي تكرار.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 justify-center"
                      disabled={importBusy || preview.columns.price_vat?.startsWith("❌")}
                      onClick={confirmImport}>
                {preview.columns.price_vat?.startsWith("❌")
                  ? "⛔ الاعتماد متوقف — عمود السعر غير متعرف عليه"
                  : importBusy ? "جارٍ الاعتماد…" : `✓ اعتماد استيراد ${preview.totalRows} صنف`}
              </Button>
              <Button variant="ghost" onClick={() => { setPreview(null); setPendingFile(null); }}>إلغاء</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════ تأكيد المسح الشامل ══════════ */}
      <Modal open={wipeOpen} onClose={() => setWipeOpen(false)} title="🗑 مسح كل الأصناف">
        <div className="space-y-3">
          <p className="text-[13px] font-bold text-ember">هتمسح كل الأصناف النشطة ({rows.length} صنف) من النظام.</p>
          <p className="text-[12px] text-text-dim">
            المسح آمن على البيانات التاريخية: الفواتير القديمة وحركات المخزون تبقى كما هي.
            بعد المسح ارفع ملف الإكسل الصحيح وسيبدأ على صفحة نظيفة.
          </p>
          <div className="flex gap-2">
            <Button variant="danger" className="flex-1 justify-center" disabled={wipeBusy} onClick={wipeAll}>
              {wipeBusy ? "جارٍ المسح…" : "نعم — امسح الكل نهائياً"}
            </Button>
            <Button variant="ghost" onClick={() => setWipeOpen(false)}>تراجع</Button>
          </div>
        </div>
      </Modal>

    </div>
  );
}
