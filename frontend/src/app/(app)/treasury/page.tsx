"use client";
// الخزينة — سندات القبض والصرف والمصروفات والسلف، بقيود محاسبية تلقائية وطباعة سند رسمي
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Switch, PageHeader, Tabs } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { money } from "@/modules/invoices/types";
import { Customer } from "@/modules/customers/types";
import { MIcon } from "@/components/m-icon";

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

type BankAccount = {
  id: string; name: string; bank_name: string | null; account_number: string | null;
  iban: string | null; account_code: string; opening_balance: number; balance: number;
  is_active: boolean; created_at: string;
};
type BankTxn = {
  id: string; bank_account_id: string; txn_type: "deposit" | "withdrawal";
  amount: number; description: string | null; reconciled: boolean; created_at: string;
};
type StatementLine = {
  id: string; bank_account_id: string; stmt_date: string; amount: number;
  description: string | null; matched_txn_id: string | null; created_at: string;
};
type ReconSummary = {
  bookBalance: number; unreconciledSystemTxns: number;
  unmatchedStatementLines: number; unmatchedStatementTotal: number;
};

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

  // ══════════ البنوك: حسابات حقيقية + إيداع/سحب + تسوية ══════════
  const [tab, setTab] = useState<"vouchers" | "banks">("vouchers");
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [banksErr, setBanksErr] = useState("");
  const [selectedBankId, setSelectedBankId] = useState<string>("");
  const [bankTxns, setBankTxns] = useState<BankTxn[]>([]);
  const [stmtLines, setStmtLines] = useState<StatementLine[]>([]);
  const [recon, setRecon] = useState<ReconSummary | null>(null);
  const [bankModal, setBankModal] = useState(false);
  const [bankForm, setBankForm] = useState({ name: "", bankName: "", accountNumber: "", iban: "", openingBalance: 0 });
  const [txnModal, setTxnModal] = useState<null | "deposit" | "withdrawal">(null);
  const [txnForm, setTxnForm] = useState({ amount: "", method: "cash", description: "", txnDate: todayISO() });
  const [stmtModal, setStmtModal] = useState(false);
  const [stmtForm, setStmtForm] = useState({ stmtDate: todayISO(), amount: "", description: "" });
  const [matchFor, setMatchFor] = useState<StatementLine | null>(null);
  const [matchTxnId, setMatchTxnId] = useState("");
  const [bankBusy, setBankBusy] = useState(false);

  async function loadBanks() {
    try { setBanks(await api<BankAccount[]>("/treasury/bank-accounts")); setBanksErr(""); }
    catch (e: any) { setBanksErr(e.message); }
  }
  useEffect(() => { if (tab === "banks") loadBanks(); }, [tab]);

  async function loadBankDetail(bankAccountId: string) {
    try {
      const [txns, lines, sm] = await Promise.all([
        api<BankTxn[]>(`/treasury/bank-accounts/${bankAccountId}/transactions`),
        api<StatementLine[]>(`/treasury/bank-accounts/${bankAccountId}/statement-lines`),
        api<ReconSummary>(`/treasury/bank-accounts/${bankAccountId}/reconciliation`),
      ]);
      setBankTxns(txns); setStmtLines(lines); setRecon(sm); setBanksErr("");
    } catch (e: any) { setBanksErr(e.message); }
  }
  useEffect(() => { if (selectedBankId) loadBankDetail(selectedBankId); }, [selectedBankId]);

  async function saveBankAccount() {
    setBankBusy(true); setBanksErr("");
    try {
      await api("/treasury/bank-accounts", { method: "POST", body: JSON.stringify(bankForm) });
      setBankModal(false);
      setBankForm({ name: "", bankName: "", accountNumber: "", iban: "", openingBalance: 0 });
      await loadBanks();
    } catch (e: any) { setBanksErr(e.message); }
    finally { setBankBusy(false); }
  }

  async function removeBankAccount(b: BankAccount) {
    if (!await appConfirm(`إلغاء تفعيل الحساب البنكي «${b.name}»؟`)) return;
    try {
      await api(`/treasury/bank-accounts/${b.id}`, { method: "DELETE" });
      if (selectedBankId === b.id) setSelectedBankId("");
      await loadBanks();
    } catch (e: any) { await appAlert(e.message); }
  }

  async function saveBankTxn() {
    if (!selectedBankId || !txnModal) return;
    setBankBusy(true); setBanksErr("");
    try {
      await api(`/treasury/bank-accounts/${txnModal === "deposit" ? "deposit" : "withdraw"}`, {
        method: "POST",
        body: JSON.stringify({
          bankAccountId: selectedBankId, amount: Number(txnForm.amount), method: txnForm.method,
          description: txnForm.description.trim() || null, txnDate: txnForm.txnDate || null,
        }),
      });
      setTxnModal(null);
      setTxnForm({ amount: "", method: "cash", description: "", txnDate: todayISO() });
      await Promise.all([loadBanks(), loadBankDetail(selectedBankId)]);
    } catch (e: any) { setBanksErr(e.message); }
    finally { setBankBusy(false); }
  }

  async function saveStatementLine() {
    if (!selectedBankId) return;
    setBankBusy(true); setBanksErr("");
    try {
      await api("/treasury/statement-lines", {
        method: "POST",
        body: JSON.stringify({
          bankAccountId: selectedBankId, stmtDate: stmtForm.stmtDate,
          amount: Number(stmtForm.amount), description: stmtForm.description.trim() || null,
        }),
      });
      setStmtModal(false);
      setStmtForm({ stmtDate: todayISO(), amount: "", description: "" });
      await loadBankDetail(selectedBankId);
    } catch (e: any) { setBanksErr(e.message); }
    finally { setBankBusy(false); }
  }

  async function doMatch() {
    if (!matchFor || !matchTxnId) return;
    setBankBusy(true);
    try {
      await api(`/treasury/statement-lines/${matchFor.id}/match`, {
        method: "POST", body: JSON.stringify({ txnId: matchTxnId }),
      });
      setMatchFor(null); setMatchTxnId("");
      await loadBankDetail(selectedBankId);
    } catch (e: any) { setBanksErr(e.message); }
    finally { setBankBusy(false); }
  }

  async function doUnmatch(line: StatementLine) {
    try {
      await api(`/treasury/statement-lines/${line.id}/unmatch`, { method: "POST" });
      await loadBankDetail(selectedBankId);
    } catch (e: any) { setBanksErr(e.message); }
  }

  const selectedBank = banks.find((b) => b.id === selectedBankId) || null;
  const unmatchedTxnsForBank = bankTxns.filter((t) => !t.reconciled);

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
      <PageHeader title="الخزينة" description="سندات القبض والصرف وحسابات الخزينة." actions={<>{canCreate && tab === "vouchers" && (
          <>
            <Button onClick={() => openModal("receipt")}><MIcon name="arrow_downward" className="!text-[16px]" />سند قبض</Button>
            <Button variant="outline" onClick={() => openModal("payment")}><MIcon name="arrow_upward" className="!text-[16px]" />سند صرف</Button>
          </>
        )}
        {tab === "banks" && canCreate && (
          <Button onClick={() => setBankModal(true)}>+ حساب بنكي جديد</Button>
        )}</>} />

      <Tabs value={tab} onChange={setTab} items={[{ key: "vouchers", label: "السندات" }, { key: "banks", label: "البنوك" }]} />

      {tab === "vouchers" && <ErrorNote msg={pageErr} />}

      {tab === "vouchers" && summary && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Card><div className="text-t-xs font-bold text-text-dim">مقبوضات اليوم ({summary.receiptCount})</div>
            <div className="mt-1 tnum text-t-xl font-black text-emerald">{money(summary.receipts)} ر.س</div></Card>
          <Card><div className="text-t-xs font-bold text-text-dim">مصروفات اليوم ({summary.paymentCount})</div>
            <div className="mt-1 tnum text-t-xl font-black text-ember">{money(summary.payments)} ر.س</div></Card>
          <Card><div className="text-t-xs font-bold text-text-dim">صافي حركة اليوم</div>
            <div className={`mt-1 tnum text-t-xl font-black ${summary.net >= 0 ? "text-petrol" : "text-ember"}`}>{money(summary.net)} ر.س</div></Card>
        </div>
      )}

      {tab === "vouchers" && (
      <Card className="!p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <div className="flex flex-wrap items-center gap-2 text-t-sm">
            <span className="font-bold text-text-dim">من</span>
            <Input type="date" className="tnum !py-1.5" value={from} onChange={(e) => setFrom(e.target.value)} />
            <span className="font-bold text-text-dim">إلى</span>
            <Input type="date" className="tnum !py-1.5" value={to} onChange={(e) => setTo(e.target.value)} />
            <label className="flex items-center gap-1.5 text-t-sm font-bold text-text-dim">
              <Switch size="sm" checked={showCancelled} onChange={setShowCancelled} />
              إظهار الملغي
            </label>
          </div>
          <div className="flex gap-3 text-t-sm font-bold">
            <span className="text-emerald">قبض: <span className="tnum">{money(totals.rec)}</span></span>
            <span className="text-ember">صرف: <span className="tnum">{money(totals.pay)}</span></span>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-t-sm">
            <thead>
              <tr className="bg-ink-3 text-t-xs font-extrabold text-text-dim">
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
                      {details && <div className="text-t-xs text-text-dim">{details}</div>}
                    </td>
                    <td className="px-3 py-2 text-text-dim">{METHODS[v.method] || v.method}</td>
                    <td className={`px-3 py-2 tnum font-black ${cancelled ? "line-through" : ""} ${v.type === "receipt" ? "text-emerald" : "text-ember"}`}>
                      {v.type === "receipt" ? "+" : "−"}{money(v.amount)}
                    </td>
                    <td className="px-3 py-2 tnum text-t-xs text-text-dim">{v.voucher_date || dtFmt(v.created_at)}</td>
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="xs" onClick={() => printVoucher(v)}>السند</Button>
                        {canCreate && !cancelled && (
                          <Button variant="ghost" size="xs" onClick={() => cancelVoucher(v)}>إلغاء</Button>
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
      )}

      {/* ══════════ البنوك: حسابات + إيداع/سحب + تسوية ══════════ */}
      {tab === "banks" && (
        <div className="space-y-3">
          <ErrorNote msg={banksErr} />
          <div className="grid gap-3 md:grid-cols-[280px_1fr]">
            <Card className="!p-0">
              <div className="divide-y divide-line">
                {banks.length === 0 && (
                  <div className="p-4 text-center text-t-sm text-text-dim">لا توجد حسابات بنكية بعد</div>
                )}
                {banks.map((b) => (
                  <button key={b.id} onClick={() => setSelectedBankId(b.id)}
                          className={`block w-full px-3 py-2.5 text-right transition ${selectedBankId === b.id ? "bg-petrol-soft" : "hover:bg-ink-3"}`}>
                    <div className="font-extrabold text-t-md">{b.name}</div>
                    <div className="text-t-xs text-text-dim">{b.bank_name || "—"}</div>
                    <div className="tnum mt-0.5 text-t-md font-black text-petrol">{money(b.balance)} ر.س</div>
                  </button>
                ))}
              </div>
            </Card>

            <div className="space-y-3">
              {!selectedBank ? (
                <Card><div className="p-3 text-center text-t-sm text-text-dim">اختر حساباً بنكياً من القائمة</div></Card>
              ) : (
                <>
                  <Card>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-t-md font-extrabold">{selectedBank.name}</div>
                        <div className="text-t-xs text-text-dim tnum">
                          {selectedBank.bank_name} {selectedBank.iban ? `— ${selectedBank.iban}` : ""} {selectedBank.account_number ? `— ${selectedBank.account_number}` : ""}
                        </div>
                      </div>
                      {canCreate && (
                        <div className="flex gap-1.5">
                          <Button size="sm" onClick={() => setTxnModal("deposit")}>إيداع</Button>
                          <Button variant="ghost" size="sm" onClick={() => setTxnModal("withdrawal")}>سحب</Button>
                          <Button variant="danger" size="sm" onClick={() => removeBankAccount(selectedBank)}>إلغاء الحساب</Button>
                        </div>
                      )}
                    </div>
                    {recon && (
                      <div className="mt-3 grid gap-2 sm:grid-cols-3">
                        <div className="rounded-lg border border-line p-2.5">
                          <div className="text-t-xs text-text-dim">الرصيد الدفتري</div>
                          <div className="tnum text-t-lg font-black">{money(recon.bookBalance)}</div>
                        </div>
                        <div className="rounded-lg border border-line p-2.5">
                          <div className="text-t-xs text-text-dim">حركات غير مسوّاة</div>
                          <div className="tnum text-t-lg font-black">{recon.unreconciledSystemTxns}</div>
                        </div>
                        <div className="rounded-lg border border-line p-2.5">
                          <div className="text-t-xs text-text-dim">سطور كشف غير مطابَقة</div>
                          <div className="tnum text-t-lg font-black">
                            {recon.unmatchedStatementLines} <span className="text-text-dim">({money(recon.unmatchedStatementTotal)})</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </Card>

                  <Card className="!p-0">
                    <div className="flex items-center justify-between border-b border-line px-3 py-2">
                      <div className="text-t-sm font-bold">حركات النظام</div>
                    </div>
                    <div className="max-h-64 overflow-y-auto divide-y divide-line">
                      {bankTxns.length === 0 && <div className="p-3 text-center text-t-sm text-text-dim">لا حركات بعد</div>}
                      {bankTxns.map((t) => (
                        <div key={t.id} className="flex items-center justify-between px-3 py-2 text-t-sm">
                          <div>
                            <span className={t.txn_type === "deposit" ? "text-emerald" : "text-ember"}>
                              {t.txn_type === "deposit" ? "إيداع" : "سحب"}
                            </span>
                            {t.description && <span className="text-text-dim"> — {t.description}</span>}
                            <div className="text-t-xs text-text-dim">{dtFmt(t.created_at)}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="tnum font-bold">{money(t.amount)}</span>
                            {t.reconciled
                              ? <Badge tone="good">مسوّى</Badge>
                              : <Badge tone="warn">غير مسوّى</Badge>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>

                  <Card className="!p-0">
                    <div className="flex items-center justify-between border-b border-line px-3 py-2">
                      <div className="text-t-sm font-bold">كشف حساب البنك (للتسوية)</div>
                      {canCreate && (
                        <Button variant="ghost" size="xs" onClick={() => setStmtModal(true)}>
                          + سطر من الكشف
                        </Button>
                      )}
                    </div>
                    <div className="max-h-72 overflow-y-auto divide-y divide-line">
                      {stmtLines.length === 0 && <div className="p-3 text-center text-t-sm text-text-dim">لا سطور كشف بعد</div>}
                      {stmtLines.map((l) => (
                        <div key={l.id} className="flex items-center justify-between px-3 py-2 text-t-sm">
                          <div>
                            <span className="tnum">{l.stmt_date}</span>
                            {l.description && <span className="text-text-dim"> — {l.description}</span>}
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`tnum font-bold ${l.amount >= 0 ? "text-emerald" : "text-ember"}`}>{money(l.amount)}</span>
                            {l.matched_txn_id ? (
                              <Button variant="ghost" size="xs" onClick={() => doUnmatch(l)}>فك المطابقة</Button>
                            ) : (
                              <Button size="xs" onClick={() => { setMatchFor(l); setMatchTxnId(""); }}>مطابقة</Button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                </>
              )}
            </div>
          </div>
        </div>
      )}

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
                              className="block w-full px-3 py-2 text-right text-t-sm hover:bg-ink-3">
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
                <div className="text-t-sm font-bold text-ember">
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
                  className={`flex w-full items-center justify-center gap-1 rounded-card py-3 text-t-md font-black text-white transition hover:brightness-110 disabled:opacity-40
                    ${modal === "receipt" ? "bg-emerald" : "bg-ember"}`}>
            {busy ? "جارِ الحفظ..." : <><MIcon name="check" className="!text-[16px]" /> {modal === "receipt" ? "حفظ وطباعة سند القبض" : "حفظ وطباعة سند الصرف"}</>}
          </button>
        </div>
      </Modal>

      {/* ══════════ حساب بنكي جديد ══════════ */}
      <Modal open={bankModal} onClose={() => setBankModal(false)} title="حساب بنكي جديد">
        <div className="space-y-3">
          <Field label="اسم الحساب (للعرض)">
            <Input value={bankForm.name} autoFocus onChange={(e) => setBankForm({ ...bankForm, name: e.target.value })} />
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="اسم البنك">
              <Input value={bankForm.bankName} onChange={(e) => setBankForm({ ...bankForm, bankName: e.target.value })} />
            </Field>
            <Field label="رقم الحساب">
              <Input className="tnum" value={bankForm.accountNumber} onChange={(e) => setBankForm({ ...bankForm, accountNumber: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="IBAN">
              <Input className="tnum" value={bankForm.iban} onChange={(e) => setBankForm({ ...bankForm, iban: e.target.value })} />
            </Field>
            <Field label="الرصيد الافتتاحي (ر.س)">
              <Input type="number" step="0.01" className="tnum" value={bankForm.openingBalance}
                     onChange={(e) => setBankForm({ ...bankForm, openingBalance: +e.target.value || 0 })} />
            </Field>
          </div>
          <ErrorNote msg={banksErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setBankModal(false)}>إلغاء</Button>
            <Button onClick={saveBankAccount} disabled={bankBusy || bankForm.name.trim().length < 2}>
              {bankBusy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ إيداع / سحب ══════════ */}
      <Modal open={!!txnModal} onClose={() => setTxnModal(null)}
             title={txnModal === "deposit" ? "إيداع إلى الحساب البنكي" : "سحب من الحساب البنكي"}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="المبلغ (ر.س)">
              <Input type="number" min={0.01} step="0.01" className="tnum font-bold" autoFocus
                     value={txnForm.amount} onChange={(e) => setTxnForm({ ...txnForm, amount: e.target.value })} />
            </Field>
            <Field label={txnModal === "deposit" ? "من حساب" : "إلى حساب"}>
              <Select value={txnForm.method} onChange={(e) => setTxnForm({ ...txnForm, method: e.target.value })}>
                <option value="cash">الصندوق (نقدي)</option>
                <option value="card">حساب الشبكة</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="التاريخ">
              <Input type="date" className="tnum" value={txnForm.txnDate} onChange={(e) => setTxnForm({ ...txnForm, txnDate: e.target.value })} />
            </Field>
            <Field label="بيان (اختياري)">
              <Input value={txnForm.description} onChange={(e) => setTxnForm({ ...txnForm, description: e.target.value })} />
            </Field>
          </div>
          <ErrorNote msg={banksErr} />
          <button onClick={saveBankTxn} disabled={bankBusy || Number(txnForm.amount) <= 0}
                  className={`flex w-full items-center justify-center gap-1 rounded-card py-3 text-t-md font-black text-white transition hover:brightness-110 disabled:opacity-40
                    ${txnModal === "deposit" ? "bg-emerald" : "bg-ember"}`}>
            {bankBusy ? "جارِ الحفظ..." : txnModal === "deposit" ? "تأكيد الإيداع" : "تأكيد السحب"}
          </button>
        </div>
      </Modal>

      {/* ══════════ سطر كشف حساب جديد ══════════ */}
      <Modal open={stmtModal} onClose={() => setStmtModal(false)} title="سطر من كشف حساب البنك">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="التاريخ">
              <Input type="date" className="tnum" value={stmtForm.stmtDate} onChange={(e) => setStmtForm({ ...stmtForm, stmtDate: e.target.value })} />
            </Field>
            <Field label="المبلغ" hint="موجب = إيداع، سالب = سحب">
              <Input type="number" step="0.01" className="tnum" value={stmtForm.amount}
                     onChange={(e) => setStmtForm({ ...stmtForm, amount: e.target.value })} />
            </Field>
          </div>
          <Field label="بيان">
            <Input value={stmtForm.description} onChange={(e) => setStmtForm({ ...stmtForm, description: e.target.value })} />
          </Field>
          <ErrorNote msg={banksErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setStmtModal(false)}>إلغاء</Button>
            <Button onClick={saveStatementLine} disabled={bankBusy || !stmtForm.amount}>
              {bankBusy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ مطابقة سطر كشف بحركة نظام ══════════ */}
      <Modal open={!!matchFor} onClose={() => setMatchFor(null)} title="مطابقة سطر الكشف">
        <div className="space-y-3">
          {matchFor && (
            <div className="rounded-lg border border-line p-2.5 text-t-sm">
              <div className="tnum">{matchFor.stmt_date}</div>
              <div className="tnum font-bold">{money(matchFor.amount)}</div>
              {matchFor.description && <div className="text-text-dim">{matchFor.description}</div>}
            </div>
          )}
          <Field label="حركة النظام المطابقة">
            <Select value={matchTxnId} onChange={(e) => setMatchTxnId(e.target.value)}>
              <option value="">— اختر —</option>
              {unmatchedTxnsForBank.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.txn_type === "deposit" ? "إيداع" : "سحب"} — {money(t.amount)} — {dtFmt(t.created_at)}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setMatchFor(null)}>إلغاء</Button>
            <Button onClick={doMatch} disabled={bankBusy || !matchTxnId}>
              {bankBusy ? "جارِ المطابقة..." : "تأكيد المطابقة"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
