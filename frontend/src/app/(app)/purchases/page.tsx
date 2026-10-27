"use client";
// شاشة المشتريات — ٣ تبويبات:
// فواتير المشتريات (شراء مباشر أو مطابق لأمر شراء) · عروض الأسعار · أوامر الشراء
// الشراء المباشر يزوّد مخزون المستودع فوراً. الدورة الرسمية: عرض سعر → أمر شراء
// (اعتماد) → استلام مخزني (GR/IR) → فاتورة مطابقة (تصفية GR/IR + فروق السعر).
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Tabs, PageHeader } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { StockItemsEditor, StockLine } from "@/components/StockItemsEditor";
import { Product, productLabel } from "@/modules/products/types";
import { Supplier } from "@/modules/suppliers/types";
import {
  PO, PODetail, POItem, POStatus,
  PurchaseInvoice, PurchaseInvoiceDetail,
  Quotation, QuotationDetail, QuotationStatus,
  money,
} from "@/modules/purchases/types";

type Tab = "invoices" | "quotations" | "orders";

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"), { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS_BADGE: Record<PurchaseInvoice["status"], { tone: "good" | "warn" | "neutral"; label: string }> = {
  paid: { tone: "good", label: "مدفوعة" },
  partially_paid: { tone: "warn", label: "مدفوعة جزئياً" },
  unpaid: { tone: "neutral", label: "غير مدفوعة" },
};

const QUOT_BADGE: Record<QuotationStatus, { tone: "good" | "warn" | "neutral" | "info"; label: string }> = {
  received: { tone: "neutral", label: "متاح" },
  converted: { tone: "good", label: "تم تحويله لأمر شراء" },
  rejected: { tone: "warn", label: "مرفوض" },
};

const PO_BADGE: Record<POStatus, { tone: "good" | "warn" | "neutral" | "info"; label: string }> = {
  pending_approval: { tone: "warn", label: "بانتظار الاعتماد" },
  approved: { tone: "info", label: "معتمد" },
  rejected: { tone: "warn", label: "مرفوض" },
  cancelled: { tone: "neutral", label: "ملغي" },
  partially_received: { tone: "info", label: "استلام جزئي" },
  received: { tone: "good", label: "مستلم بالكامل" },
  invoiced: { tone: "good", label: "مفوتر" },
};

export default function PurchasesPage() {
  const { hasPerm } = useAuth();
  const canQuot = hasPerm("purchasing.quotations");
  const canPO = hasPerm("purchasing.orders");

  const [tab, setTab] = useState<Tab>("invoices");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [pageErr, setPageErr] = useState("");

  // ══════════ فواتير المشتريات ══════════
  const [rows, setRows] = useState<PurchaseInvoice[]>([]);
  const [loading, setLoading] = useState(true);

  const [modalOpen, setModalOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<"cash" | "credit">("credit");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<StockLine[]>([]);
  const [invoicePoId, setInvoicePoId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [viewInvoice, setViewInvoice] = useState<PurchaseInvoiceDetail | null>(null);

  // ══════════ عروض الأسعار ══════════
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [qLoading, setQLoading] = useState(true);
  const [qModalOpen, setQModalOpen] = useState(false);
  const [qSupplierId, setQSupplierId] = useState("");
  const [qValidUntil, setQValidUntil] = useState("");
  const [qNote, setQNote] = useState("");
  const [qLines, setQLines] = useState<StockLine[]>([]);
  const [qErr, setQErr] = useState("");
  const [qBusy, setQBusy] = useState(false);
  const [viewQuotation, setViewQuotation] = useState<QuotationDetail | null>(null);

  // ══════════ أوامر الشراء ══════════
  const [pos, setPos] = useState<PO[]>([]);
  const [poLoading, setPoLoading] = useState(true);
  const [poModalOpen, setPoModalOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState("");
  const [poQuotationId, setPoQuotationId] = useState<string | null>(null);
  const [poExpected, setPoExpected] = useState("");
  const [poNote, setPoNote] = useState("");
  const [poLines, setPoLines] = useState<StockLine[]>([]);
  const [poErr, setPoErr] = useState("");
  const [poBusy, setPoBusy] = useState(false);
  const [viewPO, setViewPO] = useState<PODetail | null>(null);

  const [approveOpen, setApproveOpen] = useState(false);
  const [approvePin, setApprovePin] = useState("");
  const [approveErr, setApproveErr] = useState("");
  const [approveBusy, setApproveBusy] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectPin, setRejectPin] = useState("");
  const [rejectErr, setRejectErr] = useState("");
  const [rejectBusy, setRejectBusy] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState("");
  const [receiveErr, setReceiveErr] = useState("");
  const [receiveBusy, setReceiveBusy] = useState(false);

  async function loadBase() {
    try {
      const [sup, pr] = await Promise.all([
        api<Supplier[]>("/suppliers"),
        api<Product[]>("/products").then((ps) => ps.filter((p) => !p.is_service)),
      ]);
      setSuppliers(sup); setProducts(pr); setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
  }
  async function loadInvoices() {
    setLoading(true);
    try { setRows(await api<PurchaseInvoice[]>("/purchases/purchase-invoices")); }
    catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  async function loadQuotations() {
    if (!canQuot) { setQLoading(false); return; }
    setQLoading(true);
    try { setQuotations(await api<Quotation[]>("/purchases/quotations")); }
    catch (e: any) { setPageErr(e.message); }
    finally { setQLoading(false); }
  }
  async function loadPos() {
    if (!canPO) { setPoLoading(false); return; }
    setPoLoading(true);
    try { setPos(await api<PO[]>("/purchases/orders")); }
    catch (e: any) { setPageErr(e.message); }
    finally { setPoLoading(false); }
  }
  useEffect(() => { loadBase(); loadInvoices(); loadQuotations(); loadPos(); }, []);

  // ══════════ فواتير المشتريات: إنشاء ══════════
  function openCreateInvoice() {
    setSupplierId(suppliers[0]?.id || ""); setSupplierRef(""); setInvoiceDate("");
    setPaymentTerms("credit"); setPaymentMethod("cash"); setDueDate("");
    setLines([]); setInvoicePoId(null); setErr(""); setModalOpen(true);
  }

  function openInvoiceFromPO(po: PODetail) {
    const avail = po.items.filter((it) => it.product_id && it.qty_received > 0);
    setSupplierId(po.supplier_id); setSupplierRef(""); setInvoiceDate("");
    setPaymentTerms("credit"); setPaymentMethod("cash"); setDueDate("");
    setLines(avail.map((it) => ({
      productId: it.product_id as string, productLabel: it.product_label,
      barcode: null, qty: it.qty_received, unitCost: it.unit_cost,
    })));
    setInvoicePoId(po.id); setErr(""); setModalOpen(true);
  }

  const validLines = lines.filter((l) => l.productId && l.qty > 0);
  const subtotal = validLines.reduce((s, l) => s + (l.unitCost || 0) * l.qty, 0);

  async function doSubmitInvoice(confirmVariance: boolean) {
    const body = {
      supplierId, supplierInvoiceRef: supplierRef.trim() || null,
      invoiceDate: invoiceDate || null,
      paymentTerms, paymentMethod: paymentTerms === "cash" ? paymentMethod : undefined,
      dueDate: paymentTerms === "credit" ? dueDate : null,
      items: validLines.map((l) => ({
        productId: l.productId, productLabel: l.productLabel, qty: l.qty, unitCost: l.unitCost || 0,
      })),
      poId: invoicePoId || undefined,
      confirmVariance,
    };
    await api("/purchases/purchase-invoices", { method: "POST", body: JSON.stringify(body) });
  }

  async function submit() {
    setErr(""); setBusy(true);
    try {
      try {
        await doSubmitInvoice(false);
      } catch (e: any) {
        if (invoicePoId && /فرق سعر كبير/.test(e.message)) {
          const ok = await appConfirm(`${e.message}\n\nتأكيد الفرق والاستمرار؟`);
          if (!ok) { setErr(e.message); return; }
          await doSubmitInvoice(true);
        } else { throw e; }
      }
      setModalOpen(false); setInvoicePoId(null);
      await Promise.all([loadInvoices(), loadPos()]);
      if (viewPO && invoicePoId === viewPO.id) {
        setViewPO(await api<PODetail>(`/purchases/orders/${viewPO.id}`));
      }
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function openInvoice(inv: PurchaseInvoice) {
    try { setViewInvoice(await api<PurchaseInvoiceDetail>(`/purchases/purchase-invoices/${inv.id}`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  const invoiceColumns: Column<PurchaseInvoice>[] = [
    { key: "invoice_no", title: "رقم الفاتورة", width: "110px", render: (i) => <span className="tnum font-extrabold">{i.invoice_no}</span> },
    { key: "supplier_name", title: "المورد", render: (i) => i.supplier_name || "—" },
    { key: "supplier_invoice_ref", title: "مرجع المورد", width: "120px", render: (i) => i.supplier_invoice_ref || <span className="text-text-dim">—</span> },
    { key: "invoice_date", title: "التاريخ", width: "110px", render: (i) => dateFmt(i.invoice_date) },
    { key: "total", title: "الإجمالي", width: "110px", render: (i) => <span className="tnum font-bold">{money(i.total)}</span> },
    {
      key: "status", title: "الحالة", width: "120px",
      render: (i) => <Badge tone={STATUS_BADGE[i.status].tone}>{STATUS_BADGE[i.status].label}</Badge>,
    },
    {
      key: "actions", title: "", width: "170px",
      render: (i) => (
        <div className="flex gap-1">
          <Button variant="ghost" size="xs" onClick={() => openInvoice(i)}>عرض</Button>
          <Button variant="ghost" size="xs" onClick={() => printTaxInvoice(i)}>ضريبية</Button>
        </div>
      ),
    },
  ];

  // ══════════ عروض الأسعار ══════════
  function openCreateQuotation() {
    setQSupplierId(suppliers[0]?.id || ""); setQValidUntil(""); setQNote("");
    setQLines([]); setQErr(""); setQModalOpen(true);
  }

  const validQLines = qLines.filter((l) => l.productId && l.qty > 0);

  async function submitQuotation() {
    setQErr(""); setQBusy(true);
    try {
      const body = {
        supplierId: qSupplierId, validUntil: qValidUntil || null, note: qNote.trim() || null,
        items: validQLines.map((l) => ({
          productId: l.productId, productLabel: l.productLabel, qty: l.qty, unitCost: l.unitCost || 0,
        })),
      };
      await api("/purchases/quotations", { method: "POST", body: JSON.stringify(body) });
      setQModalOpen(false);
      await loadQuotations();
    } catch (e: any) { setQErr(e.message); }
    finally { setQBusy(false); }
  }

  async function openQuotation(q: Quotation) {
    try { setViewQuotation(await api<QuotationDetail>(`/purchases/quotations/${q.id}`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function rejectQuotation(q: QuotationDetail) {
    if (!(await appConfirm(`رفض عرض السعر ${q.quotation_no}؟`))) return;
    try {
      const updated = await api<QuotationDetail>(`/purchases/quotations/${q.id}/reject`, { method: "POST" });
      setViewQuotation(updated);
      await loadQuotations();
    } catch (e: any) { await appAlert(e.message); }
  }

  function convertQuotationToPO(q: QuotationDetail) {
    const avail = q.items.filter((it) => it.product_id);
    setPoSupplierId(q.supplier_id); setPoQuotationId(q.id); setPoExpected("");
    setPoNote(`من عرض السعر ${q.quotation_no}`);
    setPoLines(avail.map((it) => ({
      productId: it.product_id as string, productLabel: it.product_label,
      barcode: null, qty: it.qty, unitCost: it.unit_cost,
    })));
    setPoErr(""); setViewQuotation(null); setPoModalOpen(true);
  }

  const quotationColumns: Column<Quotation>[] = [
    { key: "quotation_no", title: "رقم العرض", width: "110px", render: (q) => <span className="tnum font-extrabold">{q.quotation_no}</span> },
    { key: "supplier_name", title: "المورد", render: (q) => q.supplier_name || "—" },
    { key: "valid_until", title: "صلاحية حتى", width: "110px", render: (q) => q.valid_until ? dateFmt(q.valid_until) : <span className="text-text-dim">—</span> },
    { key: "total", title: "الإجمالي", width: "110px", render: (q) => <span className="tnum font-bold">{money(q.total)}</span> },
    { key: "status", title: "الحالة", width: "150px", render: (q) => <Badge tone={QUOT_BADGE[q.status].tone}>{QUOT_BADGE[q.status].label}</Badge> },
    {
      key: "actions", title: "", width: "90px",
      render: (q) => <Button variant="ghost" size="xs" onClick={() => openQuotation(q)}>عرض</Button>,
    },
  ];

  // ══════════ أوامر الشراء ══════════
  function openCreatePO() {
    setPoSupplierId(suppliers[0]?.id || ""); setPoQuotationId(null); setPoExpected(""); setPoNote("");
    setPoLines([]); setPoErr(""); setPoModalOpen(true);
  }

  const validPoLines = poLines.filter((l) => l.productId && l.qty > 0);

  async function submitPO() {
    setPoErr(""); setPoBusy(true);
    try {
      const body = {
        supplierId: poSupplierId, quotationId: poQuotationId || null,
        expectedDate: poExpected || null, note: poNote.trim() || null,
        items: validPoLines.map((l) => ({
          productId: l.productId, productLabel: l.productLabel, qty: l.qty, unitCost: l.unitCost || 0,
        })),
      };
      await api("/purchases/orders", { method: "POST", body: JSON.stringify(body) });
      setPoModalOpen(false);
      await Promise.all([loadPos(), loadQuotations()]);
    } catch (e: any) { setPoErr(e.message); }
    finally { setPoBusy(false); }
  }

  async function openPO(po: PO) {
    try { setViewPO(await api<PODetail>(`/purchases/orders/${po.id}`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function refreshPO(id: string) {
    setViewPO(await api<PODetail>(`/purchases/orders/${id}`));
    await loadPos();
  }

  function openApprove() { setApprovePin(""); setApproveErr(""); setApproveOpen(true); }
  async function submitApprove() {
    if (!viewPO) return;
    setApproveErr(""); setApproveBusy(true);
    try {
      await api(`/purchases/orders/${viewPO.id}/approve`, {
        method: "POST", body: JSON.stringify({ approvalPin: approvePin.trim() || null }),
      });
      setApproveOpen(false);
      await refreshPO(viewPO.id);
    } catch (e: any) { setApproveErr(e.message); }
    finally { setApproveBusy(false); }
  }

  function openReject() { setRejectReason(""); setRejectPin(""); setRejectErr(""); setRejectOpen(true); }
  async function submitReject() {
    if (!viewPO) return;
    setRejectErr(""); setRejectBusy(true);
    try {
      await api(`/purchases/orders/${viewPO.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ reason: rejectReason.trim(), approvalPin: rejectPin.trim() || null }),
      });
      setRejectOpen(false);
      await refreshPO(viewPO.id);
    } catch (e: any) { setRejectErr(e.message); }
    finally { setRejectBusy(false); }
  }

  async function cancelPO() {
    if (!viewPO) return;
    if (!(await appConfirm(`إلغاء أمر الشراء ${viewPO.po_no}؟`))) return;
    try {
      await api(`/purchases/orders/${viewPO.id}/cancel`, { method: "POST" });
      await refreshPO(viewPO.id);
    } catch (e: any) { await appAlert(e.message); }
  }

  function openReceive() {
    if (!viewPO) return;
    const q: Record<string, string> = {};
    for (const it of viewPO.items) {
      const remaining = it.qty - it.qty_received;
      if (it.product_id && remaining > 0) q[it.id] = String(remaining);
    }
    setReceiveQtys(q); setReceiveNote(""); setReceiveErr(""); setReceiveOpen(true);
  }
  async function submitReceive() {
    if (!viewPO) return;
    setReceiveErr(""); setReceiveBusy(true);
    try {
      const items = Object.entries(receiveQtys)
        .map(([poItemId, v]) => ({ poItemId, qtyReceived: Math.floor(Number(v) || 0) }))
        .filter((it) => it.qtyReceived > 0);
      if (!items.length) { setReceiveErr("أدخل كمية استلام لصنف واحد على الأقل"); setReceiveBusy(false); return; }
      await api(`/purchases/orders/${viewPO.id}/receive`, {
        method: "POST", body: JSON.stringify({ items, note: receiveNote.trim() || null }),
      });
      setReceiveOpen(false);
      await refreshPO(viewPO.id);
    } catch (e: any) { setReceiveErr(e.message); }
    finally { setReceiveBusy(false); }
  }

  const poColumns: Column<PO>[] = [
    { key: "po_no", title: "رقم الأمر", width: "110px", render: (p) => <span className="tnum font-extrabold">{p.po_no}</span> },
    { key: "supplier_name", title: "المورد", render: (p) => p.supplier_name || "—" },
    { key: "expected_date", title: "التوريد المتوقع", width: "110px", render: (p) => p.expected_date ? dateFmt(p.expected_date) : <span className="text-text-dim">—</span> },
    { key: "total", title: "الإجمالي", width: "110px", render: (p) => <span className="tnum font-bold">{money(p.total)}</span> },
    { key: "status", title: "الحالة", width: "150px", render: (p) => <Badge tone={PO_BADGE[p.status].tone}>{PO_BADGE[p.status].label}</Badge> },
    { key: "invoice_no", title: "الفاتورة", width: "100px", render: (p) => p.invoice_no || <span className="text-text-dim">—</span> },
    {
      key: "actions", title: "", width: "90px",
      render: (p) => <Button variant="ghost" size="xs" onClick={() => openPO(p)}>عرض</Button>,
    },
  ];

  // ══════════ فاتورة شراء ضريبية A4 ══════════
  async function printTaxInvoice(inv: PurchaseInvoice) {
    try {
      const [detail, comp] = await Promise.all([
        api<PurchaseInvoiceDetail>(`/purchases/purchase-invoices/${inv.id}`),
        api<{ name: string; vat_number: string | null; cr_number: string | null; address: string | null; phone: string | null }>("/settings/company"),
      ]);
      const sup = suppliers.find((x) => x.id === inv.supplier_id);
      const fmt = (n: number) => Number(n).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const d = new Date(detail.invoice_date as any).toLocaleDateString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"));
      const w = window.open("", "_blank", "width=860,height=1000");
      if (!w) return;
      w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
        <title>فاتورة شراء ضريبية ${detail.invoice_no}</title>
        <style>
          *{box-sizing:border-box} body{font-family:'Cairo','Segoe UI',sans-serif;margin:0;padding:26px;color:#1E3A8A;font-size:13px}
          .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #1E3A8A;padding-bottom:12px}
          h1{font-size:20px;margin:0} .sub{color:#51617A;font-size:11px}
          .badge{background:#1E3A8A;color:#fff;border-radius:10px;padding:6px 14px;font-weight:900;font-size:13px}
          .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
          .box{border:1.5px solid #E2E8F0;border-radius:12px;padding:10px 12px}
          .box h3{margin:0 0 6px;font-size:12px;color:#1E3A8A}
          .box div{display:flex;justify-content:space-between;padding:2px 0}
          .box span{color:#51617A}
          table{width:100%;border-collapse:collapse;margin-top:6px}
          th{background:#1E3A8A;color:#fff;padding:8px;font-size:12px}
          td{border-bottom:1px solid #E2E8F0;padding:7px 8px;text-align:center}
          td:first-child{text-align:right}
          .totals{margin-top:12px;margin-right:auto;width:280px}
          .totals div{display:flex;justify-content:space-between;padding:5px 10px}
          .totals .grand{background:#1E3A8A;color:#fff;border-radius:10px;font-weight:900;font-size:15px}
          .foot{margin-top:22px;text-align:center;color:#51617A;font-size:10.5px;border-top:1px dashed #E2E8F0;padding-top:10px}
          @media print{.noprint{display:none}} .noprint{text-align:center;margin-top:16px}
          button{background:#1E3A8A;color:#fff;border:0;border-radius:10px;padding:10px 28px;font-weight:900;font-family:inherit;cursor:pointer}
        </style></head><body>
        <div class="head">
          <div><h1>فاتورة شراء ضريبية</h1><div class="sub">Tax Purchase Invoice</div></div>
          <div style="text-align:left"><div class="badge">${detail.invoice_no}</div>
            <div class="sub" style="margin-top:6px">التاريخ: ${d}${detail.supplier_invoice_ref ? `<br>فاتورة المورد: ${detail.supplier_invoice_ref}` : ""}</div></div>
        </div>
        <div class="grid">
          <div class="box"><h3>المورد (البائع)</h3>
            <div><span>الاسم</span><b>${sup?.name || detail.supplier_name || "—"}</b></div>
            <div><span>الرقم الضريبي</span><b>${sup?.vat_number || "—"}</b></div>
            <div><span>الجوال</span><b>${sup?.phone || "—"}</b></div>
            <div><span>العنوان</span><b>${sup?.address || "—"}</b></div>
          </div>
          <div class="box"><h3>المنشأة (المشتري)</h3>
            <div><span>الاسم</span><b>${comp.name || ""}</b></div>
            <div><span>الرقم الضريبي</span><b>${comp.vat_number || "—"}</b></div>
            <div><span>السجل التجاري</span><b>${comp.cr_number || "—"}</b></div>
            <div><span>العنوان</span><b>${comp.address || "—"}</b></div>
          </div>
        </div>
        <table><thead><tr><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الإجمالي</th></tr></thead><tbody>
          ${detail.items.map((it) => `<tr><td>${it.product_label}</td><td>${it.qty}</td><td>${fmt(it.unit_cost)}</td><td>${fmt(it.line_total)}</td></tr>`).join("")}
        </tbody></table>
        <div class="totals">
          <div><span>الإجمالي قبل الضريبة</span><b>${fmt(detail.subtotal)} ر.س</b></div>
          <div><span>ضريبة القيمة المضافة 15%</span><b>${fmt(detail.vat_total)} ر.س</b></div>
          <div class="grand"><span>الإجمالي شامل الضريبة</span><b>${fmt(detail.total)} ر.س</b></div>
        </div>
        <div class="foot">${comp.name || ""} — منصة Z8 · ${detail.payment_terms === "credit" ? `آجلة — الاستحقاق: ${detail.due_date ? new Date(detail.due_date as any).toLocaleDateString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn")) : ""}` : "نقدية"}</div>
        <div class="noprint"><button onclick="window.print()">طباعة</button></div>
        </body></html>`);
      w.document.close();
    } catch (e: any) { setPageErr(e.message); }
  }

  const tabs: { key: Tab; label: string }[] = [{ key: "invoices", label: "فواتير المشتريات" }];
  if (canQuot) tabs.push({ key: "quotations", label: "عروض الأسعار" });
  if (canPO) tabs.push({ key: "orders", label: "أوامر الشراء" });

  const linkedPoNo = viewInvoice?.po_id ? pos.find((p) => p.id === viewInvoice.po_id)?.po_no : null;
  const availableQuotationsForPO = quotations.filter((q) => q.status === "received" && (!poSupplierId || q.supplier_id === poSupplierId));

  return (
    <div className="space-y-4">
      <PageHeader title="المشتريات" description="فواتير الشراء وعروض الأسعار وأوامر الشراء." />

      <ErrorNote msg={pageErr} />

      {tabs.length > 1 && <Tabs value={tab} onChange={(t) => setTab(t as Tab)} items={tabs} />}

      {tab === "invoices" && (
        <Card>
          <DataTable
            columns={invoiceColumns}
            rows={rows}
            loading={loading}
            searchKeys={["invoice_no", "supplier_name", "supplier_invoice_ref"]}
            searchPlaceholder="بحث برقم الفاتورة أو المورد..."
            emptyText="لا توجد فواتير مشتريات بعد"
            toolbar={<Button onClick={openCreateInvoice}>+ فاتورة مشتريات</Button>}
          />
        </Card>
      )}

      {tab === "quotations" && canQuot && (
        <Card>
          <DataTable
            columns={quotationColumns}
            rows={quotations}
            loading={qLoading}
            searchKeys={["quotation_no", "supplier_name"]}
            searchPlaceholder="بحث برقم العرض أو المورد..."
            emptyText="لا توجد عروض أسعار بعد"
            toolbar={<Button onClick={openCreateQuotation}>+ عرض سعر جديد</Button>}
          />
        </Card>
      )}

      {tab === "orders" && canPO && (
        <Card>
          <DataTable
            columns={poColumns}
            rows={pos}
            loading={poLoading}
            searchKeys={["po_no", "supplier_name", "invoice_no"]}
            searchPlaceholder="بحث برقم الأمر أو المورد..."
            emptyText="لا توجد أوامر شراء بعد"
            toolbar={<Button onClick={openCreatePO}>+ أمر شراء جديد</Button>}
          />
        </Card>
      )}

      {/* ══════════ إنشاء فاتورة مشتريات ══════════ */}
      <Modal open={modalOpen} size="lg" onClose={() => setModalOpen(false)} title={invoicePoId ? "فاتورة مطابقة لأمر شراء" : "فاتورة مشتريات جديدة"}>
        <div className="space-y-3">
          {invoicePoId && (
            <div className="rounded-lg bg-petrol-soft p-2.5 text-t-sm font-bold text-petrol">
              مرتبطة بأمر شراء — الأصناف والكميات معبّأة من الاستلام المخزني، يمكنك تعديلها عند الحاجة.
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="المورد">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} disabled={!!invoicePoId}>
                <option value="">— اختر المورد —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="مرجع فاتورة المورد" hint="اختياري">
              <Input value={supplierRef} onChange={(e) => setSupplierRef(e.target.value)} />
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="تاريخ الفاتورة" hint="فارغ = اليوم">
              <Input type="date" className="tnum" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
            </Field>
            <Field label="شروط السداد">
              <Select value={paymentTerms} onChange={(e) => setPaymentTerms(e.target.value as any)}>
                <option value="credit">آجل</option>
                <option value="cash">نقدي فوري</option>
              </Select>
            </Field>
            {paymentTerms === "cash" ? (
              <Field label="طريقة الدفع">
                <Select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as any)}>
                  <option value="cash">نقدي</option>
                  <option value="card">شبكة</option>
                  <option value="transfer">تحويل</option>
                </Select>
              </Field>
            ) : (
              <Field label="تاريخ الاستحقاق">
                <Input type="date" className="tnum" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </Field>
            )}
          </div>

          <StockItemsEditor products={products} items={lines} onChange={setLines} withCost />

          <div className="rounded-lg bg-ink-3 p-3 text-t-sm">
            <div className="flex justify-between"><span className="text-text-dim">الإجمالي قبل الضريبة</span>
              <b className="tnum">{money(subtotal)}</b></div>
            <p className="mt-1 text-t-xs text-text-dim">الضريبة والإجمالي الكلي بيتحسبوا في السيرفر حسب نسبة ضريبة الشركة.</p>
          </div>

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)}>إلغاء</Button>
            <Button onClick={submit}
                    disabled={busy || !supplierId || validLines.length === 0 || (paymentTerms === "credit" && !dueDate)}>
              {busy ? "جارِ الحفظ..." : "حفظ الفاتورة"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تفاصيل فاتورة مشتريات ══════════ */}
      <Modal open={!!viewInvoice} size="lg" onClose={() => setViewInvoice(null)} title={`فاتورة ${viewInvoice?.invoice_no ?? ""}`}>
        {viewInvoice && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-t-sm sm:grid-cols-3">
              <div><span className="text-text-dim">المورد:</span> <b>{viewInvoice.supplier_name}</b></div>
              <div><span className="text-text-dim">التاريخ:</span> <b>{dateFmt(viewInvoice.invoice_date)}</b></div>
              <div><span className="text-text-dim">الحالة:</span> <Badge tone={STATUS_BADGE[viewInvoice.status].tone}>{STATUS_BADGE[viewInvoice.status].label}</Badge></div>
              {linkedPoNo && <div><span className="text-text-dim">أمر الشراء:</span> <b className="tnum">{linkedPoNo}</b></div>}
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-t-sm">
                <thead>
                  <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الصنف</th>
                    <th className="w-16 px-2 py-2 text-right">الكمية</th>
                    <th className="w-24 px-2 py-2 text-right">التكلفة</th>
                    <th className="w-24 px-2 py-2 text-right">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {viewInvoice.items.map((it) => (
                    <tr key={it.id} className="border-t border-line/70">
                      <td className="px-3 py-1.5">{it.product_label}</td>
                      <td className="px-2 py-1.5 tnum">{it.qty}</td>
                      <td className="px-2 py-1.5 tnum text-text-dim">{money(it.unit_cost)}</td>
                      <td className="px-2 py-1.5 tnum font-bold">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-2 text-t-sm">
              <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                <div className="text-text-dim">قبل الضريبة</div>
                <div className="tnum font-bold">{money(viewInvoice.subtotal)}</div>
              </div>
              <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                <div className="text-text-dim">الضريبة</div>
                <div className="tnum font-bold">{money(viewInvoice.vat_total)}</div>
              </div>
              <div className="rounded-lg bg-petrol-soft p-2.5 text-center">
                <div className="text-text-dim">الإجمالي</div>
                <div className="tnum font-black text-petrol">{money(viewInvoice.total)}</div>
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setViewInvoice(null)}>إغلاق</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════ إنشاء عرض سعر ══════════ */}
      <Modal open={qModalOpen} size="lg" onClose={() => setQModalOpen(false)} title="عرض سعر جديد من مورد">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="المورد">
              <Select value={qSupplierId} onChange={(e) => setQSupplierId(e.target.value)}>
                <option value="">— اختر المورد —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="صلاحية العرض حتى" hint="اختياري">
              <Input type="date" className="tnum" value={qValidUntil} onChange={(e) => setQValidUntil(e.target.value)} />
            </Field>
          </div>
          <Field label="ملاحظة" hint="اختياري">
            <Input value={qNote} onChange={(e) => setQNote(e.target.value)} />
          </Field>

          <StockItemsEditor products={products} items={qLines} onChange={setQLines} withCost />

          <div className="rounded-lg bg-ink-3 p-3 text-t-sm">
            <div className="flex justify-between"><span className="text-text-dim">إجمالي العرض (قبل الضريبة)</span>
              <b className="tnum">{money(validQLines.reduce((s, l) => s + (l.unitCost || 0) * l.qty, 0))}</b></div>
          </div>

          <ErrorNote msg={qErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setQModalOpen(false)}>إلغاء</Button>
            <Button onClick={submitQuotation} disabled={qBusy || !qSupplierId || validQLines.length === 0}>
              {qBusy ? "جارِ الحفظ..." : "حفظ العرض"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تفاصيل عرض سعر ══════════ */}
      <Modal open={!!viewQuotation} size="lg" onClose={() => setViewQuotation(null)} title={`عرض سعر ${viewQuotation?.quotation_no ?? ""}`}>
        {viewQuotation && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-t-sm sm:grid-cols-3">
              <div><span className="text-text-dim">المورد:</span> <b>{viewQuotation.supplier_name}</b></div>
              <div><span className="text-text-dim">الحالة:</span> <Badge tone={QUOT_BADGE[viewQuotation.status].tone}>{QUOT_BADGE[viewQuotation.status].label}</Badge></div>
              {viewQuotation.valid_until && <div><span className="text-text-dim">صالح حتى:</span> <b>{dateFmt(viewQuotation.valid_until)}</b></div>}
              {viewQuotation.note && <div className="sm:col-span-3"><span className="text-text-dim">ملاحظة:</span> {viewQuotation.note}</div>}
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-t-sm">
                <thead>
                  <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الصنف</th>
                    <th className="w-16 px-2 py-2 text-right">الكمية</th>
                    <th className="w-24 px-2 py-2 text-right">السعر</th>
                    <th className="w-24 px-2 py-2 text-right">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {viewQuotation.items.map((it) => (
                    <tr key={it.id} className="border-t border-line/70">
                      <td className="px-3 py-1.5">{it.product_label}</td>
                      <td className="px-2 py-1.5 tnum">{it.qty}</td>
                      <td className="px-2 py-1.5 tnum text-text-dim">{money(it.unit_cost)}</td>
                      <td className="px-2 py-1.5 tnum font-bold">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end text-t-md">
              <span className="text-text-dim">الإجمالي:</span>
              <b className="tnum ms-2">{money(viewQuotation.total)} ر.س</b>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setViewQuotation(null)}>إغلاق</Button>
              {viewQuotation.status === "received" && canPO && (
                <Button onClick={() => convertQuotationToPO(viewQuotation)}>تحويل لأمر شراء</Button>
              )}
              {viewQuotation.status === "received" && (
                <Button variant="ghost" size="sm" onClick={() => rejectQuotation(viewQuotation)}>رفض العرض</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════ إنشاء أمر شراء ══════════ */}
      <Modal open={poModalOpen} size="lg" onClose={() => setPoModalOpen(false)} title="أمر شراء جديد">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="المورد">
              <Select value={poSupplierId} onChange={(e) => { setPoSupplierId(e.target.value); setPoQuotationId(null); }}>
                <option value="">— اختر المورد —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </Field>
            <Field label="تاريخ التوريد المتوقع" hint="اختياري">
              <Input type="date" className="tnum" value={poExpected} onChange={(e) => setPoExpected(e.target.value)} />
            </Field>
          </div>

          {!!poQuotationId && (
            <div className="rounded-lg bg-petrol-soft p-2.5 text-t-sm font-bold text-petrol">
              مبني على عرض سعر — الأصناف معبّأة منه ويمكن تعديلها.
            </div>
          )}
          {!poQuotationId && availableQuotationsForPO.length > 0 && (
            <Field label="بناءً على عرض سعر" hint="اختياري — بيعبّي الأصناف تلقائياً">
              <Select value="" onChange={(e) => {
                const q = quotations.find((x) => x.id === e.target.value);
                if (!q) return;
                api<QuotationDetail>(`/purchases/quotations/${q.id}`).then((d) => {
                  setPoQuotationId(d.id);
                  setPoLines(d.items.filter((it) => it.product_id).map((it) => ({
                    productId: it.product_id as string, productLabel: it.product_label,
                    barcode: null, qty: it.qty, unitCost: it.unit_cost,
                  })));
                }).catch((err) => setPoErr(err.message));
              }}>
                <option value="">— بدون —</option>
                {availableQuotationsForPO.map((q) => <option key={q.id} value={q.id}>{q.quotation_no} — {money(q.total)} ر.س</option>)}
              </Select>
            </Field>
          )}

          <Field label="ملاحظة" hint="اختياري">
            <Input value={poNote} onChange={(e) => setPoNote(e.target.value)} />
          </Field>

          <StockItemsEditor products={products} items={poLines} onChange={setPoLines} withCost />

          <div className="rounded-lg bg-ink-3 p-3 text-t-sm">
            <div className="flex justify-between"><span className="text-text-dim">إجمالي أمر الشراء (قبل الضريبة)</span>
              <b className="tnum">{money(validPoLines.reduce((s, l) => s + (l.unitCost || 0) * l.qty, 0))}</b></div>
          </div>

          <ErrorNote msg={poErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setPoModalOpen(false)}>إلغاء</Button>
            <Button onClick={submitPO} disabled={poBusy || !poSupplierId || validPoLines.length === 0}>
              {poBusy ? "جارِ الحفظ..." : "حفظ أمر الشراء"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ تفاصيل أمر شراء ══════════ */}
      <Modal open={!!viewPO} size="lg" onClose={() => setViewPO(null)} title={`أمر شراء ${viewPO?.po_no ?? ""}`}>
        {viewPO && (
          <div className="space-y-3">
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-t-sm sm:grid-cols-3">
              <div><span className="text-text-dim">المورد:</span> <b>{viewPO.supplier_name}</b></div>
              <div><span className="text-text-dim">الحالة:</span> <Badge tone={PO_BADGE[viewPO.status].tone}>{PO_BADGE[viewPO.status].label}</Badge></div>
              {viewPO.expected_date && <div><span className="text-text-dim">التوريد المتوقع:</span> <b>{dateFmt(viewPO.expected_date)}</b></div>}
              {viewPO.approved_by_name && <div><span className="text-text-dim">اعتمده:</span> <b>{viewPO.approved_by_name}</b></div>}
              {viewPO.rejected_reason && <div className="sm:col-span-3 text-ember"><span className="text-text-dim">سبب الرفض:</span> {viewPO.rejected_reason}</div>}
              {viewPO.note && <div className="sm:col-span-3"><span className="text-text-dim">ملاحظة:</span> {viewPO.note}</div>}
              {viewPO.invoice_no && <div><span className="text-text-dim">الفاتورة:</span> <b className="tnum">{viewPO.invoice_no}</b></div>}
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-t-sm">
                <thead>
                  <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">الصنف</th>
                    <th className="w-20 px-2 py-2 text-right">الكمية</th>
                    <th className="w-20 px-2 py-2 text-right">المستلم</th>
                    <th className="w-24 px-2 py-2 text-right">السعر</th>
                    <th className="w-24 px-2 py-2 text-right">الإجمالي</th>
                  </tr>
                </thead>
                <tbody>
                  {viewPO.items.map((it) => (
                    <tr key={it.id} className="border-t border-line/70">
                      <td className="px-3 py-1.5">{it.product_label}</td>
                      <td className="px-2 py-1.5 tnum">{it.qty}</td>
                      <td className="px-2 py-1.5 tnum">
                        <span className={it.qty_received < it.qty ? "font-bold text-brass" : "text-emerald font-bold"}>{it.qty_received}</span>
                      </td>
                      <td className="px-2 py-1.5 tnum text-text-dim">{money(it.unit_cost)}</td>
                      <td className="px-2 py-1.5 tnum font-bold">{money(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="grid grid-cols-3 gap-2 text-t-sm">
              <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                <div className="text-text-dim">قبل الضريبة</div>
                <div className="tnum font-bold">{money(viewPO.subtotal)}</div>
              </div>
              <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                <div className="text-text-dim">الضريبة</div>
                <div className="tnum font-bold">{money(viewPO.vat_total)}</div>
              </div>
              <div className="rounded-lg bg-petrol-soft p-2.5 text-center">
                <div className="text-text-dim">الإجمالي</div>
                <div className="tnum font-black text-petrol">{money(viewPO.total)}</div>
              </div>
            </div>

            {viewPO.receipts.length > 0 && (
              <div>
                <div className="mb-1 text-t-sm font-extrabold text-text-dim">سندات الاستلام</div>
                <div className="space-y-1.5">
                  {viewPO.receipts.map((r) => (
                    <div key={r.id} className="rounded-lg border border-line p-2 text-t-sm">
                      <div className="flex justify-between font-bold">
                        <span className="tnum">{r.receipt_no}</span>
                        <span className="text-text-dim">{dateFmt(r.created_at)} {r.received_by_name ? `— ${r.received_by_name}` : ""}</span>
                      </div>
                      <div className="mt-1 text-text-dim">
                        {r.items.map((it) => `${it.product_label} ×${it.qty_received}`).join("، ")}
                      </div>
                      {r.note && <div className="mt-1 text-text-dim">ملاحظة: {r.note}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setViewPO(null)}>إغلاق</Button>
              {viewPO.status === "pending_approval" && (
                <>
                  <Button variant="ghost" size="sm" onClick={openReject}>رفض</Button>
                  <Button onClick={openApprove}>اعتماد</Button>
                </>
              )}
              {viewPO.status === "pending_approval" && (
                <Button variant="ghost" onClick={cancelPO}>إلغاء الأمر</Button>
              )}
              {(viewPO.status === "approved" || viewPO.status === "partially_received") && (
                <Button onClick={openReceive}>استلام بضاعة</Button>
              )}
              {!viewPO.invoice_id && (viewPO.status === "approved" || viewPO.status === "partially_received" || viewPO.status === "received") && (
                <Button onClick={() => openInvoiceFromPO(viewPO)}>إنشاء فاتورة مشتريات</Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* ══════════ اعتماد أمر شراء ══════════ */}
      <Modal open={approveOpen} onClose={() => setApproveOpen(false)} title="اعتماد أمر الشراء">
        <div className="space-y-3">
          <Field label="رمز اعتماد المشرف (لو مفعّل بالشركة)">
            <Input inputMode="numeric" value={approvePin}
                   onChange={(e) => setApprovePin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
          </Field>
          <ErrorNote msg={approveErr} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setApproveOpen(false)}>إلغاء</Button>
            <Button onClick={submitApprove} disabled={approveBusy}>{approveBusy ? "جارِ الاعتماد..." : "اعتماد"}</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ رفض أمر شراء ══════════ */}
      <Modal open={rejectOpen} onClose={() => setRejectOpen(false)} title="رفض أمر الشراء">
        <div className="space-y-3">
          <Field label="سبب الرفض">
            <Input value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} />
          </Field>
          <Field label="رمز اعتماد المشرف (لو مفعّل بالشركة)">
            <Input inputMode="numeric" value={rejectPin}
                   onChange={(e) => setRejectPin(e.target.value.replace(/\D/g, ""))} placeholder="••••" />
          </Field>
          <ErrorNote msg={rejectErr} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setRejectOpen(false)}>إلغاء</Button>
            <Button onClick={submitReject} disabled={rejectBusy || !rejectReason.trim()}>{rejectBusy ? "جارِ الرفض..." : "رفض"}</Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ استلام بضاعة ══════════ */}
      <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title={`استلام بضاعة — ${viewPO?.po_no ?? ""}`}>
        {viewPO && (
          <div className="space-y-3">
            <div className="space-y-2">
              {viewPO.items.filter((it) => it.product_id && it.qty_received < it.qty).map((it) => {
                const remaining = it.qty - it.qty_received;
                return (
                  <div key={it.id} className="flex items-center justify-between gap-2 rounded-lg border border-line p-2">
                    <div className="min-w-0 text-t-sm">
                      <div className="font-bold">{it.product_label}</div>
                      <div className="text-text-dim">المتبقي للاستلام: <span className="tnum">{remaining}</span> من <span className="tnum">{it.qty}</span></div>
                    </div>
                    <Input type="number" min={0} max={remaining} className="tnum w-24"
                           value={receiveQtys[it.id] ?? ""}
                           onChange={(e) => setReceiveQtys((p) => ({ ...p, [it.id]: e.target.value }))} />
                  </div>
                );
              })}
              {viewPO.items.every((it) => !it.product_id || it.qty_received >= it.qty) && (
                <div className="text-center text-t-sm text-text-dim">لا توجد أصناف متبقية للاستلام</div>
              )}
            </div>
            <Field label="ملاحظة" hint="اختياري">
              <Input value={receiveNote} onChange={(e) => setReceiveNote(e.target.value)} />
            </Field>
            <ErrorNote msg={receiveErr} />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setReceiveOpen(false)}>إلغاء</Button>
              <Button onClick={submitReceive} disabled={receiveBusy}>{receiveBusy ? "جارِ التسجيل..." : "تسجيل الاستلام"}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
