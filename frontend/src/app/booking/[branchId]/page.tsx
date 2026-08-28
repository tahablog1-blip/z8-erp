"use client";
// حجز الدور الذاتي — رحلة العميل الكاملة:
// جوال/لوحة → جراجه المحفوظ (بياناته ما بتضيعش) → أو تسجيل جديد بثلاث فئات → تذكرة حية
//
// ⚠️ قاعدة مهمة في هذا الملف:
// كل كومبوننت (TInput / Section / EntryCard / GarageCard / RegisterForm) معرّف
// خارج الكومبوننت الأب. لو اتعرّف جوه، React بيعتبره "نوع جديد" كل render
// فبيهد الحقول ويعيد بناءها → الفوكس بيضيع وتضطر تضغط قبل كل حرف.
// كمان: حالة الحقول (state) عايشة جوه كل كارت — الكتابة ما بتعملش render للأب أصلاً.
import { useEffect, useMemo, useRef, useState } from "react";
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
type ChatMsg = {
  id: string; sender_type: "employee" | "customer";
  message: string; attachment_url?: string | null; message_type?: string | null; created_at: string;
};
type ChatNote = { note_number: string; type: string; title?: string | null; description?: string | null; created_at: string };
type ChatData = { car: { plate?: string | null }; messages: ChatMsg[]; notes: ChatNote[]; typeLabels: Record<string, string> };
type SType = "basic" | "warranty" | "company";
type FormValues = {
  name: string; phone: string;
  plateNumbers: string; plateLetters: string; brand: string; carName: string; modelYear: string; odometer: string;
  carCategory: string; cylinders: string; color: string; chassisNumber: string;
  vat: string; cr: string; buildingNo: string; street: string; district: string; city: string; postalCode: string; additionalNo: string;
};

const NAVY = "#0F2D52", GREEN = "#16A34A", DIM = "#51617A", LINE = "#E2E8F0";
const TYPE_META: Record<SType, { title: string; desc: string; icon: string }> = {
  basic: { title: "خارج الضمان", desc: "بيانات مختصرة وسريعة", icon: "directions_car" },
  warranty: { title: "تحت الضمان", desc: "بيانات السيارة كاملة", icon: "verified_user" },
  company: { title: "سائق شركة — فاتورة ضريبية", desc: "بيانات كاملة + الرقم الضريبي والعنوان الوطني", icon: "apartment" },
};

const EMPTY_FORM: FormValues = {
  name: "", phone: "",
  plateNumbers: "", plateLetters: "", brand: "", carName: "", modelYear: "", odometer: "",
  carCategory: "", cylinders: "", color: "", chassisNumber: "",
  vat: "", cr: "", buildingNo: "", street: "", district: "", city: "", postalCode: "", additionalNo: "",
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/cars/public/${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || data?.detail || "حدث خطأ — حاول مرة أخرى");
  return data as T;
}

/* ═══════════ كومبوننتات ثابتة (module scope) ═══════════ */

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5 rounded-xl p-3" style={{ background: "#F6F8FA" }}>
      <div className="text-[12px] font-black" style={{ color: GREEN }}>{title}</div>
      {children}
    </div>
  );
}

function ErrBox({ msg }: { msg: string }) {
  if (!msg) return null;
  return (
    <p className="rounded-lg px-3 py-2 text-center text-[12px] font-bold"
       style={{ background: "rgba(220,38,38,.08)", color: "#DC2626" }}>{msg}</p>
  );
}

/* ── 1) كارت الدخول ── */
function EntryCard({ busy, err, onSubmit }: {
  busy: boolean; err: string; onSubmit: (phone: string, plate: string) => void;
}) {
  const [phone, setPhone] = useState("");
  const [plate, setPlate] = useState("");
  const blocked = busy || (phone.replace(/\D/g, "").length < 9 && plate.trim().length < 4);

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>أهلاً بك 👋</h2>
      <p className="text-center text-[12px]" style={{ color: DIM }}>
        أدخل جوالك أو رقم لوحتك — لو سجّلت قبل كده هنرجّع بياناتك وسياراتك فوراً
      </p>
      <TInput label="رقم الجوال" inputMode="tel" placeholder="05xxxxxxxx" className="tnum"
              value={phone} onChange={(e) => setPhone(e.target.value)} />
      <div className="text-center text-[11px] font-bold" style={{ color: DIM }}>— أو —</div>
      <TInput label="رقم اللوحة (أرقام وحروف)" placeholder="1288HHR" dir="ltr" className="tnum text-center uppercase"
              value={plate} onChange={(e) => setPlate(e.target.value)} />
      <ErrBox msg={err} />
      <button onClick={() => onSubmit(phone, plate)} disabled={blocked}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-black text-white shadow-lg transition active:scale-[.98] disabled:opacity-40"
              style={{ background: GREEN }}>
        <MIcon name="arrow_back" className="!text-[20px] text-white" />
        {busy ? "جارِ البحث..." : "متابعة"}
      </button>
    </div>
  );
}

/* ── 2) كارت الجراج ── */
function GarageCard({ profile, busy, err, onBook, onAddNew }: {
  profile: Profile; busy: boolean; err: string;
  onBook: (car: SavedCar, odometer: string) => void; onAddNew: () => void;
}) {
  const [quickCar, setQuickCar] = useState<SavedCar | null>(null);
  const [quickOdo, setQuickOdo] = useState("");

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>
        أهلاً {profile.customer?.name} 👋
      </h2>
      <p className="text-center text-[12px]" style={{ color: DIM }}>اختر سيارتك لحجز الدور بضغطة</p>
      <div className="space-y-2">
        {(profile.cars || []).map((c) => (
          <button key={c.id} onClick={() => { setQuickCar(c); setQuickOdo(""); }}
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
          <button onClick={() => onBook(quickCar, quickOdo)} disabled={busy || !quickOdo}
                  className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-[14px] font-black text-white transition active:scale-[.98] disabled:opacity-40"
                  style={{ background: GREEN }}>
            <MIcon name="confirmation_number" className="!text-[19px] text-white" />
            {busy ? "جارِ الحجز..." : `تأكيد حجز ${quickCar.plate}`}
          </button>
        </div>
      )}
      <ErrBox msg={err} />
      <button onClick={onAddNew}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl border-2 border-dashed py-3 text-[13px] font-black transition active:scale-[.98]"
              style={{ borderColor: LINE, color: NAVY }}>
        <MIcon name="add_circle" className="!text-[18px]" /> إضافة سيارة أخرى
      </button>
    </div>
  );
}

/* ── 4) نموذج التسجيل — الحالة جوّه الكومبوننت ── */
function RegisterForm({ sType, initial, busy, err, onBack, onSubmit }: {
  sType: SType; initial: FormValues; busy: boolean; err: string;
  onBack: (v: FormValues) => void; onSubmit: (v: FormValues) => void;
}) {
  const [f, setF] = useState<FormValues>(initial);
  const set = (k: keyof FormValues) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setF((p) => ({ ...p, [k]: v }));
  };
  const setClean = (k: keyof FormValues, fn: (s: string) => string) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = fn(e.target.value);
      setF((p) => ({ ...p, [k]: v }));
    };

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <div className="flex items-center justify-between">
        <button onClick={() => onBack(f)} className="flex items-center gap-1 text-[12px] font-black" style={{ color: DIM }}>
          <MIcon name="arrow_forward" className="!text-[15px]" /> رجوع
        </button>
        <span className="rounded-full px-3 py-1 text-[11px] font-black text-white" style={{ background: NAVY }}>
          {TYPE_META[sType].title}
        </span>
      </div>

      <Section title="بياناتك">
        <TInput label="الاسم" value={f.name} onChange={set("name")} />
        <TInput label="رقم الجوال" inputMode="tel" className="tnum" placeholder="05xxxxxxxx"
                value={f.phone} onChange={set("phone")} />
      </Section>

      <Section title="بيانات السيارة">
        <div className="grid grid-cols-2 gap-2">
          <TInput label="أرقام اللوحة" inputMode="numeric" className="tnum text-center" placeholder="1288"
                  value={f.plateNumbers} onChange={setClean("plateNumbers", (s) => s.replace(/\D/g, "").slice(0, 4))} />
          <TInput label="حروفها (إنجليزي)" dir="ltr" className="text-center uppercase" placeholder="HHR"
                  value={f.plateLetters} onChange={setClean("plateLetters", (s) => s.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3))} />
          <TInput label="الماركة" placeholder="تويوتا" value={f.brand} onChange={set("brand")} />
          <TInput label="الموديل" placeholder="كامري" value={f.carName} onChange={set("carName")} />
          <TInput label="سنة الصنع" inputMode="numeric" className="tnum" placeholder="2022"
                  value={f.modelYear} onChange={setClean("modelYear", (s) => s.replace(/\D/g, "").slice(0, 4))} />
          <TInput label="الممشى الحالي (كم)" inputMode="numeric" className="tnum" placeholder="84500"
                  value={f.odometer} onChange={setClean("odometer", (s) => s.replace(/\D/g, ""))} />
        </div>
      </Section>

      {(sType === "warranty" || sType === "company") && (
        <Section title="بيانات الضمان الكاملة">
          <div className="grid grid-cols-2 gap-2">
            <TInput label="الفئة" placeholder="GLX / فل كامل" value={f.carCategory} onChange={set("carCategory")} />
            <TInput label="السلندرات" inputMode="numeric" className="tnum" placeholder="4"
                    value={f.cylinders} onChange={set("cylinders")} />
            <TInput label="اللون" placeholder="أبيض" value={f.color} onChange={set("color")} />
            <TInput label="رقم الهيكل (الشاصي)" dir="ltr" className="tnum uppercase"
                    value={f.chassisNumber} onChange={setClean("chassisNumber", (s) => s.toUpperCase())} />
          </div>
        </Section>
      )}

      {sType === "company" && (
        <Section title="بيانات الفاتورة الضريبية">
          <div className="grid grid-cols-2 gap-2">
            <TInput label="الرقم الضريبي (15 رقم)" inputMode="numeric" className="tnum" placeholder="3xxxxxxxxxxxxxx"
                    value={f.vat} onChange={setClean("vat", (s) => s.replace(/\D/g, "").slice(0, 15))} />
            <TInput label="رقم السجل التجاري" inputMode="numeric" className="tnum"
                    value={f.cr} onChange={set("cr")} />
            <TInput label="رقم المبنى" inputMode="numeric" className="tnum"
                    value={f.buildingNo} onChange={set("buildingNo")} />
            <TInput label="الشارع" value={f.street} onChange={set("street")} />
            <TInput label="الحي" value={f.district} onChange={set("district")} />
            <TInput label="المدينة" value={f.city} onChange={set("city")} />
            <TInput label="الرمز البريدي (اختياري)" inputMode="numeric" className="tnum"
                    value={f.postalCode} onChange={set("postalCode")} />
            <TInput label="الرقم الإضافي (اختياري)" inputMode="numeric" className="tnum"
                    value={f.additionalNo} onChange={set("additionalNo")} />
          </div>
        </Section>
      )}

      <ErrBox msg={err} />
      <button onClick={() => onSubmit(f)} disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl py-3.5 text-[15px] font-black text-white shadow-lg transition active:scale-[.98] disabled:opacity-50"
              style={{ background: GREEN }}>
        <MIcon name="confirmation_number" className="!text-[20px] text-white" />
        {busy ? "جارِ الحجز..." : "حفظ السيارة وحجز الدور"}
      </button>
      <p className="text-center text-[10px]" style={{ color: DIM }}>
        سيارتك بتتحفظ في ملفك — المرة الجاية حجزك بضغطة واحدة، وبياناتك محفوظة حتى لو غيّرت جوالك ✨
      </p>
    </div>
  );
}

/* ═══════════ محادثة مركز الخدمة (مرحلة 3) — module scope ═══════════ */

const QUICK_REPLIES = [
  "موافق — نفّذوا الخدمة ✅",
  "غير موافق حالياً ❌",
  "كم التكلفة الإضافية؟",
  "اتصلوا بي من فضلكم 📞",
];

function fmtChatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ar-SA", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch { return ""; }
}

// تحويل التسجيل الخام إلى WAV (mono 16kHz) — الصيغة الوحيدة المضمونة التشغيل على كل الأجهزة
function encodeWav(chunks: Float32Array[], inRate: number): Blob {
  const OUT = 16000;
  let len = 0; for (const c of chunks) len += c.length;
  const all = new Float32Array(len);
  let off = 0; for (const c of chunks) { all.set(c, off); off += c.length; }
  const ratio = inRate / OUT;
  const outLen = Math.floor(all.length / ratio);
  const pcm = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const s = Math.max(-1, Math.min(1, all[Math.floor(i * ratio)] || 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const dv = new DataView(buf);
  const ws = (o: number, t: string) => { for (let i = 0; i < t.length; i++) dv.setUint8(o + i, t.charCodeAt(i)); };
  ws(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, OUT, true); dv.setUint32(28, OUT * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  ws(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: "audio/wav" });
}

function ChatBubble({ m }: { m: ChatMsg }) {
  const mine = m.sender_type === "customer";
  return (
    <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed ${mine ? "rounded-bl-sm text-white" : "rounded-br-sm border bg-white"}`}
           style={mine ? { background: GREEN } : { borderColor: LINE, color: "#1E293B" }}>
        {m.attachment_url && (m.message_type === "voice" || m.attachment_url.endsWith(".wav")) ? (
          <audio controls preload="metadata" src={m.attachment_url} className="my-0.5 w-[215px] max-w-full" />
        ) : m.attachment_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.attachment_url} alt="" className="mb-1.5 max-h-52 rounded-lg" />
        ) : null}
        {(!m.attachment_url || m.message_type !== "voice") && (
          <p className="whitespace-pre-wrap break-words font-bold">{m.message}</p>
        )}
        <p className="mt-0.5 text-[9.5px]" style={{ color: mine ? "rgba(255,255,255,.75)" : DIM }}>
          {mine ? "أنت" : "مركز الخدمة"} · {fmtChatTime(m.created_at)}
        </p>
      </div>
    </div>
  );
}

function ChatNoteCard({ n, labels }: { n: ChatNote; labels: Record<string, string> }) {
  return (
    <div className="rounded-xl border px-3.5 py-2.5" style={{ borderColor: "#FDE68A", background: "#FFFBEB" }}>
      <div className="flex items-center justify-between gap-2">
        <span className="rounded-full px-2.5 py-0.5 text-[10.5px] font-black" style={{ background: "#FDE68A", color: "#92400E" }}>
          {labels[n.type] ?? n.type}
        </span>
        <span className="tnum text-[10px] font-bold" style={{ color: "#B45309" }}>{n.note_number}</span>
      </div>
      {n.title && <p className="mt-1 text-[12.5px] font-black" style={{ color: NAVY }}>{n.title}</p>}
      {n.description && <p className="mt-0.5 text-[12.5px] font-bold" style={{ color: "#334155" }}>{n.description}</p>}
    </div>
  );
}

// carId = رقم الحجز (نفس رقم السيارة) — بيتحول لتوكن آمن تلقائياً
// urlToken = توكن جاهز جاي من رابط الواتساب ?t=
function ChatSection({ carId, urlToken }: { carId?: string | null; urlToken?: string | null }) {
  const [token, setToken] = useState<string | null>(urlToken || null);
  const [data, setData] = useState<ChatData | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [cErr, setCErr] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const countRef = useRef(0);
  const [recOn, setRecOn] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef<any>(null);
  const recTimer = useRef<any>(null);
  const recStart = useRef(0);

  // تحويل رقم الحجز لتوكن آمن (لو مفيش توكن من الرابط)
  useEffect(() => {
    if (token || !carId) return;
    fetch(`/api/service-notes/public/car-token/${carId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.token && setToken(d.token))
      .catch(() => {});
  }, [token, carId]);

  // تحميل المحادثة + تحديث كل 10 ثوانٍ
  useEffect(() => {
    if (!token) return;
    let alive = true;
    const load = async () => {
      try {
        const r = await fetch(`/api/service-notes/public/${token}/messages`, { cache: "no-store" });
        if (!r.ok || !alive) return;
        const d: ChatData = await r.json();
        setData(d);
        if (d.messages.length !== countRef.current) {
          countRef.current = d.messages.length;
          setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 120);
        }
      } catch {}
    };
    load();
    const t = setInterval(load, 10000);
    return () => { alive = false; clearInterval(t); };
  }, [token]);

  async function sendMsg(preset?: string) {
    const body = (preset ?? text).trim();
    if (!body || sending || !token) return;
    setSending(true); setCErr("");
    try {
      const r = await fetch(`/api/service-notes/public/${token}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: body, messageType: "text" }),
      });
      if (r.ok) {
        setText("");
        countRef.current = -1; // إجبار إعادة التحميل والنزول لآخر رسالة
        const rr = await fetch(`/api/service-notes/public/${token}/messages`, { cache: "no-store" });
        if (rr.ok) { const d: ChatData = await rr.json(); setData(d); countRef.current = d.messages.length; }
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 120);
      } else setCErr("تعذّر الإرسال — حاول مرة أخرى");
    } catch { setCErr("تعذّر الاتصال — حاول مرة أخرى"); }
    finally { setSending(false); }
  }

  function teardownRec() {
    clearInterval(recTimer.current);
    const r = recRef.current;
    if (r) {
      try { r.proc.disconnect(); r.src.disconnect(); } catch {}
      try { r.stream.getTracks().forEach((t: any) => t.stop()); } catch {}
      try { r.ctx.close(); } catch {}
    }
    setRecOn(false);
  }

  // إيقاف التسجيل وتنضيف الموارد عند الخروج من الصفحة
  useEffect(() => () => { try { teardownRec(); } catch {} }, []); // eslint-disable-line

  async function startRec() {
    if (recOn || sending || !token) return;
    setCErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const Ctx: any = (window as any).AudioContext || (window as any).webkitAudioContext;
      const ctx = new Ctx();
      const srcNode = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      proc.onaudioprocess = (e: any) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      srcNode.connect(proc); proc.connect(ctx.destination);
      recRef.current = { ctx, stream, proc, src: srcNode, chunks, sr: ctx.sampleRate };
      recStart.current = Date.now();
      setRecSec(0); setRecOn(true);
      recTimer.current = setInterval(() => {
        const s = Math.floor((Date.now() - recStart.current) / 1000);
        setRecSec(s);
        if (s >= 60) stopRec(true); // حد أقصى دقيقة
      }, 500);
    } catch {
      setCErr("اسمح بالوصول للمايكروفون من المتصفح أولاً 🎤");
    }
  }

  async function stopRec(send: boolean) {
    const r = recRef.current;
    teardownRec();
    recRef.current = null;
    if (!send || !r || !token) return;
    const blob = encodeWav(r.chunks, r.sr);
    if (blob.size < 6000) { setCErr("التسجيل قصير جداً — حاول مرة أخرى"); return; }
    setSending(true); setCErr("");
    try {
      const fd = new FormData();
      fd.append("file", blob, "voice.wav");
      const resp = await fetch(`/api/service-notes/public/${token}/voice`, { method: "POST", body: fd });
      if (resp.ok) {
        const rr = await fetch(`/api/service-notes/public/${token}/messages`, { cache: "no-store" });
        if (rr.ok) { const d: ChatData = await rr.json(); setData(d); countRef.current = d.messages.length; }
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 120);
      } else setCErr("تعذّر إرسال التسجيل — حاول مرة أخرى");
    } catch { setCErr("تعذّر الاتصال — حاول مرة أخرى"); }
    finally { setSending(false); }
  }

  if (!token) return null;

  return (
    <div className="kiosk-pop space-y-2.5 rounded-2xl bg-white p-4 shadow-lg">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-[13.5px] font-black" style={{ color: NAVY }}>
          <MIcon name="forum" className="!text-[19px]" /> تواصل مع مركز الخدمة
        </h3>
        {data?.car?.plate && (
          <span className="tnum rounded-lg px-2 py-0.5 text-[11px] font-black text-white" style={{ background: NAVY }}>{data.car.plate}</span>
        )}
      </div>

      {data && data.notes.length > 0 && (
        <div className="space-y-1.5">
          {data.notes.map((n) => <ChatNoteCard key={n.note_number} n={n} labels={data.typeLabels} />)}
        </div>
      )}

      <div className="max-h-[42vh] space-y-2 overflow-y-auto rounded-xl p-2.5" style={{ background: "#F6F8FA" }}>
        {(!data || data.messages.length === 0) && (
          <p className="py-5 text-center text-[11.5px] font-bold" style={{ color: DIM }}>
            اكتب رسالتك وسيصلك الرد هنا — أي تحديث عن سيارتك هيظهر في نفس المكان 💬
          </p>
        )}
        {data?.messages.map((m) => <ChatBubble key={m.id} m={m} />)}
        <div ref={endRef} />
      </div>

      <div className="flex flex-wrap gap-1.5">
        {QUICK_REPLIES.map((q) => (
          <button key={q} disabled={sending} onClick={() => sendMsg(q)}
                  className="rounded-full border px-3 py-1.5 text-[11px] font-black transition active:scale-[.97] disabled:opacity-40"
                  style={{ borderColor: LINE, color: NAVY, background: "#fff" }}>
            {q}
          </button>
        ))}
      </div>

      {!recOn ? (
        <div className="flex gap-2">
          <button onClick={startRec} disabled={sending} title="تسجيل رسالة صوتية"
                  className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-xl border transition active:scale-[.95] disabled:opacity-40"
                  style={{ borderColor: LINE, color: NAVY }}>
            <MIcon name="mic" className="!text-[21px]" />
          </button>
          <input value={text} onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") sendMsg(); }}
                 placeholder="اكتب رسالتك هنا…" maxLength={2000}
                 className="min-w-0 flex-1 rounded-xl border px-3.5 py-2.5 text-[13px] font-bold outline-none focus:border-[#0F2D52]"
                 style={{ borderColor: LINE }} />
          <button onClick={() => sendMsg()} disabled={sending || !text.trim()}
                  className="flex items-center gap-1 rounded-xl px-4 py-2.5 text-[13px] font-black text-white transition active:scale-[.97] disabled:opacity-40"
                  style={{ background: GREEN }}>
            <MIcon name="send" className="!text-[17px] text-white" />
            {sending ? "…" : "إرسال"}
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-xl px-3 py-2.5" style={{ background: "rgba(220,38,38,.07)" }}>
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full" style={{ background: "#DC2626" }} />
          <span className="tnum min-w-0 flex-1 text-[12px] font-black" style={{ color: "#DC2626" }}>
            جارِ التسجيل… {recSec} ث / 60
          </span>
          <button onClick={() => stopRec(true)}
                  className="rounded-lg px-3.5 py-2 text-[12px] font-black text-white active:scale-[.97]"
                  style={{ background: GREEN }}>إيقاف وإرسال</button>
          <button onClick={() => stopRec(false)}
                  className="rounded-lg border px-3 py-2 text-[12px] font-black active:scale-[.97]"
                  style={{ borderColor: LINE, color: DIM }}>إلغاء</button>
        </div>
      )}
      {cErr && <ErrBox msg={cErr} />}
    </div>
  );
}

/* ═══════════ اختيار الزيت والفلتر — أنواع البيانات ═══════════ */
type OilProduct = {
  id: string; name: string; spec: string; unit: string; brand: string;
  price: number; image: string | null;
};
type CatProduct = { id: string; name: string; spec: string; unit: string; price: number; hasImage: boolean };
type CatalogCat = { name: string; count: number };
type ExtraSel = { p: CatProduct; qty: number };
type AutoService = { id: string; name: string; price: number };
type BrandLogo = { name: string; logo: string | null };
type PrevInvoice = {
  id: string; invoiceNo: string; issuedAt: string; total: number;
  odometer: number | null; status: string;
};
type PrevItem = { label: string; qty: number; lineInc: number; productId: string | null };
type Selection = {
  oil: OilProduct | null; oilQty: number;
  withFilter: boolean | null; filter: OilProduct | null;
  extras: ExtraSel[];
  fromInvoice: string | null;
};
const EMPTY_SEL: Selection = { oil: null, oilQty: 1, withFilter: null, filter: null, extras: [], fromInvoice: null };
// رابط تحميل التطبيق — عدّله لرابط متجرك الفعلي
const APP_URL = "https://play.google.com/store/apps/details?id=com.carexpert.entrymanager";

function money(n: number): string { return n.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

// مطابقة مرنة بين اسم كارت الشركة (المستنتج من الأصناف) واسم الشركة في جدول الشعارات
function brandLogoFor(name: string, logos: BrandLogo[]): string | null {
  const n = (name || "").trim();
  if (!n) return null;
  for (const b of logos) {
    const bn = (b.name || "").trim();
    if (bn && b.logo && (bn === n || bn.includes(n) || n.includes(bn))) return b.logo;
  }
  return null;
}

/* ═══════════ 🛢 زيت سيارتك — الكمية المعتمدة لموديلك (تُحدد مرة واحدة) ═══════════ */
function OilCard({ carId }: { carId: string }) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<{ oilQty: number | null; oilType: string; brand?: string; model?: string; modelYear?: string } | null>(null);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (info || loading) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/cars/public/oil-info/${carId}`, { cache: "no-store" });
      if (r.ok) setInfo(await r.json());
    } catch { /* الخادم غير متاح */ }
    setLoading(false);
  }

  return (
    <div className="kiosk-pop rounded-2xl bg-white p-4 shadow-lg">
      <button onClick={toggle}
              className="flex w-full items-center justify-between text-right">
        <span className="flex items-center gap-1.5 text-[13.5px] font-black" style={{ color: NAVY }}>
          🛢 زيت سيارتك
        </span>
        <span className="text-[13px] font-black" style={{ color: DIM }}>{open ? "▴" : "▾"}</span>
      </button>
      {open && (
        <div className="mt-3">
          {loading && <p className="text-[12px] font-bold" style={{ color: DIM }}>جارِ التحميل…</p>}
          {!loading && info && info.oilQty != null && (
            <div className="rounded-xl p-3" style={{ background: "#F0FDF4", border: "1px solid #BBF7D0" }}>
              <p className="text-[13px] font-black" style={{ color: "#166534" }}>
                الكمية المعتمدة لموديل سيارتك: {info.oilQty} لتر
                {info.oilType && <> — {info.oilType}</>}
              </p>
              <p className="mt-0.5 text-[11px] font-bold" style={{ color: "#15803D" }}>
                {[info.brand, info.model, info.modelYear].filter(Boolean).join(" ")}
              </p>
            </div>
          )}
          {!loading && (!info || info.oilQty == null) && (
            <p className="rounded-xl p-3 text-[12px] font-bold"
               style={{ background: "#F6F8FA", color: DIM }}>
              لم تُحدد كمية الزيت لموديل سيارتك بعد — سيحددها الفني عند الخدمة وتظهر هنا تلقائياً لكل زياراتك القادمة.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/* ═══════════ خطوة اختيار الزيت — بطاقات المنتجات + تكرار فاتورة سابقة ═══════════ */
function OilPicker({ branchId, phone, sel, setSel, onNext, onBack }: {
  branchId: string; phone: string; sel: Selection;
  setSel: (s: Selection) => void; onNext: () => void; onBack: () => void;
}) {
  const [oils, setOils] = useState<OilProduct[] | null>(null);
  const [brandLogos, setBrandLogos] = useState<BrandLogo[]>([]);
  const [mode, setMode] = useState<"choose" | "repeat" | "list">("choose");
  const [invoices, setInvoices] = useState<PrevInvoice[] | null>(null);
  const [loadingInv, setLoadingInv] = useState(false);
  const [err, setErr] = useState("");
  const [q, setQ] = useState("");

  useEffect(() => {
    call<{ oils: OilProduct[]; brands?: BrandLogo[] }>(`booking-products/${branchId}`)
      .then((r) => { setOils(r.oils); setBrandLogos(r.brands || []); }).catch(() => setOils([]));
  }, [branchId]);

  async function openRepeat() {
    setMode("repeat"); setErr("");
    if (invoices) return;
    setLoadingInv(true);
    try {
      const r = await call<{ invoices: PrevInvoice[] }>(`booking-invoices/${branchId}`, {
        method: "POST", body: JSON.stringify({ phone }),
      });
      setInvoices(r.invoices);
    } catch { setInvoices([]); }
    finally { setLoadingInv(false); }
  }

  async function repeatInvoice(inv: PrevInvoice) {
    setErr("");
    try {
      const r = await call<{ items: PrevItem[] }>(`booking-invoice-items/${inv.id}?phone=${encodeURIComponent(phone)}`);
      // أول صنف زيت في الفاتورة يصبح الاختيار — والباقي يظهر في الملخص كخدمات الفاتورة السابقة
      const oilItem = r.items.find((it) => it.productId && oils?.some((o) => o.id === it.productId));
      const oil = oilItem ? oils!.find((o) => o.id === oilItem.productId)! : null;
      setSel({ ...sel, oil, oilQty: oilItem ? Math.max(1, Math.round(oilItem.qty)) : 1, fromInvoice: inv.invoiceNo });
      onNext();
    } catch (e: any) { setErr(e.message || "تعذر تحميل الفاتورة"); }
  }

  const [brandPick, setBrandPick] = useState<string | null>(null);

  const brands = useMemo(() => {
    // ملاحظة: بطاقة الشركة بلا صورة حالياً — لوجوهات الشركات الرسمية تُضاف لاحقاً.
    // صور المنتجات تبقى في مكانها الصحيح: على المنتجات نفسها داخل كل شركة.
    const map = new Map<string, { name: string; count: number }>();
    for (const o of oils || []) {
      const b = (o.brand || "").trim() || "أخرى";
      const cur = map.get(b) || { name: b, count: 0 };
      cur.count += 1;
      map.set(b, cur);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [oils]);

  const ql = q.trim();
  const shown = (oils || []).filter((o) =>
    (ql
      ? o.name.includes(ql) || o.brand.includes(ql) || o.spec.includes(ql)
      : !brandPick || ((o.brand || "").trim() || "أخرى") === brandPick));

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>🛢 اختيار الزيت</h2>

      {mode === "choose" && (
        <div className="space-y-2.5">
          <button onClick={openRepeat}
                  className="flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-right transition active:scale-[.98]"
                  style={{ borderColor: LINE }}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: GREEN }}>
              <MIcon name="replay" className="!text-[22px] text-white" />
            </span>
            <span>
              <span className="block text-[14px] font-black" style={{ color: NAVY }}>تكرار فاتورة سابقة</span>
              <span className="text-[11.5px] font-bold" style={{ color: DIM }}>نفس زيت آخر زيارة — أسرع طريقة</span>
            </span>
          </button>
          <button onClick={() => setMode("list")}
                  className="flex w-full items-center gap-3 rounded-xl border-2 p-3.5 text-right transition active:scale-[.98]"
                  style={{ borderColor: LINE }}>
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl text-white" style={{ background: NAVY }}>
              <MIcon name="oil_barrel" className="!text-[22px] text-white" />
            </span>
            <span>
              <span className="block text-[14px] font-black" style={{ color: NAVY }}>اختيار زيت آخر</span>
              <span className="text-[11.5px] font-bold" style={{ color: DIM }}>تصفح الزيوت المتاحة واختر المناسب</span>
            </span>
          </button>
          <button onClick={onNext}
                  className="w-full rounded-xl py-2.5 text-[12px] font-black" style={{ color: DIM }}>
            التحديد عند الوصول — تخطي ›
          </button>
        </div>
      )}

      {mode === "repeat" && (
        <div className="space-y-2">
          {loadingInv && <p className="py-4 text-center text-[12px]" style={{ color: DIM }}>جارِ تحميل فواتيرك...</p>}
          {!loadingInv && invoices !== null && invoices.length === 0 && (
            <p className="rounded-xl p-3 text-center text-[12px] font-bold" style={{ background: "#F6F8FA", color: DIM }}>
              لا توجد فواتير سابقة بهذا الجوال — اختر زيتاً من القائمة
            </p>
          )}
          {(invoices || []).map((inv) => (
            <button key={inv.id} onClick={() => repeatInvoice(inv)}
                    className="flex w-full items-center justify-between rounded-xl border-2 p-3 text-right transition active:scale-[.98]"
                    style={{ borderColor: LINE }}>
              <span>
                <span className="tnum block text-[13px] font-black" style={{ color: NAVY }}>{inv.invoiceNo}</span>
                <span className="tnum text-[11px] font-bold" style={{ color: DIM }}>
                  {new Date(inv.issuedAt).toLocaleDateString("ar-SA-u-nu-latn")}
                  {inv.odometer != null && <> · عداد {inv.odometer.toLocaleString("en")}</>}
                </span>
              </span>
              <span className="tnum text-[13px] font-black" style={{ color: GREEN }}>{money(inv.total)} ر.س</span>
            </button>
          ))}
          {err && <ErrBox msg={err} />}
          <button onClick={() => setMode("choose")} className="mx-auto flex items-center gap-1 text-[12px] font-black" style={{ color: DIM }}>
            <MIcon name="arrow_forward" className="!text-[15px]" /> رجوع
          </button>
        </div>
      )}

      {mode === "list" && (
        <div className="space-y-2.5">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث: اسم / ماركة / لزوجة"
                 className="w-full rounded-xl border-2 px-3.5 py-2.5 text-[13px] font-bold outline-none"
                 style={{ borderColor: LINE }} />
          {oils === null && <p className="py-4 text-center text-[12px]" style={{ color: DIM }}>جارِ التحميل...</p>}

          {/* ═══ الشركات أولاً — شبكة منظمة 3 أعمدة (الاسم + الشعار) ═══ */}
          {!ql && !brandPick && oils !== null && (
            <div className="grid grid-cols-3 gap-2">
              {brands.map((b) => (
                <button key={b.name} onClick={() => setBrandPick(b.name)}
                        className="flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition active:scale-[.97]"
                        style={{ borderColor: LINE, background: "#fff" }}>
                  {(() => {
                    const lg = brandLogoFor(b.name, brandLogos);
                    return lg
                      ? <img src={lg} alt="" loading="lazy"
                             className="h-11 w-11 rounded-full object-contain" style={{ background: "#EEF3F9" }} />
                      : <span className="grid h-11 w-11 place-items-center rounded-full text-[20px]"
                              style={{ background: "#EEF3F9", color: NAVY }}>
                          <MIcon name="oil_barrel" className="!text-[22px]" />
                        </span>;
                  })()}
                  <span className="line-clamp-1 text-[11.5px] font-black" style={{ color: NAVY }}>{b.name}</span>
                  <span className="tnum text-[9.5px] font-bold" style={{ color: DIM }}>{b.count} منتج</span>
                </button>
              ))}
            </div>
          )}

          {/* شريط الشركة المختارة + رجوع للشركات */}
          {!ql && brandPick && (
            <div className="flex items-center justify-between rounded-xl px-3.5 py-2" style={{ background: "#F1F4F8" }}>
              <span className="text-[12.5px] font-black" style={{ color: NAVY }}>🏷 {brandPick}</span>
              <button onClick={() => setBrandPick(null)} className="text-[11.5px] font-black" style={{ color: GREEN }}>
                ‹ كل الشركات
              </button>
            </div>
          )}

          <div className={(!ql && !brandPick) ? "hidden" : "grid max-h-[46vh] gap-2 overflow-y-auto"}>
            {shown.map((o) => {
              const active = sel.oil?.id === o.id;
              return (
                <button key={o.id} onClick={() => setSel({ ...sel, oil: o, fromInvoice: null })}
                        className="flex flex-col gap-2 rounded-xl border-2 p-3 text-right transition active:scale-[.98]"
                        style={{ borderColor: active ? GREEN : LINE, background: active ? "rgba(22,163,74,.06)" : "#fff" }}>
                  {/* الصف العلوي: الصورة + الاسم كاملاً بلا قطع (يلف على أكثر من سطر) */}
                  <span className="flex w-full items-start gap-3">
                    {o.image
                      ? <img src={o.image} alt="" className="h-12 w-12 shrink-0 rounded-lg object-contain" style={{ background: "#F6F8FA" }} />
                      : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-[22px]" style={{ background: "#F6F8FA" }}>🛢</span>}
                    <span className="min-w-0 flex-1">
                      {/* بلا truncate: الاسم يظهر كاملاً حتى لو طال، يلف على سطرين+ */}
                      <span className="block text-[13px] font-black leading-snug" style={{ color: NAVY }}>{o.name}</span>
                      <span className="text-[10.5px] font-bold" style={{ color: DIM }}>
                        {[o.brand, o.spec, o.unit].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {active && <MIcon name="check_circle" filled className="!text-[20px] shrink-0" />}
                  </span>
                  {/* الصف السفلي: السعر بشارة بارزة بعرض كامل — لا يفوته أحد أثناء المرور السريع */}
                  <span className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5"
                        style={{ background: "rgba(22,163,74,.08)" }}>
                    <span className="text-[9.5px] font-bold" style={{ color: DIM }}>السعر شامل الضريبة</span>
                    <span className="tnum text-[15px] font-black" style={{ color: GREEN }}>{money(o.price)} ر.س</span>
                  </span>
                </button>
              );
            })}
            {oils !== null && shown.length === 0 && (
              <p className="py-4 text-center text-[12px]" style={{ color: DIM }}>لا نتائج مطابقة</p>
            )}
          </div>
          {sel.oil && (
            <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: "#F1F4F8" }}>
              <span className="text-[12px] font-black" style={{ color: NAVY }}>الكمية (عبوة)</span>
              <span className="flex items-center gap-3">
                <button onClick={() => setSel({ ...sel, oilQty: Math.max(1, sel.oilQty - 1) })}
                        className="grid h-9 w-9 place-items-center rounded-full text-[18px] font-black text-white" style={{ background: NAVY }}>−</button>
                <b className="tnum w-6 text-center text-[16px]">{sel.oilQty}</b>
                <button onClick={() => setSel({ ...sel, oilQty: Math.min(9, sel.oilQty + 1) })}
                        className="grid h-9 w-9 place-items-center rounded-full text-[18px] font-black text-white" style={{ background: GREEN }}>+</button>
              </span>
            </div>
          )}
          <button onClick={() => setMode("choose")} className="mx-auto flex items-center gap-1 text-[12px] font-black" style={{ color: DIM }}>
            <MIcon name="arrow_forward" className="!text-[15px]" /> رجوع
          </button>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="rounded-xl border-2 px-4 py-3 text-[13px] font-black" style={{ borderColor: LINE, color: DIM }}>رجوع</button>
        <button onClick={onNext} disabled={mode === "list" && !sel.oil}
                className="flex-1 rounded-xl py-3 text-[14px] font-black text-white transition active:scale-[.98] disabled:opacity-40"
                style={{ background: GREEN }}>
          {sel.oil ? "التالي — فلتر الزيت ‹" : "متابعة بدون تحديد ‹"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════ خطوة فلتر الزيت ═══════════ */
function FilterPicker({ branchId, sel, setSel, onNext, onBack }: {
  branchId: string; sel: Selection; setSel: (s: Selection) => void;
  onNext: () => void; onBack: () => void;
}) {
  const [filters, setFilters] = useState<OilProduct[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    call<{ filters: OilProduct[] }>(`booking-products/${branchId}`)
      .then((r) => setFilters(r.filters)).catch(() => setFilters([]));
  }, [branchId]);

  const ql = q.trim();
  const shown = (filters || []).filter((f) => !ql || f.name.includes(ql) || (f.brand || "").includes(ql));

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>هل تريد تغيير فلتر الزيت؟</h2>
      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => setSel({ ...sel, withFilter: true })}
                className="rounded-xl border-2 py-3.5 text-[13.5px] font-black transition active:scale-[.98]"
                style={{ borderColor: sel.withFilter === true ? GREEN : LINE,
                         background: sel.withFilter === true ? "rgba(22,163,74,.06)" : "#fff", color: NAVY }}>
          ✓ مع فلتر الزيت
        </button>
        <button onClick={() => setSel({ ...sel, withFilter: false, filter: null })}
                className="rounded-xl border-2 py-3.5 text-[13.5px] font-black transition active:scale-[.98]"
                style={{ borderColor: sel.withFilter === false ? NAVY : LINE,
                         background: sel.withFilter === false ? "#E9EEF6" : "#fff", color: NAVY }}>
          بدون فلتر الزيت
        </button>
      </div>

      {sel.withFilter === true && (
        <div className="space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث عن الفلتر المناسب لسيارتك"
                 className="w-full rounded-xl border-2 px-3.5 py-2.5 text-[13px] font-bold outline-none"
                 style={{ borderColor: LINE }} />
          {filters === null && <p className="py-3 text-center text-[12px]" style={{ color: DIM }}>جارِ التحميل...</p>}
          <div className="grid max-h-[38vh] gap-2 overflow-y-auto">
            {shown.map((f) => {
              const active = sel.filter?.id === f.id;
              return (
                <button key={f.id} onClick={() => setSel({ ...sel, filter: f })}
                        className="flex flex-col gap-2 rounded-xl border-2 p-3 text-right transition active:scale-[.98]"
                        style={{ borderColor: active ? GREEN : LINE, background: active ? "rgba(22,163,74,.06)" : "#fff" }}>
                  <span className="flex w-full items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg text-[18px]" style={{ background: "#F6F8FA" }}>⭕</span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-black leading-snug" style={{ color: NAVY }}>{f.name}</span>
                      {f.spec && <span className="tnum text-[10.5px] font-bold" style={{ color: DIM }}>{f.spec}</span>}
                    </span>
                    {active && <MIcon name="check_circle" filled className="!text-[18px] shrink-0" />}
                  </span>
                  <span className="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5"
                        style={{ background: "rgba(22,163,74,.08)" }}>
                    <span className="text-[9.5px] font-bold" style={{ color: DIM }}>السعر شامل الضريبة</span>
                    <span className="tnum text-[14px] font-black" style={{ color: GREEN }}>{money(f.price)} ر.س</span>
                  </span>
                </button>
              );
            })}
            {filters !== null && shown.length === 0 && (
              <p className="py-3 text-center text-[12px]" style={{ color: DIM }}>لا فلاتر مطابقة للبحث</p>
            )}
          </div>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="rounded-xl border-2 px-4 py-3 text-[13px] font-black" style={{ borderColor: LINE, color: DIM }}>رجوع</button>
        <button onClick={onNext} disabled={sel.withFilter === null || (sel.withFilter === true && !sel.filter)}
                className="flex-1 rounded-xl py-3 text-[14px] font-black text-white transition active:scale-[.98] disabled:opacity-40"
                style={{ background: GREEN }}>
          التالي — إضافات أخرى ‹
        </button>
      </div>
    </div>
  );
}

/* ═══════════ خطوة المنتجات والخدمات الإضافية — خريطة الأصناف الكاملة ═══════════ */
function catIcon(name: string): string {
  const n = name || "";
  if (n === "الخدمات") return "🛠";
  if (/فلتر|فلاتر/.test(n)) return "⭕";
  if (/زيت/.test(n)) return "🛢";
  if (/شحم/.test(n)) return "🧴";
  if (/منظف|ملمع|شامبو/.test(n)) return "🧽";
  if (/معطر/.test(n)) return "🌸";
  if (/رديتر|تبريد|مبرد/.test(n)) return "🌡";
  if (/مكيف|تكييف/.test(n)) return "❄️";
  if (/إضاف|معالج|سوائل|محسن/.test(n)) return "🧪";
  if (/أدوات|ملحق|مساح/.test(n)) return "🧰";
  return "📦";
}

function ExtrasPicker({ branchId, sel, setSel, onNext, onBack }: {
  branchId: string; sel: Selection; setSel: (s: Selection) => void;
  onNext: () => void; onBack: () => void;
}) {
  const [cats, setCats] = useState<CatalogCat[] | null>(null);
  const [services, setServices] = useState<CatProduct[]>([]);
  const [pick, setPick] = useState<string | null>(null);
  const [prods, setProds] = useState<CatProduct[] | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    fetch(`/api/products/public/booking-catalog/${branchId}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { setCats(d.categories || []); setServices(d.services || []); })
      .catch(() => { setCats([]); setServices([]); });
  }, [branchId]);

  async function openCat(name: string) {
    setPick(name); setQ("");
    if (name === "الخدمات") { setProds(services); return; }
    setProds(null);
    try {
      const r = await fetch(`/api/products/public/booking-catalog/${branchId}?category=${encodeURIComponent(name)}`);
      const d = await r.json();
      setProds(d.products || []);
    } catch { setProds([]); }
  }

  const qtyOf = (id: string) => sel.extras.find((e) => e.p.id === id)?.qty || 0;
  function add(p: CatProduct) {
    const has = sel.extras.some((e) => e.p.id === p.id);
    setSel({ ...sel, extras: has
      ? sel.extras.map((e) => (e.p.id === p.id ? { ...e, qty: Math.min(9, e.qty + 1) } : e))
      : [...sel.extras, { p, qty: 1 }] });
  }
  function dec(p: CatProduct) {
    setSel({ ...sel, extras: sel.extras.map((e) => (e.p.id === p.id ? { ...e, qty: e.qty - 1 } : e)).filter((e) => e.qty > 0) });
  }

  const ql = q.trim();
  const shown = (prods || []).filter((p) => !ql || p.name.includes(ql) || (p.spec || "").includes(ql));
  const count = sel.extras.reduce((s, e) => s + e.qty, 0);
  const total = sel.extras.reduce((s, e) => s + e.p.price * e.qty, 0);

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>🗂 منتجات وخدمات إضافية</h2>
      <p className="text-center text-[11.5px] font-bold" style={{ color: DIM }}>
        اختياري — تصفح كل الأقسام وأضف ما تحتاجه لسيارتك
      </p>

      {pick === null && (
        <div className="space-y-2.5">
          {cats === null && <p className="py-4 text-center text-[12px]" style={{ color: DIM }}>جارِ التحميل...</p>}
          {cats !== null && (
            <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto">
              {services.length > 0 && (
                <button onClick={() => openCat("الخدمات")}
                        className="flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition active:scale-[.97]"
                        style={{ borderColor: LINE, background: "#fff" }}>
                  <span className="grid h-11 w-11 place-items-center rounded-full text-[20px]" style={{ background: "#EEF3F9" }}>🛠</span>
                  <span className="line-clamp-1 text-[11.5px] font-black" style={{ color: NAVY }}>الخدمات</span>
                  <span className="tnum text-[9.5px] font-bold" style={{ color: DIM }}>{services.length} خدمة</span>
                </button>
              )}
              {cats.map((c) => (
                <button key={c.name} onClick={() => openCat(c.name)}
                        className="flex flex-col items-center gap-1.5 rounded-xl border-2 p-3 transition active:scale-[.97]"
                        style={{ borderColor: LINE, background: "#fff" }}>
                  <span className="grid h-11 w-11 place-items-center rounded-full text-[20px]" style={{ background: "#EEF3F9" }}>{catIcon(c.name)}</span>
                  <span className="line-clamp-1 text-[11.5px] font-black" style={{ color: NAVY }}>{c.name}</span>
                  <span className="tnum text-[9.5px] font-bold" style={{ color: DIM }}>{c.count} صنف</span>
                </button>
              ))}
              {cats.length === 0 && services.length === 0 && (
                <p className="col-span-3 py-4 text-center text-[12px]" style={{ color: DIM }}>لا توجد أقسام متاحة حالياً</p>
              )}
            </div>
          )}
        </div>
      )}

      {pick !== null && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between rounded-xl px-3.5 py-2" style={{ background: "#F1F4F8" }}>
            <span className="text-[12.5px] font-black" style={{ color: NAVY }}>{catIcon(pick)} {pick}</span>
            <button onClick={() => { setPick(null); setProds(null); setQ(""); }} className="text-[11.5px] font-black" style={{ color: GREEN }}>
              ‹ كل الأقسام
            </button>
          </div>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث داخل القسم"
                 className="w-full rounded-xl border-2 px-3.5 py-2.5 text-[13px] font-bold outline-none"
                 style={{ borderColor: LINE }} />
          {prods === null && <p className="py-4 text-center text-[12px]" style={{ color: DIM }}>جارِ التحميل...</p>}
          <div className="grid max-h-[42vh] gap-2 overflow-y-auto">
            {shown.map((p) => {
              const n = qtyOf(p.id);
              return (
                <div key={p.id}
                     className="flex items-center gap-3 rounded-xl border-2 p-3 text-right"
                     style={{ borderColor: n > 0 ? GREEN : LINE, background: n > 0 ? "rgba(22,163,74,.06)" : "#fff" }}>
                  {p.hasImage
                    ? <img src={`/api/products/public/product-image/${p.id}`} alt="" loading="lazy"
                           className="h-12 w-12 shrink-0 rounded-lg object-contain" style={{ background: "#F6F8FA" }} />
                    : <span className="grid h-12 w-12 shrink-0 place-items-center rounded-lg text-[20px]" style={{ background: "#F6F8FA" }}>{catIcon(pick)}</span>}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-black leading-snug" style={{ color: NAVY }}>{p.name}</span>
                    <span className="text-[10.5px] font-bold" style={{ color: DIM }}>
                      {[p.spec, p.unit].filter(Boolean).join(" · ")}
                    </span>
                    <span className="tnum block text-[12px] font-black" style={{ color: GREEN }}>
                      {p.price > 0 ? `${money(p.price)} ر.س` : "يُحدد عند الخدمة"}
                    </span>
                  </span>
                  {n === 0 ? (
                    <button onClick={() => add(p)}
                            className="shrink-0 rounded-xl px-3.5 py-2 text-[12px] font-black text-white transition active:scale-[.96]"
                            style={{ background: GREEN }}>+ إضافة</button>
                  ) : (
                    <span className="flex shrink-0 items-center gap-2">
                      <button onClick={() => dec(p)}
                              className="grid h-8 w-8 place-items-center rounded-full text-[16px] font-black text-white" style={{ background: NAVY }}>−</button>
                      <b className="tnum w-5 text-center text-[14px]">{n}</b>
                      <button onClick={() => add(p)}
                              className="grid h-8 w-8 place-items-center rounded-full text-[16px] font-black text-white" style={{ background: GREEN }}>+</button>
                    </span>
                  )}
                </div>
              );
            })}
            {prods !== null && shown.length === 0 && (
              <p className="py-4 text-center text-[12px]" style={{ color: DIM }}>لا أصناف مطابقة</p>
            )}
          </div>
        </div>
      )}

      {count > 0 && (
        <div className="flex items-center justify-between rounded-xl px-4 py-2.5" style={{ background: "rgba(22,163,74,.08)" }}>
          <span className="text-[12px] font-black" style={{ color: NAVY }}>🧺 المضاف: {count} صنف</span>
          <b className="tnum text-[13.5px]" style={{ color: GREEN }}>{money(total)} ر.س</b>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={onBack} className="rounded-xl border-2 px-4 py-3 text-[13px] font-black" style={{ borderColor: LINE, color: DIM }}>رجوع</button>
        <button onClick={onNext}
                className="flex-1 rounded-xl py-3 text-[14px] font-black text-white transition active:scale-[.98]"
                style={{ background: GREEN }}>
          {count > 0 ? "التالي — ملخص الحجز ‹" : "تخطي — ملخص الحجز ‹"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════ ملخص الحجز — قبل التأكيد النهائي ═══════════ */
function BookingSummary({ carLabel, plate, odometer, sel, autoService, busy, err, onConfirm, onBack }: {
  carLabel: string; plate: string; odometer: string; sel: Selection; autoService: AutoService | null;
  busy: boolean; err: string; onConfirm: () => void; onBack: () => void;
}) {
  // الخدمة التلقائية — تُهمل لو العميل ضافها بنفسه من قسم الخدمات (منع التكرار)
  const svc = sel.oil && autoService && !sel.extras.some((e) => e.p.id === autoService.id) ? autoService : null;
  const oilTotal = sel.oil ? sel.oil.price * sel.oilQty : 0;
  const filterTotal = sel.withFilter && sel.filter ? sel.filter.price : 0;
  const extrasTotal = sel.extras.reduce((s, e) => s + e.p.price * e.qty, 0);
  const svcTotal = svc ? svc.price : 0;
  const totalInc = oilTotal + filterTotal + svcTotal + extrasTotal;
  const totalEx = totalInc / 1.15;
  const vat = totalInc - totalEx;

  return (
    <div className="kiosk-step space-y-3 rounded-2xl bg-white p-5 shadow-lg">
      <h2 className="text-center text-[15px] font-black" style={{ color: NAVY }}>📋 ملخص الحجز</h2>

      <div className="space-y-2 rounded-xl p-3.5" style={{ background: "#F6F8FA" }}>
        <div className="flex justify-between text-[12.5px]"><span style={{ color: DIM }}>السيارة</span><b>{carLabel || "—"}</b></div>
        <div className="flex justify-between text-[12.5px]"><span style={{ color: DIM }}>اللوحة</span><b className="tnum">{plate || "—"}</b></div>
        {odometer && <div className="flex justify-between text-[12.5px]"><span style={{ color: DIM }}>العداد</span><b className="tnum">{Number(odometer).toLocaleString("en")}</b></div>}
      </div>

      {sel.fromInvoice && (
        <p className="rounded-xl px-3.5 py-2 text-[11.5px] font-bold" style={{ background: "rgba(22,163,74,.08)", color: GREEN }}>
          ↻ مُكرر من الفاتورة {sel.fromInvoice} — يمكنك التعديل بالرجوع
        </p>
      )}

      <div className="space-y-2">
        {sel.oil ? (
          <div className="flex items-center justify-between rounded-xl border-2 p-3" style={{ borderColor: LINE }}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-black" style={{ color: NAVY }}>🛢 {sel.oil.name}</span>
              <span className="text-[10.5px] font-bold" style={{ color: DIM }}>
                {[sel.oil.brand, sel.oil.spec, sel.oil.unit].filter(Boolean).join(" · ")} × {sel.oilQty}
              </span>
            </span>
            <b className="tnum text-[13.5px]" style={{ color: NAVY }}>{money(oilTotal)}</b>
          </div>
        ) : (
          <p className="rounded-xl px-3.5 py-2.5 text-[12px] font-bold" style={{ background: "#F6F8FA", color: DIM }}>
            🛢 الزيت: سيُحدد عند الوصول مع الفني
          </p>
        )}
        {sel.withFilter === true && sel.filter && (
          <div className="flex items-center justify-between rounded-xl border-2 p-3" style={{ borderColor: LINE }}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-black" style={{ color: NAVY }}>⭕ {sel.filter.name}</span>
              {sel.filter.spec && <span className="tnum text-[10.5px] font-bold" style={{ color: DIM }}>{sel.filter.spec}</span>}
            </span>
            <b className="tnum text-[13.5px]" style={{ color: NAVY }}>{money(filterTotal)}</b>
          </div>
        )}
        {sel.withFilter === false && (
          <p className="rounded-xl px-3.5 py-2 text-[11.5px] font-bold" style={{ background: "#F6F8FA", color: DIM }}>بدون فلتر الزيت</p>
        )}
        {svc && (
          <div className="flex items-center justify-between rounded-xl border-2 p-3" style={{ borderColor: LINE, background: "rgba(22,163,74,.04)" }}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-black" style={{ color: NAVY }}>🛠 {svc.name}</span>
              <span className="text-[10.5px] font-bold" style={{ color: DIM }}>أُضيفت تلقائياً مع اختيار الزيت</span>
            </span>
            <b className="tnum text-[13.5px]" style={{ color: NAVY }}>{svc.price > 0 ? money(svc.price) : "يُحدد عند الخدمة"}</b>
          </div>
        )}
        {sel.extras.map((e) => (
          <div key={e.p.id} className="flex items-center justify-between rounded-xl border-2 p-3" style={{ borderColor: LINE }}>
            <span className="min-w-0">
              <span className="block truncate text-[13px] font-black" style={{ color: NAVY }}>{catIcon("")} {e.p.name}</span>
              <span className="text-[10.5px] font-bold" style={{ color: DIM }}>
                {[e.p.spec, e.p.unit].filter(Boolean).join(" · ")} × {e.qty}
              </span>
            </span>
            <b className="tnum text-[13.5px]" style={{ color: NAVY }}>{e.p.price > 0 ? money(e.p.price * e.qty) : "يُحدد عند الخدمة"}</b>
          </div>
        ))}
      </div>

      {totalInc > 0 && (
        <div className="space-y-1.5 rounded-xl p-3.5" style={{ background: "#F1F4F8" }}>
          <div className="flex justify-between text-[12px]"><span style={{ color: DIM }}>السعر قبل الضريبة</span><b className="tnum">{money(totalEx)} ر.س</b></div>
          <div className="flex justify-between text-[12px]"><span style={{ color: DIM }}>الضريبة (15%)</span><b className="tnum">{money(vat)} ر.س</b></div>
          <div className="flex justify-between border-t pt-1.5 text-[14px]" style={{ borderColor: LINE }}>
            <b style={{ color: NAVY }}>الإجمالي</b><b className="tnum" style={{ color: GREEN }}>{money(totalInc)} ر.س</b>
          </div>
          <p className="text-[10px] font-bold" style={{ color: DIM }}>الأسعار استرشادية وتُعتمد نهائياً في الفاتورة عند الخدمة</p>
        </div>
      )}

      {err && <ErrBox msg={err} />}
      <div className="flex gap-2">
        <button onClick={onBack} disabled={busy}
                className="rounded-xl border-2 px-4 py-3 text-[13px] font-black" style={{ borderColor: LINE, color: DIM }}>رجوع</button>
        <button onClick={onConfirm} disabled={busy}
                className="flex-1 rounded-xl py-3.5 text-[15px] font-black text-white transition active:scale-[.98] disabled:opacity-50"
                style={{ background: GREEN }}>
          {busy ? "جارِ الحجز..." : "✓ تأكيد الحجز"}
        </button>
      </div>
    </div>
  );
}

/* ═══════════ زر المحادثة العائم + لوحة الدردشة المنزلقة ═══════════ */
function ChatFab({ carId, urlToken }: { carId?: string | null; urlToken?: string | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}
              className="fixed bottom-5 left-5 z-40 flex items-center gap-2 rounded-full px-4 py-3.5 text-[13px] font-black text-white shadow-xl transition active:scale-95"
              style={{ background: GREEN }}>
        <MIcon name="support_agent" className="!text-[20px] text-white" />
        تحدث مع موظف الخدمة
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-3" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between px-1">
              <span className="rounded-full bg-white/90 px-3 py-1 text-[11px] font-black" style={{ color: GREEN }}>● الموظف متاح خلال ساعات العمل</span>
              <button onClick={() => setOpen(false)} className="rounded-full bg-white/90 px-3 py-1 text-[12px] font-black" style={{ color: NAVY }}>✕ إغلاق</button>
            </div>
            <div className="max-h-[75vh] overflow-y-auto">
              <ChatSection carId={carId} urlToken={urlToken} />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ═══════════ الصفحة ═══════════ */

export default function PublicBookingPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const [view, setView] = useState<"loading" | "entry" | "garage" | "type" | "form" | "oil" | "filter" | "extras" | "summary" | "ticket">("loading");
  // الاختيار المسبق (زيت + فلتر) — يُحفظ مع الحجز ويظهر للفني
  const [sel, setSel] = useState<Selection>(EMPTY_SEL);
  // الحجز المعلّق: بيانات السيارة محفوظة لحين تأكيد الملخص
  const [pending, setPending] = useState<
    | { mode: "saved"; car: SavedCar; odometer: string }
    | { mode: "new"; form: FormValues }
    | null>(null);
  // ═══ خدمة تغيير الزيت — تُضاف تلقائياً مع اختيار أي زيت (بفلتر أو بدونه) ═══
  const [autoService, setAutoService] = useState<AutoService | null>(null);
  useEffect(() => {
    if (view !== "summary") return;
    if (!sel.oil || !pending) { setAutoService(null); return; }
    const brand = pending.mode === "saved" ? (pending.car.brand || "") : pending.form.brand;
    const model = pending.mode === "saved" ? (pending.car.name || "") : pending.form.carName;
    const year = pending.mode === "saved" ? (pending.car.model_year || "") : pending.form.modelYear;
    fetch(`/api/products/public/booking-service/${branchId}?brand=${encodeURIComponent(brand)}&model=${encodeURIComponent(model)}&year=${encodeURIComponent(year)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => setAutoService(d.service || null))
      .catch(() => setAutoService(null));
    // eslint-disable-next-line
  }, [view, sel.oil?.id, branchId]);

  const [info, setInfo] = useState<Info | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [booking, setBooking] = useState<Booking | null>(null);
  const [sType, setSType] = useState<SType>("basic");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<FormValues>(EMPTY_FORM);
  const pollRef = useRef<any>(null);
  const [chatToken, setChatToken] = useState<string | null>(null);

  // لو العميل جاي من رابط الواتساب ?t=التوكن — المحادثة تفتح فوراً
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get("t");
      if (t && t.length >= 20) setChatToken(t);
    } catch {}
  }, []);

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
    // eslint-disable-next-line
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
        setDraft((x) => ({ ...x, name: p.customer!.name, phone: p.customer!.phone }));
        setView((p.cars || []).length ? "garage" : "type");
      } else {
        setProfile(null);
        setDraft((x) => ({ ...x, phone: phone || x.phone,
          plateNumbers: plate.replace(/[^0-9]/g, "").slice(0, 4),
          plateLetters: plate.replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 3) }));
        setView("type");
      }
    } catch (e: any) { setErr(e.message); setView("entry"); }
    finally { setBusy(false); }
  }

  function bookSaved(car: SavedCar, odometer: string) {
    setErr(""); setSel(EMPTY_SEL);
    setPending({ mode: "saved", car, odometer });
    setView("oil");
  }

  function submitNew(f: FormValues) {
    setErr(""); setDraft(f); setSel(EMPTY_SEL);
    setPending({ mode: "new", form: f });
    setView("oil");
  }

  // ═══ التأكيد النهائي: إنشاء الحجز + حفظ اختيار الزيت والفلتر معه ═══
  async function confirmBooking() {
    if (!pending) return;
    setErr(""); setBusy(true);
    try {
      let b: Booking;
      if (pending.mode === "saved") {
        b = await call<Booking>(`booking/${branchId}`, {
          method: "POST",
          body: JSON.stringify({ savedCarId: pending.car.id, odometer: pending.odometer,
                                 serviceType: pending.car.service_type }),
        });
      } else {
        const f = pending.form;
        b = await _createNewBooking(f);
        localStorage.setItem("z8_cust_phone", f.phone.trim());
      }
      localStorage.setItem(`z8_booking_${branchId}`, b.bookingId);
      // حفظ الاختيار مع الحجز — يظهر للفني في أمر العمل (لا يوقف الحجز لو فشل)
      try {
        const items: { productId: string | null; label: string; qty: number; priceInc: number }[] = [];
        if (sel.oil) items.push({ productId: sel.oil.id, label: sel.oil.name, qty: sel.oilQty, priceInc: sel.oil.price });
        if (sel.withFilter && sel.filter) items.push({ productId: sel.filter.id, label: sel.filter.name, qty: 1, priceInc: sel.filter.price });
        for (const ex of sel.extras) items.push({ productId: ex.p.id, label: ex.p.spec ? `${ex.p.name} ${ex.p.spec}` : ex.p.name, qty: ex.qty, priceInc: ex.p.price });
        if (sel.oil && autoService && !sel.extras.some((e) => e.p.id === autoService.id))
          items.push({ productId: autoService.id, label: autoService.name, qty: 1, priceInc: autoService.price });
        await call(`booking-selection/${b.bookingId}`, {
          method: "PUT",
          body: JSON.stringify({ items, withFilter: sel.withFilter, fromInvoice: sel.fromInvoice }),
        });
      } catch { /* الاختيار كماليات — الحجز نفسه نجح */ }
      setPending(null);
      setBooking(b); setView("ticket");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function _createNewBooking(f: FormValues): Promise<Booking> {
    return await call<Booking>(`booking/${branchId}`, {
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
  }

  const stateUi = booking && {
    waiting: { icon: "schedule", color: "#D97706", bg: "#FCF0DE", title: "في الانتظار",
               sub: booking.ahead === 0 ? "أنت التالي — استعد!" : `أمامك ${booking.ahead} سيارة · انتظار متوقع ~${booking.estWaitMinutes} دقيقة` },
    in_service: { icon: "build", color: GREEN, bg: "rgba(22,163,74,.1)", title: "سيارتك في الخدمة الآن 🎉",
                  sub: booking.station ? `المحطة: ${booking.station}` : "جاري تنفيذ الخدمة" },
    done: { icon: "task_alt", color: NAVY, bg: "#E9EEF6", title: "اكتملت الخدمة — شكراً لزيارتك", sub: "نسعد بخدمتك دائماً" },
  }[booking.state];

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

        {view === "entry" && (
          <EntryCard busy={busy} err={err} onSubmit={(phone, plate) => restoreProfile(phone, plate)} />
        )}

        {view === "garage" && profile?.customer && (
          <>
            <GarageCard profile={profile} busy={busy} err={err}
                        onBook={bookSaved}
                        onAddNew={() => { setErr(""); setSType("basic"); setView("type"); }} />
            <div className="grid grid-cols-2 gap-2">
              <a href={`/booking/${branchId}/invoices`}
                 className="flex items-center justify-center gap-1.5 rounded-xl border-2 bg-white py-3 text-[13px] font-black shadow transition active:scale-[.98]"
                 style={{ borderColor: LINE, color: NAVY }}>
                <MIcon name="receipt_long" className="!text-[18px]" /> فواتيري
              </a>
              <a href={APP_URL} target="_blank" rel="noopener"
                 className="flex items-center justify-center gap-1.5 rounded-xl py-3 text-[13px] font-black text-white shadow transition active:scale-[.98]"
                 style={{ background: GREEN }}>
                <MIcon name="download" className="!text-[18px] text-white" /> تحميل التطبيق
              </a>
            </div>
          </>
        )}

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

        {view === "form" && (
          <RegisterForm sType={sType} initial={draft} busy={busy} err={err}
                        onBack={(v) => { setDraft(v); setErr(""); setView(profile?.found ? "garage" : "type"); }}
                        onSubmit={submitNew} />
        )}

        {view === "oil" && pending && (
          <OilPicker branchId={branchId} sel={sel} setSel={setSel}
                     phone={pending.mode === "saved" ? (profile?.customer?.phone || "") : pending.form.phone}
                     onNext={() => { setErr(""); setView("filter"); }}
                     onBack={() => { setErr(""); setView(pending.mode === "saved" ? "garage" : "form"); }} />
        )}

        {view === "filter" && pending && (
          <FilterPicker branchId={branchId} sel={sel} setSel={setSel}
                        onNext={() => { setErr(""); setView("extras"); }}
                        onBack={() => { setErr(""); setView("oil"); }} />
        )}

        {view === "extras" && pending && (
          <ExtrasPicker branchId={branchId} sel={sel} setSel={setSel}
                        onNext={() => { setErr(""); setView("summary"); }}
                        onBack={() => { setErr(""); setView("filter"); }} />
        )}

        {view === "summary" && pending && (
          <BookingSummary
            carLabel={pending.mode === "saved"
              ? [pending.car.brand, pending.car.name, pending.car.model_year].filter(Boolean).join(" ")
              : [pending.form.brand, pending.form.carName, pending.form.modelYear].filter(Boolean).join(" ")}
            plate={pending.mode === "saved"
              ? (pending.car.plate || "")
              : `${pending.form.plateNumbers} ${pending.form.plateLetters}`}
            odometer={pending.mode === "saved" ? pending.odometer : pending.form.odometer}
            sel={sel} autoService={autoService} busy={busy} err={err}
            onConfirm={confirmBooking}
            onBack={() => { setErr(""); setView("extras"); }} />
        )}

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
            <OilCard carId={booking.bookingId} />
            <a href={`/booking/${branchId}/invoices`}
               className="flex w-full items-center justify-center gap-2 rounded-xl border-2 bg-white py-3 text-[13.5px] font-black transition active:scale-[.98]"
               style={{ borderColor: LINE, color: NAVY }}>
              <MIcon name="receipt_long" className="!text-[19px]" /> فواتيري
            </a>
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

        {((view === "ticket" && booking) || chatToken) && (
          <ChatFab carId={booking?.bookingId} urlToken={chatToken} />
        )}

        <p className="text-center text-[10px]" style={{ color: DIM }}>منصة Z8 — شركة مصدر الزيوت للتجارة · نسخة الحجز v2</p>
      </div>
    </div>
  );
}
