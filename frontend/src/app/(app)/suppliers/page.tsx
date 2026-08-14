"use client";
// شاشة الموردين — سجل الموردين + كشف حساب الذمم الدائنة + سندات الصرف
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { DataTable, Column } from "@/components/DataTable";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { Supplier, SupplierStatement, money } from "@/modules/suppliers/types";

const EMPTY = { name: "", phone: "", vatNumber: "", address: "", paymentTermsDays: 0 };

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default function SuppliersPage() {
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [modal, setModal] = useState<null | { mode: "create" } | { mode: "edit"; id: string }>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const [statement, setStatement] = useState<SupplierStatement | null>(null);
  const [payAmount, setPayAmount] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "card" | "transfer">("cash");
  const [payInvoiceId, setPayInvoiceId] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payErr, setPayErr] = useState("");

  async function load() {
    setLoading(true);
    try { setRows(await api<Supplier[]>("/suppliers")); setPageErr(""); }
    catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ ...EMPTY }); setErr(""); setModal({ mode: "create" });
  }
  function openEdit(s: Supplier) {
    setForm({
      name: s.name, phone: s.phone || "", vatNumber: s.vat_number || "",
      address: s.address || "", paymentTermsDays: s.payment_terms_days,
    });
    setErr(""); setModal({ mode: "edit", id: s.id });
  }

  async function save() {
    setErr(""); setBusy(true);
    try {
      if (modal?.mode === "create") {
        await api("/suppliers", { method: "POST", body: JSON.stringify(form) });
      } else if (modal?.mode === "edit") {
        await api(`/suppliers/${modal.id}`, { method: "PUT", body: JSON.stringify(form) });
      }
      setModal(null);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(s: Supplier) {
    if (!await appConfirm(`حذف المورد «${s.name}»؟`)) return;
    try { await api(`/suppliers/${s.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function openStatement(s: Supplier) {
    setPayAmount(""); setPayInvoiceId(""); setPayNote(""); setPayErr("");
    try { setStatement(await api<SupplierStatement>(`/suppliers/${s.id}/statement`)); }
    catch (e: any) { await appAlert(e.message); }
  }

  async function submitPayment() {
    if (!statement) return;
    setPayErr("");
    const amount = Number(payAmount);
    if (!amount || amount <= 0) { setPayErr("أدخل مبلغاً صحيحاً"); return; }
    try {
      await api(`/suppliers/${statement.supplier.id}/pay`, {
        method: "POST",
        body: JSON.stringify({
          amount, method: payMethod, invoiceId: payInvoiceId || null, note: payNote.trim() || null,
        }),
      });
      setPayAmount(""); setPayInvoiceId(""); setPayNote("");
      setStatement(await api<SupplierStatement>(`/suppliers/${statement.supplier.id}/statement`));
      await load();
    } catch (e: any) { setPayErr(e.message); }
  }

  const columns: Column<Supplier>[] = [
    {
      key: "name", title: "المورد",
      render: (s) => (
        <div>
          <div className="font-extrabold">{s.name}</div>
          <div className="text-[11px] text-text-dim">{s.phone || "—"}</div>
        </div>
      ),
    },
    {
      key: "payment_terms_days", title: "شروط السداد", width: "110px",
      render: (s) => s.payment_terms_days > 0 ? `آجل ${s.payment_terms_days} يوم` : "نقدي فوري",
    },
    {
      key: "balance", title: "الذمة الدائنة", width: "130px",
      render: (s) => (
        <span className={`tnum font-bold ${s.balance > 0 ? "text-ember" : "text-text-dim"}`}>
          {money(s.balance)}
        </span>
      ),
    },
    {
      key: "vat_number", title: "الرقم الضريبي", width: "140px",
      render: (s) => s.vat_number || <span className="text-text-dim">—</span>,
    },
    {
      key: "actions", title: "", width: "220px",
      render: (s) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                  onClick={() => openStatement(s)}>كشف حساب</Button>
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                  onClick={() => openEdit(s)}>تعديل</Button>
          <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]"
                  onClick={() => remove(s)}>حذف</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">الموردون</h1>
        <span className="text-[12px] text-text-dim tnum">{rows.length} مورد</span>
      </div>

      <ErrorNote msg={pageErr} />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          searchKeys={["name", "phone", "vat_number"]}
          searchPlaceholder="بحث بالاسم أو الجوال أو الرقم الضريبي..."
          emptyText="لا يوجد موردون بعد — أضف أول مورد"
          toolbar={<Button onClick={openCreate}>+ مورد جديد</Button>}
        />
      </Card>

      {/* ══════════ إنشاء / تعديل مورد ══════════ */}
      <Modal open={!!modal} onClose={() => setModal(null)}
             title={modal?.mode === "create" ? "مورد جديد" : "تعديل المورد"}>
        <div className="space-y-3">
          <Field label="اسم المورد">
            <Input value={form.name} autoFocus onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="رقم الجوال">
              <Input value={form.phone} className="tnum" onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </Field>
            <Field label="الرقم الضريبي">
              <Input value={form.vatNumber} className="tnum" onChange={(e) => setForm({ ...form, vatNumber: e.target.value })} />
            </Field>
          </div>
          <Field label="العنوان">
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </Field>
          <Field label="مدة الأجل الافتراضية (أيام)" hint="0 = نقدي فوري">
            <Input type="number" min={0} className="tnum" value={form.paymentTermsDays}
                   onChange={(e) => setForm({ ...form, paymentTermsDays: +e.target.value || 0 })} />
          </Field>
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button>
            <Button onClick={save} disabled={busy || form.name.trim().length < 1}>
              {busy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ كشف حساب المورد ══════════ */}
      <Modal open={!!statement} size="lg" onClose={() => setStatement(null)}
             title={statement?.supplier.name || ""}>
        {statement && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-lg bg-ink-3 p-3">
              <span className="text-[12.5px] font-bold text-text-dim">الذمة الدائنة الحالية</span>
              <span className={`tnum text-[16px] font-black ${statement.balance > 0 ? "text-ember" : "text-emerald"}`}>
                {money(statement.balance)} ر.س
              </span>
            </div>

            {statement.dueInvoices.length > 0 && (
              <div className="rounded-lg border border-ember/30 bg-ember-bg p-3">
                <p className="mb-2 text-[12px] font-bold text-ember">فواتير آجلة مستحقة</p>
                <div className="space-y-1">
                  {statement.dueInvoices.map((d) => (
                    <div key={d.id} className="flex justify-between text-[12px]">
                      <span className="tnum">{d.invoice_no}</span>
                      <span>استحقاق: {d.due_date ? dateFmt(d.due_date) : "—"}</span>
                      <span className="tnum font-bold">{money(d.total - d.paid_total)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="max-h-56 overflow-y-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-[12px]">
                <thead>
                  <tr className="bg-ink-3 text-[11px] font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">التاريخ</th>
                    <th className="px-3 py-2 text-right">النوع</th>
                    <th className="px-3 py-2 text-right">المرجع</th>
                    <th className="px-3 py-2 text-right">المبلغ</th>
                    <th className="px-3 py-2 text-right">الرصيد</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.entries.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-5 text-center text-text-dim">لا توجد حركات بعد</td></tr>
                  ) : statement.entries.map((e) => (
                    <tr key={e.id} className="border-t border-line/70">
                      <td className="px-3 py-2 text-text-dim">{dateFmt(e.created_at)}</td>
                      <td className="px-3 py-2">
                        {e.entry_type === "invoice" ? <Badge tone="warn">فاتورة شراء</Badge> : <Badge tone="good">سداد</Badge>}
                      </td>
                      <td className="px-3 py-2 tnum">{e.invoice_no || "—"}</td>
                      <td className={`px-3 py-2 tnum font-bold ${e.amount > 0 ? "text-ember" : "text-emerald"}`}>
                        {e.amount > 0 ? "+" : ""}{money(e.amount)}
                      </td>
                      <td className="px-3 py-2 tnum font-bold">{money(e.running_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {statement.balance > 0 && (
              <div className="space-y-2 rounded-lg border border-line bg-ink-3 p-3">
                <p className="text-[12.5px] font-bold">تسجيل سند صرف (سداد)</p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <Field label="المبلغ">
                    <Input type="number" min={0.01} step="0.01" className="tnum" value={payAmount}
                           onChange={(e) => setPayAmount(e.target.value)} />
                  </Field>
                  <Field label="طريقة الصرف">
                    <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value as any)}>
                      <option value="cash">نقدي</option>
                      <option value="card">شبكة</option>
                      <option value="transfer">تحويل</option>
                    </Select>
                  </Field>
                  {statement.dueInvoices.length > 0 && (
                    <Field label="تخصيص لفاتورة (اختياري)">
                      <Select value={payInvoiceId} onChange={(e) => setPayInvoiceId(e.target.value)}>
                        <option value="">سداد عام (غير مخصص)</option>
                        {statement.dueInvoices.map((d) => (
                          <option key={d.id} value={d.id}>{d.invoice_no}</option>
                        ))}
                      </Select>
                    </Field>
                  )}
                  <Field label="ملاحظة">
                    <Input value={payNote} onChange={(e) => setPayNote(e.target.value)} />
                  </Field>
                </div>
                <ErrorNote msg={payErr} />
                <div className="flex justify-end">
                  <Button onClick={submitPayment}>تسجيل الصرف</Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
