"use client";
// شاشة طابور السيارات — لوحة محطات بعدادات حية + تسجيل بكاميرا اللوحة (OCR)
// + نقاط التشييك أثناء الخدمة + طباعة تذكرة السيارة + الجدول الكامل بالتعديل والحذف
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Car, carStatus } from "@/modules/cars/types";
import { Product, productLabel } from "@/modules/products/types";
import { MIcon } from "@/components/m-icon";
import { STAGES, CHECKPOINTS, CK_LABEL, FINISHED, stageOf, type CkStatus, type CkItem } from "@/lib/service-line";

type Branch = { id: string; name: string; lines?: string[] };

// تعريف خط الخدمة موحّد في lib/service-line.ts — نفس المصدر للطباعة والكاميرات
// دايرة تحميل بتلف — نفس فكرة الكروت اللي طلبها المالك
const Spinner = ({ className = "" }: { className?: string }) => (
  <span className={`inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-petrol border-t-transparent align-middle ${className}`} />
);

// ── تقدم الكارت: (المنتهي / إجمالي النقاط) + هل في نقطة شغالة الآن ──
function carProgress(c: Car) {
  const items = c.checklist || [];
  const finished = items.filter((i) => FINISHED.includes(i.status as CkStatus)).length;
  const working = items.some((i) => i.status === "in_progress");
  const total = CHECKPOINTS.length;
  return { finished, total, working, ready: finished >= total, pct: Math.round((finished / total) * 100) };
}

// ══════════ القوائم المرجعية (السوق السعودي) ══════════
const BRANDS = [
  "تويوتا", "هيونداي", "نيسان", "كيا", "فورد", "شيفروليه", "جي إم سي", "هوندا",
  "لكزس", "مازدا", "ميتسوبيشي", "إيسوزو", "سوزوكي", "مرسيدس", "بي إم دبليو",
  "أودي", "جيلي", "شانجان", "إم جي", "هافال", "فولكس واجن", "دودج", "جيب",
  "رينو", "بيجو", "فورتشنر", "لاند روفر", "بورش", "كاديلاك", "لينكولن",
];
const MODELS: Record<string, string[]> = {
  "تويوتا": ["كامري", "كورولا", "هايلكس", "لاندكروزر", "برادو", "يارس", "أفالون", "فورتشنر", "راف فور", "هايس", "إنوفا", "شاص"],
  "هيونداي": ["إلنترا", "سوناتا", "أكسنت", "توسان", "سنتافي", "كريتا", "باليسيد", "أزيرا", "كونا", "H1"],
  "نيسان": ["صني", "التيما", "باترول", "إكس تريل", "سنترا", "مكسيما", "نافارا", "كيكس", "أورفان"],
  "كيا": ["سيراتو", "K5", "سبورتاج", "سورينتو", "بيجاس", "ريو", "كارنيفال", "سيلتوس", "تيلورايد"],
  "فورد": ["إكسبلورر", "تورس", "إكسبيديشن", "F-150", "إيدج", "برونكو", "إيكوسبورت"],
  "شيفروليه": ["تاهو", "سوبربان", "سلفرادو", "كابتيفا", "ماليبو", "جروف", "بليزر", "إمبالا"],
  "جي إم سي": ["يوكن", "سييرا", "تيرين", "أكاديا"],
  "هوندا": ["أكورد", "سيفيك", "CR-V", "بايلوت", "سيتي", "HR-V"],
  "لكزس": ["ES", "LX", "RX", "IS", "GX", "NX", "LS"],
  "مازدا": ["6", "3", "CX-5", "CX-9", "CX-30", "بيك أب"],
  "ميتسوبيشي": ["باجيرو", "L200", "أوتلاندر", "أتراج", "إكسباندر", "مونتيرو"],
  "إيسوزو": ["ديماكس", "MU-X", "NPR"],
  "مرسيدس": ["C-Class", "E-Class", "S-Class", "GLE", "GLC", "G-Class", "A-Class"],
  "بي إم دبليو": ["الفئة 3", "الفئة 5", "الفئة 7", "X5", "X6", "X3"],
  "جيلي": ["كولراي", "توجيلا", "أوكافانجو", "إمجراند", "مونجارو"],
  "شانجان": ["CS75", "CS35", "إيدو", "ألسفن", "CS95", "UNI-T", "UNI-K"],
  "إم جي": ["MG5", "ZS", "RX5", "HS", "GT", "RX8"],
  "هافال": ["H6", "جوليان", "H9", "داجو"],
  "دودج": ["تشارجر", "تشالنجر", "دورانجو", "رام"],
};
const COLORS = ["أبيض", "أسود", "فضي", "رمادي", "بيج / ذهبي", "أحمر", "أزرق", "بني", "أخضر", "عنابي", "برتقالي", "أصفر"];
// خيارات المحطة بتتبني ديناميكياً من خطوط الفرع + الحفرة والرافعة الثابتتين
const YEARS = Array.from({ length: 38 }, (_, i) => String(2027 - i));

// قائمة منسدلة + خيار «أخرى...» يفتح كتابة حرة — وبيتعرف تلقائياً على القيم القديمة
function ComboSelect({ value, options, placeholder, onChange }: {
  value: string; options: string[]; placeholder?: string; onChange: (v: string) => void;
}) {
  const inList = value === "" || options.includes(value);
  const [other, setOther] = useState(!inList);
  useEffect(() => { setOther(!(value === "" || options.includes(value))); }, []); // eslint-disable-line
  if (other) {
    return (
      <div className="flex gap-1.5">
        <Input value={value} placeholder={placeholder || "اكتب..."} autoFocus
               onChange={(e) => onChange(e.target.value)} />
        <button type="button" onClick={() => { setOther(false); onChange(""); }}
                className="shrink-0 rounded-lg border border-line px-2 text-[11px] font-bold text-text-dim hover:text-text"
                title="الرجوع للقائمة">☰</button>
      </div>
    );
  }
  return (
    <Select value={value}
            onChange={(e) => {
              if (e.target.value === "__other__") { setOther(true); onChange(""); }
              else onChange(e.target.value);
            }}>
      <option value="">— اختر —</option>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
      <option value="__other__">أخرى...</option>
    </Select>
  );
}

const EMPTY = {
  branchId: "", plateLetters: "", plateNumbers: "", plateType: "saudi" as "saudi" | "other",
  name: "", modelYear: "", brand: "", color: "", chassisNumber: "",
  customerName: "", customerPhone: "", customerId: null as string | null,
  station: "", odometerCurrent: "", odometerPrevious: "", notes: "",
};

const timeFmt = (s: string | null) =>
  s ? new Date(s).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }) : "—";

function elapsed(from: string | null, now: number): string {
  if (!from) return "";
  const mins = Math.max(0, Math.floor((now - new Date(from).getTime()) / 60000));
  if (mins < 60) return `${mins} د`;
  return `${Math.floor(mins / 60)} س ${mins % 60} د`;
}

// ══════════ بوابة اختيار الزيت الذاتية (يستخدمها العميل بنفسه) ══════════
type KioskProduct = { id: string; name: string; spec: string | null; price_vat: number; oil_brand?: string | null; image_base64: string | null };
type KioskData = { brands: { id: string; name: string; logo_base64: string | null }[]; oils: KioskProduct[]; filters: KioskProduct[]; gearOils: KioskProduct[] };

function OilKiosk({ carId, onDone }: { carId: string; onDone: () => void }) {
  const [step, setStep] = useState<"loading" | "service" | "brand" | "oil" | "filter" | "review" | "gearOil" | "gearReview" | "saving" | "done" | "error">("loading");
  const [flow, setFlow] = useState<"engine" | "gear">("engine");
  const [chosenGear, setChosenGear] = useState<KioskProduct | null>(null);
  const [data, setData] = useState<KioskData | null>(null);
  const [brand, setBrand] = useState<string | null>(null);
  const [chosenOil, setChosenOil] = useState<KioskProduct | null>(null);
  const [oilQty, setOilQty] = useState(1);
  const [chosenFilter, setChosenFilter] = useState<KioskProduct | null>(null);
  const [err, setErr] = useState("");
  // الترشيح الذكي
  const [recBusy, setRecBusy] = useState(false);
  const [rec, setRec] = useState<null | { productId: string; reason: string }>(null);
  const [showAllOils, setShowAllOils] = useState(false);   // بعد الترشيح: المقترح فقط إلا لو طلب الباقي
  const [svcFee, setSvcFee] = useState<null | { productId: string | null; label?: string; price?: number }>(null);

  useEffect(() => {
    if (step === "review" && svcFee === null) {
      api<typeof svcFee>(`/cars/${carId}/service-fee`).then(setSvcFee).catch(() => setSvcFee({ productId: null }));
    }
  }, [step]);

  useEffect(() => {
    api<KioskData>("/products/kiosk-oils").then((d) => {
      setData(d);
      setStep("service");
    }).catch((e) => { setErr(e.message); setStep("error"); });
  }, []);

  const oils = (data?.oils || []).filter((o) => !brand || o.oil_brand === brand);
  const recOil = rec ? data?.oils.find((o) => o.id === rec.productId) || null : null;
  const total = (chosenOil ? chosenOil.price_vat * oilQty : 0) + (chosenFilter ? chosenFilter.price_vat : 0)
    + (svcFee?.productId && svcFee.price ? svcFee.price : 0);

  async function recommend() {
    setRecBusy(true); setRec(null);
    try {
      const r = await api<{ productId: string; reason: string }>(`/cars/${carId}/recommend-oil`, { method: "POST" });
      setRec(r);
      setBrand(null);
      setShowAllOils(false);    // التركيز على المقترح فقط
      setStep("oil");
    } catch { setErr(""); }
    finally { setRecBusy(false); }
  }

  async function submit() {
    setStep("saving");
    try {
      const items = flow === "gear"
        ? [{ productId: chosenGear!.id, qty: 1 }]
        : [{ productId: chosenOil!.id, qty: oilQty },
           ...(chosenFilter ? [{ productId: chosenFilter.id, qty: 1 }] : [])];
      await api(`/cars/${carId}/draft-items`, { method: "POST", body: JSON.stringify({ items, flow }) });
      setStep("done");
      setTimeout(onDone, 4000);
    } catch (e: any) { setErr(e.message); setStep("error"); }
  }

  const Steps = ({ current }: { current: 1 | 2 | 3 | 4 }) => (
    <div className="flex items-center justify-center gap-1.5 text-[10.5px] font-bold">
      {[{ n: 1, t: "الشركة" }, { n: 2, t: "الزيت" }, { n: 3, t: "الفلتر" }, { n: 4, t: "التأكيد" }].map((st, i) => (
        <div key={st.n} className="flex items-center gap-1.5">
          {i > 0 && <span className="h-px w-4 bg-line" />}
          <span className={`flex h-6 items-center gap-1 rounded-full px-2.5 transition-all duration-300
              ${current === st.n ? "bg-petrol text-white" : current > st.n ? "bg-emerald-bg text-emerald" : "bg-ink-3 text-text-dim"}`}>
            {current > st.n ? <MIcon name="check" className="!text-[13px]" /> : st.n} {st.t}
          </span>
        </div>
      ))}
    </div>
  );

  const BackBtn = ({ to, label }: { to: typeof step; label: string }) => (
    <button onClick={() => setStep(to)}
            className="mx-auto flex items-center gap-1 rounded-lg px-3 py-1.5 text-[12px] font-black text-text-dim transition hover:bg-ink-3 hover:text-text">
      <MIcon name="arrow_forward" className="!text-[16px]" /> {label}
    </button>
  );

  const ProductImg = ({ p, big }: { p: KioskProduct; big?: boolean }) => (
    p.image_base64
      ? <img src={`data:image/jpeg;base64,${p.image_base64}`} alt={p.name}
             className={`${big ? "h-24" : "h-14"} w-auto rounded-lg object-contain`} />
      : <span className="text-[#64748B]"><MIcon name="opacity" className={big ? "!text-[44px]" : "!text-[30px]"} /></span>
  );

  return (
    <div className="text-center">
      {step === "loading" && <p className="py-10 text-[13px] text-text-dim">جارِ التحميل...</p>}

      {step === "error" && (
        <div className="kiosk-step space-y-3 py-6">
          <p className="text-[13px] font-bold text-ember">{err || "حدث خطأ"}</p>
          <Button variant="ghost" onClick={onDone}>رجوع</Button>
        </div>
      )}

      {/* ═══ 0: اختيار الخدمة ═══ */}
      {step === "service" && data && (
        <div key="service" className="kiosk-step space-y-4">
          <div className="space-y-1">
            <h3 className="text-[19px] font-black">أهلاً بك 👋</h3>
            <p className="text-[13px] text-text-dim">إيه الخدمة اللي محتاجها النهاردة؟</p>
          </div>
          <div className="mx-auto grid max-w-lg gap-3 sm:grid-cols-2">
            <button onClick={() => { setFlow("engine"); setStep(data.brands.length > 0 ? "brand" : "oil"); }}
                    className="flex flex-col items-center gap-2.5 rounded-3xl border-2 border-line bg-ink-2 px-4 py-7 shadow-card transition hover:border-petrol hover:-translate-y-1 active:scale-[.96]">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-petrol text-white">
                <MIcon name="opacity" className="!text-[32px] text-white" />
              </span>
              <span className="text-[15px] font-black">تغيير زيت الماكينة</span>
              <span className="text-[11px] font-bold text-text-dim">زيت + فلتر + خدمة بسعر سيارتك</span>
            </button>
            <button onClick={() => { setFlow("gear"); setChosenGear(null); setStep("gearOil"); }}
                    disabled={data.gearOils.length === 0}
                    className="flex flex-col items-center gap-2.5 rounded-3xl border-2 border-line bg-ink-2 px-4 py-7 shadow-card transition hover:border-emerald hover:-translate-y-1 active:scale-[.96] disabled:opacity-40">
              <span className="grid h-16 w-16 place-items-center rounded-2xl bg-emerald text-white">
                <MIcon name="settings" className="!text-[32px] text-white" />
              </span>
              <span className="text-[15px] font-black">تغيير زيت القير</span>
              <span className="text-[11px] font-bold text-text-dim">اختر النوع — والفني يفحص ويحدد</span>
            </button>
          </div>
        </div>
      )}

      {/* ═══ رحلة القير: اختيار النوع ═══ */}
      {step === "gearOil" && data && (
        <div key="gearOil" className="kiosk-step space-y-3.5">
          <h3 className="text-[17px] font-black">اختر نوع زيت القير ⚙️</h3>
          <p className="text-[11.5px] text-text-dim">الكمية وسعر الخدمة يحددهم الفني بعد الفحص</p>
          <div className="grid max-h-[52vh] grid-cols-2 content-start gap-2.5 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
            {data.gearOils.map((p) => (
              <button key={p.id} onClick={() => { setChosenGear(p); setStep("gearReview"); }}
                      className="flex min-h-[152px] flex-col items-center justify-between gap-1.5 rounded-2xl border-2 border-line bg-ink-2 p-3 shadow-card transition hover:border-emerald hover:-translate-y-0.5 active:scale-[.96]">
                <ProductImg p={p} />
                <span className="line-clamp-2 text-[11.5px] font-black leading-snug">{p.name}{p.spec ? ` — ${p.spec}` : ""}</span>
                <span className="tnum rounded-full bg-emerald-bg px-2.5 py-0.5 text-[12.5px] font-black text-emerald">
                  {p.price_vat.toFixed(2)} ر.س / علبة
                </span>
              </button>
            ))}
          </div>
          <BackBtn to="service" label="رجوع للخدمات" />
        </div>
      )}

      {/* ═══ رحلة القير: المراجعة والتأكيد ═══ */}
      {step === "gearReview" && chosenGear && (
        <div key="gearReview" className="kiosk-step space-y-3.5">
          <h3 className="text-[17px] font-black">راجع طلبك وأكّد ✅</h3>
          <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-line p-3 text-right">
            <div className="flex items-center gap-3">
              <ProductImg p={chosenGear} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-black">{chosenGear.name}</div>
                <div className="tnum text-[12px] text-emerald">{chosenGear.price_vat.toFixed(2)} ر.س / علبة</div>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[12.5px]">
              <span className="flex items-center gap-1 font-bold text-text-dim">
                <MIcon name="search" className="!text-[16px]" /> خدمة فحص
              </span>
              <span className="tnum font-black text-emerald">+25.00 ر.س</span>
            </div>
            <div className="rounded-xl bg-brass-soft px-3 py-2.5 text-[12px] font-bold leading-relaxed text-brass">
              ⚠ كمية الزيت وسعر خدمة تغيير زيت القير يتحددان داخل الفرع بعد فحص الفني لحالة القير
            </div>
          </div>
          <button onClick={submit}
                  className="mx-auto flex items-center gap-2 rounded-2xl bg-emerald px-10 py-4 text-[16px] font-black text-white shadow-panel transition hover:brightness-110 active:scale-[.97]">
            <MIcon name="check_circle" className="!text-[22px] text-white" /> تأكيد الطلب
          </button>
          <BackBtn to="gearOil" label="تغيير النوع" />
        </div>
      )}

      {/* ═══ 1: الشركة ═══ */}
      {step === "brand" && data && (
        <div key="brand" className="kiosk-step space-y-4">
          <div className="space-y-1">
            <h3 className="text-[18px] font-black">أهلاً بك 👋</h3>
            <p className="text-[12.5px] text-text-dim">اختر شركة الزيت — أو خلّينا نرشحلك الأنسب لسيارتك</p>
          </div>
          <Steps current={1} />
          <BackBtn to="service" label="رجوع للخدمات" />
          <button onClick={recommend} disabled={recBusy}
                  className="mx-auto flex items-center gap-2 rounded-xl bg-petrol px-5 py-3 text-[13.5px] font-black text-white shadow-card transition hover:brightness-110 active:scale-[.97] disabled:opacity-60">
            <MIcon name="auto_awesome" className="!text-[19px] text-white" />
            {recBusy ? "جارِ تحليل سيارتك..." : "رشّح لي الزيت المناسب لسيارتي"}
          </button>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {data.brands.map((b) => (
              <button key={b.id} onClick={() => { setBrand(b.name); setStep("oil"); }}
                      className="flex flex-col items-center gap-2 rounded-2xl border-2 border-line bg-ink-2 p-4 shadow-card transition hover:border-petrol hover:-translate-y-0.5 active:scale-[.96]">
                {b.logo_base64
                  ? <img src={`data:image/png;base64,${b.logo_base64}`} alt={b.name} className="h-14 w-auto object-contain" />
                  : <MIcon name="verified" className="!text-[32px] text-[#64748B]" />}
                <span className="text-[13px] font-black">{b.name}</span>
              </button>
            ))}
            <button onClick={() => { setBrand(null); setStep("oil"); }}
                    className="flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line p-4 text-text-dim transition hover:border-petrol hover:text-petrol active:scale-[.96]">
              <MIcon name="apps" className="!text-[26px]" />
              <span className="text-[12.5px] font-black">عرض كل الزيوت</span>
            </button>
          </div>
        </div>
      )}

      {/* ═══ 2: الزيت ═══ */}
      {step === "oil" && data && (
        <div key="oil" className="kiosk-step space-y-3.5">
          <h3 className="text-[17px] font-black">{brand ? `زيوت ${brand}` : "اختر نوع الزيت"}</h3>
          <Steps current={2} />
          {recOil && (
            <div className="kiosk-pop mx-auto w-full max-w-lg space-y-3">
              {/* بطاقة المقترح — خلفية مميزة بالكامل */}
              <div className="rounded-3xl p-[2px] shadow-panel"
                   style={{ background: "linear-gradient(135deg, #16A34A, #0F2D52)" }}>
                <div className="flex flex-col items-center gap-2.5 rounded-[22px] bg-emerald-bg px-5 py-6">
                  <span className="flex items-center gap-1.5 rounded-full bg-emerald px-3.5 py-1 text-[12px] font-black text-white">
                    <MIcon name="auto_awesome" className="!text-[16px] text-white" /> مقترحنا لسيارتك
                  </span>
                  <ProductImg p={recOil} big />
                  <div className="text-[16px] font-black">{recOil.name}{recOil.spec ? ` — ${recOil.spec}` : ""}</div>
                  <div className="text-[12.5px] font-bold text-text-dim">{rec?.reason}</div>
                  <div className="tnum text-[22px] font-black text-emerald">{recOil.price_vat.toFixed(2)} ر.س</div>
                  <button onClick={() => { setChosenOil(recOil); setOilQty(1); setStep("filter"); }}
                          className="flex items-center gap-2 rounded-2xl bg-emerald px-8 py-3.5 text-[15px] font-black text-white shadow-card transition hover:brightness-110 active:scale-[.97]">
                    <MIcon name="check_circle" className="!text-[20px] text-white" /> اختيار المقترح
                  </button>
                </div>
              </div>
              {!showAllOils && (
                <button onClick={() => setShowAllOils(true)}
                        className="mx-auto flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-black text-text-dim transition hover:bg-ink-3 hover:text-text">
                  <MIcon name="apps" className="!text-[16px]" /> عرض باقي الزيوت
                </button>
              )}
            </div>
          )}
          {!recOil && (
            <button onClick={recommend} disabled={recBusy}
                    className="mx-auto flex items-center gap-1.5 rounded-lg border border-petrol/40 px-3.5 py-2 text-[12px] font-black text-petrol transition hover:bg-petrol-soft active:scale-[.97] disabled:opacity-60">
              <MIcon name="auto_awesome" className="!text-[16px]" />
              {recBusy ? "جارِ التحليل..." : "رشّح لي المناسب لسيارتي"}
            </button>
          )}
          {recOil && !showAllOils ? null : oils.length === 0 ? (
            <p className="py-8 text-[12.5px] text-text-dim">لا توجد زيوت في هذا التصنيف</p>
          ) : (
            <div className="grid max-h-[52vh] grid-cols-2 content-start gap-2.5 overflow-y-auto sm:grid-cols-3 lg:grid-cols-4">
              {oils.map((p) => (
                <button key={p.id} onClick={() => { setChosenOil(p); setOilQty(1); setStep("filter"); }}
                        className={`flex flex-col items-center gap-1.5 rounded-2xl border-2 p-3 shadow-card transition hover:-translate-y-0.5 active:scale-[.96]
                          ${rec?.productId === p.id ? "border-emerald bg-emerald-bg" : "border-line bg-ink-2 hover:border-petrol"}`}>
                  <ProductImg p={p} />
                  <span className="line-clamp-2 text-[11.5px] font-black leading-snug">{p.name}{p.spec ? ` — ${p.spec}` : ""}</span>
                  <span className="tnum rounded-full bg-petrol-soft px-2.5 py-0.5 text-[12.5px] font-black text-petrol">
                    {p.price_vat.toFixed(2)} ر.س
                  </span>
                </button>
              ))}
            </div>
          )}
          {data.brands.length > 0 ? <BackBtn to="brand" label="رجوع للشركات" /> : <BackBtn to="service" label="رجوع للخدمات" />}
        </div>
      )}

      {/* ═══ 3: الفلتر ═══ */}
      {step === "filter" && chosenOil && data && (
        <div key="filter" className="kiosk-step space-y-3.5">
          <h3 className="text-[17px] font-black">تحتاج فلتر زيت جديد؟</h3>
          <p className="text-[11.5px] text-text-dim">ينصح بتغيير فلتر الزيت مع كل تغيير زيت للحفاظ على المحرك</p>
          <Steps current={3} />
          {data.filters.length === 0 ? (
            <button onClick={() => { setChosenFilter(null); setStep("review"); }}
                    className="mx-auto rounded-xl bg-petrol px-6 py-3 text-[13.5px] font-black text-white">متابعة بدون فلتر</button>
          ) : (
            <>
              <div className="grid max-h-56 grid-cols-2 content-start gap-2.5 overflow-y-auto sm:grid-cols-3">
                {data.filters.map((f) => (
                  <button key={f.id} onClick={() => { setChosenFilter(f); setStep("review"); }}
                          className="flex flex-col items-center gap-1.5 rounded-2xl border-2 border-line bg-ink-2 p-3 shadow-card transition hover:border-emerald hover:-translate-y-0.5 active:scale-[.96]">
                    {f.image_base64
                      ? <img src={`data:image/jpeg;base64,${f.image_base64}`} alt={f.name} className="h-12 w-auto rounded-lg object-contain" />
                      : <MIcon name="filter_alt" className="!text-[28px] text-[#64748B]" />}
                    <span className="line-clamp-2 text-[11px] font-black leading-snug">{f.name}</span>
                    <span className="tnum text-[12px] font-black text-emerald">+{f.price_vat.toFixed(2)} ر.س</span>
                  </button>
                ))}
              </div>
              <button onClick={() => { setChosenFilter(null); setStep("review"); }}
                      className="mx-auto flex items-center gap-1.5 rounded-xl border-2 border-line px-5 py-2.5 text-[12.5px] font-black text-text-dim transition hover:border-ember hover:text-ember active:scale-[.97]">
                <MIcon name="close" className="!text-[16px]" /> لا — بدون فلتر
              </button>
            </>
          )}
          <BackBtn to="oil" label="رجوع لاختيار الزيت" />
        </div>
      )}

      {/* ═══ 4: المراجعة والتأكيد ═══ */}
      {step === "review" && chosenOil && (
        <div key="review" className="kiosk-step space-y-3.5">
          <h3 className="text-[17px] font-black">راجع طلبك وأكّد ✅</h3>
          <Steps current={4} />
          <div className="mx-auto max-w-md space-y-2 rounded-2xl border border-line p-3 text-right">
            <div className="flex items-center gap-3">
              <ProductImg p={chosenOil} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13px] font-black">{chosenOil.name}</div>
                <div className="tnum text-[12px] text-petrol">{chosenOil.price_vat.toFixed(2)} ر.س × {oilQty}</div>
              </div>
              {/* كمية الزيت بيد العميل */}
              <div className="flex items-center gap-1.5">
                <button onClick={() => setOilQty(Math.max(1, oilQty - 1))}
                        className="grid h-8 w-8 place-items-center rounded-lg border border-line text-[16px] font-black active:scale-90">−</button>
                <span className="tnum w-6 text-[15px] font-black">{oilQty}</span>
                <button onClick={() => setOilQty(Math.min(6, oilQty + 1))}
                        className="grid h-8 w-8 place-items-center rounded-lg bg-petrol text-[16px] font-black text-white active:scale-90">+</button>
              </div>
            </div>
            <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[12.5px]">
              <span className="font-bold text-text-dim">فلتر الزيت</span>
              {chosenFilter ? (
                <span className="flex items-center gap-2">
                  <b>{chosenFilter.name}</b>
                  <span className="tnum text-emerald">+{chosenFilter.price_vat.toFixed(2)}</span>
                  <button onClick={() => setStep("filter")} className="text-[11px] font-bold text-petrol hover:underline">تغيير</button>
                </span>
              ) : (
                <span className="flex items-center gap-2 text-text-dim">
                  بدون فلتر
                  <button onClick={() => setStep("filter")} className="text-[11px] font-bold text-petrol hover:underline">إضافة</button>
                </span>
              )}
            </div>
            {svcFee?.productId && (
              <div className="flex items-center justify-between border-t border-dashed border-line pt-2 text-[12.5px]">
                <span className="flex items-center gap-1 font-bold text-text-dim">
                  <MIcon name="car_repair" className="!text-[16px]" /> خدمة التغيير — حسب سيارتك
                </span>
                <span className="tnum font-black text-emerald">+{svcFee.price?.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center justify-between rounded-xl bg-petrol-soft px-3 py-2.5">
              <span className="text-[13px] font-black">الإجمالي التقريبي</span>
              <span className="tnum text-[18px] font-black text-petrol">{total.toFixed(2)} ر.س</span>
            </div>
          </div>
          <button onClick={submit}
                  className="mx-auto flex items-center gap-2 rounded-2xl bg-emerald px-10 py-4 text-[16px] font-black text-white shadow-panel transition hover:brightness-110 active:scale-[.97]">
            <MIcon name="check_circle" className="!text-[22px] text-white" /> تأكيد الطلب
          </button>
          <BackBtn to="filter" label="رجوع" />
        </div>
      )}

      {step === "saving" && <p className="py-10 text-[13px] font-bold text-text-dim">جارِ حفظ طلبك...</p>}

      {step === "done" && (
        <div className="kiosk-pop space-y-2 py-8">
          <MIcon name="task_alt" className="!text-[56px] text-emerald" filled />
          <p className="text-[16px] font-black text-emerald">تم تأكيد طلبك بنجاح</p>
          <p className="text-[12.5px] text-text-dim">تفضل بالجلوس — الموظف سيجهز فاتورتك الآن</p>
        </div>
      )}
    </div>
  );
}

// ═══════════════ نظام التصميم — لوحة Linear/Stripe المعتمدة ═══════════════
const UI = {
  primary: "#1E3A8A", success: "#22C55E", warning: "#F59E0B", danger: "#EF4444",
  bg: "#F8FAFC", card: "#FFFFFF", border: "#E5E7EB",
};

/** حبة حالة ملوّنة بأيقونة — بديل شارات النص */
function StatusPill({ tone, icon, children, pulse }: {
  tone: "warning" | "primary" | "success" | "neutral"; icon: string;
  children: React.ReactNode; pulse?: boolean;
}) {
  const map = {
    warning: { bg: "#FEF3C7", fg: "#B45309" },
    primary: { bg: "#DBEAFE", fg: "#1E3A8A" },
    success: { bg: "#DCFCE7", fg: "#15803D" },
    neutral: { bg: "#F1F5F9", fg: "#64748B" },
  }[tone];
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-bold transition-colors duration-200"
          style={{ background: map.bg, color: map.fg }}>
      {pulse && <span className="relative flex h-1.5 w-1.5">
        <span className="absolute h-full w-full animate-ping rounded-full opacity-60" style={{ background: map.fg }} />
        <span className="relative h-1.5 w-1.5 rounded-full" style={{ background: map.fg }} />
      </span>}
      <MIcon name={icon} className="!text-[14px]" />
      {children}
    </span>
  );
}

/** زر أيقونة بتلميح — بديل الأزرار الكبيرة */
function IconBtn({ icon, label, onClick, tone = "ghost" }: {
  icon: string; label: string; onClick: () => void; tone?: "ghost" | "primary" | "danger";
}) {
  const cls = {
    ghost:   "text-slate-500 hover:bg-slate-100 hover:text-slate-800",
    primary: "text-white shadow-sm hover:brightness-110",
    danger:  "text-slate-400 hover:bg-red-50 hover:text-red-600",
  }[tone];
  return (
    <span className="group/ib relative inline-flex">
      <button onClick={onClick} aria-label={label}
              className={`grid h-9 w-9 place-items-center rounded-xl transition-all duration-200 ease-in-out active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A] ${cls}`}
              style={tone === "primary" ? { background: UI.primary } : undefined}>
        <MIcon name={icon} className="!text-[19px]" />
      </button>
      <span className="pointer-events-none absolute -top-8 right-1/2 translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10.5px] font-bold text-white opacity-0 shadow-lg transition-opacity duration-200 group-hover/ib:opacity-100">
        {label}
      </span>
    </span>
  );
}

/** كارت إحصائية — أيقونة + رقم + عنوان + مؤشر */
function StatCard({ icon, value, title, hint, color, tint, onClick }: {
  icon: string; value: React.ReactNode; title: string; hint?: string;
  color: string; tint: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} disabled={!onClick}
            className="group flex items-center gap-4 rounded-2xl border bg-white p-6 text-right shadow-sm transition-all duration-200 ease-in-out enabled:hover:-translate-y-0.5 enabled:hover:shadow-md"
            style={{ borderColor: UI.border }}>
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl transition-transform duration-200 group-hover:scale-105"
            style={{ background: tint, color }}>
        <MIcon name={icon} className="!text-[24px]" />
      </span>
      <span className="min-w-0">
        <span className="tnum block text-[24px] font-black leading-none" style={{ color }}>{value}</span>
        <span className="mt-1 block text-[12px] font-bold text-slate-500">{title}</span>
        {hint && <span className="tnum mt-0.5 block text-[10.5px] text-slate-400">{hint}</span>}
      </span>
    </button>
  );
}

export default function CarsPage() {
  const { hasPerm, user } = useAuth();
  // فرع المستخدم الافتراضي: فرعه المربوط بيه لو موجود — وإلا أول فرع (للأدمن غير المربوط)
  const defaultBranchId = () => user?.branchId || branches[0]?.id || "";
  const canCreate = hasPerm("cars.create");
  const canEnter = hasPerm("cars.confirm_entry");
  const canExit = hasPerm("cars.confirm_exit");
  const canEdit = hasPerm("cars.edit");
  const canDelete = hasPerm("cars.delete");
  const canChecklist = canCreate || canEnter || canExit || canEdit;

  const [rows, setRows] = useState<Car[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");
  // فلاتر الواجهة الجديدة — الفلترة كلها عميلة على دفعة واحدة
  const [statusFilter, setStatusFilter] = useState<"active" | "queued" | "in_service" | "done_today" | "all">("active");
  const [branchFilter, setBranchFilter] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;
  const [now, setNow] = useState(() => Date.now());

  const [modal, setModal] = useState<null | { mode: "create" } | { mode: "edit"; car: Car }>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [lookupBusy, setLookupBusy] = useState(false);

  // ── كاميرا اللوحة ──
  const fileRef = useRef<HTMLInputElement>(null);
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrMsg, setOcrMsg] = useState("");
  const [plateShot, setPlateShot] = useState<string | null>(null);

  // ── نقاط التشييك ──
  const [ckCar, setCkCar] = useState<Car | null>(null);
  const [ckItems, setCkItems] = useState<CkItem[]>([]);
  const [ckBusy, setCkBusy] = useState(false);
  const [ckErr, setCkErr] = useState("");

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);

  // تحديث صامت (من غير وميض تحميل) — الكروت بتفضل حية لو حد تاني حدّث التشييك
  useEffect(() => {
    const t = setInterval(async () => {
      try { setRows(await api<Car[]>("/cars?activeOnly=false&limit=300")); } catch { /* صامت */ }
    }, 10000);
    return () => clearInterval(t);
  }, []);

  async function load() {
    setLoading(true);
    try {
      const [cars, br] = await Promise.all([
        api<Car[]>("/cars?activeOnly=false&limit=300"),
        api<Branch[]>("/branches"),
      ]);
      setRows(cars); setBranches(br); setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  const queued = useMemo(() => rows.filter((c) => carStatus(c) === "queued"), [rows]);
  const inService = useMemo(() => rows.filter((c) => carStatus(c) === "in_service"), [rows]);
  const doneToday = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return rows.filter((c) => c.exited_at && new Date(c.exited_at) >= today);
  }, [rows]);
  // متوسط انتظار السيارات الواقفة في الطابور الآن — مؤشر حي
  const avgWaitMin = useMemo(() => {
    if (!queued.length) return null;
    const total = queued.reduce((s, c) => s + Math.max(0, now - +new Date(c.created_at)), 0);
    return Math.round(total / queued.length / 60000);
  }, [queued, now]);
  const filteredRows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter((c) => {
      if (branchFilter && c.branch_id !== branchFilter) return false;
      const s = carStatus(c);
      if (statusFilter === "active" && s === "done") return false;
      if (statusFilter === "queued" && s !== "queued") return false;
      if (statusFilter === "in_service" && s !== "in_service") return false;
      if (statusFilter === "done_today" && !doneToday.some((d) => d.id === c.id)) return false;
      if (!term) return true;
      return [c.plate, c.customer_name, c.customer_phone].some((v) => (v || "").toLowerCase().includes(term));
    });
  }, [rows, q, statusFilter, branchFilter, doneToday]);
  const pageRows = useMemo(() => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), [filteredRows, page]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  useEffect(() => { setPage(1); }, [q, statusFilter, branchFilter]);
  function exportCsv() {
    const head = ["اللوحة", "العميل", "الجوال", "السيارة", "الفرع", "الحالة", "التسجيل"];
    const body = filteredRows.map((c) => [
      c.plate || "", c.customer_name || "", c.customer_phone || "",
      [c.brand, c.name, c.model_year].filter(Boolean).join(" "),
      branchName[c.branch_id] || "", carStatus(c), new Date(c.created_at).toLocaleString("ar-SA"),
    ]);
    const csv = "\ufeff" + [head, ...body].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `service-line-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  function openCreate() {
    setForm({ ...EMPTY, branchId: defaultBranchId() });
    setPlateShot(null); setOcrMsg("");
    setErr(""); setModal({ mode: "create" });
  }
  function openEdit(c: Car) {
    setForm({
      ...EMPTY, branchId: c.branch_id,
      plateLetters: c.plate?.split(" ")[0] || "", plateNumbers: c.plate?.split(" ")[1] || "",
      name: c.name || "", brand: c.brand || "", modelYear: c.model_year || "", color: c.color || "",
      chassisNumber: c.chassis_number || "", customerName: c.customer_name || "",
      customerPhone: c.customer_phone || "", odometerCurrent: c.odometer_current?.toString() || "",
      notes: c.notes || "",
    });
    setPlateShot(null); setOcrMsg("");
    setErr(""); setModal({ mode: "edit", car: c });
  }

  // ══════════════════ كاميرا اللوحة + OCR ══════════════════

  // ══════════ بوابة الدخول الذكية ══════════
  const router = useRouter();
  const [gateOpen, setGateOpen] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrBranch, setQrBranch] = useState("");
  const [gateBusy, setGateBusy] = useState(false);
  const [gateMsg, setGateMsg] = useState("");
  const [gateResult, setGateResult] = useState<null | {
    matched: boolean; alreadyEntered?: boolean; matchBy?: string; isWalkIn?: boolean;
    car?: Car; lastInvoiceId?: string | null;
    lastInvoiceItems?: { productId: string | null; label: string; qty: number; unitPriceVat: number }[];
    letters: string; numbers: string;
  }>(null);
  const gateFileRef = useRef<HTMLInputElement>(null);

  async function onGatePhoto(file: File) {
    setGateBusy(true); setGateResult(null); setGateMsg("جارِ قراءة اللوحة والمطابقة...");
    try {
      const { base64, canvas } = await preprocess(file);
      let res;
      try {
        // الطريق الذكي: الصورة تتحلل في الخادم وتتطابق في نداء واحد
        res = await api<typeof gateResult>("/cars/gate-scan", {
          method: "POST",
          body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg", branchId: defaultBranchId() }),
        });
      } catch {
        // احتياطي: القارئ المحلي ثم المطابقة
        setGateMsg("جارِ القراءة بالقارئ المحلي...");
        const local = await localOcr(canvas);
        if (!local.letters && !local.numbers) throw new Error("مقدرتش أقرأ اللوحة — قرّب الكاميرا وصوّر تاني");
        res = await api<typeof gateResult>("/cars/gate-scan", {
          method: "POST",
          body: JSON.stringify({ letters: local.letters, numbers: local.numbers, branchId: defaultBranchId() }),
        });
      }
      setGateResult(res);
      setGateMsg("");
      if (res?.matched) await load(); // تحديث اللوحة الحية بعد تأكيد الدخول
    } catch (e: any) {
      setGateMsg(e.message || "فشلت العملية");
    } finally { setGateBusy(false); }
  }

  function goToSalesWithLastInvoice() {
    if (!gateResult?.car) return;
    if (gateResult.lastInvoiceItems?.length) {
      localStorage.setItem("z8_repeat_invoice", JSON.stringify({
        branchId: gateResult.car.branch_id,
        carId: gateResult.car.id,
        customerId: gateResult.car.customer_id,
        customerName: gateResult.car.customer_name,
        items: gateResult.lastInvoiceItems.map((it) => ({
          productId: it.productId, label: it.label, qty: it.qty,
          unitPrice: Math.round((it.unitPriceVat / 1.15) * 100) / 100, unitPriceVat: it.unitPriceVat,
        })),
      }));
    }
    router.push("/sales");
  }

  // ══════════ 🎛 مفتاح البوابة الذكية (المراقب الخلفي) — تشغيل/إيقاف بضغطة ══════════
  const [gateSwOn, setGateSwOn] = useState<boolean | null>(null);
  const [gateSwRunning, setGateSwRunning] = useState(false);
  const [gateSwBusy, setGateSwBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<{ enabled: boolean; running: boolean }>("/auto-checkin/watcher-status")
        .then((r) => { if (alive) { setGateSwOn(r.enabled); setGateSwRunning(r.running); } })
        .catch(() => { if (alive) setGateSwOn(null); });
    load();
    const t = setInterval(load, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  async function toggleGateSw() {
    if (gateSwOn === null || gateSwBusy) return;
    setGateSwBusy(true);
    try {
      const r = await api<{ enabled: boolean; running: boolean }>(
        `/auto-checkin/watcher-toggle?enabled=${!gateSwOn}`, { method: "POST" });
      setGateSwOn(r.enabled); setGateSwRunning(r.running);
    } catch { /* تجاهل */ }
    finally { setGateSwBusy(false); }
  }

  // ── لوحة الكاميرات: مفتاح مستقل لكل كاميرا + مؤشر حالة حي ──
  const [gateSwPanel, setGateSwPanel] = useState(false);
  const [gateCamsStatus, setGateCamsStatus] = useState<
    { id: string; name: string; is_active: boolean; ok: boolean | null; last: string }[]>([]);

  const loadCamsStatus = () =>
    api<{ cameras: any[] }>("/auto-checkin/cameras-status")
      .then((r) => setGateCamsStatus(r.cameras))
      .catch(() => {});

  useEffect(() => {
    if (!gateSwPanel) return;
    loadCamsStatus();
    const t = setInterval(loadCamsStatus, 8000);
    return () => clearInterval(t);
  }, [gateSwPanel]);

  async function toggleCam(camId: string, enabled: boolean) {
    try {
      await api(`/auto-checkin/camera-toggle?camera_id=${camId}&enabled=${enabled}`, { method: "POST" });
      setGateCamsStatus((l) => l.map((c) => (c.id === camId ? { ...c, is_active: enabled } : c)));
    } catch { /* تجاهل */ }
  }

  // ══════════ البوابة الحية (ANPR تلقائي بالكامل) ══════════
  // خط المعالجة: كشف حركة محلي → انتظار الثبات → قراءة ذكية للقطة واحدة → مطابقة وتأكيد → تهدئة
  const [liveOpen, setLiveOpen] = useState(false);
  const [liveStatus, setLiveStatus] = useState<"idle" | "starting" | "watching" | "motion" | "reading" | "error">("idle");
  const [liveErr, setLiveErr] = useState("");
  const [liveLog, setLiveLog] = useState<{ t: string; msg: string; tone: "ok" | "warn" | "err" | "info" }[]>([]);
  const [liveHit, setLiveHit] = useState<null | { title: string; sub: string; tone: "ok" | "warn" | "err" }>(null);
  const [liveKioskCar, setLiveKioskCar] = useState<string | null>(null);   // سيارة عميل جديد داخل بوابة اختيار الزيت
  const [liveMode, setLiveMode] = useState<null | "device" | "ip">(null);   // null = شاشة الاختيار
  const [ipCamUrl, setIpCamUrl] = useState("");
  const [gateCams, setGateCams] = useState<{ id: string; name: string; rtsp_url: string; station: string; branch_name: string | null }[]>([]);
  const [ipFrame, setIpFrame] = useState("");   // آخر لقطة IP معروضة

  const videoRef = useRef<HTMLVideoElement>(null);
  const liveRefs = useRef<{
    stream: MediaStream | null; timer: any; wakeLock: any;
    prevFrame: Uint8ClampedArray | null; stillTicks: number; inMotion: boolean;
    busy: boolean; attempts: number; globalCooldownUntil: number;
    plateCooldown: Map<string, number>; visionCalls: number[]; useLocalOnly: boolean;
    hitTimer: any; ipFetching: boolean; lastIpB64: string; lastIpCanvas: HTMLCanvasElement | null; lastIpErr: string;
    lastReadFrame: Uint8ClampedArray | null; lastReadAt: number;
    mode: "device" | "ip" | null; camUrl: string; paused: boolean;
  }>({ stream: null, timer: null, wakeLock: null, prevFrame: null, stillTicks: 0,
       inMotion: false, busy: false, attempts: 0, globalCooldownUntil: 0,
       plateCooldown: new Map(), visionCalls: [], useLocalOnly: false, hitTimer: null,
       ipFetching: false, lastIpB64: "", lastIpCanvas: null as HTMLCanvasElement | null, lastIpErr: "",
       lastReadFrame: null as Uint8ClampedArray | null, lastReadAt: 0,
       mode: null as "device" | "ip" | null, camUrl: "", paused: false });

  const TICK_MS = 350;          // إيقاع الفحص (كاميرا الجهاز)
  const TICK_IP_MS = 800;       // إيقاع سحب لقطات IP
  const TRIGGER_T = 4;          // أي تغيّر في المشهد عن آخر قراءة → اقرأ فوراً
  const FORCE_RESCAN_MS = 12000; // ولو المشهد ثابت تماماً: إعادة مسح كل 12 ثانية
  const PLATE_COOLDOWN_MS = 10 * 60 * 1000;   // نفس اللوحة: 10 دقايق
  const GLOBAL_COOLDOWN_MS = 1500;            // بعد كل قراءة: 1.5 ثانية بس
  const MAX_VISION_PER_MIN = 20;              // سقف أمان لنداءات الرؤية

  function liveAddLog(msg: string, tone: "ok" | "warn" | "err" | "info") {
    const t = new Date().toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    setLiveLog((prev) => [{ t, msg, tone }, ...prev].slice(0, 8));
  }

  function beep(ok: boolean) {
    try {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const seq = ok ? [[880, 0], [1320, 0.16]] : [[240, 0]];
      for (const [freq, delay] of seq) {
        const o = ctx.createOscillator(); const g = ctx.createGain();
        o.frequency.value = freq; o.connect(g); g.connect(ctx.destination);
        g.gain.setValueAtTime(0.15, ctx.currentTime + delay);
        g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.18);
        o.start(ctx.currentTime + delay); o.stop(ctx.currentTime + delay + 0.2);
      }
    } catch { /* الصوت كماليات */ }
  }

  function showHit(title: string, sub: string, tone: "ok" | "warn" | "err") {
    setLiveHit({ title, sub, tone });
    clearTimeout(liveRefs.current.hitTimer);
    liveRefs.current.hitTimer = setTimeout(() => setLiveHit(null), 6000);
  }

  // إطار مصغّر رمادي لكشف الحركة (رخيص جداً) — من كاميرا الجهاز أو آخر لقطة IP
  function grabSmallFrame(): Uint8ClampedArray | null {
    const src: HTMLVideoElement | HTMLCanvasElement | null =
      liveRefs.current.mode === "ip" ? liveRefs.current.lastIpCanvas
                        : (videoRef.current && videoRef.current.readyState >= 2 ? videoRef.current : null);
    if (!src) return null;
    const cv = document.createElement("canvas");
    cv.width = 96; cv.height = 54;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    const d = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const gray = new Uint8ClampedArray(cv.width * cv.height);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    return gray;
  }

  function frameDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
    return sum / a.length;
  }

  // لقطة كاملة الجودة للقراءة
  function grabFullFrame(): { base64: string; canvas: HTMLCanvasElement } | null {
    if (liveRefs.current.mode === "ip") {
      const R = liveRefs.current;
      if (!R.lastIpB64 || !R.lastIpCanvas) return null;
      return { base64: R.lastIpB64, canvas: R.lastIpCanvas };
    }
    const v = videoRef.current;
    if (!v || v.readyState < 2) return null;
    const scale = Math.min(1, 1400 / v.videoWidth);
    const cv = document.createElement("canvas");
    cv.width = Math.round(v.videoWidth * scale);
    cv.height = Math.round(v.videoHeight * scale);
    const ctx = cv.getContext("2d")!;
    ctx.drawImage(v, 0, 0, cv.width, cv.height);
    return { base64: cv.toDataURL("image/jpeg", 0.88).split(",")[1], canvas: cv };
  }

  // ══════════ كاشف منطقة اللوحة المحلي الفوري (10-20ms) ══════════
  // الفكرة: حروف وأرقام اللوحة بتولّد كثافة حواف رأسية عالية جداً في شريط أفقي —
  // بنمسح الصورة المصغرة ونحدد الشريط الأعلى كثافة ونقصه بهامش أمان.
  // النتيجة: بنبعت للتحليل قصاصة اللوحة بس (أصغر 10x) → أسرع وأدق بكثير.
  function detectPlateRegion(src: HTMLCanvasElement): { x: number; y: number; w: number; h: number } | null {
    const DW = 320;
    const scale = DW / src.width;
    const DH = Math.max(1, Math.round(src.height * scale));
    const cv = document.createElement("canvas");
    cv.width = DW; cv.height = DH;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(src, 0, 0, DW, DH);
    const d = ctx.getImageData(0, 0, DW, DH).data;
    const gray = new Float32Array(DW * DH);
    for (let i = 0, j = 0; i < d.length; i += 4, j++) gray[j] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

    // حواف رأسية (فرق أفقي) — بصمة الحروف
    const EDGE_T = 26;
    const edge = new Uint8Array(DW * DH);
    for (let y = 0; y < DH; y++)
      for (let x = 1; x < DW - 1; x++)
        if (Math.abs(gray[y * DW + x + 1] - gray[y * DW + x - 1]) > EDGE_T) edge[y * DW + x] = 1;

    // كثافة كل صف + تنعيم بسيط
    const rowScore = new Float32Array(DH);
    for (let y = 0; y < DH; y++) {
      let sum = 0;
      for (let x = 0; x < DW; x++) sum += edge[y * DW + x];
      rowScore[y] = sum;
    }
    // أفضل شريط صفوف بارتفاع 6%-45% من الصورة
    let bestY0 = -1, bestY1 = -1, bestRowSum = 0;
    const minH = Math.max(4, Math.round(DH * 0.06)), maxH = Math.round(DH * 0.45);
    let winSum = 0;
    for (let h = minH; h <= maxH; h += Math.max(2, Math.round(minH / 2))) {
      winSum = 0;
      for (let y = 0; y < h; y++) winSum += rowScore[y];
      let cur = winSum;
      for (let y0 = 0; y0 + h <= DH; y0++) {
        if (y0 > 0) cur += rowScore[y0 + h - 1] - rowScore[y0 - 1];
        const norm = cur / h;
        if (norm > bestRowSum) { bestRowSum = norm; bestY0 = y0; bestY1 = y0 + h; }
      }
    }
    if (bestY0 < 0 || bestRowSum < DW * 0.06) return null; // لا يوجد كثافة كافية = لا يوجد لوحة واضحة

    // داخل الشريط: أفضل نطاق أعمدة متصل الكثافة
    const colScore = new Float32Array(DW);
    for (let x = 0; x < DW; x++) {
      let sum = 0;
      for (let y = bestY0; y < bestY1; y++) sum += edge[y * DW + x];
      colScore[x] = sum;
    }
    const bandH = bestY1 - bestY0;
    const colT = bandH * 0.12;
    // أوسع نافذة أعمدة كثيفة (عرض 20%-95%)
    let bestX0 = -1, bestX1 = -1, bestColSum = 0;
    const minW = Math.round(DW * 0.2), maxW = Math.round(DW * 0.95);
    const dense = new Float32Array(DW);
    for (let x = 0; x < DW; x++) dense[x] = colScore[x] > colT ? 1 : 0;
    for (let w = minW; w <= maxW; w += 8) {
      let cur = 0;
      for (let x = 0; x < w; x++) cur += dense[x];
      for (let x0 = 0; x0 + w <= DW; x0++) {
        if (x0 > 0) cur += dense[x0 + w - 1] - dense[x0 - 1];
        const norm = cur / w;
        if (norm > bestColSum) { bestColSum = norm; bestX0 = x0; bestX1 = x0 + w; }
      }
    }
    if (bestX0 < 0 || bestColSum < 0.3) return null;

    // الرجوع لإحداثيات الصورة الأصلية + هامش 14%
    const mx = (bestX1 - bestX0) * 0.14, my = (bestY1 - bestY0) * 0.3;
    const x = Math.max(0, (bestX0 - mx) / scale);
    const y = Math.max(0, (bestY0 - my) / scale);
    const w = Math.min(src.width - x, (bestX1 - bestX0 + 2 * mx) / scale);
    const h = Math.min(src.height - y, (bestY1 - bestY0 + 2 * my) / scale);
    return { x, y, w, h };
  }

  // قص اللوحة المكتشفة وإرجاعها base64 مضغوطة — أو الكادر كامل لو الكشف فشل
  function cropForVision(full: { base64: string; canvas: HTMLCanvasElement }): { base64: string; cropped: boolean } {
    try {
      const region = detectPlateRegion(full.canvas);
      if (!region) return { base64: full.base64, cropped: false };
      const cv = document.createElement("canvas");
      // نطلع القصاصة بعرض ثابت 800px — كافية للقراءة وأصغر بكثير
      const outW = Math.min(640, Math.round(region.w));
      const outH = Math.round(region.h * (outW / region.w));
      cv.width = outW; cv.height = outH;
      cv.getContext("2d")!.drawImage(full.canvas, region.x, region.y, region.w, region.h, 0, 0, outW, outH);
      return { base64: cv.toDataURL("image/jpeg", 0.85).split(",")[1], cropped: true };
    } catch { return { base64: full.base64, cropped: false }; }
  }

  async function liveReadAndMatch() {
    const R = liveRefs.current;
    if (R.busy) return;
    R.busy = true;
    setLiveStatus("reading");
    R.lastReadAt = Date.now();
    R.lastReadFrame = grabSmallFrame();
    const t0 = performance.now();
    try {
      const frame = grabFullFrame();
      if (!frame) return;
      const shot = cropForVision(frame);   // قص اللوحة محلياً في ~15ms → إرسال أصغر وأسرع 10x

      // سقف الأمان لنداءات الرؤية في الدقيقة
      const now = Date.now();
      R.visionCalls = R.visionCalls.filter((t) => now - t < 60000);
      const canVision = !R.useLocalOnly && R.visionCalls.length < MAX_VISION_PER_MIN;

      let res: any = null;
      let lastErr = "";
      if (canVision) {
        // ── قراءة مزدوجة: القصاصة أولاً (سريعة)، ولو فشلت/ناقصة → الكادر الكامل فوراً ──
        // (القص ممكن يتلخبط مع خلفية مزدحمة — أرفف الزيوت — فالكادر الكامل صمام أمان دائم)
        const attempts: string[] = shot.cropped ? [shot.base64, frame.base64] : [frame.base64];
        for (const b64 of attempts) {
          R.visionCalls.push(Date.now());
          try {
            res = await api("/cars/gate-scan", {
              method: "POST",
              body: JSON.stringify({ imageBase64: b64, mediaType: "image/jpeg", branchId: defaultBranchId() }),
            });
            if (res && res.matched) break;                    // نجاح — خلصنا
            if (res && !res.incomplete && (res.letters || res.numbers)) break; // قراءة كاملة بس مش في الدور
            // ناقصة → جرّب الكادر الكامل
          } catch (e: any) {
            lastErr = String(e.message || "");
            if (lastErr.includes("غير مفعّلة")) { R.useLocalOnly = true; break; }
            if (lastErr.includes("لم أتمكن") || lastErr.includes("لم تُقرأ")) {
              res = { matched: false, incomplete: true, letters: "", numbers: "" };
              continue;                                        // اعتبرها ناقصة وجرّب الكادر الكامل
            }
            res = null;                                        // خطأ فعلي (شبكة/خادم)
          }
        }
      }
      if (!res && (R.useLocalOnly || !canVision)) {
        // احتياطي: القارئ المحلي (أبطأ وأقل دقة — بيشتغل لو الذكي متعطل)
        const local = await localOcr(frame.canvas);
        if (local.letters || local.numbers) {
          try {
            res = await api("/cars/gate-scan", {
              method: "POST",
              body: JSON.stringify({ letters: local.letters, numbers: local.numbers, branchId: defaultBranchId() }),
            });
          } catch (e: any) { lastErr = String(e.message || ""); res = null; }
        }
      }

      if (!res) {
        // ── لا يوجد فشل صامت: أول فشل بيتكتب في السجل بسببه ──
        if (R.attempts === 0) {
          liveAddLog(`⚠ فشلت محاولة القراءة${lastErr ? `: ${lastErr}` : " — جارِ الإعادة"}`, "err");
        }
        // محاولة تانية للحدث نفسه لو لسه في النطاق
        R.attempts += 1;
        if (R.attempts >= 3) {
          R.inMotion = false; R.attempts = 0;
          R.globalCooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
        }
        return;
      }

      const plateKey = `${res.letters}${res.numbers}`;
      const lastSeen = R.plateCooldown.get(plateKey) || 0;
      if (plateKey && Date.now() - lastSeen < PLATE_COOLDOWN_MS) {
        // نفس اللوحة لسه واقفة قدام الكاميرا — تجاهل صامت
        R.inMotion = false; R.attempts = 0;
        R.globalCooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
        return;
      }
      if (plateKey) R.plateCooldown.set(plateKey, Date.now());

      if (res.matched && !res.alreadyEntered && !res.lastInvoiceId) {
        // عميل جديد (مفيهوش فاتورة سابقة): إيقاف المسح وفتح بوابة اختيار الزيت الذاتية
        beep(true);
        liveAddLog(`✓ دخلت ${res.car.plate} — عميل جديد (⏱ ${((performance.now() - t0) / 1000).toFixed(1)}ث)`, "ok");
        load();
        R.paused = true;
        setLiveKioskCar(res.car.id);
      } else if (res.matched && !res.alreadyEntered) {
        beep(true);
        // التجهيز التلقائي بقى مركزي في الباك اند (بيشتغل مع أي طريقة دخول) — هنا بس بنعرض الحالة
        const walkInNote = res.isWalkIn ? "عميل مسجل — وصل من غير حجز" : "";
        const prepped = !!res.lastInvoiceItems?.length;
        showHit(`✓ تم تأكيد دخول ${res.car.plate}`,
                [walkInNote, prepped ? "الفاتورة جاهزة بنفس أصناف آخر مرة" : "سجّل الأصناف يدوياً من المبيعات"]
                  .filter(Boolean).join(" — "), "ok");
        liveAddLog(`✓ دخلت ${res.car.plate} — ${res.car.customer_name || "بدون عميل"}${res.isWalkIn ? " (عميل مسجل بدون حجز)" : ""}${prepped ? " (فاتورة مجهّزة ✓)" : ""} ⏱ ${((performance.now() - t0) / 1000).toFixed(1)}ث`, "ok");
        load();
      } else if (res.matched && res.alreadyEntered) {
        showHit(`اللوحة ${res.car.plate} داخلة بالفعل`, "", "warn");
        liveAddLog(`اللوحة ${res.car.plate} داخلة بالفعل`, "warn");
      } else if (res.incomplete) {
        // قراءة ناقصة (الحروف مش 3 كاملة): إعادة فورية بدون تهدئة — بحد أقصى 3 محاولات للمشهد
        R.attempts += 1;
        if (R.attempts < 3) {
          liveAddLog(`↻ قراءة ناقصة (${res.letters || "؟"} ${res.numbers || "؟"}) — محاولة فورية تانية`, "info");
          R.lastReadFrame = null;                       // المشهد يتقرأ تاني فوراً في التكة الجاية
          R.globalCooldownUntil = Date.now() + 250;     // ربع ثانية بس
          return;
        }
        liveAddLog(`⚠ اللوحة مش واضحة كفاية — قرّب الكاميرا أو حسّن الإضاءة`, "warn");
        R.attempts = 0;
      } else if (res.letters || res.numbers) {
        // لوحة أول مرة فعلاً (اتفحصت في الدور النشط + الجراج الدائم + كل التاريخ ومفيش أي تطابق)
        // → نفتح فورمة تسجيل سيارة جديدة تلقائياً بدل ما نستنى الموظف يدوس زر
        beep(false);
        showHit(`سيارة جديدة: ${res.letters} ${res.numbers}`, "بيانات العميل والسيارة — إدخال أول مرة", "warn");
        liveAddLog(`+ لوحة جديدة تماماً — فتح فورمة التسجيل تلقائياً: ${res.letters} ${res.numbers}`, "info");
        R.paused = true;
        setForm({ ...EMPTY, branchId: defaultBranchId(),
                  plateLetters: res.letters, plateNumbers: res.numbers });
        setPlateShot(null); setOcrMsg("");
        setModal({ mode: "create" });
      }
      R.inMotion = false; R.attempts = 0;
      R.globalCooldownUntil = Date.now() + GLOBAL_COOLDOWN_MS;
    } finally {
      R.busy = false;
      setLiveStatus("watching");
    }
  }

  // سحب لقطة من كاميرا IP وتجهيزها كمصدر إطارات
  async function pullIpFrame(): Promise<boolean> {
    const R = liveRefs.current;
    if (R.ipFetching) return false;
    R.ipFetching = true;
    try {
      const r = await api<{ image_base64: string }>("/cameras/fetch-snapshot", {
        method: "POST", body: JSON.stringify({ url: liveRefs.current.camUrl }),
      });
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res(); img.onerror = () => rej(new Error("لقطة غير صالحة"));
        img.src = `data:image/jpeg;base64,${r.image_base64}`;
      });
      const scale = Math.min(1, 1400 / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
      R.lastIpCanvas = cv;
      R.lastIpB64 = cv.toDataURL("image/jpeg", 0.88).split(",")[1];
      setIpFrame(`data:image/jpeg;base64,${R.lastIpB64}`);
      return true;
    } catch (e: any) {
      R.lastIpErr = e?.message || "تعذّر الوصول للكاميرا";
      liveAddLog(`⚠ الكاميرا مش بترد: ${e.message}`, "err");
      return false;
    } finally { R.ipFetching = false; }
  }

  async function liveTick() {
    const R = liveRefs.current;
    if (R.busy || R.paused) return;
    if (Date.now() < R.globalCooldownUntil) return;
    if (R.mode === "ip") {
      const ok = await pullIpFrame();
      if (!ok) return;
    }
    const frame = grabSmallFrame();
    if (!frame) return;
    const now = Date.now();
    // قراءة فورية: أول إطار، أو أي تغيّر عن آخر مشهد اتقرأ، أو مرور فترة الإعادة الإجبارية
    const changed = !R.lastReadFrame || frameDiff(frame, R.lastReadFrame) >= TRIGGER_T;
    if (changed || now - R.lastReadAt >= FORCE_RESCAN_MS) {
      liveReadAndMatch();
    }
  }

  function openLive() {
    setLiveErr(""); setLiveLog([]); setLiveHit(null); setLiveMode(null);
    try { setIpCamUrl(localStorage.getItem("z8_gate_cam_url") || ""); } catch { /* */ }
    // الكاميرات المسجلة في الإعدادات — مصدر موحد بدل رابط منفصل للبوابة
    api<typeof gateCams>("/cameras").then(setGateCams).catch(() => setGateCams([]));
    setLiveOpen(true); setLiveStatus("idle");
  }

  async function startLive(mode: "device" | "ip", urlOverride?: string) {
    setLiveErr(""); setLiveHit(null);
    setLiveMode(mode); setLiveStatus("starting");
    const R = liveRefs.current;
    R.mode = mode;
    R.camUrl = (urlOverride ?? ipCamUrl).trim();
    // ═══ حماية جذرية v2: أي رابط RTSP (محفوظ قديم / زر / يدوي) يُترجم فوراً
    //     لجسر الباك اند — مع جلب قائمة الكاميرات لحظياً لو لم تكن محمّلة ═══
    liveAddLog("نسخة الواجهة: bridge-v2", "info");
    if (R.camUrl.toLowerCase().startsWith("rtsp://")) {
      let cam = gateCams.find((c) => (c.rtsp_url || "").trim() === R.camUrl);
      if (!cam) {
        try {
          const list = await api<{ id: string; rtsp_url: string }[]>("/cameras");
          cam = (list || []).find((c) => (c.rtsp_url || "").trim() === R.camUrl) as any;
        } catch { /* هنتعامل تحت */ }
      }
      if (cam) {
        R.camUrl = `${window.location.origin}/api/cameras/public-live/${cam.id}.jpg`;
        localStorage.setItem("z8_gate_cam_url", R.camUrl);
        setIpCamUrl(R.camUrl);
        liveAddLog("↻ رابط RTSP اتحوّل تلقائياً لجسر الخادم", "info");
      } else {
        localStorage.removeItem("z8_gate_cam_url");
        setLiveStatus("error");
        setLiveErr("روابط RTSP لا تعمل من المتصفح — افتح «تغيير مصدر الكاميرا» واختر الكاميرا من القائمة الخضراء");
        return;
      }
    }
    try {
      if (mode === "device") {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("المتصفح مانع الكاميرا المستمرة على HTTP — استخدم وضع كاميرا IP أو فعّل استثناء HTTPS");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        R.stream = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
      } else {
        const u = R.camUrl;
        if (!u.startsWith("http")) throw new Error("اكتب رابط اللقطة — مثال: http://10.151.86.117:8080/shot.jpg");
        localStorage.setItem("z8_gate_cam_url", u);
        setIpCamUrl(u);
        const ok = await pullIpFrame();
        if (!ok) throw new Error(R.lastIpErr || "مقدرتش أوصل للكاميرا — تأكد إن IP Webcam شغال والرابط صحيح");
      }
      // منع قفل الشاشة (مدعوم في كروم الحديث)
      try { R.wakeLock = await (navigator as any).wakeLock?.request("screen"); } catch { /* اختياري */ }
      R.prevFrame = null; R.inMotion = false; R.busy = false; R.lastReadFrame = null; R.lastReadAt = 0;
      R.globalCooldownUntil = 0; R.plateCooldown.clear(); R.visionCalls = []; R.useLocalOnly = false;
      // بصمة نسخة الخادم — لو قديمة يبقى الباك اند شغال بكود قديم ولازم إعادة تشغيل
      api<{ build?: string }>("/health").then((h) => {
        if (h.build && h.build >= "gate-v3") liveAddLog(`✓ الخادم محدث (${h.build})`, "info");
        else liveAddLog("⚠ الباك اند شغال بنسخة قديمة! اقفل نافذته وشغّل START-Z8.bat", "err");
      }).catch(() => {});
      R.timer = setInterval(liveTick, mode === "ip" ? TICK_IP_MS : TICK_MS);
      setLiveStatus("watching");
      liveAddLog(mode === "ip" ? "👁 المراقبة بدأت من كاميرا IP" : "👁 المراقبة بدأت — وجّه الكاميرا على مكان الدخول", "info");
    } catch (e: any) {
      setLiveStatus("error");
      setLiveErr(e?.message || "تعذّر فتح الكاميرا");
    }
  }

  function stopLive() {
    const R = liveRefs.current;
    clearInterval(R.timer);
    clearTimeout(R.hitTimer);
    R.stream?.getTracks().forEach((t) => t.stop());
    R.stream = null;
    try { R.wakeLock?.release(); } catch { /* */ }
    R.mode = null; R.lastIpCanvas = null; R.lastIpB64 = ""; R.paused = false;
    setLiveOpen(false); setLiveStatus("idle"); setLiveHit(null); setLiveKioskCar(null);
  }

  // تنظيف عند مغادرة الصفحة
  useEffect(() => () => { stopLive(); }, []); // eslint-disable-line

  // ══════════ ملصق باركود الحجز الذاتي ══════════
  function printBookingQr() {
    const url = `${window.location.origin}/q/${qrBranch}`;
    const bName = branches.find((b) => b.id === qrBranch)?.name || "";
    const w = window.open("", "_blank", "width=520,height=720");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="rtl"><head><meta charset="utf-8"><title>باركود الحجز</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
      <style>
        body{font-family:'IBM Plex Sans Arabic',system-ui;margin:0;padding:28px;text-align:center;color:#0B2B30}
        .card{border:3px solid #0C5E66;border-radius:24px;padding:28px 20px}
        h1{font-size:26px;margin:0 0 4px;color:#0C5E66}
        h2{font-size:16px;margin:0 0 18px;color:#555}
        #qrcode{display:flex;justify-content:center;margin:14px 0}
        .steps{text-align:right;font-size:14.5px;line-height:2;margin:14px auto 0;max-width:330px;font-weight:700}
        .url{font-size:11px;color:#888;direction:ltr;margin-top:12px;word-break:break-all}
      </style></head><body>
      <div class="card">
        <h1>🚗 احجز دورك قبل ما توصل</h1>
        <h2>فرع ${bName}</h2>
        <div id="qrcode"></div>
        <div class="steps">
          ١- امسح الباركود بكاميرا جوالك 📷<br>
          ٢- سجّل اسمك ورقم لوحتك<br>
          ٣- تابع دورك مباشرة من جوالك<br>
          ٤- عند وصولك يتم دخولك <b>تلقائياً</b> ✨
        </div>
        <div class="url">${url}</div>
      </div>
      <script>
        new QRCode(document.getElementById("qrcode"), { text: "${url}", width: 220, height: 220, correctLevel: QRCode.CorrectLevel.M });
        setTimeout(() => window.print(), 600);
      <\/script></body></html>`);
    w.document.close();
  }

  // ══════════ قراءة اللوحة السعودية: الصف السفلي فقط (أرقام غربية + حروف لاتينية) ══════════
  // المستوى 1: Claude Vision عبر الباك اند (الدقة القصوى) — المستوى 2: قارئ محلي محسّن كاحتياطي

  // الحروف المسموحة رسمياً على اللوحات السعودية
  const PLATE_LETTERS = "ABDEGHJKLNRSTUVXZ";

  // تجهيز الصورة: تصغير + تدرج رمادي + رفع تباين — بيحسّن القراءة في الطريقين
  function preprocess(file: File): Promise<{ base64: string; canvas: HTMLCanvasElement }> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1400 / img.width);
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale);
        cv.height = Math.round(img.height * scale);
        const ctx = cv.getContext("2d")!;
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        const d = ctx.getImageData(0, 0, cv.width, cv.height);
        const px = d.data;
        // تدرج رمادي + شد التباين
        let min = 255, max = 0;
        for (let i = 0; i < px.length; i += 4) {
          const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
          px[i] = px[i + 1] = px[i + 2] = g;
          if (g < min) min = g; if (g > max) max = g;
        }
        const range = Math.max(1, max - min);
        for (let i = 0; i < px.length; i += 4) {
          const v = ((px[i] - min) / range) * 255;
          px[i] = px[i + 1] = px[i + 2] = v;
        }
        ctx.putImageData(d, 0, 0);
        resolve({ base64: cv.toDataURL("image/jpeg", 0.9).split(",")[1], canvas: cv });
      };
      img.onerror = () => reject(new Error("تعذّر فتح الصورة"));
      img.src = URL.createObjectURL(file);
    });
  }

  // تحليل نص القارئ المحلي: استخراج 3 حروف مسموحة + 1-4 أرقام مع تصحيح الالتباسات
  function parsePlateText(text: string): { letters: string; numbers: string } {
    const up = text.toUpperCase();
    // أرقام: أطول تتابع 1-4 مع تصحيح O→0 و I→1
    const digitsRuns = (up.replace(/O/g, "0").replace(/I/g, "1").match(/\d{1,4}/g) || [])
      .sort((a, b) => b.length - a.length);
    const numbers = digitsRuns[0] || "";
    // حروف: أول تتابع 3 حروف كلها من المجموعة المسموحة
    let letters = "";
    const runs = up.match(/[A-Z]{3,}/g) || [];
    for (const r of runs) {
      for (let i = 0; i + 3 <= r.length; i++) {
        const c = r.slice(i, i + 3);
        if ([...c].every((ch) => PLATE_LETTERS.includes(ch))) { letters = c; break; }
      }
      if (letters) break;
    }
    return { letters, numbers };
  }

  function loadTesseract(): Promise<any> {
    return new Promise((resolve, reject) => {
      const w = window as any;
      if (w.Tesseract) return resolve(w.Tesseract);
      const sc = document.createElement("script");
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js";
      sc.onload = () => resolve((window as any).Tesseract);
      sc.onerror = () => reject(new Error("تعذّر تحميل القارئ المحلي — تأكد من الإنترنت"));
      document.head.appendChild(sc);
    });
  }

  async function localOcr(canvas: HTMLCanvasElement): Promise<{ letters: string; numbers: string }> {
    const T = await loadTesseract();
    const worker = await T.createWorker("eng");
    try {
      await worker.setParameters({
        tessedit_char_whitelist: PLATE_LETTERS + "0123456789OI",
      });
      // محاولة 1: النص السفلي بس (مكان الأرقام والحروف اللاتينية في اللوحة السعودية)
      const half = document.createElement("canvas");
      half.width = canvas.width; half.height = Math.round(canvas.height / 2);
      half.getContext("2d")!.drawImage(canvas, 0, canvas.height - half.height, canvas.width, half.height, 0, 0, half.width, half.height);
      let r = await worker.recognize(half);
      let parsed = parsePlateText(r?.data?.text || "");
      if (!parsed.letters || !parsed.numbers) {
        // محاولة 2: الصورة كاملة
        r = await worker.recognize(canvas);
        const full = parsePlateText(r?.data?.text || "");
        parsed = { letters: parsed.letters || full.letters, numbers: parsed.numbers || full.numbers };
      }
      return parsed;
    } finally { await worker.terminate(); }
  }

  async function onPlatePhoto(file: File) {
    setPlateShot(URL.createObjectURL(file));
    setOcrBusy(true); setOcrMsg("جارِ قراءة اللوحة...");
    try {
      const { base64, canvas } = await preprocess(file);
      let letters = "", numbers = "", source = "";

      // المستوى 1: الرؤية الذكية (Claude Vision)
      try {
        const r = await api<{ letters: string; numbers: string; confidence: number }>(
          "/cars/plate-ocr", { method: "POST", body: JSON.stringify({ imageBase64: base64, mediaType: "image/jpeg" }) });
        letters = r.letters; numbers = r.numbers;
        source = `قراءة ذكية${r.confidence ? ` — ثقة ${Math.round(r.confidence * 100)}%` : ""}`;
      } catch (smartErr: any) {
        // المستوى 2: القارئ المحلي المحسّن — مع إظهار سبب تعطّل الذكي
        const reason = smartErr?.message || "غير معروف";
        setOcrMsg(`القراءة الذكية متعطلة (${reason}) — جارِ القارئ المحلي...`);
        const r = await localOcr(canvas);
        letters = r.letters; numbers = r.numbers;
        source = `قارئ محلي (الذكي متعطل: ${reason}) — راجعها`;
      }

      if (letters || numbers) {
        setForm((f) => ({
          ...f,
          plateLetters: letters || f.plateLetters,
          plateNumbers: numbers || f.plateNumbers,
        }));
        setOcrMsg(`✓ ${source}: ${letters || "؟"} ${numbers || "؟"}`);
        setTimeout(tryLookup, 100);
      } else {
        setOcrMsg("مقدرتش أقرأ اللوحة — قرّب الكاميرا على اللوحة بس وصوّر تاني");
      }
    } catch (e: any) {
      setOcrMsg(e.message || "فشلت قراءة الصورة — اكتب اللوحة يدوياً");
    } finally { setOcrBusy(false); }
  }

  // بحث تلقائي عن عميل/سيارة سابقة برقم اللوحة أو الجوال أثناء التسجيل
  async function tryLookup() {
    const plate = [form.plateLetters, form.plateNumbers].filter(Boolean).join(" ").trim();
    if (!plate && !form.customerPhone) return;
    setLookupBusy(true);
    try {
      const q = new URLSearchParams();
      if (plate) q.set("plate", plate);
      if (form.customerPhone) q.set("phone", form.customerPhone);
      const result = await api<{ customer: any; vehicle: any; lastOdometer: number | null } | null>(
        `/cars/lookup?${q.toString()}`
      );
      if (result) {
        setForm((f) => ({
          ...f,
          customerName: result.customer?.name || f.customerName,
          customerPhone: result.customer?.phone || f.customerPhone,
          customerId: result.customer?.id || null,
          brand: result.vehicle?.brand || f.brand,
          modelYear: result.vehicle?.modelYear || f.modelYear,
          color: result.vehicle?.color || f.color,
          chassisNumber: result.vehicle?.chassisNumber || f.chassisNumber,
          odometerPrevious: result.lastOdometer != null ? String(result.lastOdometer) : f.odometerPrevious,
        }));
      }
    } catch { /* بحث اختياري — تجاهل الفشل */ }
    finally { setLookupBusy(false); }
  }

  // ── قواعد التسجيل الإلزامية — رسالة عربية فورية قبل أي إرسال ──
  function validateCreate(): string {
    if (!form.customerName.trim()) return "اسم العميل إجباري";
    if (!/^05\d{8}$/.test(form.customerPhone.replace(/\D/g, "")))
      return "رقم الجوال لازم يبدأ بـ05 ويتكون من 10 أرقام بالظبط";
    if (!/^[A-Z]{3}$/.test(form.plateLetters.trim().toUpperCase()))
      return "حروف اللوحة: 3 حروف إنجليزي كابيتال بالظبط";
    if (!/^\d{1,4}$/.test(form.plateNumbers.trim()))
      return "أرقام اللوحة: من 1 إلى 4 أرقام";
    if (!form.brand.trim()) return "الماركة إجبارية";
    if (!form.name.trim()) return "الموديل إجباري";
    if (!form.modelYear.trim()) return "سنة الصنع إجبارية";
    if (!form.color.trim()) return "اللون إجباري";
    if (form.odometerCurrent === "" || Number(form.odometerCurrent) < 0)
      return "ممشى السيارة الحالي إجباري";
    if (!/^[A-Z0-9]{17}$/.test(form.chassisNumber.trim().toUpperCase().replace(/\s/g, "")))
      return "رقم الهيكل لازم يتكون من 17 حرف/رقم بالظبط";
    return "";
  }

  async function save() {
    setErr(""); setBusy(true);
    try {
      if (modal?.mode === "create") {
        const v = validateCreate();
        if (v) { setErr(v); setBusy(false); return; }
        const body = {
          ...form,
          plateLetters: form.plateLetters.trim().toUpperCase(),
          plateNumbers: form.plateNumbers.replace(/\D/g, ""),
          customerPhone: form.customerPhone.replace(/\D/g, ""),
          chassisNumber: form.chassisNumber.trim().toUpperCase().replace(/\s/g, ""),
          odometerCurrent: form.odometerCurrent === "" ? null : Number(form.odometerCurrent),
          odometerPrevious: form.odometerPrevious === "" ? null : Number(form.odometerPrevious),
        };
        const created = await api<Car>("/cars", { method: "POST", body: JSON.stringify(body) });
        setModal(null);
        await load();
        printTicket(created); // تذكرة فورية عند التسجيل — نفس سلوك النظام القديم
        // لو الفورمة دي اتفتحت من البوابة الحية (لوحة جديدة تماماً)، استأنف المراقبة
        if (liveMode) {
          liveRefs.current.paused = false;
          liveRefs.current.lastReadFrame = null;
          liveAddLog(`✓ تسجّلت ${created.plate} — استُؤنفت المراقبة`, "ok");
        }
      } else if (modal?.mode === "edit") {
        const body = {
          plateLetters: form.plateLetters, plateNumbers: form.plateNumbers,
          name: form.name, brand: form.brand, modelYear: form.modelYear, color: form.color,
          chassisNumber: form.chassisNumber, customerName: form.customerName,
          customerPhone: form.customerPhone,
          odometerCurrent: form.odometerCurrent === "" ? null : Number(form.odometerCurrent),
          notes: form.notes,
        };
        await api(`/cars/${modal.car.id}`, { method: "PUT", body: JSON.stringify(body) });
        setModal(null);
        await load();
      }
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function confirmEntry(c: Car) {
    try { await api(`/cars/${c.id}/confirm-entry`, { method: "POST" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }
  async function confirmExit(c: Car) {
    try { await api(`/cars/${c.id}/exit`, { method: "POST" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }
  async function remove(c: Car) {
    if (!await appConfirm(`حذف سيارة اللوحة «${c.plate || "—"}»؟`)) return;
    try { await api(`/cars/${c.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }

  // ══════════════════ نقاط التشييك ══════════════════

  async function openChecklist(c: Car) {
    setCkCar(c); setCkErr(""); setCkBusy(true);
    try {
      const r = await api<{ items: CkItem[] }>(`/cars/${c.id}/checklist`);
      const saved = new Map((r.items || []).map((i) => [i.key, i]));
      setCkItems(CHECKPOINTS.map((p) => saved.get(p.key) ?? ({ ...p, status: "pending", note: null })));
    } catch (e: any) { setCkErr(e.message); setCkItems(CHECKPOINTS.map((p) => ({ ...p, status: "pending" as CkStatus, note: null }))); }
    finally { setCkBusy(false); }
  }
  function setCk(key: string, patch: Partial<CkItem>, instantSave = false) {
    setCkItems((prev) => {
      const next = prev.map((i) => i.key === key ? { ...i, ...patch } : i);
      if (instantSave && ckCar) {
        // حفظ فوري صامت — الكارت الحي في اللوحة يتحدّث فوراً لكل الشاشات
        api(`/cars/${ckCar.id}/checklist`, { method: "PUT", body: JSON.stringify({ items: next }) })
          .then(() => setRows((rs) => rs.map((r) => r.id === ckCar.id ? { ...r, checklist: next } : r)))
          .catch(() => { /* الحفظ اليدوي بالزرار موجود احتياطي */ });
      }
      return next;
    });
  }
  const [aiCamBusy, setAiCamBusy] = useState(false);

  // ══════════ تنبيهات المشرف الآلي ══════════
  const [alerts, setAlerts] = useState<{ id: string; plate: string | null; station: string | null; message: string; at: string }[]>([]);
  useEffect(() => {
    const pull = () => api<typeof alerts>("/cars/alerts").then(setAlerts).catch(() => {});
    pull();
    const t = setInterval(pull, 20000);
    return () => clearInterval(t);
  }, []);
  async function dismissAlert(id: string, isFalse = false) {
    setAlerts((a) => a.filter((x) => x.id !== id));
    api(`/cars/alerts/${id}/seen?isFalse=${isFalse}`, { method: "POST" }).catch(() => {});
  }

  // ══════════ إسناد العمل: مين اشتغل على السيارة ══════════
  const [lineWorkers, setLineWorkers] = useState<{ id: string; name: string }[]>([]);
  const [workLog, setWorkLog] = useState<{ employee_id: string | null; employee_name: string; at: string }[]>([]);
  const [workBusy, setWorkBusy] = useState(false);
  useEffect(() => {
    api<typeof lineWorkers>("/cars/line-workers").then(setLineWorkers).catch(() => {});
  }, []);
  useEffect(() => {
    if (ckCar) api<{ items: typeof workLog }>(`/cars/${ckCar.id}/work-log`)
      .then((r) => setWorkLog(r.items)).catch(() => setWorkLog([]));
  }, [ckCar?.id]);
  async function tagWorker(w: { id: string | null; name: string }) {
    if (!ckCar) return;
    setWorkBusy(true);
    try {
      const r = await api<{ items: typeof workLog }>(`/cars/${ckCar.id}/work-log`, {
        method: "POST", body: JSON.stringify({ employeeId: w.id, employeeName: w.name }),
      });
      setWorkLog(r.items);
    } catch (e: any) { setCkErr(e.message); }
    finally { setWorkBusy(false); }
  }
  // ══════════ فريق العمل — مراجعة من اشتغل على السيارة فيما بعد ══════════
  type TeamData = {
    plate: string | null; customerName: string | null; car: string; station: string | null;
    filler: string | null; fitter1: string | null; fitter2: string | null; checker: string | null;
    preparedBy: string | null; preparedAt: string | null; enteredAt: string | null; exitedAt: string | null;
    log: { employee_id: string | null; employee_name: string; station: string | null; at: string }[];
  };
  const [teamCar, setTeamCar] = useState<Car | null>(null);
  const [team, setTeam] = useState<TeamData | null>(null);
  const [teamErr, setTeamErr] = useState("");
  useEffect(() => {
    if (!teamCar) { setTeam(null); return; }
    setTeamErr("");
    api<TeamData>(`/cars/${teamCar.id}/team`)
      .then(setTeam)
      .catch((e) => setTeamErr(e instanceof Error ? e.message : "تعذر التحميل"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamCar?.id]);
  const dtFmt = (x: string | null) => x
    ? new Date(x).toLocaleString("ar", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

  async function aiAnalyzeChecklist() {
    if (!ckCar) return;
    setCkErr(""); setAiCamBusy(true);
    try {
      const st = parseInt(String(ckCar.station || "").replace(/\D/g, "")) || 1;
      const cams = await api<{ id: string; name: string }[]>(
        `/cameras/for-station?branchId=${ckCar.branch_id}&station=${st}`);
      if (!cams.length) throw new Error(`لا كاميرا مسجلة للمحطة ${st} — أضفها من الإعدادات ← الكاميرات`);
      const r = await api<{ camera: string; items: { key: string; status: CkStatus; note?: string | null; confidence?: number }[] }>(
        `/cameras/${cams[0].id}/analyze-stage?stage=${st}`, { method: "POST" });
      let applied = 0;
      for (const it of r.items) {
        if (it.status && it.status !== "pending") {
          setCk(it.key, { status: it.status, note: it.note || null }, true);
          applied++;
        }
      }
      setCkErr(applied ? "" : "الكاميرا مش شايفة دليل واضح على أي خطوة حالياً — جرّب بعد شوية");
    } catch (e: any) { setCkErr(e.message); }
    finally { setAiCamBusy(false); }
  }

  async function saveChecklist(printAfter = false) {
    if (!ckCar) return;
    setCkErr(""); setCkBusy(true);
    try {
      await api(`/cars/${ckCar.id}/checklist`, { method: "PUT", body: JSON.stringify({ items: ckItems }) });
      if (printAfter) printTicket(ckCar, ckItems);
      setCkCar(null);
    } catch (e: any) { setCkErr(e.message); }
    finally { setCkBusy(false); }
  }

  // ══════════════════ طباعة التذكرة ══════════════════

  async function printTicket(c: Car, checklist?: CkItem[]) {
    const { printReceipt } = await import("@/lib/print"); // تحميل كسول
    const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const ckDone = (checklist || []).filter((i) => i.status !== "pending");
    const ckRows = STAGES.map((st) => {
      const items = ckDone.filter((i) => stageOf(i.key) === st.id);
      if (!items.length) return "";
      return `<div style="font-weight:800;font-size:10.5px;margin-top:4px">${esc(st.title)}</div>` +
        items.map((i) =>
          `<div class="row"><span>${esc(i.label)}</span><b>${esc(CK_LABEL[i.status])}${i.note ? ` — ${esc(i.note)}` : ""}</b></div>`
        ).join("");
    }).join("");
    printReceipt(`تذكرة ${c.plate || ""}`, `
      <div style="text-align:center;font-weight:800;margin:4px 0">تذكرة خدمة</div>
      <div class="big tnum">${esc(c.plate || "بدون لوحة")}</div>
      <div class="dash"></div>
      <div class="row"><span>العميل</span><b>${esc(c.customer_name || "—")}</b></div>
      <div class="row"><span>الجوال</span><b class="tnum">${esc(c.customer_phone || "—")}</b></div>
      <div class="row"><span>السيارة</span><b>${esc([c.brand, c.name, c.model_year].filter(Boolean).join(" ") || "—")}</b></div>
      ${c.color ? `<div class="row"><span>اللون</span><b>${esc(c.color)}</b></div>` : ""}
      ${c.odometer_current ? `<div class="row"><span>العداد الحالي</span><b class="tnum">${esc(c.odometer_current)}</b></div>` : ""}
      ${c.odometer_previous ? `<div class="row"><span>العداد السابق</span><b class="tnum">${esc(c.odometer_previous)}</b></div>` : ""}
      <div class="row"><span>وقت التسجيل</span><b class="tnum">${esc(new Date(c.created_at).toLocaleString("ar-SA-u-nu-latn"))}</b></div>
      ${ckRows ? `<div class="dash"></div><div style="font-weight:800;margin:2px 0">نقاط التشييك</div>${ckRows}` : ""}
      <div class="perfo">✂ - - - - - - - - - - - - - - - - - - ✂</div>
      <div style="text-align:center">
        <div class="big tnum" style="font-size:18px">${esc(c.plate || "—")}</div>
        <div style="font-size:10px">${esc(c.customer_name || "")} — احتفظ بهذا الجزء</div>
      </div>
    `);
  }

  const branchName = useMemo(() => {
    const m: Record<string, string> = {};
    branches.forEach((b) => { m[b.id] = b.name; });
    return m;
  }, [branches]);

  const columns: Column<Car>[] = [];  // (استُبدل الجدول العام بجدول مصمم مخصص أدناه)

  /** حبة الحالة الموحدة — نفس المنطق القديم بتصميم الحبوب الملونة */
  function renderStatus(c: Car) {
    const s = carStatus(c);
    if (s === "done") return <StatusPill tone="neutral" icon="check_circle">خرجت — {timeFmt(c.exited_at)}</StatusPill>;
    if (s === "in_service") {
      const p = carProgress(c);
      if (p.ready) return <StatusPill tone="success" icon="task_alt">جاهزة — {elapsed(c.entered_at, now)}</StatusPill>;
      return <StatusPill tone="primary" icon="build" pulse={p.working}>
        {p.working ? `جاري التنفيذ ${p.finished}/${p.total}` : `في الخدمة — ${elapsed(c.entered_at, now)}`}
      </StatusPill>;
    }
    return <StatusPill tone="warning" icon="schedule" pulse>انتظار</StatusPill>;
  }

  /** مدة الانتظار كعمود مستقل */
  function renderWait(c: Car) {
    const s = carStatus(c);
    if (s === "done") return <span className="tnum text-[12px] text-slate-400">—</span>;
    const from = s === "in_service" ? c.entered_at : c.created_at;
    return <span className="tnum text-[12.5px] font-bold text-slate-600">{elapsed(from, now)}</span>;
  }

  /** أزرار الإجراءات — أيقونات بتلميحات، الأساسي مميز باللون */
  function renderActions(c: Car) {
    const s = carStatus(c);
    return (
      <div className="flex justify-end gap-1">
        {canEnter && s === "queued" && <IconBtn tone="primary" icon="login" label="تأكيد الدخول" onClick={() => confirmEntry(c)} />}
        {canExit && s === "in_service" && <IconBtn tone="primary" icon="logout" label="تسجيل الخروج" onClick={() => confirmExit(c)} />}
        {canChecklist && s !== "done" && <IconBtn icon="checklist" label="التشييك" onClick={() => openChecklist(c)} />}
        <IconBtn icon="groups" label="فريق العمل" onClick={() => setTeamCar(c)} />
        <IconBtn icon="confirmation_number" label="طباعة التذكرة" onClick={() => printTicket(c)} />
        {canEdit && <IconBtn icon="edit" label="تعديل البيانات" onClick={() => openEdit(c)} />}
        {canDelete && <IconBtn tone="danger" icon="delete" label="حذف" onClick={() => remove(c)} />}
      </div>
    );
  }

  return (
    <div className="min-h-screen space-y-5 pb-24" style={{ background: UI.bg }}>

      {/* ═══════ الهيدر اللاصق: العنوان + بوابات الدخول ═══════ */}
      <div className="sticky top-0 z-20 -mx-4 border-b bg-[#F8FAFC]/85 px-4 py-3 backdrop-blur-md"
           style={{ borderColor: UI.border }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-[22px] font-black text-slate-900">خط الخدمة</h1>
            <p className="text-[11.5px] font-medium text-slate-500">إدارة طابور السيارات — من الحجز للخروج</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setQrOpen(true); setQrBranch(branches[0]?.id || ""); }}
                    className="flex items-center gap-1.5 rounded-xl border bg-white px-3.5 py-2 text-[12.5px] font-bold text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#1E3A8A]"
                    style={{ borderColor: UI.border }}>
              <MIcon name="qr_code_2" className="!text-[17px]" /> باركود الحجز
            </button>
            {/* 🎛 البوابة الذكية — لوحة بمفتاح مستقل لكل كاميرا */}
            <div className="relative">
              <button onClick={() => setGateSwPanel((v) => !v)}
                      className="flex items-center gap-2 rounded-xl border bg-white px-3.5 py-2 shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md"
                      style={{ borderColor: UI.border }}>
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${gateSwOn && gateSwRunning ? "animate-pulse" : ""}`}
                      style={{ background: gateSwOn === null ? "#CBD5E1" : gateSwOn ? UI.success : "#DC2626" }} />
                <span className="text-[12.5px] font-bold text-slate-700">البوابة الذكية</span>
                <MIcon name={gateSwPanel ? "expand_less" : "expand_more"} className="!text-[17px]" />
              </button>

              {gateSwPanel && (
                <div className="absolute left-0 top-full z-30 mt-2 w-80 rounded-2xl border bg-white p-3 shadow-xl"
                     style={{ borderColor: UI.border }}>
                  {/* المفتاح الرئيسي */}
                  <div className="flex items-center justify-between rounded-xl px-3 py-2.5"
                       style={{ background: "#F6F8FA" }}>
                    <span className="text-[12.5px] font-black text-slate-800">المراقب التلقائي (الكل)</span>
                    <button onClick={toggleGateSw} disabled={gateSwOn === null || gateSwBusy}
                            className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
                            style={{ background: gateSwOn ? UI.success : "#CBD5E1" }}>
                      <span className="absolute h-5 w-5 rounded-full bg-white shadow transition-all"
                            style={{ right: gateSwOn ? "2px" : "22px" }} />
                    </button>
                  </div>

                  {/* مفتاح مستقل لكل كاميرا + مؤشر حي */}
                  <div className="mt-2 space-y-1.5">
                    {gateCamsStatus.length === 0 && (
                      <p className="py-2 text-center text-[11.5px] font-bold text-slate-400">جارِ تحميل الكاميرات...</p>
                    )}
                    {gateCamsStatus.map((c) => (
                      <div key={c.id} className="flex items-center justify-between rounded-xl border px-3 py-2"
                           style={{ borderColor: UI.border }}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="inline-block h-2 w-2 shrink-0 rounded-full"
                                style={{ background: !c.is_active ? "#CBD5E1" : c.ok === null ? "#F59E0B" : c.ok ? UI.success : "#DC2626" }}
                                title={!c.is_active ? "موقوفة" : c.ok === null ? "بانتظار أول التقاط" : c.ok ? "تلتقط بنجاح" : "لا تستجيب"} />
                          <span className="truncate text-[12px] font-bold text-slate-700">{c.name}</span>
                          {c.last && <span className="tnum shrink-0 text-[10px] text-slate-400">{c.last}</span>}
                        </span>
                        <button onClick={() => toggleCam(c.id, !c.is_active)}
                                className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors"
                                style={{ background: c.is_active ? UI.success : "#CBD5E1" }}>
                          <span className="absolute h-5 w-5 rounded-full bg-white shadow transition-all"
                                style={{ right: c.is_active ? "2px" : "22px" }} />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="mt-2 text-center text-[10px] font-bold text-slate-400">
                    🟢 تلتقط · 🔴 لا تستجيب · 🟠 بانتظار أول التقاط · ⚪ موقوفة
                  </p>
                </div>
              )}
            </div>
            <button onClick={() => { setGateOpen(true); setGateResult(null); setGateMsg(""); }}
                    className="flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[12.5px] font-bold text-white shadow-sm transition-all duration-200 hover:-translate-y-px hover:brightness-110"
                    style={{ background: UI.primary }}>
              <MIcon name="photo_camera" className="!text-[17px] text-white" /> لقطة يدوية
            </button>
          </div>
        </div>
      </div>

      <ErrorNote msg={pageErr} />

      {/* ═══════ بطاقات الإحصائيات ═══════ */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard icon="schedule" value={queued.length} title="في الانتظار"
                  color="#B45309" tint="#FEF3C7" onClick={() => setStatusFilter("queued")} />
        <StatCard icon="build" value={inService.length} title="في الخدمة"
                  color={UI.primary} tint="#DBEAFE" onClick={() => setStatusFilter("in_service")} />
        <StatCard icon="task_alt" value={doneToday.length} title="اكتملت اليوم"
                  color="#15803D" tint="#DCFCE7" onClick={() => setStatusFilter("done_today")} />
        <StatCard icon="timer" value={avgWaitMin === null ? "—" : `${avgWaitMin} د`} title="متوسط الانتظار"
                  hint={queued.length ? "للسيارات الواقفة الآن" : "الطابور فارغ"}
                  color="#7C3AED" tint="#EDE9FE" />
      </div>

      {/* ═══════ لوحتا المحطات الحية (انتظار / خدمة) ═══════ */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: UI.border }}>
          <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: UI.border }}>
            <h2 className="flex items-center gap-2 text-[13px] font-extrabold text-slate-800">
              <MIcon name="schedule" className="!text-[17px] text-amber-600" /> في الانتظار
            </h2>
            <span className="tnum rounded-full bg-amber-100 px-2.5 py-0.5 text-[12px] font-black text-amber-700">{queued.length}</span>
          </div>
          <div className="max-h-56 divide-y overflow-y-auto" style={{ borderColor: UI.border }}>
            {queued.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-slate-400">
                <MIcon name="coffee" className="!text-[26px]" />
                <p className="text-[12px] font-bold">لا توجد سيارات في الانتظار</p>
              </div>
            ) : queued.map((c) => (
              <div key={c.id} className="flex items-center justify-between px-5 py-2.5 text-[12.5px] transition-colors duration-200 hover:bg-slate-50">
                <div className="min-w-0">
                  <span className="tnum font-extrabold text-slate-900">{c.plate || "بدون لوحة"}</span>
                  <span className="mr-2 text-slate-500">{c.customer_name}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="tnum text-[11px] font-bold text-amber-600">{elapsed(c.created_at, now)}</span>
                  {canEnter && <IconBtn tone="primary" icon="login" label="دخول" onClick={() => confirmEntry(c)} />}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: UI.border }}>
          <div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: UI.border }}>
            <h2 className="flex items-center gap-2 text-[13px] font-extrabold text-slate-800">
              <span style={{ color: UI.primary }}><MIcon name="build" className="!text-[17px]" /></span> في الخدمة
            </h2>
            <span className="tnum rounded-full px-2.5 py-0.5 text-[12px] font-black" style={{ background: "#DBEAFE", color: UI.primary }}>{inService.length}</span>
          </div>
          <div className="max-h-56 divide-y overflow-y-auto" style={{ borderColor: UI.border }}>
            {inService.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-slate-400">
                <MIcon name="build" className="!text-[26px]" />
                <p className="text-[12px] font-bold">لا توجد سيارات في الخدمة</p>
              </div>
            ) : inService.map((c) => {
              const p = carProgress(c);
              return (
                <div key={c.id} className="px-5 py-2.5 text-[12.5px] transition-colors duration-200 hover:bg-slate-50">
                  <div className="flex items-center justify-between">
                    <div className="min-w-0">
                      <span className="tnum font-extrabold text-slate-900">{c.plate || "بدون لوحة"}</span>
                      <span className="mr-2 text-slate-500">{c.customer_name}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <span className="tnum text-[11px] font-bold" style={{ color: UI.primary }}>{elapsed(c.entered_at, now)}</span>
                      {canChecklist && <IconBtn icon="checklist" label="التشييك" onClick={() => openChecklist(c)} />}
                      {canExit && <IconBtn tone="primary" icon="logout" label="خروج" onClick={() => confirmExit(c)} />}
                    </div>
                  </div>
                  <div className="mt-1.5 flex items-center gap-2">
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full transition-all duration-500"
                           style={{ width: `${p.pct}%`, background: p.ready ? UI.success : UI.primary }} />
                    </div>
                    <span className="tnum shrink-0 text-[10.5px] font-bold text-slate-500">{p.finished}/{p.total}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ═══════ شريط الأدوات: بحث + فلاتر + تصدير ═══════ */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border bg-white p-3 shadow-sm" style={{ borderColor: UI.border }}>
        <div className="relative min-w-[220px] flex-1">
          <MIcon name="search" className="absolute right-3 top-1/2 -translate-y-1/2 !text-[18px] text-slate-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
                 placeholder="بحث باللوحة أو العميل أو الجوال…"
                 className="w-full rounded-xl border bg-slate-50 py-2 pl-3 pr-10 text-[13px] font-medium outline-none transition-all duration-200 focus:border-[#1E3A8A] focus:bg-white focus:ring-2 focus:ring-[#1E3A8A]/15"
                 style={{ borderColor: UI.border }} />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                className="rounded-xl border bg-white px-3 py-2 text-[12.5px] font-bold text-slate-700 outline-none transition focus:border-[#1E3A8A]"
                style={{ borderColor: UI.border }}>
          <option value="active">النشطة (لم تغادر بعد)</option>
          <option value="queued">في الانتظار</option>
          <option value="in_service">في الخدمة</option>
          <option value="done_today">اكتملت اليوم</option>
          <option value="all">الكل</option>
        </select>
        {branches.length > 1 && (
          <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}
                  className="rounded-xl border bg-white px-3 py-2 text-[12.5px] font-bold text-slate-700 outline-none transition focus:border-[#1E3A8A]"
                  style={{ borderColor: UI.border }}>
            <option value="">كل الفروع</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {(q || statusFilter !== "active" || branchFilter) && (
          <button onClick={() => { setQ(""); setStatusFilter("active"); setBranchFilter(""); }}
                  className="flex items-center gap-1 rounded-xl px-3 py-2 text-[12px] font-bold text-slate-500 transition hover:bg-slate-100 hover:text-slate-800">
            <MIcon name="filter_alt_off" className="!text-[16px]" /> مسح الفلاتر
          </button>
        )}
        <button onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-xl border bg-white px-3.5 py-2 text-[12.5px] font-bold text-slate-700 shadow-sm transition-all duration-200 hover:-translate-y-px hover:shadow-md"
                style={{ borderColor: UI.border }}>
          <MIcon name="download" className="!text-[16px]" /> تصدير
        </button>
      </div>

      {/* ═══════ الجدول الرئيسي — سطح مكتب ═══════ */}
      <div className="hidden overflow-hidden rounded-2xl border bg-white shadow-sm md:block" style={{ borderColor: UI.border }}>
        <div className="max-h-[60vh] overflow-auto">
          <table className="w-full text-[12.5px]">
            <thead className="sticky top-0 z-10 bg-slate-50 text-[11.5px] font-black text-slate-500">
              <tr className="border-b" style={{ borderColor: UI.border }}>
                <th className="px-4 py-3 text-right">اللوحة</th>
                <th className="px-3 py-3 text-right">العميل</th>
                <th className="px-3 py-3 text-right">الجوال</th>
                <th className="px-3 py-3 text-right">السيارة</th>
                <th className="px-3 py-3 text-right">الفرع</th>
                <th className="px-3 py-3 text-right">الحالة</th>
                <th className="px-3 py-3 text-right">مدة الانتظار</th>
                <th className="px-4 py-3 text-left">إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1, 2, 3].map((i) => (
                  <tr key={i} className="border-b" style={{ borderColor: UI.border }}>
                    {Array.from({ length: 8 }).map((_, j) => (
                      <td key={j} className="px-4 py-4"><div className="h-3.5 animate-pulse rounded-full bg-slate-100" /></td>
                    ))}
                  </tr>
                ))
              ) : pageRows.length === 0 ? (
                <tr><td colSpan={8}>
                  <div className="flex flex-col items-center gap-2 py-14 text-slate-400">
                    <MIcon name="directions_car" className="!text-[38px]" />
                    <p className="text-[13px] font-bold">لا سيارات مطابقة</p>
                    <p className="text-[11.5px]">جرّب مسح عوامل التصفية — أو سجّل سيارة من الزر العائم</p>
                  </div>
                </td></tr>
              ) : pageRows.map((c) => (
                <tr key={c.id} className="border-b transition-colors duration-150 odd:bg-slate-50/40 hover:bg-blue-50/40"
                    style={{ borderColor: UI.border }}>
                  <td className="tnum px-4 py-3 font-extrabold text-slate-900">{c.plate || "—"}</td>
                  <td className="px-3 py-3 font-bold text-slate-800">{c.customer_name || "—"}</td>
                  <td className="tnum px-3 py-3 text-slate-500">{c.customer_phone || "—"}</td>
                  <td className="px-3 py-3 text-slate-600">{[c.brand, c.name, c.model_year].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-3 text-slate-600">{branchName[c.branch_id] || "—"}</td>
                  <td className="px-3 py-3">{renderStatus(c)}</td>
                  <td className="px-3 py-3">{renderWait(c)}</td>
                  <td className="px-4 py-2">{renderActions(c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {pages > 1 && (
          <div className="flex items-center justify-between border-t bg-slate-50/60 px-4 py-2.5" style={{ borderColor: UI.border }}>
            <span className="tnum text-[11.5px] font-bold text-slate-500">{filteredRows.length} سيارة — صفحة {page} من {pages}</span>
            <div className="flex gap-1">
              <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-600 transition enabled:hover:border-[#1E3A8A] disabled:opacity-40" style={{ borderColor: UI.border }}>›</button>
              <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)}
                      className="grid h-8 w-8 place-items-center rounded-lg border bg-white text-slate-600 transition enabled:hover:border-[#1E3A8A] disabled:opacity-40" style={{ borderColor: UI.border }}>‹</button>
            </div>
          </div>
        )}
      </div>

      {/* ═══════ عرض الموبايل: بطاقات بدل الجدول ═══════ */}
      <div className="space-y-2.5 md:hidden">
        {pageRows.map((c) => (
          <div key={c.id} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: UI.border }}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="tnum text-[15px] font-black text-slate-900">{c.plate || "بدون لوحة"}</div>
                <div className="text-[12px] font-bold text-slate-700">{c.customer_name}</div>
                <div className="tnum text-[11px] text-slate-500">{c.customer_phone}</div>
              </div>
              {renderStatus(c)}
            </div>
            <div className="mt-2 flex items-center justify-between border-t pt-2" style={{ borderColor: UI.border }}>
              <span className="text-[11px] text-slate-500">{[c.brand, c.name].filter(Boolean).join(" ")}</span>
              {renderActions(c)}
            </div>
          </div>
        ))}
      </div>

      {/* ═══════ الزر العائم: تسجيل سيارة ═══════ */}
      {canCreate && (
        <button onClick={openCreate} aria-label="تسجيل سيارة جديدة" title="تسجيل سيارة جديدة"
                className="fixed bottom-6 left-6 z-40 grid h-14 w-14 place-items-center rounded-full text-white shadow-lg transition-all duration-200 ease-in-out hover:scale-105 hover:shadow-xl active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1E3A8A]"
                style={{ background: UI.primary }}>
          <MIcon name="add" className="!text-[28px] text-white" />
        </button>
      )}

      {/* ══════════ تسجيل / تعديل ══════════ */}
      <Modal open={!!modal} size="lg" onClose={() => {
               setModal(null);
               // لو اتفتحت من البوابة الحية والموظف ألغى من غير حفظ، استأنف المراقبة برضو
               if (liveMode) {
                 liveRefs.current.paused = false;
                 liveRefs.current.lastReadFrame = null;
               }
             }}
             title={modal?.mode === "create" ? "تسجيل سيارة جديدة" : "تعديل بيانات السيارة"}>
        <div className="space-y-3">
          {modal?.mode === "create" && (
            <Field label="الفرع" hint={user?.branchId ? "مربوط بفرعك تلقائياً" : undefined}>
              <Select value={form.branchId} disabled={!!user?.branchId}
                      onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          )}

          <div className="grid items-end gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <Field label="حروف اللوحة *" hint="3 حروف إنجليزي">
              <Input value={form.plateLetters} className="tnum" onBlur={tryLookup} maxLength={3}
                     onChange={(e) => setForm({ ...form, plateLetters: e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) })} />
            </Field>
            <Field label="أرقام اللوحة *">
              <Input value={form.plateNumbers} className="tnum" onBlur={tryLookup} maxLength={4} inputMode="numeric"
                     onChange={(e) => setForm({ ...form, plateNumbers: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
            </Field>
            <Field label="نوع اللوحة">
              <Select value={form.plateType}
                      onChange={(e) => setForm({ ...form, plateType: e.target.value as any })}>
                <option value="saudi">سعودية</option>
                <option value="other">أخرى</option>
              </Select>
            </Field>
            <div className="pb-0.5">
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden"
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) onPlatePhoto(f); e.target.value = ""; }} />
              <Button variant="ghost" className="!px-3" disabled={ocrBusy}
                      onClick={() => fileRef.current?.click()} title="التقاط صورة اللوحة">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                  <circle cx="12" cy="13" r="4"/>
                </svg>
              </Button>
            </div>
          </div>
          {(ocrBusy || ocrMsg || plateShot) && (
            <div className="flex items-center gap-3 rounded-lg bg-ink-3 px-3 py-2 text-[12px]">
              {plateShot && <img src={plateShot} alt="لوحة" className="h-10 rounded-md border border-line object-cover" />}
              <span className={ocrBusy ? "text-amber-600" : "text-text-dim"}>
                {ocrBusy ? "جارِ قراءة اللوحة من الصورة..." : ocrMsg}
              </span>
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="اسم العميل *">
              <Input value={form.customerName}
                     onChange={(e) => setForm({ ...form, customerName: e.target.value, customerId: null })} />
            </Field>
            <Field label="جوال العميل *" hint={lookupBusy ? "جارِ البحث..." : "يبدأ بـ05 — 10 أرقام"}>
              <Input value={form.customerPhone} className="tnum" onBlur={tryLookup} maxLength={10} inputMode="numeric"
                     onChange={(e) => setForm({ ...form, customerPhone: e.target.value.replace(/\D/g, "").slice(0, 10), customerId: null })} />
            </Field>
            <Field label="القسم / المحطة">
              <ComboSelect value={form.station}
                           options={[
                             ...(branches.find((b) => b.id === form.branchId)?.lines || []),
                             "حفرة", "رافعة",
                           ]}
                           placeholder="اسم المحطة"
                           onChange={(v) => setForm({ ...form, station: v })} />
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="الماركة *">
              <ComboSelect value={form.brand} options={BRANDS} placeholder="اسم الماركة"
                           onChange={(v) => setForm({ ...form, brand: v, name: "" })} />
            </Field>
            <Field label="الموديل / الاسم *">
              {MODELS[form.brand] ? (
                <ComboSelect value={form.name} options={MODELS[form.brand]} placeholder="اسم الموديل"
                             onChange={(v) => setForm({ ...form, name: v })} />
              ) : (
                <Input value={form.name} placeholder="اكتب الموديل..."
                       onChange={(e) => setForm({ ...form, name: e.target.value })} />
              )}
            </Field>
            <Field label="سنة الصنع *">
              <ComboSelect value={form.modelYear} options={YEARS} placeholder="السنة"
                           onChange={(v) => setForm({ ...form, modelYear: v })} />
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="اللون *">
              <ComboSelect value={form.color} options={COLORS} placeholder="اللون"
                           onChange={(v) => setForm({ ...form, color: v })} />
            </Field>
            <Field label="العداد الحالي (الممشى) *">
              <Input type="number" min={0} className="tnum" value={form.odometerCurrent}
                     onChange={(e) => setForm({ ...form, odometerCurrent: e.target.value })} />
            </Field>
            {modal?.mode === "create" && (
              <Field label="العداد السابق">
                <Input type="number" min={0} className="tnum" value={form.odometerPrevious}
                       onChange={(e) => setForm({ ...form, odometerPrevious: e.target.value })} />
              </Field>
            )}
          </div>

          <Field label="رقم الهيكل *" hint={`17 حرف/رقم — المدخل: ${form.chassisNumber.length}`}>
            <Input value={form.chassisNumber} className="tnum" maxLength={17}
                   placeholder="مثال: JTDBT923771012345"
                   onChange={(e) => setForm({ ...form, chassisNumber: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 17) })} />
          </Field>

          <Field label="ملاحظات">
            <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </Field>

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button>
            <Button onClick={save}
                    disabled={busy || (modal?.mode === "create" &&
                      (!form.branchId || !form.customerName.trim() || !form.customerPhone.trim()))}>
              {busy ? "جارِ الحفظ..." : modal?.mode === "create" ? "حفظ وطباعة التذكرة" : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ نقاط التشييك ══════════ */}
      <Modal open={!!ckCar} size="lg" onClose={() => setCkCar(null)}
             title={`نقاط التشييك — ${ckCar?.plate || ""}`}>
        <div className="space-y-2">
          <p className="text-[12px] text-text-dim">
            {ckCar?.customer_name} — {[ckCar?.brand, ckCar?.name].filter(Boolean).join(" ")}
          </p>
          {(() => {
            const fin = ckItems.filter((i) => FINISHED.includes(i.status)).length;
            const ready = fin >= CHECKPOINTS.length;
            const working = ckItems.some((i) => i.status === "in_progress");
            return (
              <div>
                <div className="flex items-center gap-2">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-ink-3">
                    <div className={`h-full rounded-full transition-all duration-500 ${ready ? "bg-emerald" : "bg-petrol"}`}
                         style={{ width: `${Math.round((fin / CHECKPOINTS.length) * 100)}%` }} />
                  </div>
                  <span className="tnum text-[11.5px] font-bold text-text-dim">{fin}/{CHECKPOINTS.length}</span>
                </div>
                <div className="mt-1 text-[12px] font-bold">
                  {ready ? <span className="text-emerald">✓ كل النقاط تمت — السيارة جاهزة</span>
                    : working ? <span className="flex items-center gap-1.5 text-petrol"><Spinner /> جاري تنفيذ الخدمة المطلوبة...</span>
                    : <span className="text-text-dim">اضغط «بدء» على النقطة اللي شغالين فيها</span>}
                </div>
              </div>
            );
          })()}
          <div className="rounded-lg border border-line">
            {STAGES.map((st) => (
              <div key={st.id}>
                <div className="border-y border-line bg-petrol-soft px-3 py-1.5 text-[12px] font-extrabold text-petrol first:border-t-0">
                  {st.title}
                </div>
                <div className="divide-y divide-line">
                  {ckItems.filter((i) => stageOf(i.key) === st.id).map((i) => {
              const btn = (st: CkStatus, label: string, activeCls: string) => (
                <button key={st} onClick={() => setCk(i.key, { status: i.status === st ? "pending" : st }, true)}
                        className={`rounded-md px-2 py-1 text-[11px] font-bold transition
                          ${i.status === st ? activeCls : "bg-ink-3 text-text-dim hover:text-text"}`}>
                  {label}
                </button>
              );
              return (
                <div key={i.key} className="grid items-center gap-2 px-3 py-2 sm:grid-cols-[130px_1fr_170px]">
                  <span className="flex items-center gap-1.5 text-[12.5px] font-bold">
                    {i.status === "in_progress" && <Spinner />}
                    {FINISHED.includes(i.status) && <span className="text-emerald">✓</span>}
                    {i.label}
                  </span>
                  <div className="flex flex-wrap gap-1">
                    {btn("in_progress", "▶ بدء", "bg-petrol text-white")}
                    {btn("ok", "سليم", "bg-emerald text-white")}
                    {btn("done", "تم التغيير", "bg-emerald text-white")}
                    {btn("needs", "يحتاج متابعة", "bg-brass text-white")}
                  </div>
                  <Input value={i.note || ""} placeholder="ملاحظة..." className="!py-1.5 !text-[12px]"
                         onChange={(e) => setCk(i.key, { note: e.target.value || null })} />
                </div>
              );
            })}
                </div>
              </div>
            ))}
          </div>
          {/* إسناد العمل: الفني يدوس اسمه أول ما يبدأ */}
          <div className="space-y-1.5 rounded-xl border border-line p-2.5">
            <div className="flex items-center justify-between text-[11.5px] font-black">
              <span className="flex items-center gap-1"><MIcon name="engineering" className="!text-[16px]" /> مين شغال على السيارة؟</span>
              {workLog.length > 0 && (
                <span className="flex flex-wrap justify-end gap-1">
                  {[...new Map(workLog.map((w) => [w.employee_name, w])).values()].map((w) => (
                    <span key={w.employee_name} className="rounded-full bg-emerald-bg px-2 py-0.5 text-[10px] font-black text-emerald">
                      ✓ {w.employee_name}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {lineWorkers.length === 0 && (
                <span className="text-[11px] text-text-dim">أضف موظفيك من الموارد البشرية أولاً</span>
              )}
              {lineWorkers.map((w) => {
                const tagged = workLog.some((x) => x.employee_name === w.name);
                return (
                  <button key={w.id} disabled={workBusy || tagged} onClick={() => tagWorker(w)}
                          className={`rounded-lg px-2.5 py-1.5 text-[11.5px] font-bold transition active:scale-[.95]
                            ${tagged ? "bg-emerald text-white" : "border border-line hover:border-petrol hover:text-petrol"}`}>
                    {w.name}
                  </button>
                );
              })}
            </div>
          </div>

          <button onClick={aiAnalyzeChecklist} disabled={aiCamBusy}
                  className="mi-hover flex w-full items-center justify-center gap-1.5 rounded-xl border border-petrol/40 py-2.5 text-[12.5px] font-black text-petrol transition hover:bg-petrol-soft active:scale-[.98] disabled:opacity-50">
            <MIcon name="videocam" className="!text-[18px]" />
            {aiCamBusy ? "الكاميرا بتحلل المشهد..." : "🤖 تحليل بالكاميرا — تعليم تلقائي"}
          </button>
          <ErrorNote msg={ckErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setCkCar(null)}>إلغاء</Button>
            <Button variant="ghost" disabled={ckBusy} onClick={() => saveChecklist(true)}>حفظ وطباعة</Button>
            <Button disabled={ckBusy} onClick={() => saveChecklist(false)}>
              {ckBusy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ فريق العمل — من اشتغل على السيارة ══════════ */}
      <Modal open={!!teamCar} onClose={() => setTeamCar(null)}
             title={`👥 فريق العمل — ${teamCar?.plate || ""}`}>
        {teamErr ? (
          <p className="py-6 text-center text-[12.5px] font-bold text-ember">⚠ {teamErr}</p>
        ) : !team ? (
          <p className="py-6 text-center text-[12.5px] text-text-dim">جارٍ التحميل…</p>
        ) : (
          <div className="space-y-3">
            <p className="text-[12px] text-text-dim">
              {team.customerName} — {team.car}{team.station ? ` · محطة ${team.station}` : ""}
            </p>

            {/* الأدوار الأربعة المحفوظة لحظة اعتماد أمر العمل */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: "فني التعبئة", name: team.filler, bg: "#E0F2FE", fg: "#0369A1" },
                { label: "فك وتركيب 1", name: team.fitter1, bg: "#DBEAFE", fg: "#1E3A8A" },
                { label: "فك وتركيب 2", name: team.fitter2, bg: "#DBEAFE", fg: "#1E3A8A" },
                { label: "التشييك", name: team.checker, bg: "#DCFCE7", fg: "#15803D" },
              ].map((r) => (
                <div key={r.label} className="rounded-xl p-3" style={{ background: r.bg }}>
                  <div className="text-[10.5px] font-black" style={{ color: r.fg }}>{r.label}</div>
                  <div className="mt-0.5 truncate text-[13px] font-extrabold"
                       style={{ color: r.name ? "#0F172A" : "#94A3B8" }}>
                    {r.name || "لم يُسجَّل"}
                  </div>
                </div>
              ))}
            </div>

            {/* التوقيتات + معتمد الأمر */}
            <div className="rounded-xl bg-ink-3 p-3 text-[11.5px]">
              <div className="grid grid-cols-2 gap-x-3 gap-y-1">
                <div className="flex justify-between"><span className="text-text-dim">الدخول</span><span className="tnum font-bold">{dtFmt(team.enteredAt)}</span></div>
                <div className="flex justify-between"><span className="text-text-dim">اعتماد الأمر</span><span className="tnum font-bold">{dtFmt(team.preparedAt)}</span></div>
                <div className="flex justify-between"><span className="text-text-dim">الخروج</span><span className="tnum font-bold">{dtFmt(team.exitedAt)}</span></div>
                <div className="flex justify-between"><span className="text-text-dim">اعتمده</span><span className="truncate font-bold">{team.preparedBy || "—"}</span></div>
              </div>
            </div>

            {/* سجل الإسناد اليدوي (شاشة التشييك) */}
            {team.log.length > 0 && (
              <div>
                <p className="mb-1 text-[11px] font-bold text-text-dim">سجل الإسناد أثناء الخدمة</p>
                <div className="max-h-36 space-y-1 overflow-y-auto rounded-xl border border-line p-2 text-[11.5px]">
                  {team.log.map((w, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="font-bold">{w.employee_name}{w.station ? ` · محطة ${w.station}` : ""}</span>
                      <span className="tnum text-text-dim">{dtFmt(w.at)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {!team.filler && !team.fitter1 && !team.fitter2 && !team.checker && team.log.length === 0 && (
              <p className="rounded-xl bg-amber-50 p-3 text-center text-[12px] font-bold text-amber-700">
                لم يُسجَّل أي فني على هذه السيارة — الفنيون يُسجَّلون لحظة اعتماد أمر العمل من التابلت
              </p>
            )}
          </div>
        )}
      </Modal>

      {/* ══════════ بوابة الدخول الذكية ══════════ */}
      <Modal open={gateOpen} onClose={() => setGateOpen(false)} title="📷 بوابة الدخول الذكية">
        <div className="space-y-3">
      {/* ══════════ تنبيهات المشرف الآلي ══════════ */}
      {alerts.length > 0 && (
        <div className="space-y-1.5">
          {alerts.map((a) => (
            <div key={a.id} className="flex items-center justify-between gap-2 rounded-xl border-2 border-ember bg-ember-bg px-3.5 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-[12.5px] font-black text-ember">
                <MIcon name="warning" filled className="!text-[20px] shrink-0" />
                <span className="truncate">
                  {a.plate && <b className="tnum ml-1">{a.plate}</b>}
                  {a.station && <span className="ml-1 text-[11px]">م{String(a.station).replace(/\D/g, "")}</span>}
                  — {a.message}
                </span>
              </span>
              <span className="flex shrink-0 gap-1.5">
                <button onClick={() => dismissAlert(a.id, true)}
                        className="rounded-lg border border-ember/40 px-2 py-1 text-[10.5px] font-bold text-ember hover:bg-ember/10">
                  بلاغ خاطئ
                </button>
                <button onClick={() => dismissAlert(a.id)}
                        className="rounded-lg bg-ember px-2.5 py-1 text-[11px] font-black text-white hover:brightness-110">
                  تم التعامل
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
          {!gateResult && (
            <>
              <p className="text-[12.5px] text-text-dim">
                صوّر لوحة السيارة — لو متسجلة في الدور هيتأكد دخولها <b>تلقائياً</b> وتظهر بياناتها كاملة.
              </p>
              <input ref={gateFileRef} type="file" accept="image/*" capture="environment" hidden
                     onChange={(e) => { const f = e.target.files?.[0]; if (f) onGatePhoto(f); e.target.value = ""; }} />
              <button onClick={() => gateFileRef.current?.click()} disabled={gateBusy}
                      className="w-full rounded-xl bg-petrol py-4 text-[15px] font-black text-white transition hover:brightness-110 disabled:opacity-50">
                {gateBusy ? "جارِ القراءة والمطابقة..." : "📷 التقاط صورة اللوحة"}
              </button>
              {gateMsg && <p className="text-center text-[12.5px] font-bold text-ember">{gateMsg}</p>}
            </>
          )}

          {gateResult?.matched && gateResult.car && (
            <div className="space-y-3">
              <div className={`rounded-xl border px-4 py-3 text-center font-black
                     ${gateResult.alreadyEntered ? "border-brass bg-brass-soft text-brass" : "border-emerald/40 bg-emerald-bg text-emerald"}`}>
                {gateResult.alreadyEntered
                  ? `اللوحة ${gateResult.car.plate} داخلة بالفعل`
                  : `✓ تم تأكيد دخول اللوحة ${gateResult.car.plate} تلقائياً`}
              </div>
              {gateResult.isWalkIn && !gateResult.alreadyEntered && (
                <div className="flex items-center justify-center gap-1.5 rounded-xl border border-petrol/30 bg-petrol-soft px-3 py-2 text-[12px] font-black text-petrol">
                  <MIcon name="verified" className="!text-[16px]" /> عميل مسجل معانا — وصل من غير حجز، وكل بياناته اتسحبت من جراجه تلقائياً
                </div>
              )}
              <div className="space-y-1.5 rounded-xl border border-line p-3 text-[13px]">
                <div className="flex justify-between"><span className="text-text-dim">العميل</span><b>{gateResult.car.customer_name || "—"}</b></div>
                <div className="flex justify-between"><span className="text-text-dim">الجوال</span><b className="tnum">{gateResult.car.customer_phone || "—"}</b></div>
                <div className="flex justify-between"><span className="text-text-dim">السيارة</span><b>{[gateResult.car.brand, gateResult.car.name, gateResult.car.model_year].filter(Boolean).join(" ") || "—"}</b></div>
                <div className="flex justify-between"><span className="text-text-dim">المحطة</span><b>{gateResult.car.station || "—"}</b></div>
                {gateResult.car.odometer_previous ? (
                  <div className="flex justify-between"><span className="text-text-dim">العداد السابق</span><b className="tnum">{gateResult.car.odometer_previous}</b></div>
                ) : null}
              </div>
              {gateResult.lastInvoiceId ? (
                <div className="space-y-2">
                  <div className="rounded-xl border border-petrol/30 bg-petrol-soft px-3 py-2.5 text-center text-[12.5px] font-bold text-petrol">
                    🧾 الفاتورة (مثل آخر مرة) جاهزة تلقائياً — هتظهر فور اختيار السيارة من طابور الفوترة في المبيعات
                  </div>
                  <Button variant="ghost" className="w-full justify-center" onClick={goToSalesWithLastInvoice}>
                    الذهاب لشاشة المبيعات — الفاتورة معبأة وقابلة للتعديل
                  </Button>
                </div>
              ) : (
                <div className="rounded-2xl border border-line p-4">
                  <OilKiosk carId={gateResult.car.id} onDone={() => { setGateResult(null); setGateMsg(""); load(); }} />
                </div>
              )}
              <Button variant="ghost" className="w-full justify-center"
                      onClick={() => { setGateResult(null); setGateMsg(""); }}>
                📷 سيارة تانية
              </Button>
            </div>
          )}

          {gateResult && !gateResult.matched && (
            <div className="space-y-3">
              <div className="rounded-xl border border-ember/40 bg-ember-bg px-4 py-3 text-center text-[13px] font-black text-ember">
                اللوحة المقروءة ({gateResult.letters} {gateResult.numbers}) مش متسجلة في الدور
              </div>
              <Button className="w-full justify-center"
                      onClick={() => {
                        setGateOpen(false);
                        setForm({ ...EMPTY, branchId: defaultBranchId(),
                                  plateLetters: gateResult.letters, plateNumbers: gateResult.numbers });
                        setPlateShot(null); setOcrMsg("");
                        setModal({ mode: "create" });
                      }}>
                + تسجيل سيارة جديدة بهذه اللوحة
              </Button>
              <Button variant="ghost" className="w-full justify-center"
                      onClick={() => { setGateResult(null); setGateMsg(""); }}>
                📷 إعادة التصوير
              </Button>
            </div>
          )}
        </div>
      </Modal>

      {/* ══════════ شاشة البوابة الحية (ANPR) ══════════ */}
      {liveOpen && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-black">
          {/* شريط الحالة */}
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-2 text-[13px] font-black text-white">
              <span className={`relative flex h-3 w-3`}>
                <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60
                  ${liveStatus === "watching" ? "bg-emerald-400" : liveStatus === "motion" ? "bg-amber-400" : liveStatus === "reading" ? "bg-sky-400" : "bg-red-500"}`} />
                <span className={`relative inline-flex h-3 w-3 rounded-full
                  ${liveStatus === "watching" ? "bg-emerald-400" : liveStatus === "motion" ? "bg-amber-400" : liveStatus === "reading" ? "bg-sky-400" : "bg-red-500"}`} />
              </span>
              {liveStatus === "starting" && "جارِ تشغيل الكاميرا..."}
              {liveStatus === "watching" && "المراقبة نشطة — أي لوحة تظهر تتقرأ فوراً"}
              {liveStatus === "reading" && "🔍 جارِ قراءة اللوحة والمطابقة..."}
              {liveStatus === "error" && "تعذّر تشغيل الكاميرا"}
            </div>
            <button onClick={stopLive}
                    className="rounded-lg bg-white/15 px-4 py-1.5 text-[12.5px] font-black text-white hover:bg-white/25">
              ✕ إيقاف البوابة
            </button>
          </div>

          {/* البث الحي */}
          <div className="relative flex-1 overflow-hidden">
            <video ref={videoRef} playsInline muted autoPlay
                   className={`h-full w-full object-cover ${liveMode === "ip" ? "hidden" : ""}`} />
            {liveMode === "ip" && (
              ipFrame
                ? <img src={ipFrame} alt="بث الكاميرا" className="h-full w-full object-contain" />
                : <div className="grid h-full place-items-center text-[13px] font-bold text-white/50">في انتظار أول لقطة من الكاميرا...</div>
            )}

            {/* ══ شاشة اختيار مصدر الكاميرا ══ */}
            {liveStatus === "idle" && (
              <div className="absolute inset-0 grid place-items-center bg-black/80 p-5">
                <div className="w-full max-w-md space-y-3 rounded-2xl bg-white p-5">
                  <h3 className="text-center text-[15px] font-black">مصدر كاميرا البوابة</h3>
                  <button onClick={() => startLive("device")}
                          className="w-full rounded-xl bg-petrol py-3.5 text-[14px] font-black text-white hover:brightness-110">
                    📱 كاميرا هذا الجهاز
                  </button>
                  {gateCams.length > 0 && (
                    <div className="space-y-1.5 rounded-xl border border-emerald/40 bg-emerald-bg p-3">
                      <p className="text-[12px] font-black text-emerald">📷 كاميراتك المسجلة في الإعدادات — ضغطة تشغيل</p>
                      {gateCams.map((c) => (
                        <button key={c.id}
                                onClick={() => {
                                  const u = c.rtsp_url.trim();
                                  // كاميرا RTSP (Hikvision): المتصفح لا يفهم RTSP —
                                  // نمر عبر جسر الباك اند الذي يجلب لقطة حية متجددة
                                  const shot = u.toLowerCase().startsWith("rtsp://")
                                    ? `${window.location.origin}/api/cameras/public-live/${c.id}.jpg`
                                    : (u.startsWith("http") && !u.includes("shot.jpg")
                                        ? u.replace(/\/+$/, "") + "/shot.jpg" : u);
                                  setIpCamUrl(shot);
                                  startLive("ip", shot);
                                }}
                                className="flex w-full items-center justify-between rounded-lg bg-ink-2 px-3 py-2 text-[12px] font-bold shadow-card transition hover:brightness-105 active:scale-[.98]">
                          <span>{c.name} — {c.branch_name || ""} م{c.station}</span>
                          <span className="text-emerald">▶ تشغيل</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="rounded-xl border border-line p-3">
                    <p className="mb-1.5 text-[12px] font-black">🌐 أو رابط كاميرا يدوي</p>
                    <Input dir="ltr" className="tnum" value={ipCamUrl}
                           placeholder="http://10.151.86.117:8080/shot.jpg"
                           onChange={(e) => setIpCamUrl(e.target.value)} />
                    <p className="mt-1 text-[10.5px] text-text-dim">
                      من IP Webcam: شغّل Start server وخد الرابط اللي بيظهر تحت وضيف عليه /shot.jpg
                    </p>
                    <button onClick={() => startLive("ip")}
                            className="mt-2 w-full rounded-xl bg-emerald py-3 text-[13.5px] font-black text-white hover:brightness-110">
                      ▶ تشغيل من كاميرا IP
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* بطاقة النتيجة الكبيرة */}
            {liveHit && (
              <div className={`absolute inset-x-4 top-4 rounded-2xl border-2 px-5 py-4 text-center shadow-panel backdrop-blur
                     ${liveHit.tone === "ok" ? "border-emerald-400 bg-emerald-600/85"
                       : liveHit.tone === "warn" ? "border-amber-400 bg-amber-600/85"
                       : "border-red-400 bg-red-600/85"}`}>
                <div className="text-[20px] font-black text-white">{liveHit.title}</div>
                {liveHit.sub && <div className="mt-0.5 text-[13px] font-bold text-white/85">{liveHit.sub}</div>}
              </div>
            )}

            {liveKioskCar && (
              <div className="absolute inset-0 overflow-y-auto bg-ink p-4 sm:p-6">
                <div className="mx-auto w-full max-w-4xl rounded-2xl bg-ink-2 p-5 shadow-panel sm:p-7">
                  <OilKiosk carId={liveKioskCar}
                            onDone={() => {
                              setLiveKioskCar(null);
                              liveRefs.current.paused = false;
                              liveRefs.current.lastReadFrame = null;
                              liveAddLog("✓ تم إعداد الزيت — استُؤنفت المراقبة", "ok");
                              load();
                            }} />
                </div>
              </div>
            )}

            {liveStatus === "error" && (
              <div className="absolute inset-0 grid place-items-center bg-black/70 p-6">
                <div className="max-w-md space-y-3 rounded-2xl bg-white p-5 text-center">
                  <p className="text-[14px] font-black text-ember">{liveErr}</p>
                  {liveMode === "ip" ? (
                    <div className="space-y-1.5 text-right text-[12px] leading-relaxed text-text-dim">
                      <p className="font-bold text-text">تأكد من:</p>
                      <p>1. تطبيق IP Webcam فاتح على الموبايل وضاغط <b>Start server</b> فيه (مش بس مفتوح)</p>
                      <p>2. الموبايل والكمبيوتر على <b>نفس شبكة الواي فاي</b> بالظبط</p>
                      <p>3. الرابط بالشكل: <span className="tnum" dir="ltr">http://[IP-الموبايل]:8080/shot.jpg</span> (الـIP ظاهر في شاشة التطبيق نفسها)</p>
                      <p>4. لو الرابط شغال من متصفح الكمبيوتر لوحده بس مش هنا، جرّب تقفل VPN لو مفعّل على أي جهاز</p>
                    </div>
                  ) : (
                    <p className="text-[12px] leading-relaxed text-text-dim">
                      المتصفح بيسمح بالكاميرا المستمرة على HTTPS أو localhost فقط.
                      من كروم الموبايل افتح: <span className="tnum" dir="ltr">chrome://flags</span> ←
                      ابحث <b>Insecure origins treated as secure</b> ← أضف
                      <span className="tnum" dir="ltr"> http://10.172.176.171:3000 </span>
                      ← Enabled ← Relaunch
                    </p>
                  )}
                  <Button className="w-full justify-center"
                          onClick={() => liveMode ? startLive(liveMode) : setLiveStatus("idle")}>
                    إعادة المحاولة
                  </Button>
                  <Button variant="ghost" className="w-full justify-center"
                          onClick={() => { setLiveErr(""); setLiveStatus("idle"); }}>
                    ↩ تغيير مصدر الكاميرا
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* سجل الأحداث الحي */}
          <div className="max-h-44 space-y-1 overflow-y-auto bg-black/90 px-4 py-3">
            {liveLog.length === 0 ? (
              <p className="text-center text-[11.5px] text-white/40">الأحداث هتظهر هنا أولاً بأول</p>
            ) : liveLog.map((l, i) => (
              <div key={i} className="flex items-center gap-2 text-[12px] font-bold">
                <span className="tnum text-white/40">{l.t}</span>
                <span className={l.tone === "ok" ? "text-emerald-400" : l.tone === "warn" ? "text-amber-400" : l.tone === "err" ? "text-red-400" : "text-white/70"}>
                  {l.msg}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ══════════ باركود الحجز الذاتي ══════════ */}
      <Modal open={qrOpen} onClose={() => setQrOpen(false)} title="📱 باركود الحجز الذاتي للعملاء">
        <div className="space-y-3">
          <p className="text-[12.5px] leading-relaxed text-text-dim">
            العميل بيمسح الباركود بجواله → يسجّل سيارته ويحجز دوره <b>قبل ما يوصل</b> → يتابع
            الطابور مباشرة → وأول ما يوصل، البوابة الحية بتتعرف على لوحته وتأكد دخوله تلقائياً.
          </p>
          <Field label="الفرع">
            <Select value={qrBranch} onChange={(e) => setQrBranch(e.target.value)}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          {qrBranch && (
            <div className="space-y-2 rounded-xl border border-line p-4 text-center">
              <img alt="باركود الحجز" className="mx-auto h-44 w-44 rounded-lg"
                   src={`https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(`${typeof window !== "undefined" ? window.location.origin : ""}/q/${qrBranch}`)}`} />
              <div dir="ltr" className="tnum break-all text-[10.5px] text-text-dim">
                {typeof window !== "undefined" ? `${window.location.origin}/q/${qrBranch}` : ""}
              </div>
            </div>
          )}
          <Button className="w-full justify-center" onClick={printBookingQr} disabled={!qrBranch}>
            🖨 طباعة ملصق الباركود
          </Button>
          <p className="text-[10.5px] leading-relaxed text-text-dim">
            💡 اطبعه والصقه على مدخل الفرع وطاولة الاستقبال — ولو عايز العملاء يحجزوا من بيوتهم،
            ابعت اللينك في واتساب أو حطه في جوجل ماب (يتطلب إن السيرفر يكون متاح على الإنترنت).
          </p>
        </div>
      </Modal>
    </div>
  );
}
