"use client";
// شاشة فواتير المشتريات — شراء مباشر (بدون أمر شراء رسمي): يزوّد مخزون المستودع
// فوراً ويسجّل القيد المحاسبي والذمة الدائنة للمورد لو آجل
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { StockItemsEditor, StockLine } from "@/components/StockItemsEditor";
import { Product, productLabel } from "@/modules/products/types";
import { Supplier } from "@/modules/suppliers/types";
import { PurchaseInvoice, PurchaseInvoiceDetail, money } from "@/modules/purchases/types";

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

const STATUS_BADGE: Record<PurchaseInvoice["status"], { tone: "good" | "warn" | "neutral"; label: string }> = {
  paid: { tone: "good", label: "مدفوعة" },
  partially_paid: { tone: "warn", label: "مدفوعة جزئياً" },
  unpaid: { tone: "neutral", label: "غير مدفوعة" },
};

export default function PurchasesPage() {
  const [rows, setRows] = useState<PurchaseInvoice[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [modalOpen, setModalOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [supplierRef, setSupplierRef] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [paymentTerms, setPaymentTerms] = useState<"cash" | "credit">("credit");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [dueDate, setDueDate] = useState("");
  const [lines, setLines] = useState<StockLine[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [viewInvoice, setViewInvoice] = useState<PurchaseInvoiceDetail | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [inv, sup, pr] = await Promise.all([
        api<PurchaseInvoice[]>("/purchases/purchase-invoices"),
        api<Supplier[]>("/suppliers"),
        api<Product[]>("/products").then((ps) => ps.filter((p) => !p.is_service)),
      ]);
      setRows(inv); setSuppliers(sup); setProducts(pr); setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setSupplierId(suppliers[0]?.id || ""); setSupplierRef(""); setInvoiceDate("");
    setPaymentTerms("credit"); setPaymentMethod("cash"); setDueDate("");
    setLines([]); setErr(""); setModalOpen(true);
  }

  const validLines = lines.filter((l) => l.productId && l.qty > 0);
  const subtotal = validLines.reduce((s, l) => s + (l.unitCost || 0) * l.qty, 0);

  async function submit() {
    setErr(""); setBusy(true);
    try {
      const body = {
        supplierId, supplierInvoiceRef: supplierRef.trim() || null,
        invoiceDate: invoiceDate || null,
        paymentTerms, paymentMethod: paymentTerms === "cash" ? paymentMethod : undefined,
        dueDate: paymentTerms === "credit" ? dueDate : null,
        items: validLines.map((l) => ({
          productId: l.productId, productLabel: l.productLabel, qty: l.qty, unitCost: l.unitCost || 0,
        })),
      };
      await api("/purchases/purchase-invoices", { method: "POST", body: JSON.stringify(body) });
      setModalOpen(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function openInvoice(inv: PurchaseInvoice) {
    try { setViewInvoice(await api<PurchaseInvoiceDetail>(`/purchases/purchase-invoices/${inv.id}`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  const columns: Column<PurchaseInvoice>[] = [
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
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => openInvoice(i)}>عرض</Button>
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => printTaxInvoice(i)}>🖨 ضريبية</Button>
        </div>
      ),
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
      const fmt = (n: number) => Number(n).toLocaleString("ar-SA-u-nu-latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const d = new Date(detail.invoice_date as any).toLocaleDateString("ar-SA-u-nu-latn");
      const w = window.open("", "_blank", "width=860,height=1000");
      if (!w) return;
      w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
        <title>فاتورة شراء ضريبية ${detail.invoice_no}</title>
        <style>
          *{box-sizing:border-box} body{font-family:'Cairo','Segoe UI',sans-serif;margin:0;padding:26px;color:#0F2D52;font-size:13px}
          .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0F2D52;padding-bottom:12px}
          h1{font-size:20px;margin:0} .sub{color:#51617A;font-size:11px}
          .badge{background:#16A34A;color:#fff;border-radius:10px;padding:6px 14px;font-weight:900;font-size:13px}
          .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0}
          .box{border:1.5px solid #E2E8F0;border-radius:12px;padding:10px 12px}
          .box h3{margin:0 0 6px;font-size:12px;color:#16A34A}
          .box div{display:flex;justify-content:space-between;padding:2px 0}
          .box span{color:#51617A}
          table{width:100%;border-collapse:collapse;margin-top:6px}
          th{background:#0F2D52;color:#fff;padding:8px;font-size:12px}
          td{border-bottom:1px solid #E2E8F0;padding:7px 8px;text-align:center}
          td:first-child{text-align:right}
          .totals{margin-top:12px;margin-right:auto;width:280px}
          .totals div{display:flex;justify-content:space-between;padding:5px 10px}
          .totals .grand{background:#0F2D52;color:#fff;border-radius:10px;font-weight:900;font-size:15px}
          .foot{margin-top:22px;text-align:center;color:#51617A;font-size:10.5px;border-top:1px dashed #E2E8F0;padding-top:10px}
          @media print{.noprint{display:none}} .noprint{text-align:center;margin-top:16px}
          button{background:#16A34A;color:#fff;border:0;border-radius:10px;padding:10px 28px;font-weight:900;font-family:inherit;cursor:pointer}
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
        <div class="foot">${comp.name || ""} — منصة Z8 · ${detail.payment_terms === "credit" ? `آجلة — الاستحقاق: ${detail.due_date ? new Date(detail.due_date as any).toLocaleDateString("ar-SA-u-nu-latn") : ""}` : "نقدية"}</div>
        <div class="noprint"><button onclick="window.print()">🖨 طباعة</button></div>
        </body></html>`);
      w.document.close();
    } catch (e: any) { setPageErr(e.message); }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">فواتير المشتريات</h1>
        <span className="text-[12px] text-text-dim tnum">{rows.length} فاتورة</span>
      </div>

      <ErrorNote msg={pageErr} />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          searchKeys={["invoice_no", "supplier_name", "supplier_invoice_ref"]}
          searchPlaceholder="بحث برقم الفاتورة أو المورد..."
          emptyText="لا توجد فواتير مشتريات بعد"
          toolbar={<Button onClick={openCreate}>+ فاتورة مشتريات</Button>}
        />
      </Card>

      {/* ══════════ إنشاء فاتورة مشتريات ══════════ */}
      <Modal open={modalOpen} size="lg" onClose={() => setModalOpen(false)} title="فاتورة مشتريات جديدة">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="المورد">
              <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
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

          <div className="rounded-lg bg-ink-3 p-3 text-[12.5px]">
            <div className="flex justify-between"><span className="text-text-dim">الإجمالي قبل الضريبة</span>
              <b className="tnum">{money(subtotal)}</b></div>
            <p className="mt-1 text-[11px] text-text-dim">الضريبة والإجمالي الكلي بيتحسبوا في السيرفر حسب نسبة ضريبة الشركة.</p>
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
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-[12.5px] sm:grid-cols-3">
              <div><span className="text-text-dim">المورد:</span> <b>{viewInvoice.supplier_name}</b></div>
              <div><span className="text-text-dim">التاريخ:</span> <b>{dateFmt(viewInvoice.invoice_date)}</b></div>
              <div><span className="text-text-dim">الحالة:</span> <Badge tone={STATUS_BADGE[viewInvoice.status].tone}>{STATUS_BADGE[viewInvoice.status].label}</Badge></div>
            </div>

            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
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

            <div className="grid grid-cols-3 gap-2 text-[12.5px]">
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
    </div>
  );
}
