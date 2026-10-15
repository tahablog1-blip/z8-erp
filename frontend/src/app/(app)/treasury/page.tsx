"use client";
// الخزينة — سندات القبض والصرف والمصروفات والسلف، بقيود محاسبية تلقائية وطباعة سند رسمي
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { money } from "@/modules/invoices/types";
import { Customer } from "@/modules/customers/types";

type Voucher = {
  id: string; voucher_no: string; type: "receipt" | "payment";
  amount: number; method: string; party_type: string; status?: string;
  customer_id: string | null; customer_name: string | null;
  employee_id?: string | null; employee_name?: string | null;
  party_name: string | null; category: string | null; description: string | null;
  reason?: string | null; reference_no?: string | null; voucher_date?: string | null;
  branch_name: string | null; created_at: string;
};
type Summary = { receipts: number; payments: number; receiptCount: number; paymentCount: number; net: number };
type Branch = { id: string; name: string };
type Employee = { id: string; name: string; advanceBalance: number };

const METHODS: Record<string, string> = { cash: "نقدي", card: "شبكة", transfer: "تحويل" };
const REASONS: Record<string, string> = { advance: "سلفة", advance_repay: "سداد سلفة", salary: "راتب / أجر" };
const EXPENSE_CATS = ["إيجار", "كهرباء ومياه", "اتصالات وإنترنت", "صيانة", "رواتب وأجور", "تسويق وإعلان", "رسوم حكومية", "نظافة وضيافة", "مصروفات أخرى"];
// تاريخ محلي (مش UTC) — عشان بين 12 و3 الفجر بتوقيت الرياض ما يرجعش اليوم اللي فات
const todayISO = () => new Date().toLocaleDateString("en-CA");
const dtFmt = (s: string) => new Date(s).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"), { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });

const emptyForm = () => ({
  amount: "", method: "cash", branchId: "", partyType: "other",
  customerId: null as string | null, customerName: "", partyName: "",
  employeeId: "", reason: "advance", installment: "",
  category: "مصروفات أخرى", description: "", referenceNo: "", voucherDate: todayISO(),
});

export default function TreasuryPage() {
  const { hasPerm } = useAuth();
  const canCreate = hasPerm("treasury.create");

  const [rows, setRows] = useState<Voucher[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [from, setFrom] = useState(todayISO());
  const [to, setTo] = useState(todayISO());
  const [showCancelled, setShowCancelled] = useState(false);
  const [pageErr, setPageErr] = useState("");
  const [loading, setLoading] = useState(true);

  // ── نافذة سند جديد ──
  const [modal, setModal] = useState<null | "receipt" | "payment">(null);
  const [form, setForm] = useState(emptyForm());
  const [custQuery, setCustQuery] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [allCust, setAllCust] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    try {
      const [vs, sm, br] = await Promise.all([
        api<Voucher[]>(`/treasury?dateFrom=${from}&dateTo=${to}&includeCancelled=${showCancelled}`),
        api<Summary>("/treasury/summary"),
        api<Branch[]>("/branches"),
      ]);
      setRows(vs); setSummary(sm); setBranches(br); setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [from, to, showCancelled]);

  async function openModal(t: "receipt" | "payment") {
    setForm({ ...emptyForm(), branchId: branches[0]?.id || "",
              partyType: t === "receipt" ? "customer" : "expense",
              category: t === "payment" ? "مصروفات أخرى" : "" });
    setCustQuery(""); setCustResults([]); setErr("");
    setModal(t);
    try { setEmployees(await api<Employee[]>("/treasury/employees")); } catch (e: any) { setErr("تعذر تحميل الموظفين: " + e.message); }
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

  const selectedEmp = employees.find((e) => e.id === form.employeeId);
  const isEmp = form.partyType === "employee";
  const isAdvance = modal === "payment" && isEmp && form.reason === "advance";
  const overBalance = modal === "receipt" && isEmp && !!selectedEmp && Number(form.amount) > selectedEmp.advanceBalance;
  const needsDesc = form.partyType === "other" || (form.partyType === "expense" && form.category === "مصروفات أخرى");

  const canSave =
    !busy && Number(form.amount) > 0 &&
    (form.partyType !== "customer" || !!form.customerId) &&
    (form.partyType !== "supplier" || !!form.partyName.trim()) &&
    (form.partyType !== "other" || !!form.partyName.trim()) &&
    (!isEmp || !!form.employeeId) && !overBalance &&
    (!isAdvance || Number(form.installment) > 0) &&
    (!needsDesc || !!form.description.trim());

  async function save() {
    setErr(""); setBusy(true);
    try {
      const v = await api<Voucher>("/treasury", {
        method: "POST",
        body: JSON.stringify({
          type: modal, amount: Number(form.amount), method: form.method,
          branchId: form.branchId || null, partyType: form.partyType,
          customerId: form.partyType === "customer" ? form.customerId : null,
          employeeId: isEmp ? form.employeeId : null,
          reason: modal === "payment" && isEmp ? form.reason : null,
          installment: isAdvance ? Number(form.installment) : null,
          partyName: form.partyName.trim() || null,
          category: form.partyType === "expense" ? form.category : null,
          description: form.description.trim() || null,
          referenceNo: form.referenceNo.trim() || null,
          voucherDate: form.voucherDate || null,
        }),
      });
      setModal(null);
      printVoucher({ ...v, customer_name: v.customer_name ?? form.customerName,
                     employee_name: v.employee_name ?? selectedEmp?.name ?? null });
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function cancelVoucher(v: Voucher) {
    const reason = window.prompt(`سبب إلغاء السند ${v.voucher_no}؟`);
    if (!reason || reason.trim().length < 2) return;
    try {
      await api<unknown>(`/treasury/${v.id}/cancel`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      await load();
    } catch (e: any) { setPageErr(e.message); }
  }

  async function printVoucher(v: Voucher) {
    const { printReport, tableHTML } = await import("@/lib/print");
    const isRec = v.type === "receipt";
    const party = v.employee_name || v.customer_name || v.party_name ||
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
        ["التاريخ", v.voucher_date || new Date(v.created_at).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"))],
        [isRec ? "استلمنا من" : "صرفنا إلى", party],
        ["المبلغ (ر.س)", money(v.amount)],
        ["طريقة الدفع", METHODS[v.method] || v.method],
        ...(v.reason ? [["السبب", REASONS[v.reason] || v.reason] as [string, string]] : []),
        ...(v.category ? [["البند", v.category] as [string, string]] : []),
        ...(v.reference_no ? [["المرجع", v.reference_no] as [string, string]] : []),
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
    rec: rows.filter((r) => r.type === "receipt" && r.status !== "cancelled").reduce((s, r) => s + r.amount, 0),
    pay: rows.filter((r) => r.type === "payment" && r.status !== "cancelled").reduce((s, r) => s + r.amount, 0),
  }), [rows]);

  const reset = (extra: object) => setForm({ ...form, customerId: null, customerName: "", partyName: "",
    employeeId: "", installment: "", ...extra });

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
          <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
            <span className="font-bold text-text-dim">من</span>
            <Input type="date" className="tnum !py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="font-bold text-text-dim">إلى</span>
            <Input type="date" className="tnum !py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
            <label className="flex items-center gap-1.5 text-[12px] font-bold text-text-dim">
              <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              إظهار الملغي
            </label>
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
                <th className="w-40 px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-dim">جارِ التحميل...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="px-3 py-8 text-center text-text-dim">لا سندات في الفترة</td></tr>
              ) : rows.map((v) => {
                const cancelled = v.status === "cancelled";
                const details = [v.reason ? REASONS[v.reason] : null, v.party_type === "employee" ? null : v.category,
                                 v.reference_no ? `مرجع: ${v.reference_no}` : null, v.description]
                  .filter(Boolean).join(" · ");
                return (
                  <tr key={v.id} className={`border-t border-line/70 ${cancelled ? "opacity-50" : ""}`}>
                    <td className="px-3 py-2 tnum font-extrabold">{v.voucher_no}</td>
                    <td className="px-3 py-2">
                      {cancelled ? <Badge tone="warn">ملغي</Badge>
                        : v.type === "receipt" ? <Badge tone="good">قبض</Badge> : <Badge tone="warn">صرف</Badge>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-bold">{v.employee_name || v.customer_name || v.party_name || v.category || "—"}</div>
                      {details && <div className="text-[11px] text-text-dim">{details}</div>}
                    </td>
                    <td className="px-3 py-2 text-text-dim">{METHODS[v.method] || v.method}</td>
                    <td className={`px-3 py-2 tnum font-black ${cancelled ? "line-through" : ""} ${v.type === "receipt" ? "text-emerald" : "text-ember"}`}>
                      {v.type === "receipt" ? "+" : "−"}{money(v.amount)}
                    </td>
                    <td className="px-3 py-2 tnum text-[11.5px] text-text-dim">{v.voucher_date || dtFmt(v.created_at)}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => printVoucher(v)}>🖨 السند</Button>
                        {canCreate && !cancelled && (
                          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => cancelVoucher(v)}>إلغاء</Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
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
            <Select value={form.partyType} onChange={(e) => reset({ partyType: e.target.value })}>
              {modal === "receipt" ? (
                <>
                  <option value="customer">عميل — تحصيل مديونية</option>
                  <option value="employee">موظف — سداد سلفة</option>
                  <option value="other">جهة أخرى — إيراد آخر</option>
                </>
              ) : (
                <>
                  <option value="expense">بند مصروف</option>
                  <option value="supplier">مورد — سداد مديونية</option>
                  <option value="employee">موظف — سلفة أو راتب</option>
                  <option value="other">جهة أخرى</option>
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

          {isEmp && (
            <>
              <Field label="الموظف"
                     hint={modal === "receipt" ? "الموظفين اللي عليهم سلفة قائمة بس" : "السلفة بتتخصم من راتبه تلقائياً"}>
                <Select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
                  <option value="">— اختر الموظف —</option>
                  {employees.filter((e) => modal === "payment" || e.advanceBalance > 0).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name}{e.advanceBalance > 0 ? ` — سلفة قائمة ${money(e.advanceBalance)}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              {modal === "payment" && (
                <Field label="السبب">
                  <Select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}>
                    <option value="advance">سلفة (تتخصم من الراتب)</option>
                    <option value="salary">راتب / أجر</option>
                  </Select>
                </Field>
              )}
              {isAdvance && (
                <Field label="القسط الشهري (ر.س)" hint="المبلغ اللي هيتخصم من الراتب كل شهر — آخر قسط بياخد الباقي">
                  <Input type="number" min={0.01} step="0.01" className="tnum"
                         value={form.installment} onChange={(e) => setForm({ ...form, installment: e.target.value })} />
                </Field>
              )}
              {overBalance && selectedEmp && (
                <div className="text-[12px] font-bold text-ember">
                  المبلغ أكبر من رصيد السلفة ({money(selectedEmp.advanceBalance)} ر.س)
                </div>
              )}
            </>
          )}

          {form.partyType === "expense" && (
            <Field label="بند المصروف" hint="كل بند بيتسجل على حسابه المحاسبي تلقائياً">
              <Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {EXPENSE_CATS.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          )}

          {(form.partyType === "supplier" || form.partyType === "other") && (
            <Field label={form.partyType === "supplier" ? "اسم المورد" : modal === "receipt" ? "اسم الجهة / مصدر الإيراد" : "اسم الجهة المستلمة"}>
              <Input value={form.partyName} onChange={(e) => setForm({ ...form, partyName: e.target.value })} />
            </Field>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="التاريخ">
              <Input type="date" className="tnum" value={form.voucherDate}
                     onChange={(e) => setForm({ ...form, voucherDate: e.target.value })} />
            </Field>
            <Field label="رقم مرجع (فاتورة / إيصال)">
              <Input value={form.referenceNo} onChange={(e) => setForm({ ...form, referenceNo: e.target.value })} />
            </Field>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الفرع">
              <Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label={needsDesc ? "البيان (إجباري)" : "البيان (اختياري)"}>
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>

          <ErrorNote msg={err} />
          <button onClick={save} disabled={!canSave}
                  className={`w-full rounded-xl py-3 text-[14px] font-black text-white transition hover:brightness-110 disabled:opacity-40
                    ${modal === "receipt" ? "bg-emerald" : "bg-ember"}`}>
            {busy ? "جارِ الحفظ..." : modal === "receipt" ? "✓ حفظ وطباعة سند القبض" : "✓ حفظ وطباعة سند الصرف"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
