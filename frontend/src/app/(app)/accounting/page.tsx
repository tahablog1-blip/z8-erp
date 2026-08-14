"use client";
// شاشة الحسابات — شجرة الحسابات + سجل القيود + ثلاث تقارير مالية أساسية
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Tabs } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import {
  Account, ACCOUNT_TYPE_LABELS, BalanceSheet, IncomeStatement, JournalEntry, TrialBalance, money,
} from "@/modules/accounting/types";

type Tab = "accounts" | "journal" | "trial-balance" | "income-statement" | "balance-sheet";

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString("ar-SA-u-nu-latn", { year: "numeric", month: "2-digit", day: "2-digit" });

export default function AccountingPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [tab, setTab] = useState<Tab>("trial-balance");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journal, setJournal] = useState<JournalEntry[]>([]);
  const [trialBalance, setTrialBalance] = useState<TrialBalance | null>(null);
  const [incomeStatement, setIncomeStatement] = useState<IncomeStatement | null>(null);
  const [balanceSheet, setBalanceSheet] = useState<BalanceSheet | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");

  const [asOf, setAsOf] = useState(new Date().toISOString().slice(0, 10));
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(today.slice(0, 8) + "01");
  const [to, setTo] = useState(today);

  const [accountModal, setAccountModal] = useState(false);
  const [accForm, setAccForm] = useState({ code: "", name: "", type: "expense" as Account["type"] });
  const [accErr, setAccErr] = useState("");

  async function loadAll() {
    setLoading(true);
    try {
      const [acc, tb] = await Promise.all([
        api<Account[]>("/accounting/accounts"),
        api<TrialBalance>(`/accounting/trial-balance?asOf=${asOf}`),
      ]);
      setAccounts(acc); setTrialBalance(tb); setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { loadAll(); }, []);

  async function loadJournal() {
    try { setJournal(await api<JournalEntry[]>(`/accounting/journal?from=${from}&to=${to}&limit=100`)); }
    catch (e: any) { setPageErr(e.message); }
  }
  async function loadIncomeStatement() {
    try { setIncomeStatement(await api<IncomeStatement>(`/accounting/income-statement?from=${from}&to=${to}`)); }
    catch (e: any) { setPageErr(e.message); }
  }
  async function loadBalanceSheet() {
    try { setBalanceSheet(await api<BalanceSheet>(`/accounting/balance-sheet?asOf=${asOf}`)); }
    catch (e: any) { setPageErr(e.message); }
  }
  async function loadTrialBalance() {
    try { setTrialBalance(await api<TrialBalance>(`/accounting/trial-balance?asOf=${asOf}`)); }
    catch (e: any) { setPageErr(e.message); }
  }

  function changeTab(t: Tab) {
    setTab(t);
    if (t === "journal" && journal.length === 0) loadJournal();
    if (t === "income-statement" && !incomeStatement) loadIncomeStatement();
    if (t === "balance-sheet" && !balanceSheet) loadBalanceSheet();
  }

  async function createAccount() {
    setAccErr("");
    try {
      await api("/accounting/accounts", { method: "POST", body: JSON.stringify(accForm) });
      setAccountModal(false);
      setAccounts(await api<Account[]>("/accounting/accounts"));
    } catch (e: any) { setAccErr(e.message); }
  }

  async function deleteAccount(a: Account) {
    if (!await appConfirm(`حذف الحساب «${a.name}»؟`)) return;
    try { await api(`/accounting/accounts/${a.id}`, { method: "DELETE" }); setAccounts(await api<Account[]>("/accounting/accounts")); }
    catch (e: any) { await appAlert(e.message); }
  }

  const accountsByType = useMemo(() => {
    const map: Record<string, Account[]> = {};
    accounts.forEach((a) => { (map[a.type] ||= []).push(a); });
    return map;
  }, [accounts]);

  // ══════════ الطباعة — كل تبويبات القسم المالي ══════════
  function printCurrent() {
    if (tab === "trial-balance" && trialBalance) {
      const body =
        kpisHTML([
          { label: "إجمالي مدين", value: money(trialBalance.totalDebit) },
          { label: "إجمالي دائن", value: money(trialBalance.totalCredit) },
          { label: "الحالة", value: trialBalance.balanced ? "متزن ✓" : "غير متزن ✗" },
        ]) +
        tableHTML(["الكود", "الحساب", "النوع", "مدين", "دائن", "الرصيد"],
          trialBalance.rows.map((r) => [
            r.code, r.name, ACCOUNT_TYPE_LABELS[r.type] ?? r.type,
            money(r.total_debit), money(r.total_credit), money(r.balance),
          ]), { numericCols: [0, 3, 4, 5] });
      printReport("ميزان المراجعة", `حتى تاريخ ${trialBalance.asOf}`, body);
    }
    if (tab === "income-statement" && incomeStatement) {
      const body =
        kpisHTML([
          { label: "إجمالي الإيرادات", value: money(incomeStatement.totalRevenue) },
          { label: "إجمالي المصروفات", value: money(incomeStatement.totalExpense) },
          { label: incomeStatement.netIncome >= 0 ? "صافي الربح" : "صافي الخسارة", value: money(Math.abs(incomeStatement.netIncome)) },
        ]) +
        `<h2 class="sec">الإيرادات</h2>` +
        tableHTML(["الكود", "الحساب", "المبلغ (ر.س)"],
          incomeStatement.revenue.map((r) => [r.code, r.name, money(r.amount)]), { numericCols: [0, 2] }) +
        `<h2 class="sec">المصروفات</h2>` +
        tableHTML(["الكود", "الحساب", "المبلغ (ر.س)"],
          incomeStatement.expense.map((r) => [r.code, r.name, money(r.amount)]), { numericCols: [0, 2] });
      printReport("قائمة الدخل", `الفترة من ${incomeStatement.from} إلى ${incomeStatement.to}`, body);
    }
    if (tab === "balance-sheet" && balanceSheet) {
      const sec = (t: string, rows: typeof balanceSheet.assets) =>
        `<h2 class="sec">${t}</h2>` +
        tableHTML(["الكود", "الحساب", "الرصيد (ر.س)"],
          rows.map((r) => [r.code, r.name, money(r.balance)]), { numericCols: [0, 2] });
      const body =
        kpisHTML([
          { label: "إجمالي الأصول", value: money(balanceSheet.totalAssets) },
          { label: "الالتزامات", value: money(balanceSheet.totalLiabilities) },
          { label: "حقوق الملكية", value: money(balanceSheet.totalEquity) },
        ]) +
        sec("الأصول", balanceSheet.assets) +
        sec("الالتزامات", balanceSheet.liabilities) +
        sec("حقوق الملكية", balanceSheet.equity) +
        tableHTML(["البند", "القيمة (ر.س)"], [
          ["أرباح الفترة الحالية (غير مُقفلة)", money(balanceSheet.currentEarnings)],
          ["الميزانية", balanceSheet.balanced ? "متزنة ✓" : "غير متزنة ✗"],
        ], { numericCols: [1] });
      printReport("الميزانية العمومية", `حتى تاريخ ${balanceSheet.asOf}`, body);
    }
    if (tab === "journal" && journal.length > 0) {
      const rows: (string | number)[][] = [];
      journal.forEach((e) => {
        e.lines.forEach((l, i) => rows.push([
          i === 0 ? dateFmt(e.entry_date) : "", i === 0 ? (e.description || e.source_type) : "",
          `${l.account_code} — ${l.account_name}`,
          l.debit > 0 ? money(l.debit) : "", l.credit > 0 ? money(l.credit) : "",
        ]));
      });
      printReport("سجل القيود اليومية", `الفترة من ${from} إلى ${to} — ${journal.length} قيد`,
        tableHTML(["التاريخ", "البيان", "الحساب", "مدين", "دائن"], rows, { numericCols: [3, 4] }));
    }
    if (tab === "accounts" && accounts.length > 0) {
      printReport("شجرة الحسابات", `${accounts.length} حساب`,
        tableHTML(["الكود", "الحساب", "النوع"],
          accounts.map((a) => [a.code, a.name, ACCOUNT_TYPE_LABELS[a.type] ?? a.type]),
          { numericCols: [0] }));
    }
  }

  if (loading) return <div className="text-text-dim">جارِ التحميل...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">الحسابات</h1>
        <Button variant="ghost" className="!px-3 !py-1.5 !text-[12px]" onClick={printCurrent}>
          🖨 طباعة التبويب الحالي
        </Button>
      </div>
      <ErrorNote msg={pageErr} />

      <Card className="!p-0">
        <div className="px-5 pt-4">
          <Tabs value={tab} onChange={(t) => changeTab(t as Tab)} items={[
            { key: "trial-balance", label: "ميزان المراجعة" },
            { key: "income-statement", label: "قائمة الدخل" },
            { key: "balance-sheet", label: "الميزانية العمومية" },
            { key: "journal", label: "سجل القيود" },
            { key: "accounts", label: "شجرة الحسابات" },
          ]} />
        </div>

        <div className="space-y-3 p-5">
          {(tab === "trial-balance" || tab === "balance-sheet") && (
            <div className="flex items-center gap-2">
              <Field label="حتى تاريخ">
                <Input type="date" className="tnum" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
              </Field>
              <Button className="mt-5" onClick={tab === "trial-balance" ? loadTrialBalance : loadBalanceSheet}>تحديث</Button>
            </div>
          )}
          {(tab === "journal" || tab === "income-statement") && (
            <div className="flex items-center gap-2">
              <Field label="من"><Input type="date" className="tnum" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
              <Field label="إلى"><Input type="date" className="tnum" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
              <Button className="mt-5" onClick={tab === "journal" ? loadJournal : loadIncomeStatement}>تحديث</Button>
            </div>
          )}

          {tab === "trial-balance" && trialBalance && (
            <div className="space-y-2">
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                      <th className="px-3 py-2 text-right">الكود</th>
                      <th className="px-3 py-2 text-right">الحساب</th>
                      <th className="px-3 py-2 text-right">النوع</th>
                      <th className="px-3 py-2 text-right">مدين</th>
                      <th className="px-3 py-2 text-right">دائن</th>
                      <th className="px-3 py-2 text-right">الرصيد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trialBalance.rows.map((r) => (
                      <tr key={r.code} className="border-t border-line/70">
                        <td className="px-3 py-1.5 tnum">{r.code}</td>
                        <td className="px-3 py-1.5">{r.name}</td>
                        <td className="px-3 py-1.5 text-text-dim">{ACCOUNT_TYPE_LABELS[r.type]}</td>
                        <td className="px-3 py-1.5 tnum">{money(r.total_debit)}</td>
                        <td className="px-3 py-1.5 tnum">{money(r.total_credit)}</td>
                        <td className="px-3 py-1.5 tnum font-bold">{money(r.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex items-center justify-between rounded-lg bg-ink-3 p-3 text-[12.5px]">
                <span>إجمالي مدين: <b className="tnum">{money(trialBalance.totalDebit)}</b> · إجمالي دائن: <b className="tnum">{money(trialBalance.totalCredit)}</b></span>
                {trialBalance.balanced ? <Badge tone="good">متزن</Badge> : <Badge tone="warn">غير متزن!</Badge>}
              </div>
            </div>
          )}

          {tab === "income-statement" && incomeStatement && (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[13px] font-extrabold text-emerald">الإيرادات</h3>
                <div className="space-y-1">
                  {incomeStatement.revenue.map((r) => (
                    <div key={r.code} className="flex justify-between text-[12.5px]">
                      <span>{r.name}</span><span className="tnum font-bold">{money(r.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-line pt-1.5 text-[13px] font-bold">
                    <span>الإجمالي</span><span className="tnum">{money(incomeStatement.totalRevenue)}</span>
                  </div>
                </div>
              </div>
              <div>
                <h3 className="mb-2 text-[13px] font-extrabold text-ember">المصروفات</h3>
                <div className="space-y-1">
                  {incomeStatement.expense.map((r) => (
                    <div key={r.code} className="flex justify-between text-[12.5px]">
                      <span>{r.name}</span><span className="tnum font-bold">{money(r.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-line pt-1.5 text-[13px] font-bold">
                    <span>الإجمالي</span><span className="tnum">{money(incomeStatement.totalExpense)}</span>
                  </div>
                </div>
              </div>
              <div className="sm:col-span-2 flex items-center justify-between rounded-lg bg-petrol-soft p-3">
                <span className="font-bold text-text-dim">صافي الدخل</span>
                <span className={`tnum text-[18px] font-black ${incomeStatement.netIncome >= 0 ? "text-petrol" : "text-ember"}`}>
                  {money(incomeStatement.netIncome)} ر.س
                </span>
              </div>
            </div>
          )}

          {tab === "balance-sheet" && balanceSheet && (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                {([["الأصول", balanceSheet.assets], ["الخصوم", balanceSheet.liabilities], ["حقوق الملكية", balanceSheet.equity]] as const).map(([label, list]) => (
                  <div key={label}>
                    <h3 className="mb-2 text-[13px] font-extrabold">{label}</h3>
                    <div className="space-y-1">
                      {list.map((r) => (
                        <div key={r.code} className="flex justify-between text-[12.5px]">
                          <span>{r.name}</span><span className="tnum">{money(r.balance)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-3 gap-2 text-[12.5px]">
                <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                  <div className="text-text-dim">إجمالي الأصول</div>
                  <div className="tnum font-bold">{money(balanceSheet.totalAssets)}</div>
                </div>
                <div className="rounded-lg bg-ink-3 p-2.5 text-center">
                  <div className="text-text-dim">الخصوم + حقوق الملكية</div>
                  <div className="tnum font-bold">{money(balanceSheet.totalLiabilities + balanceSheet.totalEquity)}</div>
                </div>
                <div className="rounded-lg bg-petrol-soft p-2.5 text-center">
                  <div className="text-text-dim">الأرباح حتى الآن</div>
                  <div className="tnum font-black text-petrol">{money(balanceSheet.currentEarnings)}</div>
                </div>
              </div>
              {!balanceSheet.balanced && <Badge tone="warn">تحذير: الميزانية غير متزنة</Badge>}
            </div>
          )}

          {tab === "journal" && (
            <div className="max-h-[32rem] space-y-2 overflow-y-auto">
              {journal.length === 0 ? (
                <p className="py-6 text-center text-text-dim">لا توجد قيود في هذه الفترة</p>
              ) : journal.map((e) => (
                <div key={e.id} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between text-[12px]">
                    <span className="font-bold">{e.description || e.source_type}</span>
                    <span className="tnum text-text-dim">{dateFmt(e.entry_date)}</span>
                  </div>
                  <table className="w-full text-[12px]">
                    <tbody>
                      {e.lines.map((l) => (
                        <tr key={l.id}>
                          <td className="py-0.5 tnum text-text-dim">{l.account_code}</td>
                          <td className="py-0.5">{l.account_name}</td>
                          <td className="py-0.5 text-left tnum">{l.debit > 0 ? money(l.debit) : ""}</td>
                          <td className="py-0.5 text-left tnum text-text-dim">{l.credit > 0 ? money(l.credit) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}

          {tab === "accounts" && (
            <div className="space-y-4">
              {isAdmin && (
                <div className="flex justify-end">
                  <Button onClick={() => { setAccForm({ code: "", name: "", type: "expense" }); setAccErr(""); setAccountModal(true); }}>
                    + حساب فرعي جديد
                  </Button>
                </div>
              )}
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([type, label]) => (
                <div key={type}>
                  <h3 className="mb-1.5 text-[13px] font-extrabold">{label}</h3>
                  <div className="overflow-x-auto rounded-lg border border-line">
                    <table className="w-full border-collapse text-[12.5px]">
                      <tbody>
                        {(accountsByType[type] || []).map((a) => (
                          <tr key={a.id} className="border-t border-line/70 first:border-t-0">
                            <td className="w-20 px-3 py-1.5 tnum text-text-dim">{a.code}</td>
                            <td className="px-3 py-1.5">{a.name}</td>
                            <td className="w-16 px-3 py-1.5 text-left">
                              {isAdmin && !a.is_system && (
                                <button onClick={() => deleteAccount(a)} className="text-text-dim hover:text-ember">حذف</button>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <Modal open={accountModal} onClose={() => setAccountModal(false)} title="حساب فرعي جديد">
        <div className="space-y-3">
          <Field label="الكود"><Input value={accForm.code} className="tnum" onChange={(e) => setAccForm({ ...accForm, code: e.target.value })} /></Field>
          <Field label="الاسم"><Input value={accForm.name} onChange={(e) => setAccForm({ ...accForm, name: e.target.value })} /></Field>
          <Field label="النوع">
            <Select value={accForm.type} onChange={(e) => setAccForm({ ...accForm, type: e.target.value as Account["type"] })}>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </Select>
          </Field>
          <ErrorNote msg={accErr} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setAccountModal(false)}>إلغاء</Button>
            <Button onClick={createAccount} disabled={!accForm.code.trim() || !accForm.name.trim()}>حفظ</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
