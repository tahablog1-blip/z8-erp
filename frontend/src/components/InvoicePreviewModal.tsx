"use client";
// InvoicePreviewModal — معاينة الفاتورة قبل الطباعة بنفس القالب الذي يُطبع (A4 أو حراري 80مم) + إجراءات: طباعة / PDF / واتساب.
// عرض فقط: لا يعدّل أي بيانات — القيم كلها من InvoiceDetail القادم من الـ API.
import { useEffect, useRef, useState } from "react";
import { api, getToken } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { Button } from "@/components/ui";
import FullScreenModal from "@/components/FullScreenModal";
import type { InvoiceDetail } from "@/modules/invoices/types";
import type { PrintFormat } from "@/lib/print-invoice";

const SIZE: Record<PrintFormat, { w: number; h: number }> = { a4: { w: 794, h: 1123 }, thermal: { w: 302, h: 1100 } };

export function InvoicePreviewModal({ invoice, initialFormat = "a4", onClose }: { invoice: InvoiceDetail; initialFormat?: PrintFormat; onClose: () => void }) {
  const [fmt, setFmt] = useState<PrintFormat>(initialFormat);
  const [html, setHtml] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<"" | "pdf" | "wa">("");
  const [note, setNote] = useState<{ ok: boolean; msg: string } | null>(null);
  const [scale, setScale] = useState(1);
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let alive = true;
    import("@/lib/print-invoice").then((m) => { if (alive) setHtml(m.invoiceHTML(invoice, fmt, true)); })
      .catch((e) => alive && setErr(e instanceof Error ? e.message : String(e)));
    return () => { alive = false; };
  }, [invoice, fmt]);

  useEffect(() => {   // يصغّر المعاينة لتناسب عرض الشاشة (جوال/تابلت) بدل تمرير أفقي
    const fit = () => { const w = box.current?.clientWidth ?? SIZE[fmt].w; setScale(Math.min(1, (w - 8) / SIZE[fmt].w)); };
    fit(); window.addEventListener("resize", fit); return () => window.removeEventListener("resize", fit);
  }, [fmt]);

  const flash = (ok: boolean, msg: string) => { setNote({ ok, msg }); setTimeout(() => setNote(null), 6000); };
  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print(); } };

  async function pdf() {
    setBusy("pdf");
    try {
      const token = getToken();
      const res = await fetch(`/api/invoices/${invoice.id}/pdf`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!res.ok) { let m = `تعذر إنشاء ملف PDF (${res.status})`; try { const d = await res.json(); m = d?.detail || d?.error || m; } catch { /* */ } throw new Error(m); }
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = `${invoice.invoice_no}.pdf`; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { flash(false, e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  async function whatsapp() {
    setBusy("wa");
    try { await api(`/invoices/${invoice.id}/send-whatsapp`, { method: "POST" }); flash(true, `تمت جدولة إرسال الفاتورة ${invoice.invoice_no} عبر واتساب`); }
    catch (e) { flash(false, e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }

  const { w, h } = SIZE[fmt];
  return (
    <FullScreenModal title={`معاينة الفاتورة ${invoice.invoice_no}`} onClose={onClose}>
      <div className="flex min-h-0 flex-1 flex-col gap-3 p-3 md:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="حجم الطباعة" className="inline-flex rounded-card border border-line bg-ink-2 p-0.5">
            {([["a4", "A4"], ["thermal", "حراري 80مم"]] as const).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={fmt === k} onClick={() => setFmt(k)}
                className={`rounded-lg px-3.5 py-1.5 text-t-md font-bold transition ${fmt === k ? "bg-petrol text-white" : "text-text-dim hover:text-text"}`}>{l}</button>))}
          </div>
          <div className="ms-auto flex flex-wrap items-center gap-2">
            <Button onClick={print} disabled={!html}><MIcon name="print" className="!text-[17px]" />طباعة</Button>
            <Button variant="outline" onClick={pdf} loading={busy === "pdf"}><MIcon name="picture_as_pdf" className="!text-[17px]" />تحميل PDF</Button>
            <Button variant="outline" onClick={whatsapp} loading={busy === "wa"}><MIcon name="chat" className="!text-[17px]" />واتساب</Button>
          </div>
        </div>
        {note && <div role="status" className={`rounded-card px-3 py-2 text-t-md font-bold ${note.ok ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>{note.msg}</div>}
        <div ref={box} className="min-h-0 flex-1 overflow-auto rounded-card border border-line bg-ink-3 p-2">
          {err ? <div role="alert" className="p-8 text-center text-ember">تعذر تجهيز المعاينة: {err}</div> : !html ? <div className="p-8 text-center text-text-dim">جارِ التجهيز…</div> : (
            <div dir="ltr" style={{ width: w * scale, height: h * scale, margin: "0 auto" }}>
              <iframe ref={frame} title={`فاتورة ${invoice.invoice_no}`} srcDoc={html} sandbox="allow-same-origin allow-scripts allow-modals"
                style={{ width: w, height: h, border: 0, background: "#fff", transform: `scale(${scale})`, transformOrigin: "top left", boxShadow: "0 1px 8px rgba(0,0,0,.15)" }} />
            </div>)}
        </div>
      </div>
    </FullScreenModal>
  );
}
