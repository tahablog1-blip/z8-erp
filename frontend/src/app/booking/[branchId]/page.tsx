"use client";
// حجز الدور الذاتي — رحلة العميل الكاملة:
// جوال/لوحة → جراجه المحفوظ (بياناته ما بتضيعش) → أو تسجيل جديد بثلاث فئات → تذكرة حية
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { MIcon } from "@/components/m-icon";

type Info = { branchName: string; waiting: number; inService: number; estWaitMinutes: number };
type SavedCar = { id: string; plate: string; brand: string | null; name: string | null; model_year: string | null; service_type: string };
type Profile = { found: boolean; customer?: { id: string; name: string; phone: string }; cars?: SavedCar[] };
type Booking = {
  bookingId: string; state: "waiting" | "in_service" | "done";
  queueNo: number; ahead: number; estWaitMinutes: number;
  plate: string; customerName: string; station: string | null; branchName: string;
};
type SType = "basic" | "warranty" | "company";

const NAVY = "#0F2D52", GREEN = "#16A34A", DIM = "#51617A", LINE = "#E2E8F0";
const TYPE_META: Record<SType, { title: string; desc: string; icon: string }> = {
  basic: { title: "خارج الضمان", desc: "بيانات مختصرة وسريعة", icon: "directions_car" },
  warranty: { title: "تحت الضمان", desc: "بيانات السيارة كاملة", icon: "verified_user" },
  company: { title: "سائق شركة — فاتورة ضريبية", desc: "بيانات كاملة + الرقم الضريبي والعنوان الوطني", icon: "apartment" },
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/cars/public/${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.detail || "حدث خطأ — حاول مرة أخرى");
  return data as T;
}

const inputCls = `w-full rounded-xl border px-4 py-3 text-[14px] font-bold outline-none transition focus:border-[#0F2D52] focus:ring-2 focus:ring-[#0F2D52]/15`;
function TInput(props: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const { label, className = "", ...rest } = props;
  return (
    <label className="block text-right">
      <span className="mb-1 block text-[11.5px] font-black" style={{ color: NAVY }}>{label}</span>
      <input {...rest} style={{ borderColor: LINE }} className={`${inputCls} ${className}`} />
    </label>
  );
}

export default function PublicBookingPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const [view, setView] = useState<"loading" | "entry" | "garage" | "type" | "form" | "ticket">("loading");
  const [info, setInfo] = useState<Info | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [sType, setSType] = useState<SType>("basic");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<any>(null);

  const [entry, setEntry] = useState({ phone: "", plate: "" });
  const [f, setF] = useState({
    name: "", phone: "",
    plateNumbers: "", plateLetters: "", brand: "", carName: "", modelYear: "", odometer: "",
    carCategory: "", cylinders: "", color: "", chassisNumber: "",
    vat: "", cr: "", buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
  });
  const [quickCar, setQuickCar] = useState<SavedCar | null>(null);
  const [quickOdo, setQuickOdo] = useState("");

  useEffect(() => {
    call<Info>(`booking/${branchId}`).then(setInfo).catch(() => {});
    const savedBooking = localStorage.getItem(`z8_booking_${branchId}`);
    const savedPhone = localStorage.getItem("z8_cust_phone");
    if (savedBooking) {
      call<Booking>(`booking-status/${savedBooking}`)
        .then((b) => {
          if (b.state !== "done") { setBooking(b); setView("ticket"); }
          else if (savedPhone) restoreProfile(savedPhone, "");
          else setView("entry");
        }).catch(() => savedPhone ? restoreProfile(savedPhone, "") : setView("entry"));
    } else if (savedPhone) restoreProfile(savedPhone, "");
    else setView("entry");
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line
  }, [branchId]);

  useEffect(() => {
    clearInterval(pollRef.current);
    if (view === "ticket" && booking) {
      pollRef.current = setInterval(() => {
        call<Booking>(`booking-status/${booking.bookingId}`).then(setBooking).catch(() => {});
      }, 8000);
    }
    return () => clearInterval(pollRef.current);
  }, [view, booking?.bookingId]);

  async function restoreProfile(phone: string, plate: string) {
    setErr(""); setBusy(true);
    try {
      const p = await call<Profile>(`booking/${branchId}/lookup`, {
        method: "POST", body: JSON.stringify({ phone, plate }),
      });
      if (p.found && p.customer) {
        localStorage.setItem("z8_cust_phone", p.customer.phone);
        setProfile(p);
        setF((x) => ({ ...x, name: p.customer!.name, phone: p.customer!.phone }));
        setView((p.cars || []).length ? "garage" : "type");
      } else {
        setF((x) => ({ ...x, phone: phone || x.phone,
          plateNumbers: plate.replace(/[^0-9]/g, "").slice(0, 4),
          plateLetters: plate.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) }));
        setView("type");
      }
    } catch (e: any) { setErr(e.message); setView("entry"); }
    finally { setBusy(false); }
  }

  async function bookSaved() {
    if (!quickCar) return;
    setErr(""); setBusy(true);
    try {
      const b = await call<Booking>(`booking/${branchId}`, {
        method: "POST",
        body: JSON.stringify({ savedCarId: quickCar.id, odometer: quickOdo, serviceType: quickCar.service_type }),
      });
      localStorage.setItem(`z8_booking_${branchId}`, b.bookingId);
      setBooking(b); setQuickCar(null); setView("ticket");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function submitNew() {
    setErr(""); setBusy(true);
    try {
      const b = await call<Booking>(`booking/${branchId}`, {
        method: "POST",
        body: JSON.stringify({
          serviceType: sType, name: f.name.trim(), phone: f.phone.trim(),
          car: { plateLetters: f.plateLetters, plateNumbers: f.plateNumbers,
                 brand: f.brand.trim() || null, carName: f.carName.trim() || null,
                 modelYear: f.modelYear.trim() || null, odometer: f.odometer,
                 carCategory: f.carCategory.trim() || null, cylinders: f.cylinders.trim() || null,
                 color: f.color.trim() || null, chassisNumber: f.chassisNumber.trim() || null },
          company: sType === "company" ? {
            vat: f.vat.trim(), cr: f.cr.trim(), buildingNo: f.buildingNo.trim(),
            street: f.street.trim(), district: f.district.trim(), city: f.city.trim(),
            postalCode: f.postalCode.trim() || null, additionalNo: f.additionalNo.trim() || null,
          } : null,
        }),
      });
      localStorage.setItem(`z8_booking_${branchId}`, b.bookingId);
      localStorage.setItem("z8_cust_phone", f.phone.trim());
      setBooking(b); setView("ticket");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  const stateUi = booking && {
    waiting: { icon: "schedule", color: "#D97706", bg: "#FCF0DE", title: "في الانتظار",
               sub: booking.ahead === 0 ? "أنت التالي — استعد!" : `أمامك ${booking.ahead} سيارة · انتظار متوقع ~${booking.estWaitMinutes} دقيقة` },
    in_service: { icon: "build", color: GREEN, bg: "rgba(22,163,74,.1)", title: "سيارتك في الخدمة الآن 🎉",
                  sub: booking.station ? `المحطة: ${booking.station}` : "جاري تنفيذ الخدمة" },
    done: { icon: "task_alt", color: NAVY, bg: "#E9EEF6", title: "اكتملت الخدمة — شكراً لزيارتك", sub: "نسعد بخدمتك دائماً" },
  }[booking.state];

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="space-y-2.5 rounded-xl p-3" style={{ background: "#F6F8FA" }}>
      <div className="text-[12px] font-black" style={{ color: GREEN }}>{title}</div>
      {children}
    </div>
  );

  return (
    <div dir="rtl" className="min-h-screen px-4 py-6" style={{ background: "#EEF2F6" }}>
      <div className="mx-auto max-w-md space-y-4">
        <div className="rounded-2xl px-5 py-4 text-center text-white shadow-lg" style={{ background: NAVY }}>
          <div className="text-[18px] font-black">مصدر الزيوت</div>
          <div className="text-[12px] text-white/70">{info?.branchName || "..."} — حجز الدور الذاتي</div>
          {info && view !== "ticket" && (
            <div className="mx-auto mt-2 flex w-fit gap-4 rounded-full bg-white/10 px-4 py-1 text-[10.5px] font-bold">
              <span>⏳ {info.waiting} منتظر</span><span>🔧 {info.inService} في الخدمة</span><span>~{info.estWaitMinutes} دقيقة</span>
            </div>
          )}
        </div>

        {view === "loading" && <p className="py-10 text-center text-[13px]" style={{ color: DIM }}>جارِ التحميل...</p>}

        {/* ══ 1) الدخول: جوال أو لوحة ══ */}
        {view === "entry" && (
          <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
            <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>أهلاً بك 👋</h2>
            <p className="text-center text-[12px]" style={{ color: DIM }}>
              أدخل جوالك أو رقم لوحتك — لو سجّلت قبل كده هنرجّع بياناتك وسياراتك فوراً
            </p>
            <TInput label="رقم الجوال" inputMode="tel" placeholder="05xxxxxxxx" className="tnum"
                    value={entry.phone} onChange={(e) => setEntry({ ...entry, phone: e.target.value })} />
            <div className="text-center text-[11px] font-bold" style={{ color: DIM }}>— أو —</div>
            <TInput label="رقم اللوحة (أرقام وحروف)" placeholder="1288HHR" dir="ltr" className="tnum text-center uppercase"
                    value={entry.plate} onChange={(e) => setEntry({ ...entry, plate: e.target.value })} />
            {err && <p className="rounded-lg px-3 py-2 text-center text-[12px] font-bold" style={{ background: "rgba(220,38,38,.08)", color: "#DC2626" }}>{err}</p>}
            <button onClick={() => restoreProfile(entry.phone, entry.plate)}
                    disabled={busy || (entry.phone.replace(/\D/g, "").length < 9 && entry.plate.trim().length < 4)}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-black text-white shadow-lg transition active:scale-[.98] disabled:opacity-40"
                    style={{ background: GREEN }}>
              <MIcon name="arrow_back" className="!text-[20px] text-white" />
              {busy ? "جارِ البحث..." : "متابعة"}
            </button>
          </div>
        )}

        {/* ══ 2) الجراج: سياراته المحفوظة ══ */}
        {view === "garage" && profile?.customer && (
          <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
            <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>
              أهلاً {profile.customer.name} 👋
            </h2>
            <p className="text-center text-[12px]" style={{ color: DIM }}>اختر سيارتك لحجز الدور بضغطة</p>
            <div className="space-y-2">
              {(profile.cars || []).map((c) => (
                <button key={c.id} onClick={() => { setQuickCar(c); setQuickOdo(""); setErr(""); }}
                        className="flex w-full items-center gap-3 rounded-xl border-2 p-3 text-right transition active:scale-[.98]"
                        style={{ borderColor: quickCar?.id === c.id ? GREEN : LINE, background: quickCar?.id === c.id ? "rgba(22,163,74,.06)" : "#fff" }}>
                  <MIcon name={TYPE_META[(c.service_type as SType) || "basic"]?.icon || "directions_car"} className="!text-[26px]" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-black">{[c.brand, c.name, c.model_year].filter(Boolean).join(" ") || "سيارة"}</span>
                    <span className="text-[11px] font-bold" style={{ color: DIM }}>
                      {TYPE_META[(c.service_type as SType) || "basic"]?.title}
                    </span>
                  </span>
                  <span className="tnum shrink-0 rounded-lg px-2.5 py-1 text-[13px] font-black text-white" style={{ background: NAVY }}>{c.plate}</span>
                </button>
              ))}
            </div>
            {quickCar && (
              <div className="kiosk-pop space-y-2 rounded-xl p-3" style={{ background: "#F6F8FA" }}>
                <TInput label={`ممشى ${quickCar.plate} الحالي (كم)`} inputMode="numeric" className="tnum" placeholder="مثال: 84500"
                        value={quickOdo} onChange={(e) => setQuickOdo(e.target.value.replace(/\D/g, ""))} autoFocus />
                <button onClick={bookSaved} disabled={busy || !quickOdo}
                        className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-black text-white transition active:scale-[.98] disabled:opacity-40"
                        style={{ background: GREEN }}>
                  <MIcon name="confirmation_number" className="!text-[19px] text-white" />
                  {busy ? "جارِ الحجز..." : `تأكيد حجز ${quickCar.plate}`}
                </button>
              </div>
            )}
            {err && <p className="rounded-lg px-3 py-2 text-center text-[12px] font-bold" style={{ background: "rgba(220,38,38,.08)", color: "#DC2626" }}>{err}</p>}
            <button onClick={() => { setSType("basic"); setView("type"); }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-3 text-[13px] font-black transition active:scale-[.98]"
                    style={{ borderColor: LINE, color: NAVY }}>
              <MIcon name="add_circle" className="!text-[18px]" /> إضافة سيارة أخرى
            </button>
          </div>
        )}

        {/* ══ 3) نوع التسجيل ══ */}
        {view === "type" && (
          <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
            <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>نوع تسجيل السيارة</h2>
            {(Object.keys(TYPE_META) as SType[]).map((t) => (
              <button key={t} onClick={() => { setSType(t); setView("form"); setErr(""); }}
                      className="flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-right transition hover:-translate-y-0.5 active:scale-[.98]"
                      style={{ borderColor: LINE }}>
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: NAVY }}>
                  <MIcon name={TYPE_META[t].icon} className="!text-[22px] text-white" />
                </span>
                <span>
                  <span className="block text-[14px] font-black" style={{ color: NAVY }}>{TYPE_META[t].title}</span>
                  <span className="text-[11.5px] font-bold" style={{ color: DIM }}>{TYPE_META[t].desc}</span>
                </span>
              </button>
            ))}
            {profile?.found && (
              <button onClick={() => setView("garage")} className="mx-auto flex items-center gap-1 text-[12px] font-black" style={{ color: DIM }}>
                <MIcon name="arrow_forward" className="!text-[15px]" /> رجوع لسياراتي
              </button>
            )}
          </div>
        )}

        {/* ══ 4) نموذج التسجيل الديناميكي ══ */}
        {view === "form" && (
          <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
            <div className="flex items-center justify-between">
              <button onClick={() => setView(profile?.found ? "garage" : "type")}
                      className="flex items-center gap-1 text-[12px] font-black" style={{ color: DIM }}>
                <MIcon name="arrow_forward" className="!text-[15px]" /> رجوع
              </button>
              <span className="rounded-full px-3 py-1 text-[11px] font-black text-white" style={{ background: NAVY }}>
                {TYPE_META[sType].title}
              </span>
            </div>

            <Section title="بياناتك">
              <TInput label="الاسم" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
              <TInput label="رقم الجوال" inputMode="tel" className="tnum" placeholder="05xxxxxxxx"
                      value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
            </Section>

            <Section title="بيانات السيارة">
              <div className="grid grid-cols-2 gap-2">
                <TInput label="أرقام اللوحة" inputMode="numeric" className="tnum text-center" placeholder="1288"
                        value={f.plateNumbers} onChange={(e) => setF({ ...f, plateNumbers: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                <TInput label="حروفها (إنجليزي)" dir="ltr" className="text-center uppercase" placeholder="HHR"
                        value={f.plateLetters} onChange={(e) => setF({ ...f, plateLetters: e.target.value.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) })} />
                <TInput label="الماركة" placeholder="تويوتا" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} />
                <TInput label="الموديل" placeholder="كامري" value={f.carName} onChange={(e) => setF({ ...f, carName: e.target.value })} />
                <TInput label="سنة الصنع" inputMode="numeric" className="tnum" placeholder="2022"
                        value={f.modelYear} onChange={(e) => setF({ ...f, modelYear: e.target.value.replace(/\D/g, "").slice(0, 4) })} />
                <TInput label="الممشى الحالي (كم)" inputMode="numeric" className="tnum" placeholder="84500"
                        value={f.odometer} onChange={(e) => setF({ ...f, odometer: e.target.value.replace(/\D/g, "") })} />
              </div>
            </Section>

            {(sType === "warranty" || sType === "company") && (
              <Section title="بيانات الضمان الكاملة">
                <div className="grid grid-cols-2 gap-2">
                  <TInput label="الفئة" placeholder="GLX / فل كامل" value={f.carCategory} onChange={(e) => setF({ ...f, carCategory: e.target.value })} />
                  <TInput label="السلندرات" inputMode="numeric" className="tnum" placeholder="4"
                          value={f.cylinders} onChange={(e) => setF({ ...f, cylinders: e.target.value })} />
                  <TInput label="اللون" placeholder="أبيض" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
                  <TInput label="رقم الهيكل (الشاصي)" dir="ltr" className="tnum uppercase"
                          value={f.chassisNumber} onChange={(e) => setF({ ...f, chassisNumber: e.target.value.toUpperCase() })} />
                </div>
              </Section>
            )}

            {sType === "company" && (
              <Section title="بيانات الفاتورة الضريبية">
                <div className="grid grid-cols-2 gap-2">
                  <TInput label="الرقم الضريبي (15 رقم)" inputMode="numeric" className="tnum" placeholder="3xxxxxxxxxxxxxx"
                          value={f.vat} onChange={(e) => setF({ ...f, vat: e.target.value.replace(/\D/g, "").slice(0, 15) })} />
                  <TInput label="رقم السجل التجاري" inputMode="numeric" className="tnum"
                          value={f.cr} onChange={(e) => setF({ ...f, cr: e.target.value })} />
                  <TInput label="رقم المبنى" inputMode="numeric" className="tnum"
                          value={f.buildingNo} onChange={(e) => setF({ ...f, buildingNo: e.target.value })} />
                  <TInput label="الشارع" value={f.street} onChange={(e) => setF({ ...f, street: e.target.value })} />
                  <TInput label="الحي" value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} />
                  <TInput label="المدينة" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
                  <TInput label="الرمز البريدي (اختياري)" inputMode="numeric" className="tnum"
                          value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} />
                  <TInput label="الرقم الإضافي (اختياري)" inputMode="numeric" className="tnum"
                          value={f.additionalNo} onChange={(e) => setF({ ...f, additionalNo: e.target.value })} />
                </div>
              </Section>
            )}

            {err && <p className="rounded-lg px-3 py-2 text-center text-[12px] font-bold" style={{ background: "rgba(220,38,38,.08)", color: "#DC2626" }}>{err}</p>}
            <button onClick={submitNew} disabled={busy}
                    className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-black text-white shadow-lg transition active:scale-[.98] disabled:opacity-50"
                    style={{ background: GREEN }}>
              <MIcon name="confirmation_number" className="!text-[20px] text-white" />
              {busy ? "جارِ الحجز..." : "حفظ السيارة وحجز الدور"}
            </button>
            <p className="text-center text-[10px]" style={{ color: DIM }}>
              سيارتك بتتحفظ في ملفك — المرة الجاية حجزك بضغطة واحدة، وبياناتك محفوظة حتى لو غيّرت جوالك ✨
            </p>
          </div>
        )}

        {/* ══ 5) التذكرة الحية ══ */}
        {view === "ticket" && booking && stateUi && (
          <div className="kiosk-pop space-y-3">
            <div className="overflow-hidden rounded-2xl bg-white shadow-lg">
              <div className="px-5 py-5 text-center" style={{ background: stateUi.bg }}>
                <MIcon name={stateUi.icon} filled className="!text-[44px]" />
                <div className="mt-1 text-[16px] font-black" style={{ color: stateUi.color }}>{stateUi.title}</div>
                <div className="text-[12.5px] font-bold" style={{ color: DIM }}>{stateUi.sub}</div>
              </div>
              <div className="space-y-2.5 px-5 py-4">
                <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: "#F1F4F8" }}>
                  <span className="text-[12.5px] font-bold" style={{ color: DIM }}>رقم دورك</span>
                  <span className="tnum text-[30px] font-black leading-none" style={{ color: NAVY }}>#{booking.queueNo}</span>
                </div>
                <div className="flex justify-between text-[12.5px]"><span style={{ color: DIM }}>الاسم</span><b>{booking.customerName}</b></div>
                <div className="flex justify-between text-[12.5px]"><span style={{ color: DIM }}>اللوحة</span><b className="tnum">{booking.plate}</b></div>
                <div className="flex justify-between text-[12.5px]"><span style={{ color: DIM }}>الفرع</span><b>{booking.branchName}</b></div>
              </div>
              <div className="h-3" style={{ background: "linear-gradient(45deg, #EEF2F6 50%, transparent 50%) 0 100%/12px 12px repeat-x, linear-gradient(-45deg, #EEF2F6 50%, transparent 50%) 6px 100%/12px 12px repeat-x" }} />
            </div>
            <p className="text-center text-[10.5px]" style={{ color: DIM }}>الصفحة بتتحدث تلقائياً — سيبها مفتوحة وتابع دورك</p>
            <button onClick={() => {
                      localStorage.removeItem(`z8_booking_${branchId}`);
                      const ph = localStorage.getItem("z8_cust_phone");
                      setBooking(null);
                      ph ? restoreProfile(ph, "") : setView("entry");
                    }}
                    className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 bg-white py-3 text-[13px] font-black transition active:scale-[.98]"
                    style={{ borderColor: LINE, color: NAVY }}>
              <MIcon name="add_circle" className="!text-[18px]" /> حجز جديد — اختر السيارة
            </button>
          </div>
        )}

        <p className="text-center text-[10px]" style={{ color: DIM }}>منصة Z8 — شركة مصدر الزيوت للتجارة · نسخة الحجز v2</p>
      </div>
    </div>
  );
}
