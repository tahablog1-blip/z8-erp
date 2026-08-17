"use client";
// تفاصيل الملاحظة — بيانات كاملة + مرفقات + محادثة + إبلاغ العميل (بنود 6/9/14)
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, Input } from "@/components/ui";

type Attachment = { id: string; file_url: string; file_type: string; created_at: string };
type Msg = {
  id: string; sender_type: "employee" | "customer" | "system";
  message: string; attachment_url: string | null; message_type?: string | null;
  is_read: boolean; created_at: string; read_at: string | null;
};
type Note = {
  id: string; note_number: string; type: string; status: string; priority: string;
  title: string | null; description: string;
  required_quantity: number | null; available_quantity: number | null;
  customer_visible: boolean; created_at: string; updated_at: string;
  work_order_id: string;
  plate: string | null; brand: string | null; car_name: string | null; model_year: string | null;
  customer_name: string | null; customer_phone: string | null;
  product_name: string | null; product_barcode: string | null;
  employee_name: string | null; branch_name: string | null;
  attachments: Attachment[]; messages: Msg[];
};
type Template = { id: string; title: string; message: string };

const STATUS_LABELS: Record<string, string> = {
  new: "جديدة", in_progress: "قيد المتابعة", awaiting_customer: "بانتظار رد العميل",
  awaiting_management: "بانتظار الإدارة", handled: "تم التعامل معها",
  closed: "مغلقة", rejected: "مرفوضة",
};
const TYPE_LABELS: Record<string, string> = {
  out_of_stock: "منتج غير متوفر", low_stock: "كمية غير كافية",
  needs_replacement: "منتج يحتاج تغيير", part_replacement: "قطعة تحتاج تغيير",
  technical: "مشكلة فنية", car_note: "ملاحظة على السيارة",
  extra_service: "خدمة إضافية مقترحة", customer_declined: "العميل رفض خدمة",
  operational: "مشكلة تشغيلية", other: "أخرى",
};

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

function isVoice(m: Msg): boolean {
  return !!m.attachment_url && (m.message_type === "voice" || m.attachment_url.endsWith(".wav"));
}

function Row({ k, v }: { k: string; v: string | number | null | undefined }) {
  return (
    <div className="flex justify-between border-b border-line/50 py-1.5 text-[13px]">
      <span className="text-text-dim">{k}</span>
      <span className="font-bold">{v ?? "—"}</span>
    </div>
  );
}

export default function NoteDetailsPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const { hasPerm } = useAuth();
  const canManage = hasPerm("service_notes.manage");

  const [note, setNote] = useState<Note | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  // إبلاغ العميل (بند 9)
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [notifyText, setNotifyText] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);

  // المحادثة
  const [chatText, setChatText] = useState("");
  const chatEnd = useRef<HTMLDivElement>(null);

  // التسجيل الصوتي 🎤
  const [recOn, setRecOn] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef<any>(null);
  const recTimer = useRef<any>(null);
  const recStart = useRef(0);

  const load = useCallback(async () => {
    try {
      setNote(await api<Note>(`/service-notes/${noteId}`));
      setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر التحميل"); }
  }, [noteId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: "smooth" }); }, [note?.messages.length]);

  async function changeStatus(status: string) {
    if (busy) return; setBusy(true);
    try { await api(`/service-notes/${noteId}/status`, { method: "PUT", body: JSON.stringify({ status }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "خطأ"); }
    finally { setBusy(false); }
  }

  async function openNotify() {
    setNotifyOpen(true);
    if (templates.length === 0) {
      try { setTemplates(await api<Template[]>("/service-notes/templates/list")); } catch { /* اختياري */ }
    }
    if (!notifyText && note) {
      setNotifyText(`⚠️ ملاحظة من موظف الخدمة:\n${note.description}\nسيتم توضيح التفاصيل داخل صفحة الحجز.`);
    }
  }

  async function sendNotify() {
    if (!notifyText.trim() || busy) return; setBusy(true);
    try {
      const r = await api<{ whatsapp: boolean }>(`/service-notes/${noteId}/notify-customer`,
        { method: "POST", body: JSON.stringify({ message: notifyText.trim() }) });
      setNotifyOpen(false); setNotifyText("");
      setErr(r.whatsapp ? "" : "أُرسلت الرسالة — لكن إشعار الواتساب لم يصل (تحقق من رقم العميل)");
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "خطأ"); }
    finally { setBusy(false); }
  }

  async function sendChat() {
    const t = chatText.trim();
    if (!t || !note || busy) return; setBusy(true);
    try {
      await api(`/service-notes/messages/${note.work_order_id}`,
        { method: "POST", body: JSON.stringify({ message: t, noteId }) });
      setChatText(""); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "خطأ"); }
    finally { setBusy(false); }
  }

  function teardownRec() {
    clearInterval(recTimer.current);
    const r = recRef.current;
    if (r) {
      try { r.proc.disconnect(); r.src.disconnect(); } catch { /* تجاهل */ }
      try { r.stream.getTracks().forEach((t: any) => t.stop()); } catch { /* تجاهل */ }
      try { r.ctx.close(); } catch { /* تجاهل */ }
    }
    setRecOn(false);
  }

  useEffect(() => () => { try { teardownRec(); } catch { /* تجاهل */ } }, []); // eslint-disable-line

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
    if (!send || !r || !note) return;
    const blob = encodeWav(r.chunks, r.sr);
    if (blob.size < 6000) { setErr("التسجيل قصير جداً — حاول مرة أخرى"); return; }
    setBusy(true); setErr("");
    try {
      const fd = new FormData();
      fd.append("file", blob, "voice.wav");
      const resp = await fetch(`/api/service-notes/messages/${note.work_order_id}/voice`, {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: fd,
      });
      if (resp.ok) await load();
      else setErr("تعذّر إرسال التسجيل — حاول مرة أخرى");
    } catch { setErr("تعذّر الاتصال — حاول مرة أخرى"); }
    finally { setBusy(false); }
  }

  if (!note) return <Card><div className="p-6 text-text-dim">{err || "جارٍ التحميل…"}</div></Card>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[18px] font-black">
          {note.note_number} <Badge tone="info">{TYPE_LABELS[note.type] ?? note.type}</Badge>{" "}
          <Badge tone={note.status === "new" ? "warn" : note.status === "handled" ? "good" : "neutral"}>
            {STATUS_LABELS[note.status] ?? note.status}
          </Badge>
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button onClick={openNotify}>💬 إبلاغ العميل</Button>
          {note.status === "new" && (
            <Button variant="ghost" disabled={busy} onClick={() => changeStatus("in_progress")}>بدء المتابعة</Button>
          )}
          {canManage && !["closed", "handled", "rejected"].includes(note.status) && (
            <>
              <Button variant="ghost" disabled={busy} onClick={() => changeStatus("handled")}>✓ تم التعامل</Button>
              <Button variant="danger" disabled={busy} onClick={() => changeStatus("closed")}>إغلاق</Button>
            </>
          )}
        </div>
      </div>

      {err && <p className="rounded-lg bg-ember-bg px-3 py-2 text-[12px] font-bold text-ember">{err}</p>}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ═══ الأقسام (بند 6) ═══ */}
        <div className="space-y-4">
          <Card>
            <div className="mb-2 text-[13px] font-black text-petrol">بيانات العميل</div>
            <Row k="الاسم" v={note.customer_name} />
            <Row k="الجوال" v={note.customer_phone} />
          </Card>
          <Card>
            <div className="mb-2 text-[13px] font-black text-petrol">السيارة</div>
            <Row k="اللوحة" v={note.plate} />
            <Row k="الماركة/الموديل" v={[note.brand, note.car_name].filter(Boolean).join(" ")} />
            <Row k="السنة" v={note.model_year} />
          </Card>
          <Card>
            <div className="mb-2 text-[13px] font-black text-petrol">المنتج</div>
            <Row k="الاسم" v={note.product_name} />
            <Row k="الباركود" v={note.product_barcode} />
            <Row k="الكمية المطلوبة" v={note.required_quantity} />
            <Row k="الكمية المتوفرة" v={note.available_quantity} />
          </Card>
          <Card>
            <div className="mb-2 text-[13px] font-black text-petrol">الملاحظة</div>
            <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed">{note.description}</p>
            <div className="mt-2 text-[11px] text-text-dim">
              {note.employee_name} · {note.branch_name} · {new Date(note.created_at).toLocaleString("ar-SA")}
            </div>
            {note.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {note.attachments.map((a) => (
                  <a key={a.id} href={a.file_url} target="_blank" rel="noreferrer"
                    className="block h-20 w-20 overflow-hidden rounded-lg border border-line">
                    {a.file_type === "image"
                      ? <img src={a.file_url} alt="" className="h-full w-full object-cover" />
                      : <span className="flex h-full w-full items-center justify-center text-[11px]">📎 ملف</span>}
                  </a>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* ═══ المحادثة (بند 14) ═══ */}
        <Card className="flex h-[560px] flex-col !p-3">
          <div className="mb-2 text-[13px] font-black text-petrol">💬 محادثة العميل</div>
          <div className="flex-1 space-y-2 overflow-y-auto rounded-xl bg-ink-3 p-3">
            {note.messages.length === 0 && (
              <p className="py-8 text-center text-[12px] text-text-dim">لا توجد رسائل — ابدأ بإبلاغ العميل</p>
            )}
            {note.messages.map((m) => (
              <div key={m.id} className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] ${
                m.sender_type === "employee"
                  ? "mr-auto bg-petrol text-white"
                  : "ml-auto border border-line bg-ink-2"}`}>
                {isVoice(m) ? (
                  <audio controls preload="metadata" src={m.attachment_url as string} className="my-0.5 w-[215px] max-w-full" />
                ) : (
                  <p className="whitespace-pre-wrap">{m.message}</p>
                )}
                <div className={`mt-1 text-[10px] ${m.sender_type === "employee" ? "text-white/70" : "text-text-dim"}`}>
                  {new Date(m.created_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                  {m.sender_type === "employee" && (m.read_at ? " · ✓✓ قُرئت" : " · ✓ أُرسلت")}
                </div>
              </div>
            ))}
            <div ref={chatEnd} />
          </div>
          {!recOn ? (
            <div className="mt-2 flex gap-2">
              <button onClick={startRec} disabled={busy} title="تسجيل رسالة صوتية"
                className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-xl border border-line text-[19px] transition active:scale-[.95] disabled:opacity-40">
                🎤
              </button>
              <Input placeholder="اكتب رسالة للعميل…" value={chatText}
                onChange={(e) => setChatText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendChat(); }} />
              <Button disabled={busy || !chatText.trim()} onClick={sendChat}>إرسال</Button>
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-2 rounded-xl bg-ember-bg px-3 py-2.5">
              <span className="h-2.5 w-2.5 shrink-0 animate-pulse rounded-full bg-ember" />
              <span className="min-w-0 flex-1 text-[12px] font-black text-ember">
                جارِ التسجيل… {recSec} ث / 60
              </span>
              <Button disabled={busy} onClick={() => stopRec(true)}>إيقاف وإرسال</Button>
              <Button variant="ghost" onClick={() => stopRec(false)}>إلغاء</Button>
            </div>
          )}
        </Card>
      </div>

      {/* ═══ نافذة إبلاغ العميل (بند 9) ═══ */}
      {notifyOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setNotifyOpen(false)}>
          <Card className="w-full max-w-lg" >
            <div onClick={(e) => e.stopPropagation()}>
              <div className="mb-3 text-[15px] font-black">💬 إبلاغ العميل</div>
              {templates.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {templates.map((t) => (
                    <button key={t.id}
                      className="rounded-full border border-line bg-ink-3 px-3 py-1 text-[11px] font-bold hover:border-petrol"
                      onClick={() => setNotifyText(t.message)}>
                      {t.title}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                className="h-36 w-full rounded-xl border border-line bg-ink-2 p-3 text-[13px] focus:border-petrol focus:outline-none"
                value={notifyText} onChange={(e) => setNotifyText(e.target.value)} />
              <p className="mt-1 text-[11px] text-text-dim">
                سيُرسل إشعار واتساب للعميل برابط صفحة الحجز الآمن — الرسالة نفسها تظهر داخل الصفحة.
              </p>
              <div className="mt-3 flex justify-end gap-2">
                <Button variant="ghost" onClick={() => setNotifyOpen(false)}>إلغاء</Button>
                <Button disabled={busy || !notifyText.trim()} onClick={sendNotify}>
                  {busy ? "جارٍ الإرسال…" : "إرسال"}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
