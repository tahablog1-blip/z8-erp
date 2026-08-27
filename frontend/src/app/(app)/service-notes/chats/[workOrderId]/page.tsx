"use client";
// ═══ غرفة المحادثة — نمط واتساب: فقاعات + بطاقات ملاحظات + صوت (تسجيل وتشغيل)
//     تحديث كل 5 ثوانٍ + فتح الغرفة يعلّم رسائل العميل ✓✓ تلقائياً ═══
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { Button, Card } from "@/components/ui";

type Msg = {
  id: string; sender_type: "employee" | "customer" | "system";
  message: string; attachment_url: string | null; message_type?: string | null;
  is_read: boolean; created_at: string; read_at: string | null; note_id: string | null;
};
type CarInfo = { plate?: string; customer_name?: string; customer_phone?: string; brand?: string; car_name?: string };

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" });
}
function dayLabel(iso: string): string {
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return "اليوم";
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "أمس";
  return d.toLocaleDateString("ar-SA-u-nu-latn", { day: "2-digit", month: "2-digit", year: "numeric" });
}
function isVoice(m: Msg): boolean {
  return !!m.attachment_url && (m.message_type === "voice" || m.attachment_url.endsWith(".wav"));
}

// تحويل التسجيل الخام إلى WAV (mono 16kHz) — تشغيل مضمون على كل الأجهزة
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

export default function ChatRoomPage() {
  const router = useRouter();
  const params = useParams<{ workOrderId: string }>();
  const woId = typeof params?.workOrderId === "string" ? params.workOrderId : "";

  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [car, setCar] = useState<CarInfo | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const countRef = useRef(-1);

  // ── التسجيل الصوتي ──
  const [recOn, setRecOn] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef<any>(null);
  const recTimer = useRef<any>(null);
  const recStart = useRef(0);

  const load = useCallback(async () => {
    if (!woId) return;
    try {
      const rows = await api<Msg[]>(`/service-notes/messages/${woId}`);
      setMsgs(rows);
      setErr("");
      if (rows.length !== countRef.current) {
        countRef.current = rows.length;
        setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 100);
      }
    } catch (e: any) { setErr(e.message || "تعذر التحميل"); }
  }, [woId]);

  useEffect(() => {
    load();
    // بيانات السيارة والعميل من صف المحادثة
    api<any[]>("/service-notes/conversations")
      .then((list) => {
        const c = list.find((x) => x.work_order_id === woId);
        if (c) setCar({ plate: c.plate, customer_name: c.customer_name, customer_phone: c.customer_phone, brand: c.brand, car_name: c.car_name });
      }).catch(() => {});
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load, woId]);

  async function sendText() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true); setErr("");
    try {
      await api(`/service-notes/messages/${woId}`, {
        method: "POST",
        body: JSON.stringify({ message: body, messageType: "text" }),
      });
      setText("");
      await load();
    } catch (e: any) { setErr(e.message || "تعذر الإرسال"); }
    finally { setBusy(false); }
  }

  function teardownRec() {
    clearInterval(recTimer.current);
    const r = recRef.current;
    if (r) {
      try { r.proc.disconnect(); r.src.disconnect(); } catch { /* */ }
      try { r.stream.getTracks().forEach((t: any) => t.stop()); } catch { /* */ }
      try { r.ctx.close(); } catch { /* */ }
    }
    setRecOn(false);
  }
  useEffect(() => () => { try { teardownRec(); } catch { /* */ } }, []); // eslint-disable-line

  async function startRec() {
    if (recOn || busy) return;
    setErr("");
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
        if (s >= 60) stopRec(true);
      }, 500);
    } catch { setErr("اسمح بالوصول للمايكروفون من المتصفح أولاً 🎤"); }
  }

  async function stopRec(send: boolean) {
    const r = recRef.current;
    teardownRec();
    recRef.current = null;
    if (!send || !r) return;
    const blob = encodeWav(r.chunks, r.sr);
    if (blob.size < 6000) { setErr("التسجيل قصير جداً"); return; }
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", blob, "voice.wav");
      const resp = await fetch(`/api/service-notes/messages/${woId}/voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (resp.ok) await load();
      else setErr("تعذّر إرسال التسجيل");
    } catch { setErr("تعذّر الاتصال"); }
    finally { setBusy(false); }
  }

  // فواصل الأيام
  let lastDay = "";

  return (
    <div className="flex h-[calc(100vh-120px)] flex-col space-y-2">
      {/* رأس الغرفة */}
      <Card className="!py-2.5">
        <div className="flex items-center gap-3">
          <button onClick={() => router.push("/service-notes/chats")}
                  className="grid h-9 w-9 place-items-center rounded-full text-[16px] transition hover:bg-ink-2">→</button>
          <div className="grid h-10 w-10 place-items-center rounded-full bg-petrol text-[14px] font-black text-white">
            {(car?.customer_name || car?.plate || "؟").trim().charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13.5px] font-black">
              {car?.customer_name || "عميل"}
              {car?.plate && <span className="mr-2 rounded bg-petrol-soft px-1.5 py-0.5 text-[10.5px] font-black text-petrol tnum">{car.plate}</span>}
            </div>
            <div className="truncate text-[11px] text-text-dim">
              {[car?.brand, car?.car_name].filter(Boolean).join(" ")}
              {car?.customer_phone && <span className="tnum"> · {car.customer_phone}</span>}
            </div>
          </div>
        </div>
      </Card>

      {/* الرسائل */}
      <Card className="!p-0 flex-1 overflow-hidden">
        <div className="h-full space-y-1.5 overflow-y-auto bg-ink-2 p-3">
          {msgs.map((m) => {
            const day = dayLabel(m.created_at);
            const sep = day !== lastDay; lastDay = day;
            const mine = m.sender_type !== "customer";
            const noteCard = m.message_type === "note_internal";
            return (
              <div key={m.id}>
                {sep && (
                  <div className="my-2 text-center">
                    <span className="rounded-full bg-ink-3 px-3 py-1 text-[10.5px] font-bold text-text-dim">{day}</span>
                  </div>
                )}
                {noteCard ? (
                  <div className="mx-auto max-w-[85%] rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
                    <p className="whitespace-pre-wrap text-[12px] font-bold text-amber-900">{m.message}</p>
                    <p className="mt-0.5 text-[9.5px] text-amber-700">{fmtTime(m.created_at)} · داخلية — لا يراها العميل</p>
                  </div>
                ) : (
                  <div className={`flex ${mine ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed
                          ${mine ? "rounded-bl-sm bg-petrol text-white" : "rounded-br-sm border border-line bg-ink text-text"}`}>
                      {isVoice(m) ? (
                        <audio controls preload="metadata" src={m.attachment_url as string} className="my-0.5 w-[215px] max-w-full" />
                      ) : (
                        <p className="whitespace-pre-wrap break-words font-bold">{m.message}</p>
                      )}
                      <p className={`mt-0.5 text-[9.5px] ${mine ? "text-white/70" : "text-text-dim"}`}>
                        {fmtTime(m.created_at)}
                        {mine && (m.read_at || m.is_read ? " ✓✓" : " ✓")}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {msgs.length === 0 && (
            <p className="py-14 text-center text-[12.5px] text-text-dim">لا رسائل بعد — ابدأ المحادثة مع العميل 💬</p>
          )}
          <div ref={endRef} />
        </div>
      </Card>

      {err && <p className="rounded-lg bg-ember-bg px-3 py-1.5 text-center text-[12px] font-bold text-ember">{err}</p>}

      {/* الإدخال */}
      {!recOn ? (
        <div className="flex gap-2">
          <button onClick={startRec} disabled={busy} title="تسجيل رسالة صوتية"
                  className="grid h-[44px] w-[44px] shrink-0 place-items-center rounded-full border border-line text-[19px] transition hover:border-petrol active:scale-95 disabled:opacity-40">
            🎤
          </button>
          <input value={text} onChange={(e) => setText(e.target.value)}
                 onKeyDown={(e) => { if (e.key === "Enter") sendText(); }}
                 placeholder="اكتب رسالة…" maxLength={2000}
                 className="min-w-0 flex-1 rounded-full border border-line bg-ink px-4 py-2.5 text-[13.5px] font-bold outline-none focus:border-petrol" />
          <Button disabled={busy || !text.trim()} onClick={sendText} className="!rounded-full">
            {busy ? "…" : "إرسال ⬅"}
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-full bg-ember-bg px-4 py-2.5">
          <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ember" />
          <span className="tnum min-w-0 flex-1 text-[12.5px] font-black text-ember">جارِ التسجيل… {recSec} ث / 60</span>
          <Button disabled={busy} onClick={() => stopRec(true)}>إيقاف وإرسال</Button>
          <Button variant="ghost" onClick={() => stopRec(false)}>إلغاء</Button>
        </div>
      )}
    </div>
  );
}
