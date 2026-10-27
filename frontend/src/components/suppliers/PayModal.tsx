"use client";
// تسجيل دفعة لمورد — عبر POST /suppliers/{id}/pay القائم (يسجّل سند الصرف ودفتر المورد والقيد المحاسبي في الباك اند).
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { fmtM } from "@/components/inventory/shared";
import type { SupInvoice } from "@/lib/suppliers/types";

export function PayModal({ open, supplierId, supplierName, balance, invoices, onClose, onPaid }: {
  open: boolean; supplierId: string; supplierName: string; balance: number; invoices: SupInvoice[]; onClose: () => void; onPaid: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [invoiceId, setInvoiceId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const open_ = invoices.filter((i) => i.terms === "credit" && i.status !== "paid" && i.outstanding > 0);
  useEffect(() => { if (open) { setAmount(""); setInvoiceId(""); setNote(""); setErr(""); setMethod("cash"); } }, [open]);
  const inv = open_.find((i) => i.id === invoiceId);

  async function submit() {
    const n = Number(amount);
    if (!n || n <= 0) { setErr("أدخل مبلغاً صحيحاً."); return; }
    if (inv && n > inv.outstanding + 0.01) { setErr(`المبلغ أكبر من المتبقي على الفاتورة (${fmtM(inv.outstanding)}).`); return; }
    setErr(""); setBusy(true);
    try {
      await api(`/suppliers/${supplierId}/pay`, { method: "POST", body: JSON.stringify({ amount: n, method, invoiceId: invoiceId || null, note: note.trim() || null }) });
      onPaid();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر تسجيل الدفعة"); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} title={`تسجيل دفعة — ${supplierName}`} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-t-sm text-text-dim">الرصيد المستحق حالياً: <b className="tnum text-text">{fmtM(balance)}</b></p>
        <Field label="المبلغ"><Input type="number" min="0" step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="طريقة الدفع"><Select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="cash">نقدي</option><option value="card">بطاقة</option><option value="transfer">تحويل</option></Select></Field>
          <Field label="الفاتورة (اختياري)" hint="بدون فاتورة: تخفّض الرصيد دون تسوية فاتورة بعينها"><Select value={invoiceId} onChange={(e) => setInvoiceId(e.target.value)}>
            <option value="">دفعة على الحساب</option>{open_.map((i) => <option key={i.id} value={i.id}>{i.invoiceNo} — متبقٍ {fmtM(i.outstanding)}</option>)}</Select></Field>
        </div>
        <Field label="ملاحظة"><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <p className="text-t-xs text-text-dim">يُنشأ سند صرف وقيد محاسبي (مدين الذمم الدائنة / دائن حساب الدفع) من النظام — لا يمكن التراجع من هنا.</p>
        <ErrorNote msg={err} />
        <div className="flex gap-2"><Button variant="success" onClick={submit} loading={busy} disabled={busy}>تسجيل الدفعة</Button><Button variant="outline" onClick={onClose}>إلغاء</Button></div>
      </div>
    </Modal>
  );
}
