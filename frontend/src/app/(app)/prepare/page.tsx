"use client";
// شاشة إعداد أوامر العمل — موظف الإعداد هو بوابة الكاشير:
// السيارة (من الباركود أو الكاميرا أو التسجيل اليدوي) بتفضل "أمر عمل مؤقت" مخفي عن الكاشير
// لحد ما الموظف هنا يدخل الأصناف والخدمة، يراجع بيانات العميل والسيارة والممشى،
// ويضغط "تأكيد وإرسال للكاشير" — ساعتها بس بتظهر في نقطة البيع (ويب + أندرويد بنفس الـAPI).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, Badge, Input, Field, Textarea, ErrorNote } from "@/components/ui";
import { Product, productLabel, money } from "@/modules/products/types";
import { BillingQueueRow } from "@/modules/cars/types";
import { appAlert, appConfirm } from "@/components/dialog";
import AddNoteModal from "@/components/AddNoteModal";

type CartLine = {
  productId: string;
  label: string;
  qty: number;
  unitPriceVat: number;   // شامل الضريبة — نفس اللي بيتخزن في المسودة
  isService: boolean;
  manualPrice: boolean;   // سعر يدوي (خدمات متغيرة السعر) — بيتبعت priceVat للسيرفر
};

const STATUS_META: Record<string, { label: string; tone: "neutral" | "warn" }> = {
  queued:    { label: "في الدور — لم تدخل بعد", tone: "neutral" },
  preparing: { label: "داخل الخدمة — أمر عمل مفتوح", tone: "warn" },
};

export default function PreparePage() {
  const { hasPerm } = useAuth();
  const canPrepare = hasPerm("invoices.prepare");

  const [queue, setQueue] = useState<BillingQueueRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [odometer, setOdometer] = useState("");
  const [notes, setNotes] = useState("");
  const [products, setProducts] = useState<Product[]>([]);
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
      setOkMsg(`🛢 ثُبّتت الكمية (${q} لتر) لكل ${[oil?.brand, oil?.model, oil?.modelYear].filter(Boolean).join(" ")}`);
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

  function addProduct(p: Product) {
    setCart((c) => {
      const i = c.findIndex((l) => l.productId === p.id);
      if (i >= 0 && !p.is_service) {
        const next = [...c]; next[i] = { ...next[i], qty: next[i].qty + 1 }; return next;
      }
      if (i >= 0) return c; // الخدمة مرة واحدة
      return [...c, { productId: p.id, label: productLabel(p), qty: 1,
                      unitPriceVat: Number(p.price_vat), isService: p.is_service, manualPrice: false }];
    });
    setSearch("");
  }
  const setQty = (id: string, d: number) =>
    setCart((c) => c.map((l) => l.productId === id ? { ...l, qty: Math.max(1, l.qty + d) } : l));
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
      await appAlert("💾 تم حفظ المسودة — يمكنك العودة لهذا الأمر في أي وقت");
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
      setOkMsg(`✅ اتبعت للكاشير — ${r.plate || active.plate || ""}`);
      setActiveId(null); loadedCarRef.current = null; setApprovalPin("");
      loadQueue();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "تعذّر التأكيد");
    } finally { setSaving(false); }
  }

  if (!canPrepare)
    return <Card><div className="p-6 text-text-dim">لا تملك صلاحية "تجهيز فاتورة وإرسالها للكاشير"</div></Card>;

  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]" dir="rtl">
      {/* ══════════ عمود الطابور ══════════ */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-bold">إعداد أوامر العمل</h1>
          <Badge tone="neutral">{queue.length} سيارة</Badge>
        </div>
        {okMsg && <div className="rounded-lg bg-emerald-bg px-3 py-2 text-sm font-bold text-emerald">{okMsg}</div>}
        {queue.length === 0 && (
          <Card><div className="p-5 text-sm text-text-dim">لا يوجد سيارات محتاجة إعداد الآن — أي حجز جديد أو سيارة تدخل من الكاميرا هتظهر هنا فوراً.</div></Card>
        )}
        {queue.map((c) => {
          const meta = STATUS_META[c.work_status || "queued"] || STATUS_META.queued;
          const sel = c.id === activeId;
          return (
            <button key={c.id} onClick={() => { loadedCarRef.current = null; setActiveId(c.id); }}
              className={`m3 block w-full rounded-2xl border p-3 text-right shadow-card transition-all duration-200
                ${sel ? "border-petrol bg-petrol-soft ring-2 ring-petrol shadow-md"
                      : "border-line bg-ink-2 hover:-translate-y-0.5 hover:border-petrol hover:shadow-md"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold tnum">{c.plate || "بدون لوحة"}</span>
                <Badge tone={meta.tone}>{meta.label}</Badge>
              </div>
              <div className="mt-1 text-sm text-text-dim">
                {[c.customer_name, [c.brand, c.name].filter(Boolean).join(" ")].filter(Boolean).join(" — ") || "بيانات ناقصة"}
              </div>
              <div className="mt-1 flex items-center gap-3 text-xs text-text-dim">
                <span>دور #{c.queue_no}</span>
                {c.prepared_items?.length ? <span>مسودة: {c.prepared_items.length} صنف</span> : null}
                {c.odometer_current != null && <span className="tnum">ممشى {c.odometer_current}</span>}
              </div>
            </button>
          );
        })}
      </div>

      {/* ══════════ لوحة أمر العمل ══════════ */}
      <div>
        {!active ? (
          <Card><div className="p-8 text-center text-text-dim">اختار سيارة من الطابور لكي تجهّز أمر العمل بتاعها</div></Card>
        ) : (
          <Card>
            <div className="space-y-4 p-4">
              {/* بيانات العميل والسيارة — مراجعة وتأكيد */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <div>
                  <div className="text-lg font-bold tnum">{active.plate || "بدون لوحة"}</div>
                  <div className="text-sm text-text-dim">
                    {[active.customer_name, active.customer_phone].filter(Boolean).join(" — ") || "عميل غير معروف"}
                    {" · "}
                    {[active.brand, active.name, active.model_year].filter(Boolean).join(" ") || "سيارة بدون بيانات"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {/* 🛢 كمية الزيت المعتمدة للموديل — ضغطة للتحديد/التعديل */}
                  <button onClick={() => setOilOpen((v) => !v)}
                          className={`rounded-full px-3.5 py-1.5 text-[12px] font-black transition
                            ${oil?.oilQty != null ? "bg-emerald text-white" : "border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol"}`}>
                    {oil?.oilQty != null ? `🛢 ${oil.oilQty} لتر${oil.oilType ? ` · ${oil.oilType}` : ""}` : "🛢 حدد كمية الزيت"}
                  </button>
                  <Badge tone={(STATUS_META[active.work_status || "queued"] || STATUS_META.queued).tone}>
                    {(STATUS_META[active.work_status || "queued"] || STATUS_META.queued).label}
                  </Badge>
                </div>
              </div>

              {/* 🛢 نموذج كمية الزيت — تُدخل مرة واحدة وتثبت للموديل كله وتظهر للعميل */}
              {oilOpen && (
                <div className="rounded-xl border border-line bg-ink-3 p-3">
                  <p className="mb-2 text-[11.5px] font-bold text-text-dim">
                    الكمية تُحفظ لكل سيارة بنفس ({[oil?.brand, oil?.model, oil?.modelYear].filter(Boolean).join(" ") || "الماركة/الموديل/السنة"}) وتظهر للعميل في صفحة الحجز تلقائياً
                  </p>
                  <div className="flex flex-wrap items-end gap-2">
                    <Field label="الكمية باللتر *">
                      <Input className="w-28 text-center tnum" inputMode="decimal" placeholder="5.5"
                             value={oilQtyIn}
                             onChange={(e) => setOilQtyIn(e.target.value.replace(/[^0-9.]/g, ""))} />
                    </Field>
                    <Field label="نوع الزيت (اختياري)">
                      <Input className="w-52" placeholder="مثال: 5W-30 تخليقي"
                             value={oilTypeIn} onChange={(e) => setOilTypeIn(e.target.value)} />
                    </Field>
                    <Button disabled={oilBusy || !oilQtyIn.trim()} onClick={saveOil}>
                      {oilBusy ? "جارٍ الحفظ…" : "✓ حفظ وتثبيت للموديل"}
                    </Button>
                    <Button variant="ghost" onClick={() => setOilOpen(false)}>إغلاق</Button>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="الممشى الحالي (كم)">
                  <Input inputMode="numeric" value={odometer}
                         onChange={(e) => setOdometer(e.target.value.replace(/[^0-9]/g, ""))}
                         placeholder="مثال: 84500" />
                </Field>
                <Field label="ملاحظات الفني (بتظهر في الفاتورة)">
                  <Textarea rows={1} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
              </div>

              {/* بحث الأصناف */}
              <div className="relative">
                <Field label="إضافة صنف أو خدمة (اسم أو باركود)">
                  <Input value={search} onChange={(e) => setSearch(e.target.value)}
                         placeholder="اكتب حرفين على الأقل…" autoComplete="off" />
                </Field>
                {results.length > 0 && (
                  <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-ink-2 shadow-lg">
                    {results.map((p) => (
                      <button key={p.id} onClick={() => addProduct(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-right text-sm hover:bg-petrol-soft">
                        <span>{productLabel(p)}{p.is_service && <Badge tone="neutral">خدمة</Badge>}</span>
                        <span className="tnum text-text-dim">{money(Number(p.price_vat))}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* الفئات السريعة — وصول فوري بدون كتابة */}
              <div className="flex flex-wrap gap-1.5">
                {quickCats.map((c) => (
                  <button key={c} onClick={() => setQuickCat(quickCat === c ? "" : c)}
                          className={`m3 rounded-full px-3 py-1.5 text-[12px] font-bold transition-all duration-200
                            ${quickCat === c ? "bg-petrol text-white shadow-md"
                                             : "border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol"}`}>
                    {c}
                  </button>
                ))}
              </div>
              {quickCat && quickProducts.length > 0 && (
                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-line bg-ink-3 p-2 sm:grid-cols-3">
                  {quickProducts.map((p) => (
                    <button key={p.id} onClick={() => addProduct(p)}
                            className="m3 rounded-xl border border-line bg-ink-2 px-2 py-2 text-right text-[12px] font-bold transition-all duration-150 hover:border-petrol">
                      <span className="line-clamp-2">{productLabel(p)}</span>
                      <span className="tnum mt-0.5 block text-[11px] text-petrol">{money(Number(p.price_vat))}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* أصناف أمر العمل */}
              {cart.length === 0 ? (
                <div className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-text-dim">
                  لا يوجد بعد أصناف — ابحث فوق وضيف، أو لو العميل اختار من الكشك هتلاقي اختياره اتعبى تلقائياً
                </div>
              ) : (
                <div className="overflow-hidden rounded-xl border border-line">
                  <table className="w-full text-sm">
                    <thead className="bg-ink-3 text-text-dim">
                      <tr>
                        <th className="px-3 py-2 text-right">الصنف</th>
                        <th className="px-2 py-2">الكمية</th>
                        <th className="px-2 py-2">السعر شامل</th>
                        <th className="px-2 py-2">الإجمالي</th>
                        <th className="w-8" />
                      </tr>
                    </thead>
                    <tbody>
                      {cart.map((l) => (
                        <tr key={l.productId} className="border-t border-line">
                          <td className="px-3 py-2">{l.label}{l.isService && <span className="mr-1 text-xs text-text-dim">(خدمة)</span>}</td>
                          <td className="px-2 py-2 text-center">
                            {l.isService ? "—" : (
                              <span className="inline-flex items-center gap-1">
                                <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => setQty(l.productId, -1)}>−</Button>
                                <span className="w-6 text-center tnum">{l.qty}</span>
                                <Button variant="ghost" className="h-7 w-7 p-0" onClick={() => setQty(l.productId, +1)}>+</Button>
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-center">
                            {l.isService ? (
                              <Input className="mx-auto h-8 w-24 text-center tnum" inputMode="decimal"
                                     value={String(l.unitPriceVat)}
                                     onChange={(e) => setPrice(l.productId, e.target.value)} />
                            ) : <span className="tnum">{money(l.unitPriceVat)}</span>}
                          </td>
                          <td className="px-2 py-2 text-center tnum">{money(l.unitPriceVat * (l.isService ? 1 : l.qty))}</td>
                          <td className="px-1 py-2">
                            <Button variant="ghost" className="h-7 w-7 p-0 text-ember" onClick={() => removeLine(l.productId)}>✕</Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {err && <ErrorNote msg={err} />}
              {okMsg && <p className="rounded-lg bg-emerald-bg px-3 py-2 text-[12.5px] font-bold text-emerald">{okMsg}</p>}

              {/* ══ شريط الإجراءات السفلي — التحكم الكامل ══ */}
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-ink-3 p-3">
                <div className="min-w-fit">
                  <div className="text-[11px] font-bold text-text-dim">الإجمالي شامل الضريبة</div>
                  <div className="tnum text-[22px] font-black text-text">{money(total)} <span className="text-[11px] font-bold text-text-dim">ر.س</span></div>
                </div>
                <div className="mr-auto flex flex-wrap items-center gap-2">
                  <Button variant="danger" onClick={cancelOrder}>🗑 إلغاء أمر العمل</Button>
                  <Button variant="ghost" onClick={() => setNoteOpen(true)}>+ إضافة ملاحظة</Button>
                  <Button variant="ghost" disabled={draftBusy || cart.length === 0} onClick={saveDraft}>
                    {draftBusy ? "جارٍ الحفظ…" : "💾 حفظ مسودة"}
                  </Button>
                  <Input
                    className="h-9 w-28 text-center tnum"
                    inputMode="numeric"
                    maxLength={6}
                    placeholder="رمز الاعتماد"
                    value={approvalPin}
                    onChange={(e) => setApprovalPin(e.target.value.replace(/\D/g, ""))}
                  />
                  <Button className="!px-7 !py-3 !text-[15px]" disabled={saving || cart.length === 0} onClick={confirmAndSend}>
                    {saving ? "جارٍ الإرسال…" : "✓ إرسال إلى الكاشير"}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-text-dim">التسعير النهائي يُحسم عند إصدار الفاتورة لدى الكاشير.</p>
            </div>
          </Card>
        )}
      </div>
      {noteOpen && active && (
        <AddNoteModal workOrderId={active.id} onClose={() => setNoteOpen(false)} />
      )}
    </div>
  );
}
