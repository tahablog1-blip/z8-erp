"use client";
// ═══ فواتيري — صفحة فواتير العميل: بطاقات + معاينة رسمية + تحميل PDF ═══
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { MIcon } from "@/components/m-icon";
import { printInvoice } from "@/lib/print-invoice";
import { cacheCompany } from "@/lib/company";
import type { InvoiceDetail } from "@/modules/invoices/types";

const NAVY = "#122A5C";
const GREEN = "#16A34A";
const DIM = "#6B7A90";
const LINE = "#E3E8EF";

type Inv = {
  id: string; invoiceNo: string; issuedAt: string; total: number;
  odometer: number | null; status: string;
};
async function call<T>(path: string): Promise<T> {
  const r = await fetch(`/api/cars/public/${path}`, { cache: "no-store" });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d?.detail || "تعذر الاتصال");
  return d as T;
}

function money(n: number): string {
  return n.toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  paid: { label: "مدفوعة", color: GREEN, bg: "rgba(22,163,74,.1)" },
  partial: { label: "مدفوعة جزئياً", color: "#D97706", bg: "#FCF0DE" },
  unpaid: { label: "غير مدفوعة", color: "#DC2626", bg: "#FDECEC" },
};

export default function MyInvoicesPage() {
  const { branchId } = useParams<{ branchId: string }>();
  const [invoices, setInvoices] = useState<Inv[] | null>(null);
  const [err, setErr] = useState("");
  const phone = typeof window !== "undefined" ? localStorage.getItem("z8_cust_phone") || "" : "";

  useEffect(() => {
    if (!phone) { setErr("سجّل برقم جوالك من صفحة الحجز أولاً"); setInvoices([]); return; }
    fetch(`/api/cars/public/booking-invoices/${branchId}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    }).then(async (r) => {
      const d = await r.json();
      if (!r.ok) throw new Error(d?.detail || "تعذر التحميل");
      setInvoices(d.invoices);
    }).catch((e) => { setErr(e.message); setInvoices([]); });
  }, [branchId, phone]);

  // ═══ الفاتورة الرسمية 1:1 — نفس قالب printInvoice المستخدم في الكاشير بالحرف ═══
  const [busyId, setBusyId] = useState<string | null>(null);

  async function openOfficial(inv: Inv) {
    setErr(""); setBusyId(inv.id);
    try {
      const full = await call<InvoiceDetail & { company: { name: string; vat: string; cr: string; address: string; phone: string } }>(
        `booking-invoice-full/${inv.id}?phone=${encodeURIComponent(phone)}`);
      // زرع بيانات المنشأة في نفس الكاش الذي يقرأه القالب — ترويسة مطابقة
      cacheCompany(full.company);
      // نفس الدالة الرسمية: نافذة الفاتورة A4 + حوار الطباعة (اختر "حفظ PDF" للتحميل)
      printInvoice(full, "a4");
    } catch (e: any) { setErr(e.message || "تعذر فتح الفاتورة"); }
    finally { setBusyId(null); }
  }

  return (
    <div dir="rtl" className="min-h-screen px-4 py-6" style={{ background: "#EEF2F6" }}>
      <div className="mx-auto max-w-md space-y-4">
        <div className="flex items-center justify-between rounded-2xl px-5 py-4 text-white shadow-lg" style={{ background: NAVY }}>
          <div>
            <div className="text-[17px] font-black">📄 فواتيري</div>
            <div className="text-[11px] text-white/70">كل فواتيرك — معاينة وتحميل</div>
          </div>
          <a href={`/booking/${branchId}`}
             className="rounded-full bg-white/15 px-4 py-2 text-[12px] font-black text-white">‹ رجوع للحجز</a>
        </div>

        {err && (
          <p className="rounded-xl bg-white px-4 py-3 text-center text-[12.5px] font-bold shadow" style={{ color: "#DC2626" }}>{err}</p>
        )}

        {invoices === null && <p className="py-8 text-center text-[13px]" style={{ color: DIM }}>جارِ التحميل...</p>}
        {invoices !== null && invoices.length === 0 && !err && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-lg">
            <MIcon name="receipt_long" className="!text-[42px]" />
            <p className="mt-2 text-[13px] font-bold" style={{ color: DIM }}>لا توجد فواتير مسجلة بجوالك بعد</p>
          </div>
        )}

        {(invoices || []).map((inv) => {
          const st = STATUS_META[inv.status] || null;
          return (
            <div key={inv.id} className="kiosk-pop space-y-3 rounded-2xl bg-white p-4 shadow-lg">
              <div className="flex items-start justify-between">
                <div>
                  <div className="tnum text-[15px] font-black" style={{ color: NAVY }}>{inv.invoiceNo}</div>
                  <div className="tnum mt-0.5 text-[11.5px] font-bold" style={{ color: DIM }}>
                    📅 {new Date(inv.issuedAt).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" })}
                    {inv.odometer != null && <> · 🛞 عداد {inv.odometer.toLocaleString("en")}</>}
                  </div>
                </div>
                <div className="text-left">
                  <div className="tnum text-[15px] font-black" style={{ color: GREEN }}>{money(inv.total)} ر.س</div>
                  {st && <span className="mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-black"
                               style={{ color: st.color, background: st.bg }}>{st.label}</span>}
                </div>
              </div>
              <button onClick={() => openOfficial(inv)} disabled={busyId === inv.id}
                      className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-[12.5px] font-black text-white transition active:scale-[.98] disabled:opacity-50"
                      style={{ background: NAVY }}>
                <MIcon name="visibility" className="!text-[17px] text-white" />
                {busyId === inv.id ? "جارِ الفتح..." : "معاينة وتحميل الفاتورة الرسمية"}
              </button>
              <p className="text-center text-[10px] font-bold" style={{ color: DIM }}>
                للتحميل PDF: من نافذة الفاتورة اختر «حفظ كـ PDF» في حوار الطباعة
              </p>
            </div>
          );
        })}
      </div>

    </div>
  );
}