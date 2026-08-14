"use client";
// الخزينة — سندات القبض والصرف والمصروفات، بقيود محاسبية تلقائية وطباعة سند رسمي
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { money } from "@/modules/invoices/types";
import { Customer } from "@/modules/customers/types";

type Voucher = {
  id: string; voucher_no: string; type: "receipt" | "payment";
  amount: number; method: string; party_type: string;
  customer_id: string | null; customer_name: string | null;
  party_name: string | null; category: string | null; description: string | null;
  branch_name: string | null; created_at: string;
};
type Summary = { receipts: number; payments: number; receiptCount: number; paymentCount: number; net: number };
type Branch = { id: string; name: string };

const METHODS: Record<string, string> = { cash: "نقدي", card: "شبكة", transfer: "تحويل" };
const EXPENSE_CATS = ["إيجار", "كهرباء ومياه", "اتصالات وإنترنت", "صيانة", "رواتب وأجور", "تسويق وإعلان", "رسوم حكومية", "نظافة وضيافة", "مصروفات أخرى"];
const todayISO = () => new Date().toISOString().slice(0, 10);
const dtFmt = (s: string) => new Date(s).toLocaleString("ar-SA-u-nu-latn", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

export default function TreasuryPage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm("treasury.create");

  const [rows, setRows] = useState<Voucher[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [pageErr, setPageErr] = useState("");
  const [loading, setLoading] = useState(true);

  // ── نافذة سند جديد ──
  const [modal, setModal] = useState<null | "receipt" | "payment">(null);
  const [form, setForm] = useState({
    amount: "", method: "cash", branchId: "", partyType: "other",
    customerId: null as string | null, customerName: "", partyName: "",
    category: "مصروفات أخرى", description: "",
  });
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [allCust, setAllCust] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [vs, sm, br] = await Promise.all([
        api<Voucher[]>(`/treasury?dateFrom=${from}&dateTo=${to}`),
        api<Summary>("/treasury/summary"),
        api<Branch[]>("/branches"),
      ]);
      setRows(vs); setSummary(sm); setBranches(br); setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [from, to]);

  function openModal(t: "receipt" | "payment") {
    setForm({
      amount: "", method: "cash", branchId: branches[0]?.id || "",
      partyType: t === "receipt" ? "other" : "expense",
      customerId: null, customerName: "", partyName: "",
      category: t === "payment" ? "مصروفات أخرى" : "", description: "",
    });
    setCustQuery(""); setCustResults([]); setErr("");
    setModal(t);
  }

  async function searchCust(q: string) {
    setCustQuery(q);
    if (q.trim().length < 2) { setCustResults([]); return; }
    let base = allCust;
    if (!base) {
      try { base = await api<Customer[]>("/customers"); setAllCust(base); } catch { base = []; }
    }
    const low = q.trim().toLowerCase();
    setCustResults((base || []).filter((c) =>
      c.name.toLowerCase().includes(low) || (c.phone || "").includes(q.trim())).slice(0, 8));
  }

  async function save() {
    setErr(""); setBusy(true);
    try {
      const v = await api<Voucher>("/treasury", {
        method: "POST",
        body: JSON.stringify({
          type: modal, amount: Number(form.amount), method: form.method,
          branchId: form.branchId || null, partyType: form.partyType,
          customerId: form.partyType === "customer" ? form.customerId : null,
          partyName: form.partyName.trim() || null,
          category: form.category || null, description: form.description.trim() || null,
        }),
      });
      setModal(null);
      printVoucher({ ...v, customer_name: v.customer_name ?? form.customerName });
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function printVoucher(v: Voucher) {
    const { printReport, tableHTML } = await import("@/lib/print");
    const isRec = v.type === "receipt";
    const party = v.customer_name || v.party_name ||
      (v.party_type === "expense" ? v.category : "—") || "—";
    const body =
      `<div style="text-align:center;margin:6px 0 12px">
         <span style="border:2px solid ${isRec ? "#157F4C" : "#C2382F"};color:${isRec ? "#157F4C" : "#C2382F"};
                border-radius:10px;padding:6px 22px;font-size:16px;font-weight:800">
           ${isRec ? "سنــد قبــض" : "سنــد صــرف"}
         </span>
       </div>` +
      tableHTML(["البيان", "القيمة"], [
        ["رقم السند", v.voucher_no],
        ["التاريخ", new Date(v.created_at).toLocaleString("ar-SA-u-nu-latn")],
        [isRec ? "استلمنا من" : "صرفنا إلى", party],
        ["المبلغ (ر.س)", money(v.amount)],
        ["طريقة الدفع", METHODS[v.method] || v.method],
        ...(v.category ? [["البند", v.category] as [string, string]] : []),
        ...(v.description ? [["البيان", v.description] as [string, string]] : []),
        ...(v.branch_name ? [["الفرع", v.branch_name] as [string, string]] : []),
      ], { numericCols: [] }) +
      `<div style="display:flex;justify-content:space-between;margin-top:40px;font-size:11.5px">
         <div>توقيع ${isRec ? "المستلِم" : "الصارف"}: ______________</div>
         <div>توقيع ${isRec ? "الدافع" : "المستلِم"}: ______________</div>
       </div>`;
    printReport(isRec ? "سند قبض" : "سند صرف", `رقم ${v.voucher_no}`, body);
  }

  const totals = useMemo(() => ({
    rec: rows.filter((r) => r.type === "receipt").reduce((s, r) => s + r.amount, 0),
    pay: rows.filter((r) => r.type === "payment").reduce((s, r) => s + r.amount, 0),
  }), [rows]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[19px] font-extrabold">الخزينة</h1>
        {canCreate && (
          <div className="flex gap-2">
            <button onClick={() => openModal("receipt")}
                    className="rounded-xl bg-emerald px-5 py-2.5 text-[13.5px] font-black text-white shadow-card transition hover:brightness-110 active:scale-[.98]">
              ⬇ سند قبض
            </button>
            <button onClick={() => openModal("payment")}
                    className="rounded-xl bg-ember px-5 py-2.5 text-[13.5px] font-black text-white shadow-card transition hover:brightness-110 active:scale-[.98]">
              ⬆ سند صرف
            </button>
          </div>
        )}
      </div>

      <ErrorNote msg={pageErr} />

      {summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><div className="text-[11.5px] font-bold text-text-dim">مقبوضات اليوم ({summary.receiptCount})</div>
            <div className="mt-1 tnum text-[19px] font-black text-emerald">{money(summary.receipts)} ر.س</div></Card>
          <Card><div className="text-[11.5px] font-bold text-text-dim">مصروفات اليوم ({summary.paymentCount})</div>
            <div className="mt-1 tnum text-[19px] font-black text-ember">{money(summary.payments)} ر.س</div></Card>
          <Card><div className="text-[11.5px] font-bold text-text-dim">صافي حركة اليوم</div>
            <div className={`mt-1 tnum text-[19px] font-black ${summary.net >= 0 ? "text-petrol" : "text-ember"}`}>{money(summary.net)} ر.س</div></Card>
        </div>
      )}

      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="font-bold text-text-dim">من</span>
            <Input type="date" className="tnum !py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="font-bold text-text-dim">إلى</span>
            <Input type="date" className="tnum !py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex gap-3 text-[12px] font-bold">
            <span className="text-emerald">قبض: <span className="tnum">{money(totals.rec)}</span></span>
            <span className="text-ember">صرف: <span className="tnum">{money(totals.pay)}</span></span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                <th className="px-3 py-2 text-right">السند</th>
                <th className="px-3 py-2 text-right">النوع</th>
                <th className="px-3 py-2 text-right">الطرف / البند</th>
                <th className="px-3 py-2 text-right">الطريقة</th>
                <th className="px-3 py-2 text-right">المبلغ</th>
                <th className="px-3 py-2 text-right">التاريخ</th>
                <th className="w-24 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-dim">جارِ التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-dim">لا سندات في الفترة</td></tr>
              ) : rows.map((v) => (
                <tr key={v.id} className="border-t border-line/70">
                  <td className="px-3 py-2 tnum font-extrabold">{v.voucher_no}</td>
                  <td className="px-3 py-2">
                    {v.type === "receipt" ? <Badge tone="good">قبض</Badge> : <Badge tone="warn">صرف</Badge>}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-bold">{v.customer_name || v.party_name || v.category || "—"}</div>
                    {v.description && <div className="text-[11px] text-text-dim">{v.description}</div>}
                  </td>
                  <td className="px-3 py-2 text-text-dim">{METHODS[v.method] || v.method}</td>
                  <td className={`px-3 py-2 tnum font-black ${v.type === "receipt" ? "text-emerald" : "text-ember"}`}>
                    {v.type === "receipt" ? "+" : "−"}{money(v.amount)}
                  </td>
                  <td className="px-3 py-2 tnum text-[11.5px] text-text-dim">{dtFmt(v.created_at)}</td>
                  <td className="px-2 py-2">
                    <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => printVoucher(v)}>🖨 السند</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ══════════ سند جديد ══════════ */}
      <Modal open={!!modal} onClose={() => setModal(null)}
             title={modal === "receipt" ? "سند قبض جديد" : "سند صرف / مصروف جديد"}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="المبلغ (ر.س)">
              <Input type="number" min={0.01} step="0.01" className="tnum !text-[15px] font-bold" autoFocus
                     value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="طريقة الدفع">
              <Select value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value })}>
                <option value="cash">نقدي</option><option value="card">شبكة</option><option value="transfer">تحويل</option>
              </Select>
            </Field>
          </div>

          <Field label={modal === "receipt" ? "القبض من" : "الصرف لـ"}>
            <Select value={form.partyType}
                    onChange={(e) => setForm({ ...form, partyType: e.target.value, customerId: null, customerName: "" })}>
              {modal === "receipt" ? (
                <>
                  <option value="other">إيراد آخر (غير مديونية)</option>
                  <option value="customer">عميل — تحصيل مديونية</option>
                </>
              ) : (
                <>
                  <option value="expense">بند مصروف</option>
                  <option value="supplier">مورد — سداد مديونية</option>
                </>
              )}
            </Select>
          </Field>

          {form.partyType === "customer" && (
            <Field label="العميل" hint="بحث بالاسم أو الجوال — التحصيل هيخفض مديونيته تلقائياً">
              <div className="relative">
                <Input value={form.customerId ? form.customerName : custQuery}
                       onChange={(e) => { setForm({ ...form, customerId: null, customerName: "" }); searchCust(e.target.value); }} />
                {custResults.length > 0 && !form.customerId && (
                  <div className="absolute z-10 mt-1 w-full rounded-lg border border-line bg-ink-2 shadow-panel">
                    {custResults.map((c) => (
                      <button key={c.id}
                              onClick={() => { setForm({ ...form, customerId: c.id, customerName: c.name }); setCustResults([]); }}
                              className="block w-full px-3 py-2 text-right text-[12.5px] hover:bg-ink-3">
                        {c.name} {c.phone ? `— ${c.phone}` : ""}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          )}

          {form.partyType === "expense" && (
            <Field label="بند المصروف" hint="كل بند بيتسجل على حسابه المحاسبي تلقائياً">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          )}

          {form.partyType === "supplier" && (
            <Field label="اسم المورد">
              <Input value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} />
            </Field>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الفرع">
              <Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="البيان (اختياري)">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>

          <ErrorNote msg={err} />
          <button onClick={save}
                  disabled={busy || !(Number(form.amount) > 0) ||
                    (form.partyType === "customer" && !form.customerId) ||
                    (form.partyType === "supplier" && !form.partyName.trim())}
                  className={`w-full rounded-xl py-3 text-[14px] font-black text-white transition hover:brightness-110 disabled:opacity-40
                    ${modal === "receipt" ? "bg-emerald" : "bg-ember"}`}>
            {busy ? "جارِ الحفظ..." : modal === "receipt" ? "✓ حفظ وطباعة سند القبض" : "✓ حفظ وطباعة سند الصرف"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
