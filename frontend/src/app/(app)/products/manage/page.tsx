"use client";
// شاشة الأصناف — كتالوج المنتجات (زيوت، فلاتر، سوائل...)
// مبنية على نفس نمط شاشة الفروع: DataTable موحّد + Modal + أفعال محكومة بالصلاحيات
import { useEffect, useState, useMemo, useRef } from "react";
import { api, authHeaders } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Switch, PageHeader } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Product, ProductLink, productLabel, money } from "@/modules/products/types";
import ProductCards from "@/components/ProductCards";

const EMPTY = {
  category: "", name: "", spec: "", unit: "قطعة", barcode: "", sku: "",
  price: 0, costPrice: 0, minQty: 0, serviceIntervalKm: "", isService: false, isOil: false, isOilFilter: false, oilBrand: null as string | null,
  oilType: null as string | null, // للزيت: نوعه — للخدمة: نوع الزيت اللي تتطلبه (يحصر الاقتراح في بوابة الحجز)
};

/** قائمة منسدلة قابلة للبحث بموضع ثابت تحت الحقل دائماً — بديل <select>
 *  الافتراضي الذي يفتح لأعلى أو لأسفل حسب مساحة الشاشة (سلوك غير منضبط
 *  ظهر واضحاً في شاشة "فلاتر السيارات"). تسمح أيضاً بالكتابة الحرة كخيار
 *  احتياطي لو القائمة المقترحة ناقصة بيانات (مشكلة بيانات قديمة غير موحّدة). */
function SearchSelect({ value, onChange, options, placeholder, disabled }: {
  value: string; onChange: (v: string) => void; options: string[];
  placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const filtered = q.trim()
    ? options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" disabled={disabled}
        onClick={() => { setOpen(!open); setQ(""); }}
        className="flex w-full items-center justify-between rounded-card border border-line bg-ink-2 px-3 py-2 text-t-sm font-bold disabled:opacity-50"
        style={{ minHeight: 38 }}>
        <span className={value ? "" : "text-text-dim"}>{value || placeholder || "— اختر —"}</span>
        <MIcon name={open ? "expand_less" : "expand_more"} className="!text-[16px] text-text-dim" />
      </button>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-card border border-line bg-ink-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="بحث..." className="w-full border-b border-line px-3 py-2 text-t-sm outline-none" />
          <div className="max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2.5 text-t-sm text-text-dim">
                لا يوجد مطابق — اكتب اسماً جديداً واضغط Enter
              </div>
            ) : filtered.map((o) => (
              <button key={o} type="button"
                onClick={() => { onChange(o); setOpen(false); setQ(""); }}
                className="block w-full px-3 py-2 text-right text-t-sm font-bold hover:bg-ink-3">
                {o}
              </button>
            ))}
          </div>
          {q.trim() && (
            <button type="button"
              onClick={() => { onChange(q.trim()); setOpen(false); setQ(""); }}
              className="block w-full border-t border-line px-3 py-2 text-right text-t-xs font-bold text-petrol hover:bg-ink-3">
              + استخدام "{q.trim()}" كما هو
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** بحث حي في كل الأصناف (بالاسم أو الباركود) — بلا اشتراط أي تصنيف مسبق.
 *  بديل الاعتماد على filter_kind وحده، الذي قد يكون غير مكتمل أو غير محدّث
 *  في لحظة الاستخدام؛ البحث المباشر بالاسم/الباركود أضمن وأسرع دائماً. */
function ProductSearchSelect({ value, onChange, products, placeholder, disabled }: {
  value: string; onChange: (id: string) => void; products: Product[];
  placeholder?: string; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const selected = products.find((p) => p.id === value);
  const query = q.trim().toLowerCase();
  const filtered = query
    ? products.filter((p) =>
      productLabel(p).toLowerCase().includes(query) ||
      (p.barcode || "").toLowerCase().includes(query)
    ).slice(0, 50)
    : products.slice(0, 50);

  return (
    <div className="relative" ref={boxRef}>
      <button type="button" disabled={disabled}
        onClick={() => { setOpen(!open); setQ(""); }}
        className="flex w-full items-center justify-between rounded-card border border-line bg-ink-2 px-3 py-2 text-t-sm font-bold disabled:opacity-50"
        style={{ minHeight: 38 }}>
        <span className={selected ? "" : "text-text-dim"}>
          {selected ? productLabel(selected) : (placeholder || "— اختر —")}
        </span>
        <MIcon name={open ? "expand_less" : "expand_more"} className="!text-[16px] text-text-dim" />
      </button>
      {open && !disabled && (
        <div className="absolute z-30 mt-1 w-full rounded-card border border-line bg-ink-2 shadow-lg">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="بحث بالاسم أو الباركود..."
            className="w-full border-b border-line px-3 py-2 text-t-sm outline-none" />
          <div className="max-h-64 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="px-3 py-2.5 text-t-sm text-text-dim">لا يوجد مطابق</div>
            ) : filtered.map((p) => (
              <button key={p.id} type="button"
                onClick={() => { onChange(p.id); setOpen(false); setQ(""); }}
                className="flex w-full items-center justify-between px-3 py-2 text-right hover:bg-ink-3">
                <span className="text-t-sm font-bold">{productLabel(p)}</span>
                {p.barcode && <span className="tnum text-t-xs text-text-dim">{p.barcode}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProductsPage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm("products.create");

  // ── استيراد Excel (تصدير Odoo): الاسم/مرجع داخلي/سعر البيع (شامل الضريبة)/التكلفة/وحدة القياس/الفئة ──
  const importRef = useRef<HTMLInputElement>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMsg, setImportMsg] = useState("");
  const [importOk, setImportOk] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  // ── مرحلتان إلزاميتان: معاينة (بلا كتابة) ← اعتماد — لكي مصيبة الأسعار الغلط ما تتكررش ──
  type ImportPreview = {
    totalRows: number;
    columns: Record<string, string>;
    sample: { name: string; barcode: string; priceVat: string; priceEx: string | number; cost: string; unit: string; category: string }[];
    rawHeaders?: string[];
    categories?: { name: string; count: number; kind: string; mix?: Record<string, number> }[];
  };
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  // نوع الصنف لكل فئة في الملف (تُدخَل الفئة كما هي، والنوع يحدد: خدمة/زيت/فلتر/عادي)
  const [catKinds, setCatKinds] = useState<Record<string, string>>({});
  const KIND_LABELS: [string, string][] = [["normal", "عادي"], ["service", "خدمة"], ["oil", "زيت"], ["filter", "فلتر"]];
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeBusy, setWipeBusy] = useState(false);

  const [syncAll, setSyncAll] = useState(false);
  async function callImport(file: File, dryRun: boolean, kinds?: Record<string, string>, sync = false) {
    const fd = new FormData();
    fd.append("file", file);
    if (!dryRun && kinds) fd.append("categoryKinds", JSON.stringify(kinds));
    if (!dryRun && sync) fd.append("sync", "1");
    const res = await fetch(`/api/products/import-excel?dryRun=${dryRun}`, {
      method: "POST", body: fd,
      headers: authHeaders(),
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
      setCatKinds(Object.fromEntries((p.categories || []).map((c: { name: string; kind: string }) => [c.name, c.kind])));
    } catch (e) {
      setImportOk(false); setImportMsg(`${e instanceof Error ? e.message : "فشل قراءة الملف"}`);
    } finally {
      setImportBusy(false);
      if (importRef.current) importRef.current.value = "";
    }
  }

  async function confirmImport() {
    if (!pendingFile) return;
    setImportBusy(true);
    try {
      // نرسل فقط ما غيّره المستخدم؛ الباقي يُحسم لكل صنف من فئة المنتج الدقيقة (Engine Oil / Air Filters / …)
      const changed = Object.fromEntries((preview?.categories || [])
        .filter((c) => catKinds[c.name] && catKinds[c.name] !== c.kind).map((c) => [c.name, catKinds[c.name]]));
      const data = await callImport(pendingFile, false, changed, syncAll);
      setImportOk(true); setImportMsg(`استيراد ناجح: ${data.added} صنف جديد + ${data.updated} تحديث` +
        (data.deactivated ? ` — عُطّل ${data.deactivated} صنف غير موجود في الملف` : "") +
        (data.syncSkipped ? " — لم يُعطَّل شيء لوجود صفوف فيها مشاكل (أصلحها وأعد الاستيراد)" : "") +
        (data.warningsTotal ? ` — ${data.warningsTotal} صف حُدّث سعره/تكلفته فقط لأن اسمه وفئته مكرران مع صنف آخر (مثال: ${(data.warnings || [])[0]})` : "") +
        (data.errorsTotal ? ` — ${data.errorsTotal} صف فيه مشكلة: ${(data.errors || []).slice(0, 3).join(" | ")}` : ""));
      setPreview(null); setPendingFile(null); setSyncAll(false);
      load();
    } catch (e) {
      setImportOk(false); setImportMsg(`${e instanceof Error ? e.message : "فشل الاستيراد"}`);
    } finally { setImportBusy(false); }
  }

  async function wipeAll() {
    setWipeBusy(true);
    try {
      const res = await fetch("/api/products/wipe-all?confirm=WIPE", {
        method: "POST", headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "فشل المسح");
      setImportOk(true); setImportMsg(`تم مسح ${data.deactivated} صنف — تاريخ الفواتير محفوظ. ارفع الملف الصحيح الآن.`);
      setWipeOpen(false); load();
    } catch (e) {
      setImportOk(false); setImportMsg(`${e instanceof Error ? e.message : "فشل المسح"}`);
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
      unit: p.unit || "قطعة", barcode: p.barcode || "", sku: p.sku || "",
      price: Number(p.price), costPrice: Number(p.cost_price), minQty: p.min_qty,
      serviceIntervalKm: p.service_interval_km == null ? "" : String(p.service_interval_km),
      isService: !!p.is_service, isOil: !!p.is_oil, isOilFilter: !!p.is_oil_filter, oilBrand: p.oil_brand,
      oilType: p.oil_type ?? null,
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
      sku: form.sku.trim() || null,
      spec: form.spec.trim(),
      serviceIntervalKm: form.serviceIntervalKm === "" ? null : Number(form.serviceIntervalKm),
      isService: form.isService, isOil: form.isOil, isOilFilter: form.isOilFilter, oilBrand: form.oilBrand,
      oilType: form.oilType,
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

  // ══════════ الأصناف البديلة/المرتبطة ══════════
  const [linksModal, setLinksModal] = useState<Product | null>(null);
  const [links, setLinks] = useState<ProductLink[]>([]);
  const [linksErr, setLinksErr] = useState("");
  const [linksBusy, setLinksBusy] = useState(false);
  const [linkPickId, setLinkPickId] = useState("");
  const [linkType, setLinkType] = useState<"substitute" | "related">("substitute");

  async function loadLinks(productId: string) {
    try { setLinks(await api<ProductLink[]>(`/products/${productId}/links`)); setLinksErr(""); }
    catch (e: any) { setLinksErr(e.message); }
  }
  function openLinks(p: Product) {
    setLinksModal(p); setLinkPickId(""); setLinkType("substitute"); setLinksErr("");
    loadLinks(p.id);
  }
  async function addLink() {
    if (!linksModal || !linkPickId) return;
    setLinksBusy(true); setLinksErr("");
    try {
      await api(`/products/${linksModal.id}/links`, {
        method: "POST", body: JSON.stringify({ linkedProductId: linkPickId, linkType }),
      });
      setLinkPickId("");
      await loadLinks(linksModal.id);
    } catch (e: any) { setLinksErr(e.message); }
    finally { setLinksBusy(false); }
  }
  async function removeLink(linkId: string) {
    if (!linksModal) return;
    try { await api(`/products/links/${linkId}`, { method: "DELETE" }); await loadLinks(linksModal.id); }
    catch (e: any) { setLinksErr(e.message); }
  }

  // ══════════ فلترة احترافية لكل الأصناف ══════════
  const [fltOpen, setFltOpen] = useState(false);
  const [fltCategory, setFltCategory] = useState("");
  const [fltKind, setFltKind] = useState<"" | "oil" | "oilFilter" | "service" | "regular">("");
  const [fltOilType, setFltOilType] = useState("");
  const [fltFilterKind, setFltFilterKind] = useState("");
  const [fltOilBrand, setFltOilBrand] = useState("");
  const [fltActive, setFltActive] = useState<"" | "active" | "inactive">("");
  const [fltStock, setFltStock] = useState<"" | "low">("");
  const [view, setView] = useState<"cards" | "table">("cards");

  // قائمة الفئات المتاحة فعلياً من بيانات الأصناف نفسها — تتحدث تلقائياً
  const availableCategories = useMemo(
    () => Array.from(new Set(rows.map((r) => r.category).filter(Boolean))).sort(),
    [rows]);

  const activeFilterCount = [fltCategory, fltKind, fltOilType, fltFilterKind, fltOilBrand, fltActive, fltStock]
    .filter(Boolean).length;

  function clearFilters() {
    setFltCategory(""); setFltKind(""); setFltOilType(""); setFltFilterKind(""); setFltOilBrand("");
    setFltActive(""); setFltStock("");
  }

  // الصفوف بعد الفلاتر — هذا ما يُعرض فعلياً في الجدول وما ينطبق عليه "تحديد الكل"
  const filteredRows = useMemo(() => rows.filter((r) => {
    if (fltCategory && r.category !== fltCategory) return false;
    if (fltKind === "oil" && !r.is_oil) return false;
    if (fltKind === "oilFilter" && !r.is_oil_filter) return false;
    if (fltKind === "service" && !r.is_service) return false;
    if (fltKind === "regular" && (r.is_oil || r.is_oil_filter || r.is_service)) return false;
    if (fltOilType && r.oil_type !== fltOilType) return false;
    if (fltFilterKind && r.filter_kind !== fltFilterKind) return false;
    if (fltOilBrand && r.oil_brand !== fltOilBrand) return false;
    if (fltActive === "active" && !r.is_active) return false;
    if (fltActive === "inactive" && r.is_active) return false;
    if (fltStock === "low" && !(r.min_qty > 0 && (r.stock_qty ?? 0) <= r.min_qty)) return false;
    return true;
  }), [rows, fltCategory, fltKind, fltOilType, fltFilterKind, fltOilBrand, fltActive, fltStock]);

  // ── تحديد جماعي من الجدول الرئيسي — على الأصناف الظاهرة بعد الفلاتر ──
  const [bulkSel, setBulkSel] = useState<Set<string>>(new Set());
  const [bulkType, setBulkType] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // قيم البادئة (ot:/fk:) تميّز نوع الزيت عن نوع الفلتر داخل نفس القائمة المنسدلة
  async function applyBulkType() {
    if (!bulkType || bulkSel.size === 0) return;
    setBulkBusy(true);
    try {
      if (bulkType === "__clear_oiltype__") {
        await api(`/products/oil-types/clear`, {
          method: "POST", body: JSON.stringify({ productIds: Array.from(bulkSel) }),
        });
      } else if (bulkType === "__clear_filterkind__") {
        await api(`/products/filter-kinds/clear`, {
          method: "POST", body: JSON.stringify({ productIds: Array.from(bulkSel) }),
        });
      } else if (bulkType.startsWith("ot:")) {
        await api(`/products/oil-types/${bulkType.slice(3)}/assign`, {
          method: "POST", body: JSON.stringify({ productIds: Array.from(bulkSel) }),
        });
      } else if (bulkType.startsWith("fk:")) {
        await api(`/products/filter-kinds/${bulkType.slice(3)}/assign`, {
          method: "POST", body: JSON.stringify({ productIds: Array.from(bulkSel) }),
        });
      }
      setBulkSel(new Set());
      setBulkType("");
      await load();
    } catch (e: any) { await appAlert(e.message); }
    finally { setBulkBusy(false); }
  }

  const columns: Column<Product>[] = [
    {
      key: "__sel", title: (
        <input type="checkbox" className="h-4 w-4 accent-petrol"
          checked={filteredRows.length > 0 && filteredRows.every((r) => bulkSel.has(r.id))}
          onChange={(e) => setBulkSel(e.target.checked ? new Set(filteredRows.map((r) => r.id)) : new Set())} />
      ), width: "38px",
      render: (p) => (
        <input type="checkbox" className="h-4 w-4 accent-petrol"
          checked={bulkSel.has(p.id)}
          onChange={(e) => {
            const next = new Set(bulkSel);
            e.target.checked ? next.add(p.id) : next.delete(p.id);
            setBulkSel(next);
          }} />
      ),
    },
    {
      key: "name", title: "الصنف",
      render: (p) => (
        <div>
          <div className="font-extrabold">{p.name}{p.spec ? ` — ${p.spec}` : ""}</div>
          <div className="text-t-xs text-text-dim">{p.category}</div>
        </div>
      ),
    },
    { key: "unit", title: "الوحدة", width: "80px", render: (p) => p.unit || "—" },
    {
      key: "barcode", title: "الباركود", width: "130px",
      render: (p) => p.barcode
        ? <span className="tnum text-t-sm">{p.barcode}</span>
        : <span className="text-text-dim">—</span>,
    },
    {
      key: "sku", title: "SKU", width: "110px",
      render: (p) => p.sku
        ? <span className="tnum text-t-sm text-text-dim">{p.sku}</span>
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
        ? <Badge tone="info">{p.service_interval_km.toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"))} كم</Badge>
        : <span className="text-text-dim">—</span>,
    },
    ...((canEdit || canDelete) ? [{
      key: "actions", title: "", width: "150px",
      render: (p: Product) => (
        <div className="flex justify-end gap-1.5">
          {canEdit && (
            <Button variant="ghost" size="xs"
              onClick={() => openEdit(p)}>تعديل</Button>
          )}
          {canEdit && (
            <Button variant="ghost" size="xs"
              onClick={() => openLinks(p)}>بدائل/مرتبطة</Button>
          )}
          {canDelete && (
            <Button variant="danger" size="xs"
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
  const [brandEdit, setBrandEdit] = useState<OilBrand | null>(null); // الشركة الجاري تعديلها
  // تعيين المنتجات لشركة
  const [assignFor, setAssignFor] = useState<OilBrand | null>(null);
  const [assignSel, setAssignSel] = useState<Set<string>>(new Set());

  // ── تصنيف نوع الزيت (ماكينة/دفرنس/دركسيون/فرامل/قير) — جماعي بنفس نمط الشركات ──
  const OIL_TYPES: Record<string, string> = {
    engine: "زيت ماكينة", differential: "زيت دفرنس", steering: "زيت دركسيون",
    brake: "زيت فرامل", gearbox: "زيت قير", transfer: "زيت دبل",
  };
  // الأنواع الثلاثة لتصنيف الفلاتر — كانت كلها مخلوطة تحت "فلاتر زيت" واحدة
  const FILTER_KINDS: Record<string, string> = { oil: "فلتر زيت", air: "فلتر هواء", ac: "فلتر مكيف" };
  const [typesOpen, setTypesOpen] = useState(false);

  // ── التصنيف الذكي لنوع الزيت من الأسماء: معاينة ثم تطبيق ──
  type AutoTypes = { applied: boolean; scanned: number; matched: number; unmatched: number;
    byType: { type: string; label: string; count: number; oils: number; services: number; samples: string[] }[];
    unmatchedSamples: string[] };
  const [aot, setAot] = useState<AutoTypes | null>(null);
  const [aotBusy, setAotBusy] = useState(false);
  const [aotErr, setAotErr] = useState("");
  const [aotRedo, setAotRedo] = useState(false);
  async function runAutoTypes(apply: boolean) {
    setAotBusy(true); setAotErr("");
    try {
      setAot(await api<AutoTypes>("/products/oil-types/auto-classify", { method: "POST", body: JSON.stringify({ apply, redo: aotRedo }) }));
      if (apply) await load();
    } catch (e: any) { setAotErr(e.message); }
    finally { setAotBusy(false); }
  }

  // ── ربط فلتر السيارة: ماركة/موديل/نطاق سنة → صنف فلتر حقيقي من المخزون ──
  const [filtersMapOpen, setFiltersMapOpen] = useState(false);
  const [carFilters, setCarFilters] = useState<any[]>([]);
  const [cfKind, setCfKind] = useState<"oil" | "air" | "ac">("oil");
  const [cfBrand, setCfBrand] = useState("");
  const [cfModel, setCfModel] = useState("");
  const [cfFrom, setCfFrom] = useState("");
  const [cfTo, setCfTo] = useState("");
  const [cfCylinders, setCfCylinders] = useState(""); // فاضي = أي محرك (الحالة الشائعة)
  const [cfProductId, setCfProductId] = useState("");
  const [cfBusy, setCfBusy] = useState(false);
  const [cfErr, setCfErr] = useState("");
  const [autoClsBusy, setAutoClsBusy] = useState(false);
  const [autoClsMsg, setAutoClsMsg] = useState("");

  async function runAutoClassify() {
    setAutoClsBusy(true); setAutoClsMsg("");
    try {
      const r = await api<{ counts: Record<string, number> }>("/products/filter-kinds/auto-classify", { method: "POST" });
      const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
      setAutoClsMsg(total > 0
        ? `تم تصنيف ${total} صنف تلقائياً: ${Object.entries(FILTER_KINDS).map(([k, v]) => `${v} (${r.counts[k] || 0})`).join(" · ")}`
        : "لم يُعثر على أصناف جديدة تطابق أسماء فئات معروفة — صنّفها يدوياً من الجدول.");
      await load();
    } catch (e: any) { setAutoClsMsg(e.message); }
    finally { setAutoClsBusy(false); }
  }

  // كاسكيد حقيقي: الماركات من سيارات الشركة المسجّلة فعلاً، والموديل يترشّح
  // لموديلات الماركة المختارة بس — نفس فكرة صفحة الحجز، لكن على مستوى الشركة.
  const [cfBrandsList, setCfBrandsList] = useState<string[]>([]);
  const [cfModelsList, setCfModelsList] = useState<string[]>([]);
  useEffect(() => {
    if (!filtersMapOpen) return;
    api<string[]>("/cars/brands").then(setCfBrandsList).catch(() => setCfBrandsList([]));
  }, [filtersMapOpen]);
  useEffect(() => {
    if (!cfBrand) { setCfModelsList([]); return; }
    api<string[]>(`/cars/models?brand=${encodeURIComponent(cfBrand)}`)
      .then(setCfModelsList).catch(() => setCfModelsList([]));
  }, [cfBrand]);

  // نطاق سنوات معقول لقائمتي "من/إلى" — بلا كتابة حرة
  const YEAR_OPTIONS = useMemo(() => {
    const now = new Date().getFullYear();
    const out: string[] = [];
    for (let y = now + 1; y >= 1990; y--) out.push(String(y));
    return out;
  }, []);

  async function loadCarFilters() {
    try { setCarFilters(await api<any[]>("/cars/oil-filters")); } catch { setCarFilters([]); }
  }

  async function addCarFilter() {
    if (!cfBrand.trim() || !cfModel.trim() || !cfFrom || !cfTo || !cfProductId) {
      setCfErr("كل الحقول مطلوبة"); return;
    }
    setCfBusy(true); setCfErr("");
    try {
      await api("/cars/oil-filters", {
        method: "POST",
        body: JSON.stringify({
          brand: cfBrand.trim(), model: cfModel.trim(),
          yearFrom: Number(cfFrom), yearTo: Number(cfTo), filterProductId: cfProductId,
          filterKind: cfKind, cylinders: cfCylinders ? Number(cfCylinders) : null,
        }),
      });
      setCfBrand(""); setCfModel(""); setCfFrom(""); setCfTo(""); setCfProductId(""); setCfCylinders("");
      await loadCarFilters();
    } catch (e: any) { setCfErr(e.message); }
    finally { setCfBusy(false); }
  }

  async function removeCarFilter(id: string) {
    if (!(await appConfirm("حذف هذا الربط؟"))) return;
    try { await api(`/cars/oil-filters/${id}`, { method: "DELETE" }); await loadCarFilters(); }
    catch (e: any) { await appAlert(e.message); }
  }
  const [typeAssignFor, setTypeAssignFor] = useState<string | null>(null); // مفتاح النوع، مثال: "brake"
  const [typeAssignSel, setTypeAssignSel] = useState<Set<string>>(new Set());
  const [typeBusy, setTypeBusy] = useState(false);
  const [typeQuery, setTypeQuery] = useState("");
  const [typeShow, setTypeShow] = useState<"all" | "none" | "this">("all");
  // أصناف الزيوت للتصنيف: المعلّمة «زيت» + أي صنف اسمه/فئته «زيت» (غير فلتر وغير خدمة)
  const oilRows = rows.filter((r) => !r.is_service && !r.is_oil_filter
    && (r.is_oil || /زيت/.test(`${r.name} ${r.category || ""}`)) && !/فلتر|فلاتر/.test(`${r.name} ${r.category || ""}`));
  async function clearAllOilTypes() {
    if (!(await appConfirm(`إلغاء نوع كل الزيوت (${oilRows.filter((r) => r.oil_type).length} صنف) لإعادة تصنيفها من الصفر؟ لا يمس الشركات ولا الفلاتر، ويفكّ أي خدمة كانت مربوطة بنوع زيت.`))) return;
    setTypeBusy(true); setTypeErr("");
    try {
      const r = await api<{ count: number }>("/products/oil-types/clear-all", { method: "POST" });
      await load();
      await appAlert(`تم إلغاء تصنيف ${r.count} صنف. ابدأ التصنيف الذكي أو يدوياً.`);
    } catch (e: any) { setTypeErr(e.message); }
    finally { setTypeBusy(false); }
  }
  const [typeErr, setTypeErr] = useState("");
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
      if (brandEdit) {
        // تعديل: لو مرفعتش شعار جديد (null) الباك اند بيحافظ على القديم،
        // ولو الاسم اتغير المنتجات المرتبطة بتتحدث معاه تلقائياً.
        await api(`/products/oil-brands/${brandEdit.id}`, {
          method: "PUT",
          body: JSON.stringify({ name: brandName, logoBase64: brandLogo }),
        });
        setBrandEdit(null);
        await load(); // أسماء الشركات على المنتجات ممكن تكون اتغيرت
      } else {
        await api("/products/oil-brands", {
          method: "POST",
          body: JSON.stringify({ name: brandName, logoBase64: brandLogo }),
        });
      }
      setBrandName(""); setBrandLogo(null);
      await loadBrands();
    } catch (e: any) { setBrandErr(e.message); }
    finally { setBrandBusy(false); }
  }

  function startBrandEdit(b: OilBrand) {
    setBrandEdit(b); setBrandName(b.name); setBrandLogo(null); setBrandErr("");
  }

  function cancelBrandEdit() {
    setBrandEdit(null); setBrandName(""); setBrandLogo(null); setBrandErr("");
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

  function openTypeAssign(typeKey: string) {
    // تحديد مسبق: الأصناف المصنّفة بهذا النوع فعلاً
    const pre = new Set<string>();
    oilRows.forEach((r) => { if (r.oil_type === typeKey) pre.add(r.id); });
    setTypeAssignSel(pre);
    setTypeQuery(""); setTypeShow("none");
    setTypeAssignFor(typeKey);
  }

  async function saveTypeAssign() {
    if (!typeAssignFor) return;
    setTypeBusy(true); setTypeErr("");
    try {
      await api(`/products/oil-types/${typeAssignFor}/assign`, {
        method: "POST", body: JSON.stringify({ productIds: Array.from(typeAssignSel) }),
      });
      setTypeAssignFor(null);
      await load();
    } catch (e: any) { setTypeErr(e.message); }
    finally { setTypeBusy(false); }
  }

  // ══════════ قواعد تسعير الخدمة حسب السيارة ══════════
  type ServiceRule = {
    id: string; service_product_id: string; product_name: string; product_category: string | null;
    brand: string | null; model: string | null; year_from: number | null; year_to: number | null; price: number
  };
  const [rulesOpen, setRulesOpen] = useState(false);
  const [rules, setRules] = useState<ServiceRule[]>([]);
  const [ruleForm, setRuleForm] = useState({ serviceProductId: "", brand: "", model: "", yearFrom: "", yearTo: "", price: "" });
  const [ruleBusy, setRuleBusy] = useState(false);
  // تسعير بالشركات: اختر ماركات (شرائح ظاهرة بلا قوائم منسدلة) ثم اكتب سعر الخدمة مرة واحدة
  const [ruleBrands, setRuleBrands] = useState<Set<string>>(new Set());
  const [ruleAll, setRuleAll] = useState(false);
  const [ruleBrandQ, setRuleBrandQ] = useState("");
  const [ruleBrandList, setRuleBrandList] = useState<string[]>([]);
  useEffect(() => {
    if (!rulesOpen) return;
    api<string[]>("/cars/brands").then(setRuleBrandList).catch(() => setRuleBrandList([]));
  }, [rulesOpen]);
  async function saveBulkRule() {
    setRuleErr(""); setRuleBusy(true);
    try {
      await api("/products/service-price-rules/bulk", {
        method: "POST",
        body: JSON.stringify({ serviceProductId: ruleForm.serviceProductId, price: Number(ruleForm.price), brands: Array.from(ruleBrands), allBrands: ruleAll }),
      });
      setRuleBrands(new Set()); setRuleAll(false); setRuleForm({ ...ruleForm, price: "" });
      await loadRules();
    } catch (e: any) { setRuleErr(e.message); }
    finally { setRuleBusy(false); }
  }
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
        <div className={`rounded-lg px-4 py-2.5 text-t-sm font-bold ${importOk ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>
          {importMsg}
          <button onClick={() => setImportMsg("")} className="mr-2 opacity-60 hover:opacity-100"><MIcon name="close" className="!text-[15px]" /></button>
        </div>
      )}
      <PageHeader title="الأصناف" description="إدارة الأصناف والتصنيفات والأدوات الجماعية." actions={<><div className="flex items-center gap-3">
          <span className="text-t-sm text-text-dim tnum">{rows.length} صنف نشط</span>
          <div className="flex overflow-hidden rounded-card border border-line">
            <button type="button" onClick={() => setView("cards")}
              className={`px-3 py-1.5 text-t-sm font-bold ${view === "cards" ? "bg-petrol text-white" : "bg-ink-2"}`}>كروت</button>
            <button type="button" onClick={() => setView("table")}
              className={`px-3 py-1.5 text-t-sm font-bold ${view === "table" ? "bg-petrol text-white" : "bg-ink-2"}`}>جدول</button>
          </div>
        </div></>} />

      <ErrorNote msg={pageErr} />



     
      <Card>
        {/* الفلاتر والبحث في صف واحد */}
        <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-2 lg:items-start">

          {/* النصف الأول: لوحة الفلاتر */}
          <div className="min-w-0">
            <div className="rounded-card border border-line bg-ink-3/30">
              <button
                onClick={() => setFltOpen(!fltOpen)}
                className="flex w-full items-center justify-between px-3 py-2.5"
              >
                <span className="flex items-center gap-2 text-t-sm font-black">
                  <MIcon name="tune" className="!text-[16px]" />
                  الفلاتر
                  {activeFilterCount > 0 && (
                    <span className="rounded-none bg-petrol px-2 py-0.5 text-t-xs font-black text-white">
                      {activeFilterCount}
                    </span>
                  )}
                </span>

                <span className="text-t-xs text-text-dim">
                  {filteredRows.length} من {rows.length} صنف
                  <MIcon
                    name={fltOpen ? "expand_less" : "expand_more"}
                    className="mr-1 !text-[16px] align-middle"
                  />
                </span>
              </button>

              {fltOpen && (
                <div className="grid gap-2 border-t border-line p-3 sm:grid-cols-3 lg:grid-cols-2 xl:grid-cols-3">
                  <Field label="الفئة">
                    <Select
                      value={fltCategory}
                      onChange={(e) => setFltCategory(e.target.value)}
                    >
                      <option value="">الكل</option>
                      {availableCategories.map((c) => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="النوع">
                    <Select
                      value={fltKind}
                      onChange={(e) => setFltKind(e.target.value as any)}
                    >
                      <option value="">الكل</option>
                      <option value="oil">زيت</option>
                      <option value="oilFilter">فلتر زيت</option>
                      <option value="service">خدمة</option>
                      <option value="regular">صنف عادي</option>
                    </Select>
                  </Field>

                  <Field label="نوع الزيت">
                    <Select
                      value={fltOilType}
                      onChange={(e) => setFltOilType(e.target.value)}
                    >
                      <option value="">الكل</option>
                      {Object.entries(OIL_TYPES).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="نوع الفلتر">
                    <Select
                      value={fltFilterKind}
                      onChange={(e) => setFltFilterKind(e.target.value)}
                    >
                      <option value="">الكل</option>
                      {Object.entries(FILTER_KINDS).map(([k, v]) => (
                        <option key={k} value={k}>{v}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="شركة الزيت">
                    <Select
                      value={fltOilBrand}
                      onChange={(e) => setFltOilBrand(e.target.value)}
                    >
                      <option value="">الكل</option>
                      {brands.map((b) => (
                        <option key={b.id} value={b.name}>{b.name}</option>
                      ))}
                    </Select>
                  </Field>

                  <Field label="الحالة">
                    <Select
                      value={fltActive}
                      onChange={(e) => setFltActive(e.target.value as any)}
                    >
                      <option value="">الكل</option>
                      <option value="active">نشط</option>
                      <option value="inactive">موقوف</option>
                    </Select>
                  </Field>

                  <Field label="المخزون">
                    <Select
                      value={fltStock}
                      onChange={(e) => setFltStock(e.target.value as any)}
                    >
                      <option value="">الكل</option>
                      <option value="low">منخفض فقط</option>
                    </Select>
                  </Field>

                  {activeFilterCount > 0 && (
                    <div className="col-span-full flex justify-end">
                      <Button
                        variant="ghost" size="xs" className="gap-1"
                        onClick={clearFilters}
                      >
                        <MIcon name="close" className="!text-[14px]" /> مسح كل الفلاتر
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* النصف الثاني: خانة البحث */}
          <div className="min-w-0">
            <DataTable
              columns={columns}
              rows={filteredRows}
              loading={loading}
              searchKeys={["name", "category", "spec", "barcode"]}
              searchPlaceholder="بحث بالاسم أو الفئة أو الباركود..."
              searchOnly
              searchValue={productSearch}
              onSearchChange={setProductSearch}
              searchClassName="w-full"
            />
          </div>
        </div>

        {/* الجدول الأساسي وأزرار الإجراءات بعرض الصفحة */}
        <div className={view === "cards" ? "[&_table]:hidden" : ""}>
        <DataTable
          columns={columns}
          rows={filteredRows}
          loading={loading}
          searchKeys={["name", "category", "spec", "barcode"]}
          searchPlaceholder="بحث بالاسم أو الفئة أو الباركود..."
          searchOutside
          searchValue={productSearch}
          onSearchChange={setProductSearch}
          emptyText="لا توجد أصناف بعد — أضف أول صنف"
          toolbar={
            <>
              {bulkSel.size > 0 && (
                <div className="flex flex-wrap items-center gap-2 rounded-card border border-petrol bg-petrol/10 px-3 py-2">
                  <span className="text-t-sm font-black">
                    محدد: <b className="tnum">{bulkSel.size}</b> صنف
                  </span>

                  <Select
                    value={bulkType}
                    onChange={(e) => setBulkType(e.target.value)}
                  >
                    <option value="">— اختر تصنيفاً —</option>
                    <optgroup label="نوع الزيت">
                      {Object.entries(OIL_TYPES).map(([k, v]) => (
                        <option key={"ot:" + k} value={"ot:" + k}>{v}</option>
                      ))}
                      <option value="__clear_oiltype__">إزالة تصنيف الزيت</option>
                    </optgroup>
                    <optgroup label="نوع الفلتر">
                      {Object.entries(FILTER_KINDS).map(([k, v]) => (
                        <option key={"fk:" + k} value={"fk:" + k}>{v}</option>
                      ))}
                      <option value="__clear_filterkind__">إزالة تصنيف الفلتر</option>
                    </optgroup>
                  </Select>

                  <Button size="xs" className="gap-1"
                    disabled={!bulkType || bulkBusy}
                    onClick={applyBulkType}
                  >
                    {bulkBusy ? "جارِ التطبيق..." : <><MIcon name="check" className="!text-[14px]" /> تطبيق على المحدد</>}
                  </Button>

                  <Button
                    variant="ghost" size="xs"
                    onClick={() => setBulkSel(new Set())}
                  >
                    إلغاء التحديد
                  </Button>
                </div>
              )}

              {canCreate && (
                <div className="flex flex-wrap gap-2">
                  <input
                    ref={importRef}
                    type="file"
                    accept=".xlsx"
                    hidden
                    onChange={(e) =>
                      e.target.files?.[0] && importExcel(e.target.files[0])
                    }
                  />

                  <Button
                    variant="ghost"
                    disabled={importBusy}
                    onClick={() => importRef.current?.click()}
                  >
                    {importBusy ? "جارٍ القراءة…" : "استيراد Excel"}
                  </Button>

                  {hasPerm("products.delete") && (
                    <Button variant="danger" onClick={() => setWipeOpen(true)}>
                      مسح كل الأصناف
                    </Button>
                  )}

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setRulesOpen(true);
                      setRuleErr("");
                      loadRules();
                    }}
                  >
                    أسعار الخدمة
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setBrandsOpen(true);
                      setBrandErr("");
                    }}
                  >
                    شركات الزيوت
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => setTypesOpen(true)}
                  >
                    تصنيف نوع الزيت
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFiltersMapOpen(true);
                      loadCarFilters();
                    }}
                  >
                    فلاتر السيارات
                  </Button>

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setClsOpen(true);
                      setClsPreview(null);
                      setClsErr("");
                    }}
                  >
                    تصنيف ذكي
                  </Button>

                  <Button onClick={openCreate}>+ صنف جديد</Button>
                </div>
              )}
            </>
          }
        />
        </div>
        {view === "cards" && (
          <ProductCards rows={filteredRows} search={productSearch} loading={loading} />
        )}
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

          <div className="grid grid-cols-2 gap-2">
            <Field label="الباركود">
              <Input value={form.barcode} className="tnum"
                onChange={(e) => setForm({ ...form, barcode: e.target.value })} />
            </Field>
            <Field label="رمز SKU" hint="فاضي = يُولَّد تلقائياً">
              <Input value={form.sku} className="tnum" placeholder="SKU-000001"
                onChange={(e) => setForm({ ...form, sku: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2">
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
                <div className="text-t-sm font-bold">صنف خدمة (بدون مخزون)</div>
                <div className="text-t-xs text-text-dim">
                  خدمة تُقدَّم وليست بضاعة تُشترى — تُباع بكمية ثابتة، ولا تظهر في المشتريات أو التحويلات المخزنية
                </div>
              </div>
              <Switch checked={form.isService} onChange={(v) => setForm({ ...form, isService: v })} />
            </label>
            <label className="col-span-full flex cursor-pointer items-center justify-between rounded-lg border border-line bg-ink-3 px-3 py-2.5">
              <div>
                <div className="text-t-sm font-bold">صنف زيت</div>
                <div className="text-t-xs text-text-dim">يظهر كخيار في بوابة اختيار الزيت الذاتية للعميل</div>
              </div>
              <Switch checked={form.isOil} onChange={(v) => setForm({ ...form, isOil: v })} />
            </label>
            <div className="col-span-full grid gap-2 sm:grid-cols-2">
              <Field label="صورة المنتج (تظهر للعميل في بوابة الزيت)">
                <div className="flex items-center gap-2">
                  {prodImage ? (
                    <img src={`data:image/jpeg;base64,${prodImage}`} alt="صورة" className="h-12 w-12 rounded-lg border border-line object-contain" />
                  ) : (
                    <span className="grid h-12 w-12 place-items-center rounded-lg border border-dashed border-line text-t-2xl"
                      title={prodImage === undefined ? "الصورة الحالية محفوظة — ارفع لتغييرها" : ""}></span>
                  )}
                  <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-t-xs font-bold hover:border-petrol">
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
                      className="text-t-xs font-bold text-ember hover:underline">حذف</button>
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
              {form.isOil && (
                <Field label="نوع الزيت">
                  <Select value={form.oilType || ""} onChange={(e) => setForm({ ...form, oilType: e.target.value || null })}>
                    <option value="">— غير مصنّف —</option>
                    {Object.entries(OIL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              )}
              {form.isService && (
                <Field label="نوع الزيت المطلوب لهذه الخدمة">
                  <Select value={form.oilType || ""} onChange={(e) => setForm({ ...form, oilType: e.target.value || null })}>
                    <option value="">— غير مرتبطة بزيت —</option>
                    {Object.entries(OIL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </Field>
              )}
            </div>
            <label className="col-span-full flex cursor-pointer items-center justify-between rounded-lg border border-line bg-ink-3 px-3 py-2.5">
              <div>
                <div className="text-t-sm font-bold">فلتر زيت</div>
                <div className="text-t-xs text-text-dim">يُضاف تلقائياً لو العميل اختار "مع فلتر" في بوابة الزيت</div>
              </div>
              <Switch checked={form.isOilFilter} onChange={(v) => setForm({ ...form, isOilFilter: v })} />
            </label>
          </div>

          <p className="text-t-xs leading-5 text-text-dim">
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

      {/* ══════════ الأصناف البديلة/المرتبطة ══════════ */}
      <Modal open={!!linksModal} onClose={() => setLinksModal(null)}
        title={linksModal ? `بدائل/مرتبطة — ${productLabel(linksModal)}` : ""}>
        <div className="space-y-3">
          {linksErr && <ErrorNote msg={linksErr} />}

          <div className="grid grid-cols-[1fr_120px_auto] gap-2">
            <Select value={linkPickId} onChange={(e) => setLinkPickId(e.target.value)}>
              <option value="">اختر صنفاً...</option>
              {rows
                .filter((p) => p.id !== linksModal?.id && !links.some((l) => l.productId === p.id))
                .map((p) => (
                  <option key={p.id} value={p.id}>{productLabel(p)}</option>
                ))}
            </Select>
            <Select value={linkType} onChange={(e) => setLinkType(e.target.value as any)}>
              <option value="substitute">بديل</option>
              <option value="related">مرتبط</option>
            </Select>
            <Button onClick={addLink} disabled={!linkPickId || linksBusy}>إضافة</Button>
          </div>

          <div className="divide-y divide-line rounded-lg border border-line">
            {links.length === 0 && (
              <div className="p-3 text-center text-t-sm text-text-dim">لا توجد أصناف بديلة أو مرتبطة بعد</div>
            )}
            {links.map((l) => (
              <div key={l.id} className="flex items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <div className="truncate text-t-sm font-bold">
                    {l.category} — {l.name}{l.spec ? ` — ${l.spec}` : ""}
                  </div>
                  <div className="flex items-center gap-2 text-t-xs text-text-dim">
                    <Badge tone={l.linkType === "substitute" ? "warn" : "info"}>
                      {l.linkType === "substitute" ? "بديل" : "مرتبط"}
                    </Badge>
                    <span className="tnum">{money(l.price)}</span>
                    <span className="tnum">مخزون: {l.stock_qty}</span>
                  </div>
                </div>
                <Button variant="danger" size="xs"
                  onClick={() => removeLink(l.id)}>حذف</Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button variant="ghost" onClick={() => setLinksModal(null)}>إغلاق</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ المصنّف الذكي الجماعي ══════════ */}
      <Modal open={clsOpen} size="lg" onClose={() => setClsOpen(false)} title="التصنيف الذكي الجماعي">
        <div className="space-y-3">
          {!clsPreview && (
            <>
              <p className="text-t-sm leading-relaxed text-text-dim">
                بيقرأ أسماء كل الأصناف غير المصنفة (تصنيفها "أخرى" أو فارغ) ويصنفها تلقائياً بقواعد
                مفردات قطاع خدمة السيارات: زيوت، فلاتر زيت/هواء/مكيف، قير ودفرنس، مناشف، سوائل تبريد،
                بواجي، بطاريات... — <b>وبيفعّل "صنف زيت" و"فلتر زيت" تلقائياً لبوابة اختيار الزيت</b>.
                ستشاهد المعاينة أولاً ولن يحدث أي تغيير قبل الضغط على تطبيق.
              </p>
              <Button className="w-full justify-center" disabled={clsBusy} onClick={() => runClassify(false)}>
                {clsBusy ? "جارِ الفحص..." : "معاينة التصنيف (بدون تغيير)"}
              </Button>
            </>
          )}

          {clsPreview && (
            <>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-ink-3 p-2">
                  <div className="tnum text-t-xl font-black">{clsPreview.scanned}</div>
                  <div className="text-t-xs text-text-dim">تم فحصها</div>
                </div>
                <div className="rounded-lg bg-emerald-bg p-2">
                  <div className="tnum text-t-xl font-black text-emerald">{clsPreview.classified}</div>
                  <div className="text-t-xs text-text-dim">{clsPreview.applied ? "اتصنفت" : "هتتصنف"}</div>
                </div>
                <div className="rounded-lg bg-ink-3 p-2">
                  <div className="tnum text-t-xl font-black text-text-dim">{clsPreview.unclassified}</div>
                  <div className="text-t-xs text-text-dim">تحتاج تصنيفاً يدوياً</div>
                </div>
              </div>
              {(clsPreview.aiClassified ?? 0) > 0 && (
                <p className="rounded-lg bg-petrol-soft px-3 py-1.5 text-t-xs font-bold">
                  حسم الذكاء الاصطناعي {clsPreview.aiClassified} صنف لم تطابق القواعد — باختيار مغلق من فئاتك
                </p>
              )}
              {clsPreview.unclassified > 0 && clsPreview.unclassifiedSamples && clsPreview.unclassifiedSamples.length > 0 && (
                <p className="text-t-xs text-text-dim">أمثلة المتبقي: {clsPreview.unclassifiedSamples.join(" · ")}</p>
              )}

              <div className="max-h-72 space-y-1.5 overflow-y-auto rounded-lg border border-line p-2">
                {clsPreview.byCategory.map((c) => (
                  <div key={c.category} className="rounded-lg bg-ink-3 px-3 py-2">
                    <div className="flex items-center justify-between text-t-sm">
                      <span className="font-black">
                        {c.category}
                        {c.isOil && <Badge tone="warning" className="mr-1.5">زيت</Badge>}
                        {c.isOilFilter && <Badge tone="info" className="mr-1.5">فلتر زيت</Badge>}
                      </span>
                      <span className="tnum font-black text-petrol">{c.count}</span>
                    </div>
                    <div className="mt-0.5 truncate text-t-xs text-text-dim">
                      أمثلة: {c.samples.join(" · ")}
                    </div>
                  </div>
                ))}
              </div>

              <ErrorNote msg={clsErr} />
              {clsPreview.applied ? (
                <div className="rounded-lg bg-emerald-bg px-3 py-2.5 text-center text-t-md font-black text-emerald">
                  تم التطبيق — {clsPreview.classified} صنف اتصنفوا، والمتبقي {clsPreview.unclassified} تصنفهم يدوياً براحتك
                </div>
              ) : (
                <div className="flex gap-2">
                  <Button variant="ghost" className="flex-1 justify-center" onClick={() => setClsPreview(null)}>رجوع</Button>
                  <Button className="flex-[2] justify-center gap-1" disabled={clsBusy} onClick={() => runClassify(true)}>
                    {clsBusy ? "جارِ التطبيق..." : <><MIcon name="check" className="!text-[15px]" /> {`تطبيق التصنيف على ${clsPreview.classified} صنف`}</>}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </Modal>

      {/* ══════════ مدير شركات الزيوت ══════════ */}
      <Modal open={brandsOpen} size="lg" onClose={() => setBrandsOpen(false)} title="شركات الزيوت (لبوابة العميل)">
        <div className="space-y-3">
          <p className="text-t-sm text-text-dim">
            العميل في بوابة اختيار الزيت بيشوف الشركات دي بشعاراتها أولاً، وبعدها منتجات الشركة اللي يختارها.
          </p>

          {/* ── التوزيع التلقائي: كل زيت إلى شركته — قواعد ثم ذكاء ── */}
          <div className="rounded-card border border-line bg-ink-3/40 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-t-sm font-black">توزيع الزيوت على الشركات تلقائياً</div>
              <Button variant="ghost" size="xs" disabled={autoBrandBusy}
                onClick={() => runAutoBrand(false)}>
                {autoBrandBusy ? "جارِ الفحص…" : "معاينة التوزيع"}
              </Button>
            </div>
            {autoBrand && (
              <div className="mt-2 space-y-2 text-t-xs">
                {autoBrand.error ? <p className="font-bold text-ember">{autoBrand.error}</p> : (
                  <>
                    <p className="font-bold">
                      {autoBrand.scanned} زيت بلا شركة → <span className="text-emerald">{autoBrand.assigned} سيتم توزيعها</span>
                      {autoBrand.aiAssigned > 0 && <span> (منهم {autoBrand.aiAssigned} بالذكاء)</span>}
                      {autoBrand.unassigned > 0 && <span className="text-text-dim"> · {autoBrand.unassigned} يحتاجون تصنيفاً يدوياً</span>}
                    </p>
                    {autoBrand.byBrand.length > 0 && (
                      <p className="text-text-dim">{autoBrand.byBrand.map((b) => `${b.brand}: ${b.count}`).join(" · ")}</p>
                    )}
                    {autoBrand.unassigned > 0 && autoBrand.unassignedSamples.length > 0 && (
                      <p className="text-text-dim">أمثلة: {autoBrand.unassignedSamples.join(" · ")}</p>
                    )}
                    {autoBrand.applied ? (
                      <p className="font-black text-emerald">اتطبق التوزيع</p>
                    ) : autoBrand.assigned > 0 && (
                      <Button size="xs" className="gap-1" disabled={autoBrandBusy}
                        onClick={() => runAutoBrand(true)}>
                        <MIcon name="check" className="!text-[14px]" /> تطبيق التوزيع على {autoBrand.assigned} صنف
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
                <div key={b.id} className="flex flex-col">
                  {/* كارد البراند */}
                  <div className="flex min-h-[145px] flex-col rounded-card border border-line bg-ink-2 p-3 text-center">
                    {/* مساحة ثابتة للوجو */}
                    <div className="flex h-[75px] w-full items-center justify-center overflow-hidden">
                      {b.logo_base64 ? (<img src={`data:image/png;base64,${b.logo_base64}`} alt={b.name} loading="lazy" decoding="async" className="block h-full w-full object-contain p-1" />) : (<MIcon name="verified" className="!text-[30px] text-[#64748B]" />)}
                    </div>
                    {/* اسم البراند */}
                    <div className="mt-2 truncate text-t-sm font-black"> {b.name}
                    </div> </div>
                  {/* الأزرار خارج الكارد وتحت الـ border */}
                  <div className="flex items-center justify-center gap-1.5 pt-2">
                    <Button onClick={() => openAssign(b)} className="rounded-md bg-petrol px-2.5 py-1.5 text-t-xs font-bold text-white transition hover:brightness-110" > تعيين المنتجات </Button>
                    <button onClick={() => startBrandEdit(b)} className="rounded-md border border-line bg-ink-2 px-2.5 py-1.5 text-t-xs font-bold transition hover:border-petrol" > تعديل </button>
                    <button onClick={() => removeBrand(b)} className="rounded-md px-2.5 py-1.5 text-t-xs font-bold text-ember transition hover:bg-ember-bg" > حذف </button>
                  </div> </div>
              ))}
            </div>
          )}
          {brandEdit && (
            <div className="flex items-center justify-between rounded-lg bg-petrol/10 px-3 py-2 text-t-xs font-bold">
              <span>تعديل «{brandEdit.name}» — غيّر الاسم أو ارفع شعاراً جديداً (سيبه فاضي للاحتفاظ بالحالي)</span>
              <button onClick={cancelBrandEdit} className="font-black text-ember">إلغاء</button>
            </div>
          )}
          <div className="grid gap-2 rounded-card border border-dashed border-line p-3 sm:grid-cols-[1fr_auto_auto]">
            <Input value={brandName} placeholder="اسم الشركة — مثال: شيل، موبيل، كاسترول"
              onChange={(e) => setBrandName(e.target.value)} />
            <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-t-xs font-bold hover:border-petrol">
              {brandLogo ? "الشعار جاهز" : "رفع الشعار"}
              <input type="file" accept="image/*" hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  try { setBrandLogo(await fileToSquareLogo(f, 240)); } catch { /* */ }
                  e.target.value = "";
                }} />
            </label>
            <Button onClick={saveBrand} disabled={brandBusy || !brandName.trim()}>
              {brandBusy ? "..." : brandEdit ? "حفظ التعديل" : "+ إضافة"}
            </Button>
          </div>
          <ErrorNote msg={brandErr} />
        </div>
      </Modal>

      {/* ══════════ تعيين منتجات لشركة ══════════ */}
      <Modal open={!!assignFor} size="lg" onClose={() => setAssignFor(null)}
        title={`تعيين الزيوت لشركة «${assignFor?.name || ""}»`}>
        <div className="space-y-3">
          <p className="text-t-sm text-text-dim">
            حدّد المنتجات التابعة للشركة — المطابق لاسم الشركة اتحدد تلقائياً، راجع وعدّل ثم احفظ.
            المحدد: <b className="tnum">{assignSel.size}</b>
          </p>
          <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rows.filter((r) => r.is_oil).map((r) => (
              <label key={r.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-t-sm hover:bg-ink-3">
                <input type="checkbox" checked={assignSel.has(r.id)} className="h-4 w-4 accent-petrol"
                  onChange={(e) => {
                    const next = new Set(assignSel);
                    e.target.checked ? next.add(r.id) : next.delete(r.id);
                    setAssignSel(next);
                  }} />
                <span className="flex-1 font-bold">{productLabel(r)}</span>
                {r.oil_brand && r.oil_brand !== assignFor?.name && (
                  <Badge tone="neutral">حالياً: {r.oil_brand}</Badge>
                )}
              </label>
            ))}
            {rows.filter((r) => r.is_oil).length === 0 && (
              <p className="p-6 text-center text-t-sm text-text-dim">
                لا توجد أصناف زيت بعد — شغّل "تصنيف ذكي" أولاً أو فعّل "صنف زيت" على المنتجات
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAssignFor(null)}>إلغاء</Button>
            <Button className="gap-1" onClick={saveAssign} disabled={brandBusy}>
              {brandBusy ? "جارِ الحفظ..." : <><MIcon name="check" className="!text-[15px]" /> {`حفظ التعيين (${assignSel.size})`}</>}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تصنيف نوع الزيت — الأنواع الخمسة الثابتة ══════════ */}
      <Modal open={typesOpen} size="lg" onClose={() => setTypesOpen(false)} title="تصنيف نوع الزيت">
        <div className="space-y-3">
          <div className="space-y-2 rounded-card border border-line bg-ink-3 p-3">
            <div className="text-t-sm font-black">تصنيف ذكي تلقائي (الأسهل)</div>
            <p className="text-t-xs text-text-dim">
              يقرأ أسماء كل الزيوت وأصناف «تغيير زيت …» ويستنتج النوع (ماكينة/قير/دفرنس/دبل/دركسيون/فرامل) من الكلمات ودرجات اللزوجة.
              عاين النتيجة أولاً ثم طبّقها، وما لم يتضح اسمه يبقى لتصنّفه يدوياً.
            </p>
            <label className="flex items-center gap-2 text-t-xs font-bold">
              <input type="checkbox" checked={aotRedo} onChange={(e) => { setAotRedo(e.target.checked); setAot(null); }} />
              أعد تصنيف المصنّف أيضاً
            </label>
            <div className="flex gap-2">
              <Button variant="ghost" disabled={aotBusy} onClick={() => runAutoTypes(false)}>{aotBusy ? "..." : "معاينة"}</Button>
              {aot && !aot.applied && aot.matched > 0 && (
                <Button disabled={aotBusy} onClick={() => runAutoTypes(true)}>تطبيق على {aot.matched} صنف</Button>
              )}
            </div>
            {aotErr && <p className="rounded-lg bg-ember-bg px-3 py-2 text-t-xs font-bold text-ember">{aotErr}</p>}
            {aot && (
              <div className="space-y-1 text-t-xs">
                <p className="font-bold">
                  {aot.applied ? "تم التطبيق: " : "المعاينة: "}فُحص {aot.scanned} صنف — {aot.applied ? "صُنّف" : "سيُصنَّف"} {aot.matched}
                  {aot.unmatched > 0 && ` — ${aot.unmatched} غير واضح`}
                </p>
                {aot.byType.map((t) => (
                  <div key={t.type} className="rounded-lg bg-ink-2 px-2 py-1.5">
                    <b>{t.label}</b> <span className="tnum">({t.count})</span>
                    {t.services > 0 && <span className="text-text-dim"> · منها {t.services} خدمة</span>}
                    <div className="text-text-dim">{t.samples.join(" · ")}</div>
                  </div>
                ))}
                {aot.unmatchedSamples.length > 0 && (
                  <div className="rounded-lg bg-brass-soft px-2 py-1.5">
                    <b>تحتاج تصنيفاً يدوياً:</b> <span className="text-text-dim">{aot.unmatchedSamples.join(" · ")}</span>
                  </div>
                )}
              </div>
            )}
          </div>
          <p className="text-t-sm text-text-dim">
            صنّف كل زيت بنوعه (ماكينة/دفرنس/دركسيون/فرامل/قير) بالجملة دفعة واحدة بدل صنف بصنف —
            ونفس النوع يُستخدم لربط الخدمة (مثال: "تغيير زيت الفرامل") بالزيوت المناسبة لها فقط
            في بوابة الحجز، بدل ظهور أي زيت عشوائي.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {Object.entries(OIL_TYPES).map(([key, label]) => {
              const count = oilRows.filter((r) => r.oil_type === key).length;
              return (
                <div key={key} className="rounded-card border border-line p-3 text-center">
                  <div className="text-t-sm font-black">{label}</div>
                  <div className="mt-1 text-t-xs text-text-dim">
                    <b className="tnum">{count}</b> صنف مصنّف
                  </div>
                  <button onClick={() => openTypeAssign(key)}
                    className="mt-2 w-full rounded-md bg-petrol px-2 py-1.5 text-t-xs font-bold text-white hover:brightness-110">
                    تعيين المنتجات
                  </button>
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2">
            <span className="text-t-xs text-text-dim">تريد البدء من جديد؟ يُلغى نوع كل الزيوت ثم تصنّفها مرة أخرى (تلقائياً أو يدوياً).</span>
            <Button variant="danger" size="xs" disabled={typeBusy || !oilRows.some((r) => r.oil_type)} onClick={clearAllOilTypes}>إلغاء تصنيف كل الزيوت</Button>
          </div>
          {(() => {
            const unclassified = oilRows.filter((r) => !r.oil_type).length;
            return unclassified > 0 ? (
              <p className="rounded-lg bg-ink-3/40 px-3 py-2 text-t-xs font-bold text-text-dim">
                {unclassified} صنف زيت لسه من غير نوع محدد.
              </p>
            ) : null;
          })()}
        </div>
      </Modal>

      {/* ══════════ تعيين منتجات لنوع زيت (اختيار جماعي) ══════════ */}
      <Modal open={!!typeAssignFor} size="lg" onClose={() => setTypeAssignFor(null)}
        title={`تعيين الزيوت لنوع «${(typeAssignFor && OIL_TYPES[typeAssignFor]) || ""}»`}>
        <div className="space-y-3">
          {(() => {
            const q = typeQuery.trim().toLowerCase();
            const shown = oilRows.filter((r) => {
              if (typeShow === "none" && r.oil_type) return false;
              if (typeShow === "this" && r.oil_type !== typeAssignFor) return false;
              return !q || productLabel(r).toLowerCase().includes(q) || (r.oil_brand || "").toLowerCase().includes(q);
            });
            const allOn = shown.length > 0 && shown.every((r) => typeAssignSel.has(r.id));
            return (
              <>
                <p className="text-t-sm text-text-dim">
                  ابحث وحدّد الأصناف التي تتبع هذا النوع ثم احفظ. المحدد: <b className="tnum">{typeAssignSel.size}</b>
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="min-w-[200px] flex-1">
                    <Input value={typeQuery} placeholder="ابحث باسم الزيت أو الشركة أو اللزوجة (5W-30)" autoFocus
                      onChange={(e) => setTypeQuery(e.target.value)} />
                  </div>
                  {([["none", "غير المصنّف"], ["this", "هذا النوع"], ["all", "الكل"]] as const).map(([k, l]) => (
                    <Button key={k} size="xs" variant={typeShow === k ? "primary" : "ghost"} onClick={() => setTypeShow(k)}>{l}</Button>
                  ))}
                </div>
                <div className="flex items-center justify-between text-t-xs text-text-dim">
                  <span><b className="tnum">{shown.length}</b> صنف ظاهر</span>
                  <span className="flex gap-2">
                    <Button size="xs" variant="ghost" disabled={shown.length === 0}
                      onClick={() => { const n = new Set(typeAssignSel); shown.forEach((r) => (allOn ? n.delete(r.id) : n.add(r.id))); setTypeAssignSel(n); }}>
                      {allOn ? "إلغاء تحديد الظاهر" : "تحديد كل الظاهر"}
                    </Button>
                  </span>
                </div>
                <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
                  {shown.map((r) => (
                    <label key={r.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-t-sm hover:bg-ink-3">
                      <input type="checkbox" checked={typeAssignSel.has(r.id)} className="h-4 w-4 accent-petrol"
                        onChange={(e) => {
                          const next = new Set(typeAssignSel);
                          e.target.checked ? next.add(r.id) : next.delete(r.id);
                          setTypeAssignSel(next);
                        }} />
                      <span className="flex-1 font-bold">{productLabel(r)}</span>
                      {r.oil_type && r.oil_type !== typeAssignFor && (
                        <Badge tone="neutral">حالياً: {OIL_TYPES[r.oil_type] || r.oil_type}</Badge>
                      )}
                    </label>
                  ))}
                  {shown.length === 0 && (
                    <p className="p-6 text-center text-t-sm text-text-dim">
                      {oilRows.length === 0 ? "لا توجد أصناف زيت" : "لا نتائج — غيّر البحث أو اختر «الكل»"}
                    </p>
                  )}
                </div>
              </>
            );
          })()}
          <ErrorNote msg={typeErr} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setTypeAssignFor(null)}>إلغاء</Button>
            <Button className="gap-1" onClick={saveTypeAssign} disabled={typeBusy}>
              {typeBusy ? "جارِ الحفظ..." : <><MIcon name="check" className="!text-[15px]" /> {`حفظ التعيين (${typeAssignSel.size})`}</>}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ ربط فلتر السيارة: ماركة/موديل/نطاق سنة ← صنف حقيقي ══════════ */}
      <Modal open={filtersMapOpen} size="lg" onClose={() => setFiltersMapOpen(false)} title="فلاتر السيارات">
        <div className="space-y-4">
          <p className="text-t-sm text-text-dim">
            حدّد نوع الفلتر (زيت/هواء/مكيف) والماركة والموديل ونطاق سنة الصنع، واختر
            الفلتر الصحيح من أصنافك — بمجرد ما العميل يحجز بنفس البيانات، الفلتر ده
            يظهر تلقائياً في فاتورته بدل قائمة عامة.
          </p>

          {/* نوع الفلتر — أزرار بدل نص حر، يحدد أي أصناف تظهر في قائمة الاختيار */}
          <div className="flex gap-2">
            {Object.entries(FILTER_KINDS).map(([k, label]) => (
              <button key={k} onClick={() => { setCfKind(k as any); setCfProductId(""); }}
                className="rounded-none px-3.5 py-1.5 text-t-xs font-black transition"
                style={{
                  background: cfKind === k ? "var(--petrol, #0f766e)" : "transparent",
                  color: cfKind === k ? "#fff" : undefined,
                  border: cfKind === k ? "none" : "1px solid var(--line, #E2E8F0)",
                }}>
                {label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <SearchSelect value={cfBrand} onChange={(v) => { setCfBrand(v); setCfModel(""); }}
              options={cfBrandsList} placeholder="اختر أو اكتب الماركة" />
            <SearchSelect value={cfModel} onChange={setCfModel} options={cfModelsList}
              placeholder={cfBrand ? "اختر أو اكتب الموديل" : "اختر الماركة أولاً"}
              disabled={!cfBrand} />
            <Select value={cfFrom} onChange={(e) => setCfFrom(e.target.value)}>
              <option value="">من سنة</option>
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <Select value={cfTo} onChange={(e) => setCfTo(e.target.value)}>
              <option value="">إلى سنة</option>
              {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
          </div>
          {/* صنف الفلتر ياخد صفاً كاملاً — الأسماء طويلة ومحتاجة مساحة أوضح من
              زحمة شبكة الماركة/الموديل/السنة، والسلندرات جنبه لأنه اختياري بسيط.
              البحث هنا حي في كل الأصناف (اسم أو باركود) — بلا اشتراط تصنيف
              مسبق، عشان محدش يتعطل بانتظار خطوة تصنيف قد تكون غير مكتملة. */}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_140px]">
            <ProductSearchSelect value={cfProductId} onChange={setCfProductId} products={rows}
              placeholder={`ابحث عن ${FILTER_KINDS[cfKind]} بالاسم أو الباركود...`} />
            <Select value={cfCylinders} onChange={(e) => setCfCylinders(e.target.value)}>
              <option value="">أي محرك</option>
              {["3", "4", "5", "6", "8", "10", "12"].map((c) => <option key={c} value={c}>{c} سلندر</option>)}
            </Select>
          </div>
          <p className="text-t-xs text-text-dim">
            اترك "أي محرك" إلا لو نفس الموديل والسنة عنده أكثر من خيار محرك بفلاتر مختلفة
            (مثال: فورتشنر 4 أو 6 سلندر) — حينها أضف رابطاً منفصلاً لكل سلندر.
          </p>
          {/* تصنيف نوع الفلتر (زيت/هواء/مكيف) على الأصناف مفيد لتقارير الجدول
              الرئيسي وفلترته، لكن البحث فوق يعمل مباشرة في كل الأصناف بلا
              اشتراطه — فهذا مجرد اقتراح اختياري غير معطِّل لأي شيء. */}
          <div className="flex items-center justify-between gap-3 rounded-lg bg-ink-3/40 px-3 py-2">
            <p className="text-t-xs text-text-dim">
              نصيحة: صنّف أصنافك بنوع الفلتر (من الجدول الرئيسي) عشان تقدر تفلترها
              وتحلّل تقاريرها لاحقاً — مش شرط للبحث والربط هنا.
            </p>
            <Button variant="ghost" size="xs" className="!shrink-0"
              disabled={autoClsBusy} onClick={runAutoClassify}>
              {autoClsBusy ? "جارِ التصنيف..." : "تصنيف تلقائي من الفئة"}
            </Button>
          </div>
          {autoClsMsg && (
            <p className="rounded-lg bg-petrol/10 px-3 py-2 text-t-xs font-bold text-petrol">
              {autoClsMsg}
            </p>
          )}
          <ErrorNote msg={cfErr} />
          <Button onClick={addCarFilter} disabled={cfBusy}>
            {cfBusy ? "جارِ الإضافة..." : "+ إضافة ربط"}
          </Button>

          <div className="max-h-72 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {carFilters.map((f) => (
              <div key={f.id} className="flex items-center gap-2 px-3 py-2 text-t-sm">
                <Badge tone="neutral">
                  {FILTER_KINDS[f.filter_kind] || f.filter_kind}
                </Badge>
                <span className="flex-1">
                  <b>{f.brand}</b> {f.model} <span className="text-text-dim">({f.year_from}–{f.year_to}{f.cylinders ? ` · ${f.cylinders} سلندر` : ""})</span>
                  {" ← "}
                  <span className="font-bold">{f.filter_name}{f.filter_spec ? ` ${f.filter_spec}` : ""}</span>
                </span>
                <button onClick={() => removeCarFilter(f.id)}
                  className="rounded-md px-2 py-1 text-t-xs font-bold text-ember hover:bg-ember-bg">
                  حذف
                </button>
              </div>
            ))}
            {carFilters.length === 0 && (
              <p className="p-6 text-center text-t-sm text-text-dim">لا توجد روابط بعد</p>
            )}
          </div>
        </div>
      </Modal>

      {/* ══════════ قواعد تسعير الخدمة حسب السيارة ══════════ */}
      <Modal open={rulesOpen} size="lg" onClose={() => setRulesOpen(false)} title="أسعار الخدمة حسب السيارة">
        <div className="space-y-3">
          <p className="text-t-sm leading-relaxed text-text-dim">
            حدد سعر الخدمة لكل نوع سيارة — والنظام بينزّل الخدمة <b>تلقائياً بالسعر الصح</b> في طلب العميل
            حسب ماركته وموديله وسنة صنعه. <b>الأخص بيكسب</b>: (تويوتا + كامري + 2020-2024) بتغلب (تويوتا) العامة،
            وقاعدة بدون ماركة = السعر الافتراضي لكل السيارات.
          </p>

          <div className="space-y-3 rounded-card border border-dashed border-line p-3">
            <div>
              <div className="mb-1 text-t-xs font-black">1) الخدمة</div>
              <div className="flex flex-wrap gap-1.5">
                {serviceProducts.map((p: Product) => (
                  <button key={p.id} type="button" onClick={() => setRuleForm({ ...ruleForm, serviceProductId: p.id })}
                    className={`rounded-md border px-3 py-1.5 text-t-sm font-bold transition ${ruleForm.serviceProductId === p.id ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 hover:bg-ink-3"}`}>
                    {productLabel(p)}
                  </button>
                ))}
                {serviceProducts.length === 0 && <span className="text-t-xs text-text-dim">لا أصناف خدمة — علّم صنف «خدمة» أولاً</span>}
              </div>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-t-xs font-black">2) الماركات <span className="font-normal text-text-dim">(اختر واحدة أو أكثر) — المحدد: <b className="tnum">{ruleBrands.size + (ruleAll ? 1 : 0)}</b></span></span>
                <div className="w-44"><Input value={ruleBrandQ} placeholder="ابحث عن ماركة" onChange={(e) => setRuleBrandQ(e.target.value)} /></div>
              </div>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
                <button type="button" onClick={() => setRuleAll(!ruleAll)}
                  className={`rounded-md border px-3 py-1.5 text-t-sm font-bold transition ${ruleAll ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 hover:bg-ink-3"}`}>
                  كل السيارات
                </button>
                {ruleBrandList.filter((b) => !ruleBrandQ.trim() || b.toLowerCase().includes(ruleBrandQ.trim().toLowerCase())).map((b) => (
                  <button key={b} type="button"
                    onClick={() => { const n = new Set(ruleBrands); n.has(b) ? n.delete(b) : n.add(b); setRuleBrands(n); }}
                    className={`rounded-md border px-3 py-1.5 text-t-sm font-bold transition ${ruleBrands.has(b) ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 hover:bg-ink-3"}`}>
                    {b}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-48">
                <Field label="3) سعر الخدمة شامل الضريبة (ر.س)">
                  <Input value={ruleForm.price} inputMode="decimal" placeholder="مثال: 40"
                    onChange={(e) => setRuleForm({ ...ruleForm, price: e.target.value.replace(/[^0-9.]/g, "") })} />
                </Field>
              </div>
              <Button disabled={ruleBusy || !ruleForm.serviceProductId || !ruleForm.price || (ruleBrands.size === 0 && !ruleAll)} onClick={saveBulkRule}>
                {ruleBusy ? "..." : `حفظ السعر لـ ${ruleBrands.size + (ruleAll ? 1 : 0)} ماركة`}
              </Button>
            </div>
            <details className="rounded-lg bg-ink-3 p-2">
              <summary className="cursor-pointer text-t-xs font-bold">متقدم: تسعير لموديل أو نطاق سنة محدد</summary>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <Field label="الماركة"><Input value={ruleForm.brand} placeholder="تويوتا" onChange={(e) => setRuleForm({ ...ruleForm, brand: e.target.value })} /></Field>
                <Field label="الموديل"><Input value={ruleForm.model} placeholder="كامري" onChange={(e) => setRuleForm({ ...ruleForm, model: e.target.value })} /></Field>
                <Field label="من سنة"><Input value={ruleForm.yearFrom} inputMode="numeric" placeholder="2015"
                  onChange={(e) => setRuleForm({ ...ruleForm, yearFrom: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></Field>
                <Field label="إلى سنة"><Input value={ruleForm.yearTo} inputMode="numeric" placeholder="2024"
                  onChange={(e) => setRuleForm({ ...ruleForm, yearTo: e.target.value.replace(/\D/g, "").slice(0, 4) })} /></Field>
                <div className="sm:col-span-2">
                  <Button className="w-full justify-center" variant="ghost" disabled={ruleBusy || !ruleForm.serviceProductId || !ruleForm.price} onClick={addRule}>
                    {ruleBusy ? "..." : "+ إضافة قاعدة محددة (السعر أعلاه)"}
                  </Button>
                </div>
              </div>
            </details>
          </div>
          <ErrorNote msg={ruleErr} />

          <div className="max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {rules.length === 0 && <p className="p-5 text-center text-t-sm text-text-dim">لا قواعد بعد — ابدأ بقاعدة افتراضية بدون ماركة</p>}
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between px-3 py-2 text-t-sm">
                <span>
                  <b>{r.brand || "كل السيارات"}</b>
                  {r.model && <span className="text-text-dim"> · {r.model}</span>}
                  {(r.year_from || r.year_to) && (
                    <span className="tnum text-text-dim"> · {r.year_from || "..."}-{r.year_to || "..."}</span>
                  )}
                  <Badge tone="neutral" className="mr-2">{r.product_name}</Badge>
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

      {/* ══════════ معاينة الاستيراد — القرار قبل الكتابة ══════════ */}
      <Modal open={!!preview} onClose={() => { setPreview(null); setPendingFile(null); }}
        title={`معاينة الاستيراد — ${preview?.totalRows ?? 0} صنف في الملف`}>
        {preview && (
          <div className="space-y-3">
            <div className="rounded-lg bg-ink-2 p-3 text-t-sm">
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
              <div className="rounded-lg bg-ember-bg p-3 text-t-xs">
                <div className="mb-1 font-black text-ember">يوجد عمود غير متعرف عليه — هذه عناوين ملفك حرفياً:</div>
                <div className="tnum flex flex-wrap gap-1.5">
                  {(preview.rawHeaders || []).map((h, i) => (
                    <span key={i} className="rounded-md bg-ink-2 px-2 py-0.5 font-bold text-text">{h || "(فارغ)"}</span>
                  ))}
                </div>
                <div className="mt-1.5 text-text-dim">صوّر هذا الصندوق وأرسله — إضافة الاسم الناقص للمطابقة سطر واحد.</div>
              </div>
            )}
            {(preview.categories || []).length > 0 && (
              <div className="rounded-lg border border-line">
                <div className="border-b border-line bg-ink-3 px-3 py-2 text-t-xs">
                  <b>فئات ملفك ({preview.categories!.length})</b> — تُدخَل كما هي حرفياً (فئة نقطة البيع). ونوع كل صنف (خدمة/زيت/فلتر/عادي) يُحدَّد
                  من «فئة المنتج» الدقيقة إن وُجدت. غيّر نوع فئة كاملة هنا فقط إن أردتَ تجاوز ذلك.
                </div>
                <div className="max-h-56 divide-y divide-line overflow-y-auto">
                  {preview.categories!.map((c) => (
                    <div key={c.name} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-t-xs">
                      <span className="min-w-0 flex-1 font-bold">{c.name} <span className="tnum font-normal text-text-dim">({c.count})</span>
                        {c.mix && Object.keys(c.mix).length > 1 && (
                          <span className="block font-normal text-text-dim">
                            {Object.entries(c.mix).map(([k, n]) => `${KIND_LABELS.find(([x]) => x === k)?.[1] || k} ${n}`).join(" · ")}
                          </span>
                        )}
                      </span>
                      <span className="flex gap-1">
                        {KIND_LABELS.map(([k, l]) => (
                          <button key={k} type="button" onClick={() => setCatKinds({ ...catKinds, [c.name]: k })}
                            className={`rounded-md border px-2 py-1 font-bold transition ${(catKinds[c.name] || c.kind) === k ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 hover:bg-ink-3"}`}>
                            {l}
                          </button>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-t-xs">
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
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line p-3 text-t-xs">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-petrol" checked={syncAll} onChange={(e) => setSyncAll(e.target.checked)} />
              <span>
                <b>إعادة هيكلة كاملة (مزامنة مع الملف):</b> بعد الاستيراد تُعطَّل كل الأصناف الحالية غير الموجودة في هذا الملف، فيصير الكتالوج
                مطابقاً للملف تماماً (فئاته وأنواعه). التعطيل لا يحذف الفواتير ولا المخزون، ولا يتم لو وُجدت صفوف بها أخطاء.
              </span>
            </label>
            <p className="text-t-xs text-text-dim">
              راجع عمود "شامل الضريبة" — إذا كانت هذه الأرقام مطابقة لأسعار البيع الفعلية لديك، فاعتمد.
              الموجود بنفس الباركود سيتم تحديثه، والجديد سيُضاف — دون أي تكرار.
            </p>
            <div className="flex gap-2">
              <Button className="flex-1 justify-center gap-1"
                disabled={importBusy || preview.columns.price_vat?.startsWith("❌")}
                onClick={confirmImport}>
                {preview.columns.price_vat?.startsWith("❌")
                  ? "الاعتماد متوقف — عمود السعر غير متعرف عليه"
                  : importBusy ? "جارٍ الاعتماد…" : <><MIcon name="check" className="!text-[15px]" /> {`اعتماد استيراد ${preview.totalRows} صنف`}</>}
              </Button>
              <Button variant="ghost" onClick={() => { setPreview(null); setPendingFile(null); }}>إلغاء</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════ تأكيد المسح الشامل ══════════ */}
      <Modal open={wipeOpen} onClose={() => setWipeOpen(false)} title="مسح كل الأصناف">
        <div className="space-y-3">
          <p className="text-t-md font-bold text-ember">هتمسح كل الأصناف النشطة ({rows.length} صنف) من النظام.</p>
          <p className="text-t-sm text-text-dim">
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
