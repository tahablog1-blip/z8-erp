"use client";
// شاشة إعداد أوامر العمل — موظف الإعداد هو بوابة الكاشير:
// السيارة (من الباركود أو الكاميرا أو التسجيل اليدوي) بتفضل "أمر عمل مؤقت" مخفي عن الكاشير
// لحد ما الموظف هنا يدخل الأصناف والخدمة، يراجع بيانات العميل والسيارة والممشى،
// ويضغط "إرسال إلى الكاشير" — ساعتها بس بتظهر في نقطة البيع (ويب + أندرويد بنفس الـAPI).
//
// التصميم (نمط Split Pane): الطابور على جنب بكروت مدمجة، وأمر العمل كـ"ورقة" متكاملة:
// لوحة السيارة ← الفحص (ممشى/زيت/ملاحظات) ← الأصناف ← شريط إجراءات ثابت بالإجمالي.
// الموبايل: الطابور بعرض الشاشة، والضغط على سيارة يفتح أمر العمل بملء الشاشة.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Input, Textarea, ErrorNote, IconButton } from "@/components/ui";
import { Product, productLabel, money } from "@/modules/products/types";
import { Customer } from "@/modules/customers/types";
import { BillingQueueRow } from "@/modules/cars/types";
import { appAlert, appConfirm } from "@/components/dialog";
import AddNoteModal from "@/components/AddNoteModal";
import { MIcon } from "@/components/m-icon";
import { PlateBadge } from "@/components/PlateBadge";
import { CarBrandMark } from "@/components/CarBrandMark";

type CartLine = {
  productId: string;
  label: string;
  qty: number;
  unitPriceVat: number;   // شامل الضريبة — نفس اللي بيتخزن في المسودة
  isService: boolean;
  manualPrice: boolean;   // سعر يدوي (خدمات متغيرة السعر) — بيتبعت priceVat للسيرفر
};

const STATUS_META: Record<string, { label: string; dot: string }> = {
  queued:    { label: "في الدور", dot: "bg-text-dim" },
  preparing: { label: "داخل الخدمة", dot: "bg-brass" },
};

/** زمن الانتظار منذ تسجيل الحجز */
function waitLabel(createdAt: string | null | undefined): string {
  if (!createdAt) return "";
  const mins = Math.max(0, Math.round((Date.now() - new Date(createdAt).getTime()) / 60000));
  if (mins < 1) return "الآن";
  if (mins < 60) return `منذ ${mins} د`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `منذ ${h} س` : "منذ أكثر من يوم";
}

function StatusLabel({ status }: { status: string | undefined }) {
  const meta = STATUS_META[status || "queued"] || STATUS_META.queued;
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-bold text-text-dim">
      <span className={`h-2 w-2 rounded-full ${meta.dot}`} aria-hidden />{meta.label}
    </span>
  );
}


export default function PreparePage() {
  const { hasPerm } = useAuth();
  const canPrepare = hasPerm("invoices.prepare");

  const [queue, setQueue] = useState<BillingQueueRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[] | null>(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [approvalPin, setApprovalPin] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  // 🛢 كمية الزيت المعتمدة لموديل السيارة — تُدخل مرة وتثبت للموديل كله
  const [oil, setOil] = useState<{ oilQty: number | null; oilType: string; brand?: string; model?: string; modelYear?: string } | null>(null);
  const [oilOpen, setOilOpen] = useState(false);
  const [oilQtyIn, setOilQtyIn] = useState("");
  const [oilTypeIn, setOilTypeIn] = useState("");
  const [oilBusy, setOilBusy] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");
  const loadedCarRef = useRef<string | null>(null);
  const odometerRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  // تصفية الطابور (بحث + حالة) — محلية بالكامل
  const [queueQ, setQueueQ] = useState("");
  const [queueFilter, setQueueFilter] = useState<"all" | "queued" | "preparing">("all");

  function selectCar(id: string | null) { loadedCarRef.current = null; setActiveId(id); }

  // رسالة النجاح تختفي بعد 6 ثواني
  useEffect(() => {
    if (!okMsg) return;
    const t = setTimeout(() => setOkMsg(""), 6000);
    return () => clearTimeout(t);
  }, [okMsg]);

  const active = useMemo(() => queue.find((q) => q.id === activeId) || null, [queue, activeId]);

  // ── تحميل الطابور + تحديث تلقائي كل 7 ثواني (نفس إيقاع باقي الشاشات الحية) ──
  const loadQueue = useCallback(() => {
    api<BillingQueueRow[]>("/cars/preparation-queue").then(setQueue).catch(() => {});
  }, []);
  useEffect(() => {
    if (!canPrepare) return;
    loadQueue();
    const t = setInterval(loadQueue, 7000);
    return () => clearInterval(t);
  }, [canPrepare, loadQueue]);

  // ── الأصناف مرة واحدة — والبحث محلي فوري ──
  useEffect(() => {
    if (canPrepare) api<Product[]>("/products").then(setProducts).catch(() => {});
  }, [canPrepare]);
  useEffect(() => {
    if (canPrepare) api<Customer[]>("/customers").then(setAllCustomers).catch(() => {});
  }, [canPrepare]);

  // قوائم الأسعار: عميل السيارة النشطة معيّن على قائمة؟ لو كذلك، أسعار الأصناف
  // (المعروضة وبالتالي المضافة للعربة عبر addProduct) تتحول تلقائياً لأسعار
  // هذه القائمة — نقطة ربط واحدة، بلا أي لمس لمنطق العربة نفسه.
  const activePriceListId = useMemo(() => {
    const cid = active?.customer_id;
    if (!cid || !allCustomers) return null;
    return allCustomers.find((c) => c.id === cid)?.price_list_id ?? null;
  }, [active, allCustomers]);
  const prevPriceListRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (prevPriceListRef.current === undefined) { prevPriceListRef.current = activePriceListId; return; }
    if (prevPriceListRef.current === activePriceListId) return;
    prevPriceListRef.current = activePriceListId;
    api<Product[]>(`/products${activePriceListId ? `?priceListId=${encodeURIComponent(activePriceListId)}` : ""}`)
      .then(setProducts).catch(() => {});
  }, [activePriceListId]);

  // ── عند اختيار سيارة: تعبئة العربة من المسودة (اختيار العميل من الكشك أو آخر فاتورة) ──
  useEffect(() => {
    if (!active || loadedCarRef.current === active.id) return;
    loadedCarRef.current = active.id;
    setCart((active.prepared_items || [])
      .filter((it) => it.productId)
      .map((it) => ({
        productId: it.productId as string, label: it.label, qty: it.qty,
        unitPriceVat: it.unitPriceVat, isService: it.isService, manualPrice: false,
      })));
    setOdometer(active.odometer_current != null ? String(active.odometer_current) : "");
    setNotes(active.notes || "");
    setErr(""); setOkMsg(""); setSearch("");
    // 🛢 كمية الزيت المعتمدة لموديل السيارة دي
    setOil(null); setOilOpen(false);
    api<{ oilQty: number | null; oilType: string; brand?: string; model?: string; modelYear?: string }>(
      `/cars/oil/by-car/${active.id}`).then((r) => {
        setOil(r);
        setOilQtyIn(r.oilQty != null ? String(r.oilQty) : "");
        setOilTypeIn(r.oilType || "");
      }).catch(() => {});
  }, [active]);

  // 🛢 حفظ كمية الزيت — تثبت تلقائياً لكل سيارة بنفس الماركة/الموديل/السنة
  async function saveOil() {
    if (!active) return;
    const q = Number(oilQtyIn);
    if (!q || q <= 0 || q > 30) { setErr("أدخل كمية زيت صحيحة بين 0.5 و30 لتر"); return; }
    setOilBusy(true); setErr("");
    try {
      await api(`/cars/oil/by-car/${active.id}`, {
        method: "PUT",
        body: JSON.stringify({ oilQty: q, oilType: oilTypeIn.trim() }),
      });
      setOil((o) => ({ ...(o || {}), oilQty: q, oilType: oilTypeIn.trim() }));
      setOilOpen(false);
      setOkMsg(`تم تثبيت الكمية (${q} لتر) لكل ${[oil?.brand, oil?.model, oil?.modelYear].filter(Boolean).join(" ")}`);
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); }
    finally { setOilBusy(false); }
  }

  const results = useMemo(() => {
    const q = search.trim();
    if (q.length < 2) return [];
    const norm = q.toLowerCase();
    return products
      .filter((p) => productLabel(p).toLowerCase().includes(norm) || (p.barcode || "").includes(q))
      .slice(0, 12);
  }, [search, products]);

  // خصومات الكمية: أعلى حد كمية (من قواعد الصنف) تحقّقته الكمية الحالية — ما
  // بتتجاوزش سعراً يدوياً (manualPrice) ثبّته الموظف
  function effectivePriceVat(p: Product, qty: number) {
    const rules = p.qty_discount_rules || [];
    let pct = 0;
    for (const r of rules) { if (qty >= r.min_qty) pct = r.discount_percent; }
    return Number(p.price_vat) * (1 - pct / 100);
  }

  function addProduct(p: Product) {
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      if (i >= 0 && !p.is_service) {
        const next = [...c];
        const qty = next[i].qty + 1;
        next[i] = { ...next[i], qty, ...(next[i].manualPrice ? {} : { unitPriceVat: effectivePriceVat(p, qty) }) };
        return next;
      }
      if (i >= 0) return c; // الخدمة مرة واحدة
      return [...c, { productId: p.id, label: productLabel(p), qty: 1,
                      unitPriceVat: effectivePriceVat(p, 1), isService: p.is_service, manualPrice: false }];
    });
    setSearch("");
  }
  const setQty = (id: string, d: number) =>
    setCart((c) => c.map((l) => {
      if (l.productId !== id) return l;
      const qty = Math.max(1, l.qty + d);
      if (l.manualPrice) return { ...l, qty };
      const p = products.find((pp) => pp.id === id);
      return p ? { ...l, qty, unitPriceVat: effectivePriceVat(p, qty) } : { ...l, qty };
    }));
  const setPrice = (id: string, v: string) =>
    setCart((c) => c.map((l) => l.productId === id
      ? { ...l, unitPriceVat: Number(v) || 0, manualPrice: true } : l));
  const removeLine = (id: string) => setCart((c) => c.filter((l) => l.productId !== id));

  const total = cart.reduce((s, l) => s + l.unitPriceVat * (l.isService ? 1 : l.qty), 0);

  // ── الفئات السريعة: أزرار وصول فوري (زيوت/فلاتر/خدمات/قطع) ──
  const [quickCat, setQuickCat] = useState("");
  const quickCats = useMemo(() => {
    const pri = ["زيوت", "فلاتر", "خدمات", "قطع"];
    const cats = Array.from(new Set(products.map((p) => p.category || "أخرى")));
    return cats.sort((a, b) => {
      const ia = pri.findIndex((x) => a.includes(x)), ib = pri.findIndex((x) => b.includes(x));
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    }).slice(0, 8);
  }, [products]);
  const quickProducts = useMemo(
    () => quickCat ? products.filter((p) => (p.category || "أخرى") === quickCat).slice(0, 18) : [],
    [quickCat, products]);

  // ── حفظ مسودة: أمر العمل يتحفظ على السيارة ويرجعله الموظف في أي وقت ──
  const [draftBusy, setDraftBusy] = useState(false);
  async function saveDraft() {
    if (!active) return;
    setDraftBusy(true);
    try {
      await api(`/cars/${active.id}/draft-items`, {
        method: "POST",
        body: JSON.stringify({ items: cart.filter((l) => !l.isService).map((l) => ({ productId: l.productId, qty: l.qty })) }),
      });
      await appAlert("تم حفظ المسودة. يمكنك العودة لهذا الأمر في أي وقت.");
      loadQueue();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر حفظ المسودة"); }
    finally { setDraftBusy(false); }
  }

  // ── إلغاء أمر العمل بالكامل (حذف السيارة من الطابور) ──
  async function cancelOrder() {
    if (!active) return;
    if (!(await appConfirm(`إلغاء أمر عمل السيارة ${active.plate || ""} نهائياً وإزالتها من الطابور؟`))) return;
    try {
      await api(`/cars/${active.id}`, { method: "DELETE" });
      setActiveId(null); loadQueue();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر الإلغاء — قد لا تملك الصلاحية"); }
  }

  async function confirmAndSend() {
    if (!active) return;
    setSaving(true); setErr(""); setOkMsg("");
    try {
      const r = await api<{ plate: string }>(`/cars/${active.id}/prepare-confirm`, {
        method: "POST",
        body: JSON.stringify({
          items: cart.map((l) => ({
            productId: l.productId, qty: l.qty,
            ...(l.manualPrice ? { priceVat: l.unitPriceVat } : {}),
          })),
          odometer: odometer.trim() ? Number(odometer) : null,
          notes: notes.trim() || null,
          approvalPin: approvalPin.trim() || null,
        }),
      });
      setOkMsg(`تم الإرسال إلى الكاشير — ${r.plate || active.plate || ""}`);
      setActiveId(null); loadedCarRef.current = null; setApprovalPin("");
      loadQueue();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذّر التأكيد");
    } finally { setSaving(false); }
  }

  const visibleQueue = useMemo(() => {
    const q = queueQ.trim().toLowerCase().replace(/\s+/g, "");
    return queue.filter((c) => {
      if (queueFilter !== "all" && (c.work_status || "queued") !== queueFilter) return false;
      if (!q) return true;
      const hay = [c.plate, c.customer_name, c.customer_phone, c.brand, c.name].filter(Boolean).join("").toLowerCase().replace(/\s+/g, "");
      return hay.includes(q);
    });
  }, [queue, queueQ, queueFilter]);
  const counts = useMemo(() => ({
    all: queue.length,
    queued: queue.filter((c) => (c.work_status || "queued") === "queued").length,
    preparing: queue.filter((c) => c.work_status === "preparing").length,
  }), [queue]);

  // ↑ ↓ للتنقل بين السيارات، Enter ينقل التركيز لأمر العمل
  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;
    if (e.key === "Enter") { if (active) { e.preventDefault(); odometerRef.current?.focus(); } return; }
    e.preventDefault();
    const i = visibleQueue.findIndex((c) => c.id === activeId);
    const next = visibleQueue[e.key === "ArrowDown" ? Math.min(visibleQueue.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1)];
    if (next) {
      selectCar(next.id);
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-car-id="${next.id}"]`)?.focus());
    }
  }

  // Enter في خانة البحث: باركود مطابق تماماً (قارئ الباركود) أو أول نتيجة
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    const q = search.trim();
    const exact = products.find((p) => p.barcode && p.barcode === q);
    const pick = exact || results[0];
    if (pick) { e.preventDefault(); addProduct(pick); }
  }

  if (!canPrepare)
    return <Card><div className="p-6 text-text-dim">لا تملك صلاحية "تجهيز فاتورة وإرسالها للكاشير"</div></Card>;

  const hasActive = !!active;
  const lineCount = cart.length;

  return (
    <div className="mx-auto grid max-w-[1500px] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]" dir="rtl">
      {okMsg && (
        <div role="status" aria-live="polite"
          className="fixed inset-x-3 top-3 z-[60] mx-auto flex max-w-md items-center gap-2 rounded-xl border border-emerald/30 bg-ink-2 px-4 py-3 text-[13px] font-bold text-emerald shadow-lg lg:top-5">
          <MIcon name="check_circle" className="!text-[20px]" /> {okMsg}
        </div>
      )}

      {/* ══════════ الطابور ══════════ */}
      <section aria-label="طابور السيارات"
        className={`${hasActive ? "hidden lg:flex" : "flex"} min-w-0 flex-col rounded-2xl border border-line bg-ink-2 lg:sticky lg:top-0 lg:max-h-[calc(100vh-8.5rem)]`}>
        <div className="space-y-3 border-b border-line p-3.5">
          <div className="flex items-center justify-between">
            <h1 className="text-[16px] font-extrabold">الطابور</h1>
            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-bold text-text-dim">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald" aria-hidden /> يتحدّث تلقائياً
            </span>
          </div>
          <div className="relative">
            <MIcon name="search" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 !text-[18px] text-text-dim" />
            <Input value={queueQ} onChange={(e) => setQueueQ(e.target.value)} aria-label="بحث في الطابور"
              placeholder="ابحث برقم اللوحة أو اسم العميل" className="!pr-10" />
          </div>
          <div className="flex gap-1.5" role="tablist" aria-label="تصفية الطابور">
            {([["all", "الكل"], ["queued", "في الدور"], ["preparing", "داخل الخدمة"]] as const).map(([k, label]) => (
              <button key={k} role="tab" aria-selected={queueFilter === k} onClick={() => setQueueFilter(k)}
                className={`flex-1 rounded-lg px-2 py-2 text-[12px] font-bold transition
                  ${queueFilter === k ? "bg-petrol text-white" : "border border-line text-text-dim hover:border-petrol hover:text-petrol"}`}>
                {label} <span className="tnum opacity-80">{counts[k]}</span>
              </button>
            ))}
          </div>
        </div>

        <div role="listbox" aria-label="السيارات" onKeyDown={onListKey}
          className="min-h-[8rem] flex-1 space-y-1.5 overflow-y-auto p-2.5">
          {visibleQueue.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <MIcon name={queue.length === 0 ? "inbox" : "search_off"} className="!text-[30px] text-text-dim" />
              <div className="mt-2 text-[13.5px] font-extrabold">
                {queue.length === 0 ? "لا توجد سيارات بانتظار الإعداد" : "لا توجد نتائج"}
              </div>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-dim">
                {queue.length === 0
                  ? "أي حجز جديد أو سيارة تدخل من الكاميرا ستظهر هنا فوراً."
                  : "غيّر البحث أو اختر «الكل» لعرض كل السيارات."}
              </p>
            </div>
          ) : visibleQueue.map((c) => {
            const sel = c.id === activeId;
            const carLine = [c.brand, c.name].filter(Boolean).join(" ");
            return (
              <button key={c.id} data-car-id={c.id} role="option" aria-selected={sel}
                tabIndex={sel || (!activeId && c.id === visibleQueue[0]?.id) ? 0 : -1}
                onClick={() => selectCar(c.id)}
                className={`block w-full rounded-xl border p-3 text-right transition
                  ${sel ? "border-petrol bg-petrol-soft ring-1 ring-petrol" : "border-line bg-ink-2 hover:border-petrol/60 hover:bg-ink-3"}`}>
                <div className="flex items-center justify-between gap-2">
                  <PlateBadge plate={c.plate} size="sm" />
                  <span className="tnum text-[11.5px] font-bold text-text-dim">دور {c.queue_no}</span>
                </div>
                <div className="mt-2 truncate text-[13.5px] font-bold">{c.customer_name || "عميل غير معروف"}</div>
                {carLine ? <CarBrandMark brand={c.brand} model={c.name} size="sm" className="mt-1" />
                         : <div className="truncate text-[12.5px] text-text-dim">سيارة بدون بيانات</div>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <StatusLabel status={c.work_status} />
                  <span className="flex items-center gap-2 text-[11.5px] text-text-dim">
                    {c.prepared_items?.length ? <span className="tnum">مسودة {c.prepared_items.length}</span> : null}
                    <span>{waitLabel(c.created_at)}</span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
        <div className="hidden border-t border-line px-3.5 py-2 text-[11.5px] text-text-dim lg:block">
          استخدم <kbd dir="ltr" className="rounded border border-line px-1 font-sans">↑</kbd> <kbd dir="ltr" className="rounded border border-line px-1 font-sans">↓</kbd> للتنقل بين السيارات، و<kbd dir="ltr" className="rounded border border-line px-1 font-sans">Enter</kbd> للانتقال إلى أمر العمل.
        </div>
      </section>

      {/* ══════════ أمر العمل ══════════ */}
      <section aria-label="أمر العمل" className={`${hasActive ? "block" : "hidden lg:block"} min-w-0`}>
        {!active ? (
          <div className="rounded-2xl border border-dashed border-line bg-ink-2">
            <div className="flex min-h-[22rem] flex-col items-center justify-center gap-2 px-6 py-12 text-center">
              <PlateBadge plate={null} size="lg" />
              <div className="mt-3 text-[15px] font-extrabold">اختر سيارة من الطابور</div>
              <p className="max-w-sm text-[12.5px] leading-relaxed text-text-dim">
                يظهر هنا أمر العمل: بيانات السيارة والعميل، الممشى وكمية الزيت، والأصناف والخدمات قبل الإرسال إلى الكاشير.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-line bg-ink-2">
            {/* رأس أمر العمل */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line p-4">
              <button onClick={() => selectCar(null)} aria-label="رجوع إلى الطابور"
                className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line text-text-dim transition hover:border-petrol hover:text-petrol lg:hidden">
                <MIcon name="arrow_forward" className="!text-[20px]" />
              </button>
              <PlateBadge plate={active.plate} size="lg" />
              <div className="order-3 min-w-0 basis-full sm:order-none sm:basis-0 sm:flex-1">
                {active.brand || active.name ? (
                  <CarBrandMark brand={active.brand} model={active.name} year={active.model_year} size="lg" />
                ) : (
                  <div className="text-[15px] font-extrabold">سيارة بدون بيانات</div>
                )}
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-text-dim">
                  <span className="inline-flex items-center gap-1"><MIcon name="person" className="!text-[15px]" />{active.customer_name || "عميل غير معروف"}</span>
                  {active.customer_phone && <span dir="ltr" className="tnum inline-flex items-center gap-1"><MIcon name="call" className="!text-[15px]" />{active.customer_phone}</span>}
                  <StatusLabel status={active.work_status} />
                </div>
              </div>
              <div className="mr-auto flex shrink-0 items-center gap-1.5 sm:mr-0">
                <IconButton label="إضافة ملاحظة" onClick={() => setNoteOpen(true)}><MIcon name="sticky_note_2" className="!text-[19px]" /></IconButton>
                <IconButton label="إلغاء أمر العمل" onClick={cancelOrder} className="hover:!border-ember hover:!text-ember"><MIcon name="delete" className="!text-[19px]" /></IconButton>
              </div>
            </div>

            <div className="space-y-5 p-4">
              {/* الفحص: ممشى + زيت + ملاحظات */}
              <div className="grid gap-3 md:grid-cols-3">
                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-bold text-text-dim">الممشى الحالي (كم)</span>
                  <Input ref={odometerRef} inputMode="numeric" value={odometer} className="!py-3 text-[16px] tnum"
                    onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ""))} placeholder="مثال: 84500" />
                  {active.odometer_previous != null && (
                    <span className="mt-1 block text-[11.5px] text-text-dim">آخر ممشى مسجّل: <span className="tnum">{active.odometer_previous}</span> كم</span>
                  )}
                </label>

                <div>
                  <span className="mb-1.5 block text-[12px] font-bold text-text-dim">كمية الزيت المعتمدة</span>
                  <button onClick={() => setOilOpen((v) => !v)} aria-expanded={oilOpen}
                    className={`flex w-full items-center justify-between rounded-xl border px-3.5 py-3 text-right text-[14px] font-bold transition
                      ${oil?.oilQty != null ? "border-emerald/40 bg-emerald-bg text-emerald" : "border-dashed border-line text-text-dim hover:border-petrol hover:text-petrol"}`}>
                    <span className="tnum">
                      {oil?.oilQty != null ? `${oil.oilQty} لتر${oil.oilType ? ` · ${oil.oilType}` : ""}` : "حدد الكمية للموديل"}
                    </span>
                    <MIcon name={oilOpen ? "expand_less" : "edit"} className="!text-[18px]" />
                  </button>
                </div>

                <label className="block">
                  <span className="mb-1.5 block text-[12px] font-bold text-text-dim">ملاحظات الفني (تظهر في الفاتورة)</span>
                  <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="!py-3" />
                </label>
              </div>

              {oilOpen && (
                <div className="rounded-xl border border-line bg-ink-3 p-3.5">
                  <p className="mb-3 text-[12px] leading-relaxed text-text-dim">
                    تُحفظ الكمية لكل سيارة بنفس ({[oil?.brand, oil?.model, oil?.modelYear].filter(Boolean).join(" ") || "الماركة والموديل والسنة"}) وتظهر للعميل في صفحة الحجز تلقائياً.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-bold text-text-dim">الكمية باللتر</span>
                      <Input className="!w-28 text-center tnum" inputMode="decimal" placeholder="5.5" value={oilQtyIn}
                        onChange={(e) => setOilQtyIn(e.target.value.replace(/[^0-9.]/g, ""))} />
                    </label>
                    <label className="block">
                      <span className="mb-1.5 block text-[12px] font-bold text-text-dim">نوع الزيت (اختياري)</span>
                      <Input className="!w-56 max-w-full" placeholder="مثال: 5W-30 تخليقي" value={oilTypeIn} onChange={(e) => setOilTypeIn(e.target.value)} />
                    </label>
                    <Button disabled={oilBusy || !oilQtyIn.trim()} onClick={saveOil} loading={oilBusy}>حفظ الكمية للموديل</Button>
                    <Button variant="ghost" onClick={() => setOilOpen(false)}>إغلاق</Button>
                  </div>
                </div>
              )}

              {/* إضافة الأصناف */}
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-[15px] font-extrabold">الأصناف والخدمات</h2>
                  <span className="tnum text-[12px] font-bold text-text-dim">{lineCount} في الأمر</span>
                </div>
                <div className="relative">
                  <MIcon name="search" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 !text-[18px] text-text-dim" />
                  <Input ref={searchRef} value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey}
                    aria-label="بحث عن صنف أو خدمة" placeholder="ابحث بالاسم أو امسح الباركود" autoComplete="off" className="!py-3 !pr-10" />
                  {results.length > 0 && (
                    <div className="absolute z-20 mt-1 max-h-72 w-full overflow-auto rounded-xl border border-line bg-ink-2 shadow-lg">
                      {results.map((p) => (
                        <button key={p.id} onClick={() => addProduct(p)}
                          className="flex w-full items-center justify-between gap-3 border-b border-line/60 px-3.5 py-3 text-right text-[13.5px] last:border-0 hover:bg-petrol-soft">
                          <span className="min-w-0 truncate">{productLabel(p)}{p.is_service && <span className="mr-2 rounded bg-ink-3 px-1.5 py-0.5 text-[11px] font-bold text-text-dim">خدمة</span>}</span>
                          <span className="tnum shrink-0 font-bold text-text-dim">{money(Number(p.price_vat))}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5" role="tablist" aria-label="فئات الأصناف">
                  {quickCats.map((c) => (
                    <button key={c} role="tab" aria-selected={quickCat === c} onClick={() => setQuickCat(quickCat === c ? "" : c)}
                      className={`shrink-0 rounded-full px-4 py-2 text-[13px] font-bold transition
                        ${quickCat === c ? "bg-petrol text-white" : "border border-line text-text-dim hover:border-petrol hover:text-petrol"}`}>
                      {c}
                    </button>
                  ))}
                </div>
                {quickCat && quickProducts.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 rounded-xl border border-line bg-ink-3 p-2.5 sm:grid-cols-3 xl:grid-cols-4">
                    {quickProducts.map((p) => {
                      const inCart = cart.some((l) => l.productId === p.id);
                      const out = !p.is_service && p.stock_qty != null && Number(p.stock_qty) <= 0;
                      return (
                        <button key={p.id} onClick={() => addProduct(p)}
                          className={`relative rounded-xl border bg-ink-2 px-3 py-2.5 text-right transition hover:border-petrol
                            ${inCart ? "border-petrol ring-1 ring-petrol" : "border-line"}`}>
                          <span className="line-clamp-2 text-[12.5px] font-bold leading-snug">{productLabel(p)}</span>
                          <span className="mt-1.5 flex items-center justify-between">
                            <span className="tnum text-[12px] font-bold text-petrol">{money(Number(p.price_vat))}</span>
                            {out && <span className="rounded bg-ember-bg px-1.5 py-0.5 text-[10.5px] font-bold text-ember">نفد</span>}
                            {inCart && !out && <MIcon name="check_circle" filled className="!text-[16px] text-petrol" />}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* بنود الأمر */}
              <div className="overflow-hidden rounded-xl border border-line">
                {cart.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <MIcon name="shopping_basket" className="!text-[28px] text-text-dim" />
                    <div className="mt-1.5 text-[13.5px] font-extrabold">لم تُضف أصناف بعد</div>
                    <p className="mt-1 text-[12.5px] text-text-dim">ابحث أو اختر فئة لإضافة الزيت والفلاتر والخدمات. إن اختار العميل من الكشك فاختياره يُملأ تلقائياً.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {cart.map((l) => (
                      <li key={l.productId} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 px-3.5 py-3 sm:grid-cols-[minmax(0,1fr)_auto_7.5rem_2.5rem]">
                        <div className="min-w-0">
                          <div className="text-[13.5px] font-bold sm:truncate">{l.label}</div>
                          <div className="text-[11.5px] text-text-dim">{l.isService ? "خدمة — السعر قابل للتعديل" : <>للوحدة <span className="tnum">{money(l.unitPriceVat)}</span> شامل الضريبة</>}</div>
                        </div>
                        {l.isService ? (
                          <label className="sm:order-none">
                            <span className="sr-only">سعر الخدمة</span>
                            <Input className="h-10 !w-28 text-center tnum" inputMode="decimal" value={String(l.unitPriceVat)}
                              onChange={(e) => setPrice(l.productId, e.target.value)} />
                          </label>
                        ) : (
                          <div className="inline-flex items-center rounded-xl border border-line" role="group" aria-label={`كمية ${l.label}`}>
                            <button onClick={() => setQty(l.productId, -1)} aria-label="إنقاص الكمية" className="grid h-10 w-10 place-items-center text-[18px] font-bold text-text-dim hover:text-petrol">−</button>
                            <span className="w-8 text-center text-[14px] font-extrabold tnum">{l.qty}</span>
                            <button onClick={() => setQty(l.productId, +1)} aria-label="زيادة الكمية" className="grid h-10 w-10 place-items-center text-[18px] font-bold text-text-dim hover:text-petrol">+</button>
                          </div>
                        )}
                        <div className="tnum text-left text-[14px] font-extrabold sm:text-right">{money(l.unitPriceVat * (l.isService ? 1 : l.qty))}</div>
                        <IconButton label={`حذف ${l.label}`} size="sm" onClick={() => removeLine(l.productId)} className="hover:!border-ember hover:!text-ember justify-self-end">
                          <MIcon name="close" className="!text-[17px]" />
                        </IconButton>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {err && <ErrorNote msg={err} />}
            </div>

            {/* شريط الإجراءات — ثابت أسفل الشاشة أثناء التمرير */}
            <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-line bg-ink-2/95 px-4 py-3 backdrop-blur">
              <div className="min-w-fit">
                <div className="text-[11.5px] font-bold text-text-dim">الإجمالي شامل الضريبة</div>
                <div className="tnum text-[24px] font-black leading-tight">{money(total)} <span className="text-[12px] font-bold text-text-dim">ر.س</span></div>
              </div>
              <div className="mr-auto flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor="approval-pin">رمز الاعتماد</label>
                <Input id="approval-pin" className="h-11 !w-36 text-center tnum" inputMode="numeric" maxLength={6}
                  placeholder="رمز الاعتماد" value={approvalPin} onChange={(e) => setApprovalPin(e.target.value.replace(/\D/g, ""))} />
                <Button variant="ghost" size="lg" disabled={draftBusy || cart.length === 0} loading={draftBusy} onClick={saveDraft}>حفظ مسودة</Button>
                <Button size="lg" className="min-w-[12rem]" disabled={saving || cart.length === 0} loading={saving} onClick={confirmAndSend}>
                  <MIcon name="send" className="!text-[18px]" /> إرسال إلى الكاشير
                </Button>
              </div>
              <p className="w-full text-[11.5px] text-text-dim">التسعير النهائي يُحسم عند إصدار الفاتورة لدى الكاشير.</p>
            </div>
          </div>
        )}
      </section>

      {noteOpen && active && (
        <AddNoteModal workOrderId={active.id} onClose={() => setNoteOpen(false)} />
      )}
    </div>
  );
}
