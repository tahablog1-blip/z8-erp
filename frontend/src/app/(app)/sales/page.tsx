"use client";
// شاشة المبيعات (نقطة البيع) — وردية + طابور فوترة + سلة + دفع مجزّأ + فواتير معلقة
// + طباعة حرارية 80مم بالـ QR (ZATCA) + سجل الفواتير — مطابقة لوظائف النظام القديم
import { useEffect, useMemo, useState, useRef } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import type { PrintFormat } from "@/lib/print-invoice";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Product, productLabel } from "@/modules/products/types";
import { BillingQueueRow } from "@/modules/cars/types";
import {
  Invoice, InvoiceDetail, PaymentMethod, PAYMENT_LABELS, ShiftReport, money,
} from "@/modules/invoices/types";
import { Customer } from "@/modules/customers/types";

type Branch = { id: string; name: string };
type StockLevel = { loc_type: string; loc_id: string; product_id: string; qty: number };

type CartLine = { productId: string; label: string; qty: number; unitPrice: number; unitPriceVat: number; isService?: boolean };
type PaymentLine = { method: PaymentMethod; amount: string };

// ── الفواتير المعلقة: محفوظة محلياً على جهاز الكاشير (نفس سلوك النظام القديم) ──
type HeldInvoice = {
  id: string; time: string; branchId: string;
  carId: string | null; customerId: string | null; customerName: string;
  note: string; cart: CartLine[];
};
const HELD_KEY = "z8_held_invoices";

/** معرّف فريد — بديل genId() اللي محجوب على HTTP العادي (يحتاج HTTPS).
 *  يستخدم crypto.getRandomValues() لو متاحة (كل المتصفحات الحديثة، بلا قيد HTTPS)،
 *  وإلا يرجع لـMath.random كحل أخير. */
function genId(): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}
const loadHeld = (): HeldInvoice[] => {
  try { return JSON.parse(localStorage.getItem(HELD_KEY) || "[]"); } catch { return []; }
};
const saveHeld = (list: HeldInvoice[]) => localStorage.setItem(HELD_KEY, JSON.stringify(list));

const dateFmt = (s: string) =>
  new Date(s).toLocaleString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function SalesPage() {
  const { hasPerm } = useAuth();
  const canManageShift = hasPerm("shifts.manage_own");
  const canCreateInvoiceBase = hasPerm("invoices.create");
  const canReturn = hasPerm("invoices.return");
  const canViewInvoices = hasPerm("invoices.view_today", "invoices.view_all", "invoices.view_pending");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [stock, setStock] = useState<Map<string, number>>(new Map()); // key: branchId|productId
  const [allCustomers, setAllCustomers] = useState<Customer[] | null>(null);
  const [queue, setQueue] = useState<BillingQueueRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [shift, setShift] = useState<ShiftReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  // ── فتح/إغلاق وردية ──
  const [openBranchId, setOpenBranchId] = useState("");
  const [openingCash, setOpeningCash] = useState("0");
  const [closeModal, setCloseModal] = useState(false);
  const [countedCash, setCountedCash] = useState("");
  const [closeNotes, setCloseNotes] = useState("");
  const [shiftErr, setShiftErr] = useState("");
  const [shiftBusy, setShiftBusy] = useState(false);

  // ── سلة البيع ──
  const [carId, setCarId] = useState<string | null>(null);
  const [branchId, setBranchId] = useState("");
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerResults, setCustomerResults] = useState<Customer[]>([]);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [productQuery, setProductQuery] = useState("");
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: "cash", amount: "" }]);
  const [saleErr, setSaleErr] = useState("");
  const [saleBusy, setSaleBusy] = useState(false);
  // ── خصم الفاتورة + مفتاح Idempotency: يتجدد عند بدء بيع جديد، يمنع تكرار الإصدار ──
  const [discountInput, setDiscountInput] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [idemKey, setIdemKey] = useState(() => genId());
  const [lastInvoice, setLastInvoice] = useState<Invoice | null>(null);

  // ── الفواتير المعلقة ──
  const [held, setHeld] = useState<HeldInvoice[]>([]);
  const [heldModal, setHeldModal] = useState(false);
  const [holdNote, setHoldNote] = useState("");
  const [holdModal, setHoldModal] = useState(false);

  // ── عرض فاتورة ──
  const [viewInvoice, setViewInvoice] = useState<InvoiceDetail | null>(null);

  // ── تبويب الشاشة: نقطة البيع / سجل الفواتير ──
  // فتح الشاشة من "سجل الفواتير" في القائمة يوديك مباشرة لتبويب السجل — من "نقطة البيع" يفتح على البيع
  const pathname = usePathname();
  const [screen, setScreen] = useState<"pos" | "history">(pathname.endsWith("/history") ? "history" : "pos");

  // ── وضع نقطة البيع (من المسار): /sales = خدمة (سيارات الطابور فقط) | /sales/direct = بيع مباشر (بدون سيارات) ──
  const posMode: "service" | "direct" = pathname.includes("/sales/direct") ? "direct" : "service";
  const canCreateInvoice = canCreateInvoiceBase
    || hasPerm(posMode === "direct" ? "invoices.create_direct" : "invoices.create_service");
  const posTitle = posMode === "direct" ? "البيع المباشر" : "نقطة بيع الخدمة";

  // ── توست خفيف عند إضافة صنف — يختفي لوحده ──
  const [toast, setToast] = useState("");
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 1400);
  }

  // ── اختصارات الكاشير: F2 بحث | F4 دفع | Esc إلغاء ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "F2") { e.preventDefault(); document.getElementById("pos-barcode")?.focus(); }
      if (e.key === "F4") { e.preventDefault(); (document.getElementById("pos-pay") as HTMLButtonElement | null)?.click(); }
      if (e.key === "Escape") { setPickOpen(false); setProductQuery(""); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── خطوة البيع: السلة ← شاشة الدفع ──
  const [step, setStep] = useState<"cart" | "pay">("cart");

  // ── شريط الإحصائيات الحية (أعلى الشاشة) ──
  type DashStats = {
    today: { total: number; count: number };
    cars: { queued: number; inService: number; doneToday: number };
    todayBySource: Record<string, number>;
  };
  const [stats, setStats] = useState<DashStats | null>(null);
  useEffect(() => {
    let stop = false;
    const sync = () => api<DashStats>("/reports/dashboard").then((d) => !stop && setStats(d)).catch(() => {});
      api<BillingQueueRow[]>("/cars/billing-queue").then((q) => !stop && setQueue(q)).catch(() => {});
    sync();
    const t = setInterval(sync, 15000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // ── شريط التصنيفات: تمرير أفقي بالأسهم ──
  const catStripRef = useRef<HTMLDivElement>(null);
  const scrollCats = (dir: 1 | -1) =>
    catStripRef.current?.scrollBy({ left: dir * 260, behavior: "smooth" });

  // ── الفحص الختامي بالكاميرا قبل الدفع ──
  const [scanModal, setScanModal] = useState<null | {
    faults: { code: string; label: string; severity: string; note: string }[];
    image: string; blocked: boolean; compared?: boolean;
  }>(null);
  const [scanBusy, setScanBusy] = useState(false);

  // ── نافذة سيارات الخدمة (من بطاقتي الانتظار/في الخدمة) ──
  const [svcFilter, setSvcFilter] = useState<null | "waiting" | "in_service">(null);
  function openSvc(f: "waiting" | "in_service") {
    api<BillingQueueRow[]>("/cars/billing-queue").then(setQueue).catch(() => {});
    setSvcFilter(f);
  }
  const svcRows = useMemo(() => queue.filter((r) =>
    svcFilter === "waiting" ? !r.entered_at : (r.entered_at && !r.exited_at)), [queue, svcFilter]);
  const preparedTotal = (r: BillingQueueRow) =>
    (r.prepared_items || []).reduce((sum, it) => sum + it.unitPriceVat * (it.isService ? 1 : it.qty), 0);

  // ── فواتير العميل السابقة (من زر فواتير في جدول الخدمة) ──
  const [custInvFor, setCustInvFor] = useState<BillingQueueRow | null>(null);
  const [custInvs, setCustInvs] = useState<Invoice[] | null>(null);
  function openCustInvs(r: BillingQueueRow) {
    setCustInvFor(r); setCustInvs(null);
    api<Invoice[]>(`/invoices?customerId=${r.customer_id}&limit=15`)
      .then(setCustInvs).catch(() => setCustInvs([]));
  }

  // ── نافذة إعادة الطباعة (فواتير اليوم) ──
  const [repFilter, setRepFilter] = useState<null | "all" | "pos" | "car">(null);
  const todayStr = new Date().toDateString();
  const todayInvoices = useMemo(() =>
    invoices.filter((i) => new Date(i.issued_at).toDateString() === todayStr), [invoices]);

  // ── ألوان التصنيفات (بنمط أزرار الأندرويد — كل قسم بلونه) ──
  const CAT_COLORS: Record<string, string> = {
    "خدمة": "#B07E14", "الخدمات": "#B07E14",
    "زيوت": "#0C5E66", "شحوم": "#7A4E24",
    "سوائل ومعالجات": "#2E6ED8", "منظفات": "#157F4C",
    "معطرات": "#7C4DBE", "فلاتر": "#D06018",
  };
  const FALLBACK_COLORS = ["#0C5E66", "#2E6ED8", "#157F4C", "#7C4DBE", "#D06018", "#B0451F", "#3E8E8E"];
  // أيقونة التصنيف — Material Symbols Rounded حصراً
  function catIcon(cat: string, isService?: boolean): string {
    if (isService) return "handyman";
    const c = cat || "";
    if (c.includes("قير") || c.includes("دفرنس")) return "engineering";
    if (c.includes("فلتر") || c.includes("فلاتر")) return "filter_alt";
    if (c.includes("زيت") || c.includes("زيوت")) return "opacity";
    if (c.includes("بطاري")) return "battery_charging_full";
    if (c.includes("بواجي") || c.includes("شمع")) return "bolt";
    if (c.includes("تبريد") || c.includes("رديتر")) return "ac_unit";
    if (c.includes("مساحات")) return "water_drop";
    if (c.includes("مناشف") || c.includes("نظافة")) return "cleaning_services";
    if (c.includes("منظف") || c.includes("عناية")) return "soap";
    if (c.includes("معطر")) return "spa";
    if (c.includes("جريس") || c.includes("شح")) return "oil_barrel";
    if (c.includes("خدم")) return "car_repair";
    if (c.includes("إضاف") || c.includes("معالج")) return "add_circle";
    return "category";
  }
  function catColor(cat: string, isService?: boolean): string {
    if (isService) return "#B07E14";
    if (CAT_COLORS[cat]) return CAT_COLORS[cat];
    let h = 0;
    for (const ch of cat) h = (h * 31 + ch.charCodeAt(0)) % 997;
    return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
  }

  // ── نافذة اختيار العميل / السيارة (بديل شريط الطابور) ──
  const [pickOpen, setPickOpen] = useState(false);
  const [pickQuery, setPickQuery] = useState("");
  const [newCust, setNewCust] = useState<null | { name: string; phone: string }>(null);
  const [pickErr, setPickErr] = useState("");
  const [pickBusy, setPickBusy] = useState(false);

  const pickedQueue = useMemo(() => {
    const q = pickQuery.trim().toLowerCase();
    if (!q) return queue;
    return queue.filter((r) =>
      (r.plate || "").toLowerCase().includes(q) || (r.customer_name || "").toLowerCase().includes(q));
  }, [queue, pickQuery]);

  async function createQuickCustomer() {
    if (!newCust) return;
    setPickErr(""); setPickBusy(true);
    try {
      const c = await api<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify({ name: newCust.name.trim(), phone: newCust.phone.trim() || null }),
      });
      setAllCustomers(null); // إعادة تحميل الكاش في البحث القادم
      setCustomerId(c.id); setCustomerName(c.name); setCarId(null);
      setNewCust(null); setPickOpen(false); setPickQuery("");
    } catch (e: any) { setPickErr(e.message); }
    finally { setPickBusy(false); }
  }

  // ── قائمة الإعدادات السريعة ⚙ ──
  const [gearOpen, setGearOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [autoPrintOn, setAutoPrintOn] = useState(true);
  useEffect(() => {
    try {
      setDarkMode(localStorage.getItem("z8_theme") === "dark");
      setAutoPrintOn(localStorage.getItem("z8_print_auto") !== "off");
    } catch { /* */ }
  }, []);
  function toggleDark(v: boolean) {
    setDarkMode(v);
    localStorage.setItem("z8_theme", v ? "dark" : "light");
    document.documentElement.dataset.theme = v ? "dark" : "";
  }
  function toggleAutoPrint(v: boolean) {
    setAutoPrintOn(v);
    localStorage.setItem("z8_print_auto", v ? "on" : "off");
  }

  // ── تصنيفات الأصناف كمربعات فلترة ──
  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return Array.from(set).sort();
  }, [products]);
  const [activeCat, setActiveCat] = useState<string>("__all__");

  // ── شبكة الأصناف: فلترة بالتصنيف + البحث ──
  const gridProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    return products.filter((p) => {
      if (activeCat === "__service__" && !p.is_service) return false;
      if (activeCat !== "__all__" && activeCat !== "__service__" && p.category !== activeCat) return false;
      if (!q) return true;
      // البحث بالباركود فقط — لا بحث بالاسم (سياسة نقطة البيع)
      return (p.barcode || "").toLowerCase().includes(q);
    });
  }, [products, activeCat, productQuery]);

  // ── المسح التلقائي: أول ما القارئ يخلص كتابة الباركود (توقف 120مللي) والتطابق تام —
  //    الصنف ينزل الفاتورة فوراً بدون Enter. كل ضربة قارئ جديدة = +1 قطعة (زي ما هو) ──
  useEffect(() => {
    const q = productQuery.trim();
    if (!q) return;
    const t = setTimeout(() => {
      const hit = products.find((p) => p.barcode && p.barcode === q);
      if (hit) addProduct(hit);   // addProduct بتمسح الحقل جاهزاً للضربة الجاية
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productQuery, products]);

  // ── الباركود: Enter يضيف الصنف المطابق فوراً (شغال برضه كخط احتياطي) ──
  function onSearchKey(e: React.KeyboardEvent) {
    if (e.key !== "Enter") return;
    const q = productQuery.trim();
    if (!q) return;
    const byBarcode = products.find((p) => p.barcode && p.barcode === q);
    const target = byBarcode || (gridProducts.length === 1 ? gridProducts[0] : null);
    if (target) { addProduct(target); setProductQuery(""); }
  }

  // ══════════ تجهيز يدوي فوري لسيارة موجودة («جهّز الآن») ══════════
  const [forcePrepBusy, setForcePrepBusy] = useState<string | null>(null);
  async function forcePrepare(carId: string) {
    setForcePrepBusy(carId);
    try {
      await api(`/cars/${carId}/force-prepare`, { method: "POST" });
      const q = await api<BillingQueueRow[]>("/cars/billing-queue"); setQueue(q);
    } catch (e: any) { await appAlert(e.message); }
    finally { setForcePrepBusy(null); }
  }

  // ══════════ فاتورة مثل آخر مرة (جاية من بوابة الدخول الذكية) ══════════
  const [prefillMsg, setPrefillMsg] = useState("");
  function applyRepeatInvoice(prods: Product[]) {
    try {
      const raw = localStorage.getItem("z8_repeat_invoice");
      if (!raw) return;
      localStorage.removeItem("z8_repeat_invoice");
      const pre = JSON.parse(raw) as {
        branchId?: string; carId?: string; customerId?: string | null; customerName?: string | null;
        items: { productId: string | null; label: string; qty: number; unitPrice: number; unitPriceVat: number }[];
      };
      if (pre.branchId) setBranchId(pre.branchId);
      if (pre.carId && posMode === "service") setCarId(pre.carId);
      setCustomerId(pre.customerId || null);
      setCustomerName(pre.customerName || "");
      const lines = (pre.items || [])
        .filter((it) => it.productId)
        .map((it) => {
          const prod = prods.find((pp) => pp.id === it.productId);
          return {
            productId: it.productId as string, label: it.label,
            qty: prod?.is_service ? 1 : it.qty,
            unitPrice: prod ? Number(prod.price) : it.unitPrice,
            unitPriceVat: prod ? Number(prod.price_vat) : it.unitPriceVat,
            isService: !!prod?.is_service,
          };
        });
      if (lines.length) {
        setCart(lines);
        setPrefillMsg("🧾 تم تجهيز الفاتورة مثل آخر مرة — راجع الأصناف واضغط ادفع الآن");
      }
    } catch { /* تجاهل أي تنسيق قديم */ }
  }

  async function loadStock() {
    try {
      const levels = await api<StockLevel[]>("/inventory/levels");
      const m = new Map<string, number>();
      for (const l of levels) if (l.loc_type === "branch") m.set(`${l.loc_id}|${l.product_id}`, l.qty);
      setStock(m);
    } catch { /* صلاحية عرض المخزون اختيارية — الشاشة تشتغل بدونها */ }
  }

  async function load() {
    setLoading(true);
    try {
      const [br, pr, sh] = await Promise.all([
        api<Branch[]>("/branches"),
        api<Product[]>("/products"),
        canManageShift ? api<ShiftReport | null>("/shifts/current") : Promise.resolve(null),
      ]);
      setBranches(br); setProducts(pr); setShift(sh);
      if (sh) {
        setBranchId(sh.shift.branch_id);
        const [q, inv] = await Promise.all([
          canCreateInvoice ? api<BillingQueueRow[]>("/cars/billing-queue") : Promise.resolve([]),
          canViewInvoices ? api<Invoice[]>("/invoices?limit=50") : Promise.resolve([]),
        ]);
        setQueue(q); setInvoices(inv);
        loadStock();
        applyRepeatInvoice(pr);
      } else if (br[0]) {
        setOpenBranchId(br[0].id);
      }
      setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); setHeld(loadHeld()); }, []);

  const totalInc = useMemo(() => cart.reduce((s, l) => s + l.unitPriceVat * l.qty, 0), [cart]);
  const paidSum = useMemo(() => payments.reduce((s, p) => s + (Number(p.amount) || 0), 0), [payments]);
  const discountAmount = Math.max(0, Number(discountInput) || 0);
  const totalAfterDiscount = Math.max(0, totalInc - discountAmount);
  const remaining = +(totalAfterDiscount - paidSum).toFixed(2);

  async function printShiftReport(r: ShiftReport) {
    const { printReport, tableHTML, kpisHTML } = await import("@/lib/print");
    const pm: Record<string, string> = { cash: "نقدي", card: "شبكة", transfer: "تحويل", credit: "آجل" };
    const body =
      kpisHTML([
        { label: "إجمالي المبيعات (ر.س)", value: money(r.sales.totalInc) },
        { label: "عدد الفواتير", value: String(r.sales.invoiceCount) },
        { label: "النقد المتوقع بالدرج", value: money(r.cash.expected) },
      ]) +
      `<h2 class="sec">المبيعات</h2>` +
      tableHTML(["البند", "القيمة (ر.س)"], [
        ["قبل الضريبة", money(r.sales.totalEx)],
        ["الضريبة", money(r.sales.totalVat)],
        ["الإجمالي شامل الضريبة", money(r.sales.totalInc)],
        [`مرتجعات (${r.returns.count})`, money(r.returns.totalInc)],
      ], { numericCols: [1] }) +
      `<h2 class="sec">طرق الدفع</h2>` +
      tableHTML(["الطريقة", "المبلغ (ر.س)"],
        Object.entries(r.byMethod).filter(([, v]) => v > 0).map(([m, v]) => [pm[m] || m, money(v)]),
        { numericCols: [1] }) +
      `<h2 class="sec">النقدية</h2>` +
      tableHTML(["البند", "القيمة (ر.س)"], [
        ["عهدة افتتاحية", money(r.cash.opening)],
        ["متوقع بالدرج", money(r.cash.expected)],
        ...(r.cash.counted != null ? [
          ["المعدود فعلياً", money(r.cash.counted)],
          ["الفرق", money(r.cash.difference ?? 0)],
        ] : []),
      ], { numericCols: [1] });
    printReport("تقرير وردية", `${r.shift.branch_name ?? ""}`, body);
  }


  // ══════════════════ الوردية ══════════════════

  async function openShift() {
    setShiftErr(""); setShiftBusy(true);
    try {
      await api("/shifts/open", {
        method: "POST",
        body: JSON.stringify({ branchId: openBranchId, openingCash: Number(openingCash) || 0 }),
      });
      await load();
    } catch (e: any) { setShiftErr(e.message); }
    finally { setShiftBusy(false); }
  }

  async function closeShift() {
    if (!shift) return;
    setShiftErr(""); setShiftBusy(true);
    try {
      const report = await api<ShiftReport>(`/shifts/${shift.shift.id}/close`, {
        method: "POST",
        body: JSON.stringify({ countedCash: Number(countedCash) || 0, notes: closeNotes.trim() || null }),
      });
      setCloseModal(false);
      printShiftReport(report); // تقرير الإغلاق النهائي — يُطبع تلقائياً
      await load();
    } catch (e: any) { setShiftErr(e.message); }
    finally { setShiftBusy(false); }
  }

  // ══════════════════ بناء السلة ══════════════════

  function resetSale() {
    setCarId(null); setCustomerId(null); setCustomerName(""); setCustomerQuery("");
    setCustomerResults([]); setCart([]); setPayments([{ method: "cash", amount: "" }]);
    setSaleErr(""); setDiscountInput(""); setDiscountReason("");
    setIdemKey(genId());
  }

  function startFromQueue(row: BillingQueueRow) {
    resetSale();
    setCarId(row.id);
    setCustomerId(row.customer_id);
    setCustomerName(row.customer_name || "");
    setBranchId(row.branch_id);
    // عناصر مجهّزة تلقائياً من السيرفر: مسودة بوابة الزيت أو تكرار آخر فاتورة لنفس العميل
    if (row.prepared_items && row.prepared_items.length) {
      setCart(row.prepared_items
        .filter((it) => it.productId)
        .map((it) => ({
          productId: it.productId as string, label: it.label,
          qty: it.isService ? 1 : it.qty,
          unitPrice: it.unitPrice, unitPriceVat: it.unitPriceVat, isService: it.isService,
        })));
      setPrefillMsg("🧾 تم تجهيز الفاتورة تلقائياً — راجع الأصناف واضغط ادفع الآن");
    }
  }

  const branchStock = (productId: string) =>
    stock.size ? (stock.get(`${branchId}|${productId}`) ?? 0) : null;

  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
    if (!q) return [];
    // البحث بالباركود فقط — لا بحث بالاسم (سياسة نقطة البيع)
    return products.filter((p) => (p.barcode || "").toLowerCase().includes(q)).slice(0, 8);
  }, [products, productQuery]);

  function addProduct(p: Product) {
    setCart((prev) => {
      const existing = prev.find((l) => l.productId === p.id);
      if (existing) {
        if (p.is_service) return prev;               // صنف خدمة: كمية ثابتة = 1
        return prev.map((l) => l.productId === p.id ? { ...l, qty: l.qty + 1 } : l);
      }
      return [...prev, {
        productId: p.id, label: productLabel(p), qty: 1,
        unitPrice: Number(p.price), unitPriceVat: Number(p.price_vat),
        isService: !!p.is_service,
      }];
    });
    showToast(`✓ ${productLabel(p)}`);
    setProductQuery("");
  }
  function setLineQty(productId: string, qty: number) {
    setCart((prev) => prev.map((l) => l.productId === productId ? { ...l, qty: Math.max(1, qty) } : l));
  }

  // ── الكرتونة = 12 قطعة: أزرار +/− بتشتغل بالكراتين فقط — القطع المفردة من الباركود بس ──
  //    (+) بترفع لأقرب مضاعف كرتونة أعلى: 1←12، 12←24، 15←24
  //    (−) بتنزل كرتونة كاملة، ولو وصلت صفر السطر بيتشال
  const CARTON = 12;
  function cartonUp(productId: string) {
    setCart((prev) => prev.map((l) => l.productId === productId
      ? { ...l, qty: (Math.floor(l.qty / CARTON) + 1) * CARTON } : l));
  }
  function cartonDown(productId: string) {
    setCart((prev) => prev.flatMap((l) => {
      if (l.productId !== productId) return [l];
      const next = (Math.ceil(l.qty / CARTON) - 1) * CARTON;
      return next <= 0 ? [] : [{ ...l, qty: next }];
    }));
  }
  function removeLine(productId: string) {
    setCart((prev) => prev.filter((l) => l.productId !== productId));
  }

  // بحث العملاء: بالاسم أو الجوال (من القائمة) + برقم اللوحة (من السيرفر) — نفس النظام القديم
  async function searchCustomers(q: string) {
    setCustomerQuery(q);
    const term = q.trim();
    if (term.length < 2) { setCustomerResults([]); return; }
    let base = allCustomers;
    if (!base) {
      try { base = await api<Customer[]>("/customers"); setAllCustomers(base); }
      catch { base = []; }
    }
    const low = term.toLowerCase();
    const byNamePhone = (base || []).filter((c) =>
      c.name.toLowerCase().includes(low) || (c.phone || "").includes(term)
    );
    let byPlate: Customer[] = [];
    try { byPlate = await api<Customer[]>(`/customers/search-by-plate?plate=${encodeURIComponent(term)}`); }
    catch { /* اختياري */ }
    const seen = new Set<string>();
    const merged = [...byNamePhone, ...byPlate].filter((c) => !seen.has(c.id) && seen.add(c.id));
    setCustomerResults(merged.slice(0, 8));
  }

  function fillRemaining(index: number) {
    setPayments((prev) => prev.map((p, i) => i === index ? { ...p, amount: String(Math.max(0, remaining + (Number(p.amount) || 0))) } : p));
  }
  function addPaymentLine() {
    setPayments((prev) => [...prev, { method: "cash", amount: remaining > 0 ? String(remaining) : "" }]);
  }
  function removePaymentLine(i: number) {
    setPayments((prev) => prev.filter((_, idx) => idx !== i));
  }

  // ══════════════════ الفواتير المعلقة ══════════════════

  function holdCurrent() {
    if (cart.length === 0) return;
    const entry: HeldInvoice = {
      id: `H${Date.now()}`, time: new Date().toISOString(), branchId,
      carId, customerId, customerName, note: holdNote.trim(), cart,
    };
    const next = [entry, ...held];
    setHeld(next); saveHeld(next);
    setHoldModal(false); setHoldNote("");
    resetSale();
  }
  function resumeHeld(h: HeldInvoice) {
    resetSale();
    setBranchId(h.branchId); setCarId(h.carId);
    setCustomerId(h.customerId); setCustomerName(h.customerName);
    setCart(h.cart);
    const next = held.filter((x) => x.id !== h.id);
    setHeld(next); saveHeld(next);
    setHeldModal(false);
  }
  function deleteHeld(id: string) {
    const next = held.filter((x) => x.id !== id);
    setHeld(next); saveHeld(next);
  }

  // ══════════════════ الإصدار والطباعة ══════════════════

  async function printById(id: string, format: PrintFormat = "thermal") {
    try {
      // تحميل كسول: محرك الطباعة يتحمل عند أول استخدام فقط (تخفيف حزمة الصفحة)
      const [{ printInvoice }, detail] = await Promise.all([
        import("@/lib/print-invoice"),
        api<InvoiceDetail>(`/invoices/${id}`),
      ]);
      printInvoice(detail, format);
    }
    catch (e: any) { await appAlert(e.message); }
  }

  async function submitSale() {
    if (posMode === "service" && !carId) {
      setSaleErr("نقطة بيع الخدمة بتصدر فواتير سيارات الطابور فقط — اختار سيارة، أو استخدم شاشة البيع المباشر");
      return;
    }
    setSaleErr(""); setSaleBusy(true);
    try {
      const body = {
        branchId, source: carId ? "car" : "pos", carId,
        invoiceType: "simplified" as const,
        customerId, customerName: customerName.trim() || null, customerVat: null,
        items: cart.map((l) => ({
          productId: l.productId, label: l.label, qty: l.qty,
          unitPrice: l.unitPrice, unitPriceVat: l.unitPriceVat,
        })),
        payments: payments
          .filter((p) => Number(p.amount) > 0)
          .map((p) => ({ method: p.method, amount: Number(p.amount) })),
        discountAmount, discountReason: discountReason.trim() || null,
        idempotencyKey: idemKey,
      };
      const invoice = await api<Invoice>("/invoices", { method: "POST", body: JSON.stringify(body) });
      setLastInvoice(invoice);
      resetSale();
      setStep("cart");
      // طباعة تلقائية فور الإصدار (تتقفل من الإعدادات ← الطباعة)
      if (localStorage.getItem("z8_print_auto") !== "off") printById(invoice.id, "thermal");
      await load();
    } catch (e: any) { setSaleErr(e.message); }
    finally { setSaleBusy(false); }
  }

  // ══════════════════ سجل الفواتير ══════════════════

  async function openInvoice(inv: Invoice) {
    try { setViewInvoice(await api<InvoiceDetail>(`/invoices/${inv.id}`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function returnInvoice() {
    if (!viewInvoice) return;
    if (!await appConfirm(`عمل مرتجع كامل للفاتورة ${viewInvoice.invoice_no}؟ هيرجّع المخزون ويعكس القيود المحاسبية.`)) return;
    try {
      await api(`/invoices/${viewInvoice.id}/return`, { method: "POST" });
      setViewInvoice(null);
      await load();
    } catch (e: any) { await appAlert(e.message); }
  }

  const invoiceCols: Column<Invoice>[] = [
    { key: "invoice_no", title: "رقم الفاتورة", width: "120px", render: (i) => <span className="tnum font-extrabold">{i.invoice_no}</span> },
    { key: "customer_name", title: "العميل", render: (i) => i.customer_name || <span className="text-text-dim">بيع نقدي</span> },
    { key: "total_inc", title: "الإجمالي", width: "110px", render: (i) => <span className="tnum font-bold">{money(i.total_inc)}</span> },
    {
      key: "is_returned", title: "الحالة", width: "100px",
      render: (i) => i.is_returned ? <Badge tone="warn">مرتجعة</Badge> : <Badge tone="good">سارية</Badge>,
    },
    { key: "issued_at", title: "التاريخ", width: "160px", render: (i) => <span className="text-[12px] text-text-dim">{dateFmt(i.issued_at)}</span> },
    {
      key: "actions", title: "", width: "150px",
      render: (i) => (
        <div className="flex gap-1.5">
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => openInvoice(i)}>عرض</Button>
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => printById(i.id)}>طباعة</Button>
        </div>
      ),
    },
  ];

  if (loading) return <div className="text-text-dim">جارِ التحميل...</div>;

  // ── لا توجد وردية مفتوحة: شاشة فتح وردية فقط ──
  if (!shift) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <h1 className="text-[19px] font-extrabold">{posTitle}</h1>
        <ErrorNote msg={pageErr} />

      {prefillMsg && (
        <div className="flex items-center justify-between rounded-lg border border-petrol/40 bg-petrol-soft px-4 py-2.5 text-[12.5px] font-bold text-petrol">
          <span>{prefillMsg}</span>
          <button onClick={() => setPrefillMsg("")} className="text-petrol/60 hover:text-petrol">✕</button>
        </div>
      )}
        <Card>
          <p className="mb-3 text-[13px] text-text-dim">
            لازم تفتح وردية الأول قبل ما تقدر تصدر فواتير.
          </p>
          <div className="space-y-3">
            <Field label="الفرع">
              <Select value={openBranchId} onChange={(e) => setOpenBranchId(e.target.value)}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="عهدة النقدية الافتتاحية">
              <Input type="number" min={0} step="0.01" className="tnum" value={openingCash}
                     onChange={(e) => setOpeningCash(e.target.value)} />
            </Field>
            <ErrorNote msg={shiftErr} />
            <Button className="w-full justify-center" onClick={openShift} disabled={shiftBusy || !openBranchId}>
              {shiftBusy ? "جارِ الفتح..." : "فتح الوردية"}
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const chipCls = "flex items-center gap-2 rounded-xl border border-line bg-ink-2 px-3.5 py-2 text-[12px] font-bold transition hover:border-petrol";

  return (
    <div className="space-y-3">
      {/* ══════════ الشريط العلوي: العنوان + الوردية + التبويبات ══════════ */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-[19px] font-extrabold">{posTitle}</h1>
          <div className="flex overflow-hidden rounded-lg border border-line text-[12px] font-bold">
            <button onClick={() => setScreen("pos")}
                    className={`px-4 py-1.5 ${screen === "pos" ? "bg-petrol text-white" : "bg-ink-2 text-text-dim hover:text-text"}`}>
              نقطة البيع
            </button>
            {canViewInvoices && (
              <button onClick={() => setScreen("history")}
                      className={`px-4 py-1.5 ${screen === "history" ? "bg-petrol text-white" : "bg-ink-2 text-text-dim hover:text-text"}`}>
              سجل الفواتير
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
        {/* حالة الوردية: لمبة + نشطة */}
        <div className="flex items-center gap-2 rounded-lg border border-line bg-ink-2 px-3 py-1.5 text-[12.5px] font-bold">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald opacity-60" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald" />
          </span>
          الوردية: نشطة
        </div>
        {/* ⚙ الإعدادات — الوردية والتقارير والتفضيلات كلها هنا */}
        <div className="relative">
          <button onClick={() => setGearOpen((v) => !v)} aria-label="الإعدادات" title="الإعدادات — الوردية والتقارير"
                  className="flex items-center justify-center rounded-full p-1.5 transition hover:rotate-45"
                  style={{ color: "#152647" }}>
            <MIcon name="settings" className="!text-[24px]" />
          </button>
          {gearOpen && (
            <div className="absolute left-0 z-30 mt-1 w-72 space-y-3 rounded-xl border border-line bg-ink-2 p-3.5 shadow-panel">
              <div className="space-y-2 rounded-lg bg-ink-3 p-2.5">
                <div className="flex items-center justify-between text-[12.5px] font-bold">
                  <span className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald" />
                    وردية {shift.shift.branch_name} — نشطة
                  </span>
                  <b className="tnum">{money(shift.sales.totalInc)}</b>
                </div>
                <div className="flex gap-1.5">
                  <Button variant="ghost" className="flex-1 justify-center !py-1.5 !text-[11.5px]"
                          onClick={() => { printShiftReport(shift); setGearOpen(false); }}>
                    🖨 تقرير الوردية
                  </Button>
                  <Button variant="danger" className="flex-1 justify-center !py-1.5 !text-[11.5px]"
                          onClick={() => { setCountedCash(""); setCloseNotes(""); setShiftErr(""); setCloseModal(true); setGearOpen(false); }}>
                    إغلاق الوردية
                  </Button>
                </div>
              </div>
              <label className="flex cursor-pointer items-center justify-between text-[12.5px] font-bold">
                الوضع الليلي 🌙
                <input type="checkbox" checked={darkMode} className="h-4 w-4 accent-petrol"
                       onChange={(e) => toggleDark(e.target.checked)} />
              </label>
              <label className="flex cursor-pointer items-center justify-between text-[12.5px] font-bold">
                الطباعة التلقائية 🖨
                <input type="checkbox" checked={autoPrintOn} className="h-4 w-4 accent-petrol"
                       onChange={(e) => toggleAutoPrint(e.target.checked)} />
              </label>
              <div className="flex items-center justify-between text-[12.5px] font-bold text-text-dim">
                اللغة 🌐
                <span className="rounded-full bg-ink-3 px-2 py-0.5 text-[10.5px]">العربية — English قريباً</span>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ══════════ بطاقات الإحصائيات الحية — في نقطة بيع الخدمة فقط ══════════ */}
      {posMode === "service" && (
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          { icon: "description", label: "فواتير اليوم", value: stats?.today.count ?? "…", sub: stats ? `${money(stats.today.total)} ر.س` : "", color: "#0C5E66", onClick: () => setRepFilter("all"), href: "" },
          { icon: "point_of_sale", label: "فواتير بيع", value: stats?.todayBySource?.pos ?? 0, sub: "", color: "#2E6ED8", onClick: () => setRepFilter("pos"), href: "" },
          { icon: "receipt_long", label: "فواتير خدمة", value: stats?.todayBySource?.car ?? 0, sub: "", color: "#7C4DBE", onClick: () => setRepFilter("car"), href: "" },
          { icon: "schedule", label: "الانتظار", value: stats?.cars.queued ?? "…", sub: "", color: "#B07E14", onClick: () => openSvc("waiting"), href: "" },
          { icon: "build", label: "في الخدمة", value: stats?.cars.inService ?? "…", sub: "", color: "#D06018", onClick: () => openSvc("in_service"), href: "" },
          { icon: "task_alt", label: "خرجت اليوم", value: stats?.cars.doneToday ?? "…", sub: "", color: "#157F4C", onClick: () => {}, href: "/cars" },
        ].map((t) => {
          const inner = (
            <div className="flex h-full flex-col items-center justify-center gap-0.5 rounded-xl border border-line bg-ink-2 px-2 py-2 text-center shadow-card transition hover:-translate-y-0.5 hover:shadow-panel"
                 style={{ borderTopWidth: 3, borderTopColor: t.color }}>
              <span style={{ color: t.color }}><MIcon name={t.icon} className="!text-[19px]" /></span>
              <span className="tnum text-[16px] font-black leading-none" style={{ color: t.color }}>{t.value}</span>
              <span className="text-[10.5px] font-bold text-text-dim">{t.label}</span>
              {t.sub && <span className="tnum text-[9.5px] text-text-dim">{t.sub}</span>}
            </div>
          );
          return t.href
            ? <a key={t.label} href={t.href} className="block">{inner}</a>
            : <button key={t.label} onClick={t.onClick} className="block w-full">{inner}</button>;
        })}


      </div>
      )}

      <ErrorNote msg={pageErr} />
      {!canCreateInvoice && (
        <div className="rounded-xl bg-ember-bg px-4 py-3 text-[13px] font-bold text-ember">
          ⛔ هذه الشاشة مخصصة لكاشير {posMode === "direct" ? "البيع المباشر" : "الخدمة"} — حسابك لا يملك صلاحيتها.
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 right-1/2 z-50 translate-x-1/2 rounded-full bg-slate-900 px-5 py-2.5 text-[13px] font-bold text-white shadow-xl">
          {toast}
        </div>
      )}

      {lastInvoice && (
        <div className="flex items-center justify-between rounded-lg border border-emerald/30 bg-emerald-bg px-4 py-2.5 text-[12.5px] font-bold text-emerald">
          <span>✓ تم إصدار فاتورة {lastInvoice.invoice_no} بإجمالي {money(lastInvoice.total_inc)} ر.س</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => printById(lastInvoice.id)}>إعادة طباعة</Button>
            <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={() => window.open(`/api/invoices/${lastInvoice.id}/pdf`, "_blank")}>📄 PDF</Button>
            <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                    onClick={async () => {
                      try { await api(`/invoices/${lastInvoice.id}/send-whatsapp`, { method: "POST" }); showToast("📲 جارٍ الإرسال واتساب"); }
                      catch { showToast("تعذر الإرسال"); }
                    }}>📲 واتساب</Button>
            <button onClick={() => setLastInvoice(null)} className="text-emerald/70 hover:text-emerald">✕</button>
          </div>
        </div>
      )}

      {/* ══════════════════ شاشة نقطة البيع ══════════════════ */}
      {screen === "pos" && canCreateInvoice && (
        <>
          {/* اختيار العميل / السيارة — نظيف بزرار واحد */}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => { setPickOpen(true); api<BillingQueueRow[]>("/cars/billing-queue").then(setQueue).catch(() => {}); setPickQuery(""); setNewCust(null); setPickErr(""); }}
                    className="flex items-center gap-2 rounded-xl bg-petrol px-4 py-2 text-[13px] font-bold text-white shadow-card transition hover:brightness-110">
              <MIcon name="person_add" className="!text-[19px] text-white" />
              {carId || customerId ? "تغيير العميل" : posMode === "service" ? "🚗 اختيار سيارة من الطابور" : "إضافة عميل"}
            </button>
            {(carId || customerId) ? (
              <span className="flex items-center gap-2 rounded-xl border border-petrol bg-petrol-soft px-3.5 py-2 text-[12.5px] font-bold text-petrol">
                {carId ? "🚗" : "👤"} {customerName || "عميل"}
                {carId && queue.find((r) => r.id === carId)?.plate && (
                  <span className="tnum">— {queue.find((r) => r.id === carId)?.plate}</span>
                )}
                <button onClick={resetSale} className="mr-1 text-petrol/60 hover:text-petrol" aria-label="إلغاء">✕</button>
              </span>
            ) : (
              <span className="rounded-xl bg-ink-3 px-3.5 py-2 text-[12.5px] font-bold text-text-dim">{posMode === "direct" ? "بيع نقدي" : "اختار سيارة من الطابور 👈"}</span>
            )}
          </div>

          <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
            {/* ── منطقة الأصناف: بحث + تصنيفات + شبكة بطاقات ── */}
            <div className="min-w-0 space-y-3">
              <div className="flex items-center gap-2">
                <Input id="pos-barcode" value={productQuery} onKeyDown={onSearchKey}
                       onChange={(e) => setProductQuery(e.target.value)}
                       className="!w-72 shrink-0 !rounded-xl !py-2.5 !text-[13.5px] focus:!ring-2 focus:!ring-[#163A70]/20"
                       placeholder="🔍 امسح الباركود (F2) — البحث بالباركود فقط" autoFocus />

                {/* سهم يمين */}
                <button onClick={() => scrollCats(1)} aria-label="تمرير يميناً"
                        className="grid h-9 w-7 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol">
                  ‹
                </button>

                {/* شريط المربعات — تمرير أفقي ناعم */}
                <div ref={catStripRef} dir="rtl"
                     className="scrollbar-none min-w-0 flex-1 overflow-x-auto scroll-smooth">
                  <div className="flex w-max gap-2 py-0.5">
                    {[
                      { key: "__all__", label: "الكل", icon: "apps" },
                      { key: "__service__", label: "الخدمات", icon: "handyman" },
                      ...categories.map((c) => ({ key: c, label: c, icon: catIcon(c) })),
                    ].map((c) => (
                      <button key={c.key} onClick={() => setActiveCat(c.key)}
                              className={`flex h-[58px] w-[88px] shrink-0 flex-col items-center justify-center gap-1 rounded-lg text-white shadow-card transition active:scale-[.94]
                                ${activeCat === c.key ? "bg-[#163A70] text-white shadow-md" : "border border-[#E5E7EB] !bg-white !text-slate-600 hover:border-[#163A70] hover:!text-[#163A70]"}`}>
                        <MIcon name={c.icon} className={`!text-[20px] ${activeCat === c.key ? "text-white" : "text-inherit"}`} />
                        <span className="max-w-[84px] truncate px-0.5 text-[10.5px] font-black leading-tight">{c.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* سهم شمال */}
                <button onClick={() => scrollCats(-1)} aria-label="تمرير يساراً"
                        className="grid h-9 w-7 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol">
                  ›
                </button>
              </div>

              <div className="grid max-h-[calc(100vh-300px)] content-start gap-2 overflow-y-auto p-0.5 [grid-template-columns:repeat(5,minmax(0,1fr))]">
                {products.length === 0 ? (
                  Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border border-[#E5E7EB] bg-white p-2">
                      <div className="h-16 animate-pulse rounded-xl bg-slate-100" />
                      <div className="mt-2 h-3 animate-pulse rounded-full bg-slate-100" />
                      <div className="mt-1.5 h-3 w-2/3 animate-pulse rounded-full bg-slate-100" />
                    </div>
                  ))
                ) : gridProducts.length === 0 ? (
                  <div className="col-span-full flex flex-col items-center gap-2 py-12 text-slate-400">
                    <MIcon name="barcode_scanner" className="!text-[40px]" />
                    <p className="text-[13px] font-bold">لا توجد أصناف مطابقة لهذا الباركود</p>
                    <p className="text-[11.5px]">امسح باركوداً آخر — أو اختر فئة من الأعلى</p>
                  </div>
                ) : gridProducts.map((p) => {
                  const st = p.is_service ? null : branchStock(p.id);
                  const inCart = cart.some((l) => l.productId === p.id);
                  const clr = catColor(p.category, p.is_service);
                  const stockTone = st === null ? null
                    : st <= 0 ? { bg: "#FEE2E2", fg: "#B91C1C", label: "نفد" }
                    : st <= 5 ? { bg: "#FEF3C7", fg: "#B45309", label: `قليل ${st}` }
                    : { bg: "#DCFCE7", fg: "#15803D", label: `متوفر ${st}` };
                  return (
                    <button key={p.id} onClick={() => addProduct(p)}
                            className="group relative flex flex-col rounded-2xl bg-white p-2 text-center shadow-sm transition-all duration-200 ease-in-out hover:-translate-y-1 hover:shadow-lg active:translate-y-0 active:scale-[0.97] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#163A70]"
                            style={{ border: `1.5px solid ${inCart ? "#22C55E" : "#E5E7EB"}` }}>
                      <div className="relative grid h-16 place-items-center overflow-hidden rounded-xl bg-[#F7F8FA]">
                        <span className="text-slate-300 transition-transform duration-200 group-hover:scale-110">
                          <MIcon name={catIcon(p.category, p.is_service)} className="!text-[32px]" />
                        </span>
                        {inCart && (
                          <span className="absolute right-1.5 top-1.5 grid h-5 w-5 place-items-center rounded-full bg-[#22C55E] text-white shadow-sm">
                            <MIcon name="check" className="!text-[13px] text-white" />
                          </span>
                        )}
                        {stockTone && (
                          <span className="tnum absolute left-1.5 top-1.5 rounded-full px-1.5 py-0.5 text-[8.5px] font-black"
                                style={{ background: stockTone.bg, color: stockTone.fg }}>{stockTone.label}</span>
                        )}
                      </div>
                      <div className="mt-1.5 line-clamp-2 min-h-[32px] text-[12px] font-bold leading-tight text-slate-800">
                        {p.name}{p.spec ? ` — ${p.spec}` : ""}
                      </div>
                      {p.barcode && <div className="tnum text-[9px] text-slate-400">{p.barcode}</div>}
                      <div className="mt-auto flex items-center justify-between pt-1.5">
                        <span className="grid h-8 w-8 place-items-center rounded-full bg-[#22C55E] text-white shadow-md transition-all duration-200 group-hover:scale-110 group-hover:brightness-105 group-active:scale-90">
                          <MIcon name="add" className="!text-[18px] text-white" />
                        </span>
                        <span className="tnum text-[15px] font-black leading-none text-slate-900">
                          {money(Number(p.price_vat))}<span className="mr-0.5 text-[9px] font-bold text-slate-400">ر.س</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── السلة (خطوة 1) — ستايل الإيصال ── */}
            <Card className="!p-0 overflow-hidden lg:sticky lg:top-3">
              <div className="flex items-center justify-between bg-[#163A70] px-4 py-3 text-white">
                <div className="min-w-0">
                  <h2 className="flex items-center gap-1.5 text-[13.5px] font-black">
                    <MIcon name="shopping_cart" className="!text-[18px] text-white" /> الفاتورة
                  </h2>
                  <div className="truncate text-[10.5px] font-bold text-white/60">
                    {customerName || "بيع نقدي"}{carId ? " · سيارة في الخدمة" : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tnum rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold">{cart.length} صنف</span>
                  <button onClick={() => setHeldModal(true)}
                          className="rounded-lg bg-white/15 px-2.5 py-1 text-[10.5px] font-black hover:bg-white/25">
                    المعلقة {held.length > 0 && <span className="tnum rounded-full bg-amber-400 px-1.5 text-[#1E2B4F]">{held.length}</span>}
                  </button>
                </div>
              </div>

              <div className="max-h-[calc(100vh-430px)] divide-y divide-line overflow-y-auto">
                {cart.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-10 text-slate-400">
                    <MIcon name="shopping_cart" className="!text-[34px]" />
                    <p className="text-[12.5px] font-bold">الفاتورة فارغة</p>
                    <p className="text-[11px]">امسح الباركود أو اضغط بطاقة الصنف — وسيظهر هنا فوراً</p>
                  </div>
                ) : cart.map((l) => (
                  <div key={l.productId} className="px-4 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-[12px] font-bold leading-snug">
                        {l.isService && <span className="ml-1 text-[10px] text-brass">🛠</span>}
                        {l.label}
                      </div>
                      <button onClick={() => removeLine(l.productId)} aria-label="حذف"
                              className="mi-hover shrink-0 rounded-md px-1 text-text-dim hover:bg-ember-bg hover:text-ember"><MIcon name="delete" className="!text-[17px]" /></button>
                    </div>
                    <div className="mt-1 flex items-center justify-between">
                      {l.isService ? (
                        <span className="rounded-full bg-brass-soft px-2 py-0.5 text-[10px] font-bold text-brass">خدمة — كمية ثابتة</span>
                      ) : (
                        <div className="flex items-center gap-1">
                          <button onClick={() => cartonDown(l.productId)} title="− كرتونة (12 قطعة)"
                                  className="h-6 w-6 rounded-md bg-ink-3 text-[13px] font-black hover:bg-ink-4">−</button>
                          <span className="tnum w-8 text-center text-[13px] font-bold">{l.qty}</span>
                          <button onClick={() => cartonUp(l.productId)} title="+ كرتونة (12 قطعة)"
                                  className="h-6 w-6 rounded-md bg-ink-3 text-[13px] font-black hover:bg-ink-4">+</button>
                        </div>
                      )}
                      <span className="tnum text-[13px] font-black">{money(l.unitPriceVat * l.qty)}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-2.5 border-t border-dashed border-line p-4 pb-2">
                <div className="flex items-center justify-between text-[11.5px] font-bold text-text-dim">
                  <span>الإجمالي شامل الضريبة</span>
                  <span className="tnum">{cart.length} صنف</span>
                </div>
                <button onClick={async () => {
                          if (!cart.length) return;
                          // ══ بوابة الجودة: تشييك + فحص كاميرا ختامي قبل الدفع ══
                          if (carId) {
                            try {
                              const ck = await api<{ items: { label: string; status: string }[] }>(`/cars/${carId}/checklist`);
                              const needs = (ck.items || []).filter((i) => i.status === "needs");
                              if (needs.length) {
                                await appAlert(`🚫 لا يمكن الدفع — مشاكل مفتوحة على السيارة:\n• ${needs.map((i) => i.label).join("\n• ")}`);
                                return;
                              }
                            } catch { /* */ }
                            // الفحص الختامي بالكاميرا — صيد الأخطاء لحظة الدفع
                            try {
                              setScanBusy(true);
                              const scan = await api<{ available: boolean; faults: any[]; image_base64?: string; compared?: boolean }>(
                                "/cameras/error-scan", { method: "POST", body: JSON.stringify({ carId }) });
                              setScanBusy(false);
                              if (scan.available && scan.faults.length > 0) {
                                setScanModal({
                                  faults: scan.faults,
                                  image: scan.image_base64 || "",
                                  blocked: scan.faults.some((f) => f.severity === "high"),
                                  compared: scan.compared,
                                });
                                return;   // النافذة هي اللي بتقرر يكمل ولا لأ
                              }
                            } catch { setScanBusy(false); /* كاميرا مش متاحة — البيع يكمل عادي */ }
                          }
                          setPayments([{ method: "cash", amount: String(totalInc) }]); setSaleErr(""); setStep("pay");
                        }}
                        disabled={cart.length === 0 || !branchId || !canCreateInvoice}
                        id="pos-pay"
                        className="flex w-full items-center justify-between rounded-2xl bg-[#22C55E] px-5 py-4 text-white shadow-md transition-all duration-200 hover:-translate-y-px hover:shadow-lg hover:brightness-105 active:translate-y-0 active:scale-[0.99] disabled:opacity-40">
                  <span className="flex items-center gap-2 text-[15.5px] font-black">
                    <MIcon name={scanBusy ? "videocam" : "payments"} className="!text-[21px] text-white" />
                    {scanBusy ? "الكاميرا تفحص..." : "ادفع الآن"}
                    <kbd className="rounded-md bg-white/20 px-1.5 py-0.5 text-[9.5px] font-bold">F4</kbd>
                  </span>
                  <span className="tnum text-[21px] font-black">{money(totalInc)} <span className="text-[11px]">ر.س</span></span>
                </button>
                <Button variant="ghost" className="w-full justify-center !text-[11.5px]" disabled={cart.length === 0}
                        onClick={() => { setHoldNote(""); setHoldModal(true); }}>
                  ⏸ تعليق الفاتورة
                </Button>
              </div>
              {/* حافة الإيصال المسننة */}
              <div className="h-3 w-full"
                   style={{ background: "linear-gradient(45deg, var(--ink) 50%, transparent 50%) 0 100%/12px 12px repeat-x, linear-gradient(-45deg, var(--ink) 50%, transparent 50%) 6px 100%/12px 12px repeat-x" }} />
            </Card>
          </div>

          {/* ══════════ خطوة 2: شاشة الدفع ══════════ */}
          {step === "pay" && (
            <div className="fixed inset-0 z-40 grid place-items-center bg-black/50 p-4" onClick={() => setStep("cart")}>
              <div className="w-full max-w-md space-y-4 rounded-2xl border border-line bg-ink-2 p-5 shadow-panel"
                   onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <h2 className="text-[16px] font-extrabold">إتمام الدفع</h2>
                  <button onClick={() => setStep("cart")} className="text-text-dim hover:text-text">✕</button>
                </div>

                <div className="rounded-xl bg-petrol-deep px-4 py-4 text-center text-white">
                  <div className="text-[11px] font-bold text-white/70">المطلوب — {cart.length} صنف</div>
                  {discountAmount > 0 && (
                    <div className="tnum text-[13px] font-bold text-white/50 line-through">{money(totalInc)} ر.س</div>
                  )}
                  <div className="tnum text-[30px] font-black">{money(totalAfterDiscount)} <span className="text-[14px]">ر.س</span></div>
                  {discountAmount > 0 && (
                    <div className="tnum text-[11px] font-bold text-emerald">خصم {money(discountAmount)} ر.س مُطبَّق</div>
                  )}
                </div>

                {/* ── خصم الفاتورة — الحد الفعلي يُفرض من الباك اند حسب دور الموظف ── */}
                <details className="rounded-xl border border-line bg-ink-2 px-3 py-2">
                  <summary className="cursor-pointer text-[12px] font-bold text-text-dim">
                    🏷 إضافة خصم على الفاتورة {discountAmount > 0 && <span className="text-emerald">({money(discountAmount)} ر.س)</span>}
                  </summary>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <Input type="number" min={0} step="0.01" className="tnum" placeholder="مبلغ الخصم (ر.س)"
                           value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
                    <Input placeholder="سبب الخصم (اختياري)"
                           value={discountReason} onChange={(e) => setDiscountReason(e.target.value)} />
                  </div>
                </details>

                <Field label="العميل" hint={carId ? "من طابور الفوترة" : "فارغ = بيع نقدي"}>
                  <div className="relative">
                    <Input value={customerId ? customerName : customerQuery}
                           placeholder={customerName || "اسم / جوال / لوحة..."}
                           disabled={!!carId}
                           onChange={(e) => { setCustomerId(null); searchCustomers(e.target.value); }} />
                    {customerResults.length > 0 && !customerId && (
                      <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-ink-2 shadow-panel">
                        {customerResults.map((c) => (
                          <button key={c.id} onClick={() => { setCustomerId(c.id); setCustomerName(c.name); setCustomerResults([]); }}
                                  className="block w-full px-3 py-2 text-right text-[12.5px] hover:bg-ink-3">
                            {c.name} {c.phone ? `— ${c.phone}` : ""}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </Field>

                <div className="space-y-2">
                  {payments.map((p, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Select value={p.method} className="!w-24 !px-2 !text-[12px]"
                              onChange={(e) => setPayments((prev) => prev.map((pp, idx) => idx === i ? { ...pp, method: e.target.value as PaymentMethod } : pp))}>
                        {(Object.keys(PAYMENT_LABELS) as PaymentMethod[])
                          .filter((m) => m !== "credit" || customerId)
                          .map((m) => <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>)}
                      </Select>
                      <Input type="number" min={0} step="0.01" className="tnum" value={p.amount}
                             onChange={(e) => setPayments((prev) => prev.map((pp, idx) => idx === i ? { ...pp, amount: e.target.value } : pp))} />
                      <Button variant="ghost" className="!px-2 !py-1.5 !text-[10.5px] whitespace-nowrap"
                              onClick={() => fillRemaining(i)}>الباقي</Button>
                      {payments.length > 1 && (
                        <button onClick={() => removePaymentLine(i)} aria-label="حذف"
                                className="rounded-md px-1.5 py-1 text-text-dim hover:bg-ember-bg hover:text-ember">✕</button>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between">
                    <Button variant="ghost" className="!text-[11px]" onClick={addPaymentLine}>+ طريقة أخرى</Button>
                    <span className={`tnum text-[12.5px] font-bold ${Math.abs(remaining) > 0.01 ? "text-ember" : "text-emerald"}`}>
                      {Math.abs(remaining) > 0.01 ? `المتبقي: ${money(remaining)}` : "✓ المبلغ مكتمل"}
                    </span>
                  </div>
                </div>

                <ErrorNote msg={saleErr} />
                <button onClick={submitSale}
                        disabled={saleBusy || Math.abs(remaining) > 0.01}
                        className="w-full rounded-xl bg-emerald py-3.5 text-[15px] font-black text-white transition hover:brightness-110 disabled:opacity-40">
                  {saleBusy ? "جارِ الإصدار..." : "✓ إتمام الدفع وإصدار الفاتورة"}
                </button>
                <button onClick={() => setStep("cart")}
                        className="w-full rounded-lg py-2 text-[12.5px] font-bold text-text-dim hover:text-text">
                  → رجوع للسلة
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* ══════════════════ تبويب سجل الفواتير ══════════════════ */}
      {screen === "history" && canViewInvoices && (
        <Card>
          <DataTable
            columns={invoiceCols}
            rows={invoices}
            searchKeys={["invoice_no", "customer_name"]}
            searchPlaceholder="بحث برقم الفاتورة أو العميل..."
            emptyText="لا توجد فواتير بعد"
          />
        </Card>
      )}

      {/* ══════════ نافذة اختيار / إضافة عميل ══════════ */}
      <Modal open={pickOpen} onClose={() => setPickOpen(false)} title="العميل / السيارة">
        <div className="space-y-3">
          {!newCust ? (
            <>
              <Input value={pickQuery} autoFocus placeholder="🔍 بحث بالاسم أو الجوال أو اللوحة..."
                     onChange={(e) => { setPickQuery(e.target.value); searchCustomers(e.target.value); }} />

              <div className="max-h-72 space-y-3 overflow-y-auto">
                {posMode === "service" && pickedQueue.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-extrabold text-text-dim">🚗 سيارات في الطابور</p>
                    <div className="divide-y divide-line rounded-lg border border-line">
                      {pickedQueue.map((row) => (
                        <button key={row.id}
                                onClick={() => { startFromQueue(row); setPickOpen(false); }}
                                className="flex w-full items-center justify-between px-3 py-2 text-right text-[12.5px] hover:bg-ink-3">
                          <span><b className="tnum">{row.plate || "بدون لوحة"}</b>
                            <span className="mr-2 text-text-dim">{row.customer_name || "—"}</span>
                            {row.prepared_items && row.prepared_items.length > 0 && (
                              <span className="mr-2 rounded-full bg-emerald-bg px-2 py-0.5 text-[10px] font-black text-emerald">
                                🧾 فاتورة جاهزة
                              </span>
                            )}</span>
                          <span className="tnum text-[10.5px] text-text-dim">#{row.queue_no}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {posMode === "direct" && customerResults.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-extrabold text-text-dim">👤 عملاء مسجّلون</p>
                    <div className="divide-y divide-line rounded-lg border border-line">
                      {customerResults.map((c) => (
                        <button key={c.id}
                                onClick={() => { setCarId(null); setCustomerId(c.id); setCustomerName(c.name); setCustomerResults([]); setPickOpen(false); }}
                                className="block w-full px-3 py-2 text-right text-[12.5px] hover:bg-ink-3">
                          {c.name} {c.phone ? <span className="tnum text-text-dim">— {c.phone}</span> : ""}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {pickQuery.trim().length >= 2 && pickedQueue.length === 0 && customerResults.length === 0 && (
                  <p className="py-4 text-center text-[12px] text-text-dim">لا نتائج — أضفه كعميل جديد 👇</p>
                )}
              </div>

              {posMode === "direct" && (
                <div className="flex gap-2 border-t border-line pt-3">
                  <Button variant="ghost" className="flex-1 justify-center"
                          onClick={() => { resetSale(); setPickOpen(false); }}>
                    بيع نقدي (بدون عميل)
                  </Button>
                  <Button className="flex-1 justify-center"
                          onClick={() => setNewCust({ name: pickQuery.trim(), phone: "" })}>
                    + عميل جديد
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <Field label="اسم العميل">
                <Input value={newCust.name} autoFocus
                       onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
              </Field>
              <Field label="رقم الجوال">
                <Input className="tnum" value={newCust.phone}
                       onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} />
              </Field>
              <ErrorNote msg={pickErr} />
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setNewCust(null)}>رجوع</Button>
                <Button onClick={createQuickCustomer} disabled={pickBusy || !newCust.name.trim()}>
                  {pickBusy ? "جارِ الإضافة..." : "إضافة واختيار"}
                </Button>
              </div>
            </>
          )}
        </div>
      </Modal>

      {/* ══════════ الفحص الختامي بالكاميرا ══════════ */}
      <Modal open={!!scanModal} size="lg" onClose={() => setScanModal(null)}
             title={scanModal?.blocked ? "🚫 الكاميرا رصدت أخطاء — لا يمكن الدفع" : "⚠ الكاميرا رصدت ملاحظات"}>
        {scanModal && (
          <div className="space-y-3">
            {scanModal.compared && (
              <p className="rounded-lg bg-emerald-bg px-3 py-1.5 text-center text-[11px] font-black text-emerald">
                ✓ فحص مقارن — اللقطة الحالية اتقارنت بلقطة دخول السيارة نفسها
              </p>
            )}
            {scanModal.image && (
              <img src={`data:image/jpeg;base64,${scanModal.image}`} alt="لقطة الفحص"
                   className="max-h-72 w-full rounded-xl border border-line object-contain" />
            )}
            <div className="space-y-1.5">
              {scanModal.faults.map((f, i) => (
                <div key={i} className={`flex items-start gap-2 rounded-xl px-3 py-2 text-[12.5px] font-bold
                    ${f.severity === "high" ? "bg-ember-bg text-ember" : "bg-brass-soft text-brass"}`}>
                  <MIcon name={f.severity === "high" ? "error" : "warning"} filled className="!text-[18px] shrink-0" />
                  <span><b>{f.label}</b>{f.note && <span className="mr-1 font-normal">— {f.note}</span>}</span>
                </div>
              ))}
            </div>
            {scanModal.blocked ? (
              <div className="space-y-2">
                <p className="text-center text-[12px] font-bold text-text-dim">
                  راجع الفني على المحطة، وبعد الإصلاح اضغط "ادفع الآن" تاني — الكاميرا هتعيد الفحص
                </p>
                <Button className="w-full justify-center" onClick={() => setScanModal(null)}>فهمت — هراجع الفني</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1 justify-center" onClick={() => setScanModal(null)}>
                  إلغاء ومراجعة
                </Button>
                <Button className="flex-[2] justify-center"
                        onClick={() => { setScanModal(null); setPayments([{ method: "cash", amount: String(totalInc) }]); setSaleErr(""); setStep("pay"); }}>
                  متابعة للدفع رغم الملاحظات
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* ══════════ سيارات الانتظار / في الخدمة — الفواتير المعلقة ══════════ */}
      <Modal open={svcFilter !== null} size="lg" onClose={() => setSvcFilter(null)}
             title={svcFilter === "waiting" ? "سيارات الانتظار" : "في الخدمة — الفواتير المعلقة"}>
        <div className="space-y-2">
          {svcRows.length === 0 ? (
            <p className="py-10 text-center text-[13px] text-text-dim">
              {svcFilter === "waiting" ? "لا سيارات في الانتظار" : "لا توجد سيارات في الخدمة حالياً"}
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                    <th className="px-3 py-2.5 text-right">#</th>
                    <th className="px-3 py-2.5 text-right">اسم العميل</th>
                    <th className="px-3 py-2.5 text-right">نوع السيارة</th>
                    <th className="px-3 py-2.5 text-right">رقم اللوحة</th>
                    <th className="px-3 py-2.5 text-right">الفاتورة</th>
                    <th className="px-3 py-2.5 text-right">الإجمالي المطلوب</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {svcRows.map((row) => {
                    const tot = preparedTotal(row);
                    return (
                      <tr key={row.id} className="border-t border-line/70 transition hover:bg-ink-3">
                        <td className="tnum px-3 py-3 font-black text-text-dim">#{row.queue_no}</td>
                        <td className="px-3 py-3 font-black">{row.customer_name || "بيع نقدي"}</td>
                        <td className="px-3 py-3 text-text-dim">
                          {[row.brand, row.name, row.model_year].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="tnum px-3 py-3 font-black">{row.plate || "—"}</td>
                        <td className="px-3 py-3">
                          {row.prepared_items && row.prepared_items.length > 0 ? (
                            <span className="rounded-full bg-emerald-bg px-2.5 py-1 text-[10.5px] font-black text-emerald">
                              جاهزة — {row.prepared_items.length} صنف
                            </span>
                          ) : (
                            <span className="rounded-full bg-ink-3 px-2.5 py-1 text-[10.5px] font-bold text-text-dim">
                              بدون تجهيز
                            </span>
                          )}
                        </td>
                        <td className="tnum px-3 py-3 text-[14px] font-black text-petrol">
                          {tot > 0 ? `${money(tot)} ر.س` : "—"}
                        </td>
                        <td className="px-2 py-3">
                          <div className="flex justify-end gap-1.5">
                            {(row.customer_id || row.customer_phone) && tot === 0 && (
                              <button onClick={() => forcePrepare(row.id)} disabled={forcePrepBusy === row.id}
                                      className="mi-hover flex items-center gap-1 rounded-lg border border-petrol/40 px-2.5 py-1.5 text-[11px] font-bold text-petrol transition hover:bg-petrol-soft disabled:opacity-50">
                                <MIcon name="autorenew" className="!text-[16px]" />
                                {forcePrepBusy === row.id ? "..." : "جهّز الآن"}
                              </button>
                            )}
                            {row.customer_id && (
                              <button onClick={() => openCustInvs(row)}
                                      className="mi-hover flex items-center gap-1 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-bold text-text-dim transition hover:border-petrol hover:text-petrol">
                                <MIcon name="receipt_long" className="!text-[16px]" /> فواتير
                              </button>
                            )}
                            <button onClick={() => { startFromQueue(row); setSvcFilter(null); }}
                                    className="flex items-center gap-1 rounded-lg bg-emerald px-3 py-1.5 text-[11.5px] font-black text-white transition hover:brightness-110 active:scale-[.96]">
                              <MIcon name="payments" className="!text-[16px] text-white" /> تحصيل
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-center text-[10.5px] text-text-dim">
            «تحصيل» يجهّز السلة تلقائياً — «فواتير» يعرض تاريخ العميل السابق
          </p>
        </div>
      </Modal>

      {/* ══════════ فواتير العميل السابقة ══════════ */}
      <Modal open={!!custInvFor} onClose={() => setCustInvFor(null)}
             title={`فواتير ${custInvFor?.customer_name || "العميل"} السابقة`}>
        <div className="space-y-1.5">
          {custInvs === null ? (
            <p className="py-8 text-center text-[12.5px] text-text-dim">جارِ التحميل...</p>
          ) : custInvs.length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-text-dim">لا فواتير سابقة لهذا العميل</p>
          ) : (
            <div className="max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
              {custInvs.map((inv) => (
                <div key={inv.id} className="flex items-center justify-between px-3 py-2.5 text-[12.5px]">
                  <span>
                    <b className="tnum">{inv.invoice_no}</b>
                    <span className="mr-2 tnum text-[11px] text-text-dim">
                      {new Date(inv.issued_at).toLocaleDateString("ar-SA-u-nu-latn")}
                    </span>
                    {inv.is_returned && <span className="mr-2 rounded-full bg-ember-bg px-2 py-0.5 text-[9.5px] font-bold text-ember">مرتجعة</span>}
                  </span>
                  <span className="flex items-center gap-2">
                    <b className="tnum text-petrol">{money(Number(inv.total_inc))} ر.س</b>
                    <button onClick={() => printById(inv.id)}
                            className="mi-hover rounded-md border border-line px-2 py-1 text-text-dim hover:border-petrol hover:text-petrol">
                      <MIcon name="print" className="!text-[15px]" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* ══════════ نافذة إعادة الطباعة — فواتير اليوم ══════════ */}
      <Modal open={repFilter !== null} size="lg" onClose={() => setRepFilter(null)}
             title={repFilter === "pos" ? "فواتير البيع — اليوم" : repFilter === "car" ? "فواتير الخدمة — اليوم" : "كل فواتير اليوم"}>
        <div className="max-h-96 divide-y divide-line overflow-y-auto">
          {todayInvoices.filter((i) => repFilter === "all" || !repFilter || i.source === repFilter).length === 0 ? (
            <p className="py-8 text-center text-[12.5px] text-text-dim">لا فواتير اليوم في هذا التصنيف</p>
          ) : todayInvoices
              .filter((i) => repFilter === "all" || !repFilter || i.source === repFilter)
              .map((i) => (
            <div key={i.id} className="flex items-center justify-between gap-2 py-2.5 text-[12.5px]">
              <div>
                <span className="tnum font-extrabold">{i.invoice_no}</span>
                <span className="mr-2 text-text-dim">{i.customer_name || "بيع نقدي"}</span>
                <span className={`mr-2 rounded-full px-2 py-0.5 text-[10px] font-bold ${i.source === "car" ? "bg-petrol-soft text-petrol" : "bg-ink-3 text-text-dim"}`}>
                  {i.source === "car" ? "خدمة" : "بيع"}
                </span>
                {i.is_returned && <span className="mr-1 rounded-full bg-ember-bg px-2 py-0.5 text-[10px] font-bold text-ember">مرتجعة</span>}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tnum font-bold">{money(i.total_inc)}</span>
                <Button variant="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => printById(i.id, "thermal")}>🖨 حراري</Button>
                <Button variant="ghost" className="!px-2 !py-1 !text-[11px]" onClick={() => printById(i.id, "a4")}>🖨 A4</Button>
              </div>
            </div>
          ))}
        </div>
      </Modal>

      {/* ══════════ تعليق فاتورة ══════════ */}
      <Modal open={holdModal} onClose={() => setHoldModal(false)} title="تعليق الفاتورة الحالية">
        <div className="space-y-3">
          <p className="text-[12.5px] text-text-dim">
            السلة ({cart.length} صنف — {money(totalInc)} ر.س) هتتحفظ على الجهاز وترجع تكملها في أي وقت.
          </p>
          <Field label="ملاحظة (اختياري)">
            <Input value={holdNote} placeholder="مثال: العميل هيرجع بعد ساعة" autoFocus
                   onChange={(e) => setHoldNote(e.target.value)} />
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setHoldModal(false)}>إلغاء</Button>
            <Button onClick={holdCurrent}>تعليق</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ الفواتير المعلقة ══════════ */}
      <Modal open={heldModal} onClose={() => setHeldModal(false)} title="الفواتير المعلقة" size="lg">
        {held.length === 0 ? (
          <p className="py-6 text-center text-[12.5px] text-text-dim">لا توجد فواتير معلقة</p>
        ) : (
          <div className="divide-y divide-line">
            {held.map((h) => (
              <div key={h.id} className="flex items-center justify-between gap-3 py-3 text-[12.5px]">
                <div className="min-w-0">
                  <div className="font-bold">
                    {h.customerName || "بيع نقدي"}
                    <span className="tnum mr-2 text-[11px] font-normal text-text-dim">{dateFmt(h.time)}</span>
                  </div>
                  <div className="text-text-dim">
                    {h.cart.length} صنف — <span className="tnum font-bold">{money(h.cart.reduce((s, l) => s + l.unitPriceVat * l.qty, 0))}</span> ر.س
                    {h.note && <span className="mr-2">• {h.note}</span>}
                  </div>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button className="!px-3 !py-1.5 !text-[11.5px]" onClick={() => resumeHeld(h)}>استرجاع</Button>
                  <Button variant="danger" className="!px-3 !py-1.5 !text-[11.5px]" onClick={() => deleteHeld(h.id)}>حذف</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ══════════ إغلاق الوردية ══════════ */}
      <Modal open={closeModal} onClose={() => setCloseModal(false)} title="إغلاق الوردية">
        <div className="space-y-3">
          <div className="rounded-lg bg-ink-3 p-3 text-[12.5px]">
            <div className="flex justify-between"><span className="text-text-dim">النقد المتوقع في الدرج</span>
              <b className="tnum">{money(shift.cash.expected)}</b></div>
          </div>
          <Field label="النقد المعدود فعلياً">
            <Input type="number" min={0} step="0.01" className="tnum" value={countedCash} autoFocus
                   onChange={(e) => setCountedCash(e.target.value)} />
          </Field>
          <Field label="ملاحظات">
            <Input value={closeNotes} onChange={(e) => setCloseNotes(e.target.value)} />
          </Field>
          <ErrorNote msg={shiftErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCloseModal(false)}>إلغاء</Button>
            <Button onClick={closeShift} disabled={shiftBusy || countedCash === ""}>
              {shiftBusy ? "جارِ الإغلاق..." : "تأكيد الإغلاق"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تفاصيل فاتورة ══════════ */}
      <Modal open={!!viewInvoice} size="lg" onClose={() => setViewInvoice(null)}
             title={`فاتورة ${viewInvoice?.invoice_no ?? ""}`}>
        {viewInvoice && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-[12.5px] sm:grid-cols-3">
              <div><span className="text-text-dim">العميل:</span> <b>{viewInvoice.customer_name || "بيع نقدي"}</b></div>
              <div><span className="text-text-dim">الفرع:</span> <b>{viewInvoice.branch_name}</b></div>
              <div><span className="text-text-dim">التاريخ:</span> <b>{dateFmt(viewInvoice.issued_at)}</b></div>
              {viewInvoice.car && (
                <div className="sm:col-span-3">
                  <span className="text-text-dim">السيارة:</span>{" "}
                  <b className="tnum">{viewInvoice.car.plate}</b> — {[viewInvoice.car.brand, viewInvoice.car.model].filter(Boolean).join(" ")}
                </div>
              )}
              {viewInvoice.car && (() => {
                const t = viewInvoice.car as typeof viewInvoice.car & {
                  filler_name?: string | null; fitter1_name?: string | null;
                  fitter2_name?: string | null; checker_name?: string | null;
                };
                const fitters = [t.fitter1_name, t.fitter2_name].filter(Boolean).join(" و");
                if (!t.filler_name && !fitters && !t.checker_name) return null;
                return (
                  <div className="sm:col-span-3">
                    <span className="text-text-dim">فريق العمل:</span>{" "}
                    {t.filler_name && <>تعبئة <b>{t.filler_name}</b></>}
                    {fitters && <>{t.filler_name ? " · " : ""}فك وتركيب <b>{fitters}</b></>}
                    {t.checker_name && <>{(t.filler_name || fitters) ? " · " : ""}تشييك <b>{t.checker_name}</b></>}
                  </div>
                );
              })()}
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الصنف</th>
                    <th className="w-16 px-2 py-2 text-right">الكمية</th>
                    <th className="w-24 px-2 py-2 text-right">السعر</th>
                    <th className="w-24 px-2 py-2 text-right">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {viewInvoice.items.map((it) => (
                    <tr key={it.id} className="border-t border-line/70">
                      <td className="px-3 py-1.5">{it.label}</td>
                      <td className="px-2 py-1.5 tnum">{it.qty}</td>
                      <td className="px-2 py-1.5 tnum text-text-dim">{money(it.unit_price_vat)}</td>
                      <td className="px-2 py-1.5 tnum font-bold">{money(it.line_inc)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-2 text-[12.5px]">
              <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                <div className="text-text-dim">قبل الضريبة</div>
                <div className="tnum font-bold">{money(viewInvoice.total_ex)}</div>
              </div>
              <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                <div className="text-text-dim">الضريبة</div>
                <div className="tnum font-bold">{money(viewInvoice.total_vat)}</div>
              </div>
              <div className="rounded-lg bg-petrol-soft p-2.5 text-center">
                <div className="text-text-dim">الإجمالي</div>
                <div className="tnum font-black text-petrol">{money(viewInvoice.total_inc)}</div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {viewInvoice.payments.map((p) => (
                <span key={p.id} className="rounded-full bg-ink-3 px-3 py-1 text-[11.5px] font-bold">
                  {PAYMENT_LABELS[p.method]}: <span className="tnum">{money(p.amount)}</span>
                </span>
              ))}
            </div>

            {viewInvoice.is_returned && <Badge tone="warn">هذه الفاتورة مرتجعة بالكامل</Badge>}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setViewInvoice(null)}>إغلاق</Button>
              <Button variant="ghost" onClick={() => printById(viewInvoice.id, "thermal")}>🖨 حراري 80مم</Button>
              <Button variant="ghost" onClick={() => printById(viewInvoice.id, "a4")}>🖨 فاتورة A4</Button>
              {canReturn && !viewInvoice.is_returned && (
                <Button variant="danger" onClick={returnInvoice}>مرتجع كامل</Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
