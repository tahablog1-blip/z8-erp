"use client";
// شاشة عدّ الجرد — رأس + تقدم + مؤشرات + وضع المسح + فلاتر + جدول + تقرير الفروقات + سجل العمليات.
// الواجهة تعرض وتُدخل الكميات فقط؛ اللقطة والفروق والتكلفة والاعتماد والتسوية كلها من الباك اند.
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, EmptyState, Input, Modal, Select, Switch, Tabs, Textarea } from "@/components/ui";
import { appConfirm } from "@/components/dialog";
import { fmtMoney } from "@/lib/dashboard/format";
import { downloadCsv, fmtDT } from "@/lib/customers/format";
import { kpisHTML, printReport, tableHTML } from "@/lib/print";
import Link from "next/link";
import {
  ACTION_LABEL, CONDITION_LABEL, COUNT_TYPE_LABEL, STATUS_LABEL, STATUS_TONE, VAR_LABEL, VAR_TEXT, VAR_TONE, signed, varState,
  type CountRound, type ImportPreview, type StocktakeDetail, type StocktakeItem, type TimelineEvent, type VarState,
} from "@/lib/stocktake/types";

const PAGE = 60;
type Filter = "all" | VarState | "counted";
type Tab = "count" | "report" | "log";
type Sort = "shortage" | "surplus" | "value";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "الكل" }, { key: "uncounted", label: "لم يُعدّ" }, { key: "counted", label: "تم العدّ" },
  { key: "match", label: "مطابق" }, { key: "shortage", label: "عجز" }, { key: "surplus", label: "زيادة" },
];

function Stat({ label, value, tone = "" }: { label: string; value: string | number; tone?: string }) {
  return (
    <div className="rounded-lg border border-line bg-ink-2 px-3 py-2.5">
      <p className="text-t-xs font-bold text-text-dim">{label}</p>
      <p className={`tnum mt-0.5 text-t-xl font-black ${tone}`}>{value}</p>
    </div>
  );
}

export function CountScreen({ detail, locName, canApprove, onChange, onClose }: {
  detail: StocktakeDetail; locName: string; canApprove: boolean;
  onChange: (d: StocktakeDetail) => void; onClose: () => void;
}) {
  const editable = detail.status === "in_progress";
  const [tab, setTab] = useState<Tab>("count");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [cat, setCat] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [draft, setDraft] = useState<Record<string, string>>({});       // كميات مُدخلة لم تُحفظ بعد
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [conds, setConds] = useState<Record<string, string>>({});
  const [hist, setHist] = useState<{ item: StocktakeItem; rows: CountRound[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [scanMode, setScanMode] = useState(false);
  const [scanHit, setScanHit] = useState<StocktakeItem | null>(null);
  const [scanMiss, setScanMiss] = useState("");
  const [sort, setSort] = useState<Sort>("shortage");
  const [timeline, setTimeline] = useState<TimelineEvent[] | null>(null);
  const [reason, setReason] = useState<null | "cancel" | "reopen">(null);
  const [reasonText, setReasonText] = useState("");
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [zeroRest, setZeroRest] = useState(false);
  const scanRef = useRef<HTMLInputElement>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const items = detail.items;
  const counted = detail.countedItems;
  const total = detail.totalItems;
  const pct = total ? Math.round((counted / total) * 1000) / 10 : 0;
  const matched = items.filter((i) => varState(i) === "match").length;
  const diffItems = items.filter((i) => ["surplus", "shortage"].includes(varState(i))).length;
  const net = detail.surplusValue - detail.shortageValue;
  const categories = useMemo(() => Array.from(new Set(items.map((i) => i.category).filter(Boolean) as string[])).sort(), [items]);
  const dirty = Object.keys(draft).filter((k) => {
    const it = items.find((x) => x.productId === k);
    return it && draft[k] !== (it.countedQty == null ? "" : String(it.countedQty));
  });

  // تحذير عند مغادرة الصفحة وفيها كميات غير محفوظة
  useEffect(() => {
    if (!dirty.length) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty.length]);

  useEffect(() => { if (scanMode) scanRef.current?.focus(); }, [scanMode, scanHit]);

  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return items.filter((i) => {
      const st = varState(i);
      if (filter === "counted" ? st === "uncounted" : filter !== "all" && st !== filter) return false;
      if (cat && i.category !== cat) return false;
      return !s || [i.name, i.barcode, i.category, i.spec].some((v) => (v || "").toLowerCase().includes(s));
    });
  }, [items, q, filter, cat]);
  useEffect(() => setShown(PAGE), [q, filter, cat, tab]);

  // حفظ كمية صنف: الاستجابة تحمل الجلسة كاملة بأرقام الباك اند (اللقطة/الفرق/القيمة)
  const save = useCallback((productId: string, qty: number, note?: string | null, condition?: string | null) => {
    const run = async () => {
      const d = await api<StocktakeDetail>(`/inventory/stocktakes/${detail.id}/items/${productId}`, {
        method: "PUT", body: JSON.stringify({ countedQty: qty, note: note?.trim() || null, condition: condition || null }),
      });
      onChange(d);
      setDraft((o) => { const n = { ...o }; delete n[productId]; return n; });
      return d;
    };
    const p = queue.current.then(run, run);          // طابور: مسحات متتالية لا تتسابق
    queue.current = p.catch(() => undefined);
    return p;
  }, [detail.id, onChange]);

  async function saveRow(it: StocktakeItem) {
    const raw = (draft[it.productId] ?? (it.countedQty == null ? "" : String(it.countedQty))).trim();
    if (raw === "" || !/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) { setErr("أدخل كمية صحيحة (عدد صحيح، صفر أو أكثر)."); return; }
    setErr(""); setMsg("");
    try { await save(it.productId, Number(raw), notes[it.productId] ?? it.note, conds[it.productId] ?? it.condition); setMsg(`تم حفظ: ${it.name}`); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذر حفظ الكمية"); }
  }

  async function saveAll() {
    setBusy(true); setErr("");
    try {
      for (const k of dirty) {
        const raw = (draft[k] ?? "").trim();
        if (!/^\d+$/.test(raw)) throw new Error("توجد كمية غير صحيحة — صحّحها أولاً");
        const cur = items.find((x) => x.productId === k);
        await save(k, Number(raw), notes[k] ?? cur?.note, conds[k] ?? cur?.condition);
      }
      setMsg("تم حفظ كل التغييرات.");
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر الحفظ"); } finally { setBusy(false); }
  }

  // وضع المسح: باركود → يزيد العدّ 1 ويحفظ فوراً، والتركيز يرجع لحقل المسح
  async function onScan(code: string) {
    const c = code.trim();
    if (!c) return;
    const it = items.find((i) => i.barcode === c);
    if (!it) { setScanHit(null); setScanMiss(c); return; }
    setScanMiss(""); setErr("");
    try {
      const d = await save(it.productId, (it.countedQty ?? 0) + 1, it.note, it.condition);
      setScanHit((d as StocktakeDetail).items.find((x) => x.productId === it.productId) ?? it);
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر تسجيل المسح"); }
  }

  async function act(path: string, body?: object, ok = "تم.") {
    setBusy(true); setErr(""); setMsg("");
    try {
      const d = await api<StocktakeDetail>(`/inventory/stocktakes/${detail.id}/${path}`, { method: "POST", body: body ? JSON.stringify(body) : undefined });
      onChange(d); setTimeline(null); setMsg(ok);
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذر تنفيذ العملية"); } finally { setBusy(false); }
  }

  async function submitReview() {
    if (dirty.length) { setErr("احفظ الكميات غير المحفوظة أو تجاهلها أولاً."); return; }
    const rest = total - counted;
    const ok = await appConfirm(rest > 0
      ? `يوجد ${rest} صنف لم يُعدّ — سيبقى رصيده كما هو ولن يُسوّى. إرسال الجرد للمراجعة؟`
      : "إرسال الجرد للمراجعة؟ لن تتغير الأرصدة قبل الاعتماد.");
    if (ok) act("review", undefined, "تم إرسال الجرد للمراجعة.");
  }

  async function approve() {
    const ok = await appConfirm(`اعتماد الجرد سيعدّل أرصدة ${diffItems} صنف في ${locName} إلى الكميات المعدودة (عجز ${fmtMoney(detail.shortageValue)} / زيادة ${fmtMoney(detail.surplusValue)}). لا يمكن التراجع. متابعة؟`);
    if (ok) act("approve", undefined, "تم اعتماد الجرد وتسوية الأرصدة.");
  }

  async function submitReason() {
    const t = reasonText.trim();
    if (reason === "reopen" && !t) { setErr("اكتب سبب إعادة العدّ."); return; }
    const kind = reason; setReason(null); setReasonText("");
    if (kind === "reopen") await act("reopen", { reason: t }, "أُعيدت الجلسة للعدّ.");
    if (kind === "cancel") await act("cancel", { reason: t || null }, "تم إلغاء الجلسة.");
  }

  async function loadLog() {
    try { setTimeline(await api<TimelineEvent[]>(`/inventory/stocktakes/${detail.id}/timeline`)); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذر تحميل السجل"); setTimeline([]); }
  }
  useEffect(() => { if (tab === "log" && timeline === null) loadLog(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  async function showHistory(it: StocktakeItem) {
    setHist({ item: it, rows: null });
    try { setHist({ item: it, rows: await api<CountRound[]>(`/inventory/stocktakes/${detail.id}/items/${it.productId}/history`) }); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذر تحميل سجل العدّ"); setHist(null); }
  }

  async function pickFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; e.target.value = "";
    if (!f || busy) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", f);
      setPreview(await api<ImportPreview>(`/inventory/stocktakes/${detail.id}/import?commit=false`, { method: "POST", body: fd }));
      setFile(f); setZeroRest(false);
    } catch (x) { setErr(x instanceof Error ? x.message : "تعذر قراءة الملف"); } finally { setBusy(false); }
  }
  async function commitImport() {
    if (!file) return;
    setBusy(true); setErr("");
    try {
      const fd = new FormData(); fd.append("file", file);
      await api(`/inventory/stocktakes/${detail.id}/import?commit=true&zeroRest=${zeroRest}`, { method: "POST", body: fd });
      setPreview(null); setFile(null);
      onChange(await api<StocktakeDetail>(`/inventory/stocktakes/${detail.id}`));
      setMsg("تم حفظ الكميات من الملف.");
    } catch (x) { setErr(x instanceof Error ? x.message : "تعذر حفظ الكميات"); } finally { setBusy(false); }
  }

  const reportRows = useMemo(() => {
    const r = items.filter((i) => ["surplus", "shortage"].includes(varState(i)));
    const v = (i: StocktakeItem) => i.diffValue ?? 0;
    return [...r].sort((a, b) =>
      sort === "shortage" ? v(a) - v(b) : sort === "surplus" ? v(b) - v(a) : Math.abs(v(b)) - Math.abs(v(a)));
  }, [items, sort]);

  function exportCsv() {
    downloadCsv(`stocktake-${detail.id.slice(0, 8)}.csv`,
      ["الصنف", "الباركود", "التصنيف", "النظام", "الفعلي", "الفرق", "التكلفة", "قيمة الفرق", "الحالة", "حالة الصنف", "ملاحظة"],
      items.map((i) => [i.name, i.barcode, i.category, i.expectedQty, i.countedQty, i.difference, i.unitCost, i.diffValue, VAR_LABEL[varState(i)], i.condition ? CONDITION_LABEL[i.condition] : "", i.note]));
  }
  function printMinutes() {
    const rows = reportRows.map((i) => [i.name, i.barcode || "—", i.expectedQty, i.countedQty ?? "—", signed(i.difference), fmtMoney(i.unitCost), fmtMoney(i.diffValue ?? 0), i.note || ""]);
    const body = kpisHTML([
      { label: "إجمالي الأصناف", value: String(total) }, { label: "المعدودة", value: String(counted) },
      { label: "المطابقة", value: String(matched) }, { label: "ذات فرق", value: String(diffItems) },
      { label: "قيمة العجز", value: fmtMoney(detail.shortageValue) }, { label: "قيمة الزيادة", value: fmtMoney(detail.surplusValue) },
      { label: "صافي الفرق", value: fmtMoney(net) },
    ]) + (rows.length ? tableHTML(["الصنف", "الباركود", "النظام", "الفعلي", "الفرق", "التكلفة", "قيمة الفرق", "ملاحظة"], rows, { numericCols: [2, 3, 4, 5, 6] }) : "<p>لا توجد فروقات.</p>")
      + `<p style="margin-top:36px">المسؤول: ${detail.createdByName || "—"} &nbsp;&nbsp; المعتمد: ${detail.approvedByName || "........"} &nbsp;&nbsp; التوقيع: ........................</p>`;
    printReport(`محضر جرد — ${locName}`, `الحالة: ${STATUS_LABEL[detail.status] || detail.status} · ${fmtDT(detail.createdAt)} · رقم الجلسة ${detail.id.slice(0, 8)}`, body);
  }

  const canEditRow = editable;
  return (
    <section className="space-y-4" aria-label="شاشة الجرد">
      {/* الرأس */}
      <div className="rounded-card border border-line bg-ink-2 p-4 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <button onClick={onClose} className="mb-1 inline-flex items-center gap-1 text-t-sm font-bold text-petrol hover:underline">
              <MIcon name="arrow_forward" className="!text-[16px]" /> جرد المخزون
            </button>
            <h2 className="text-t-2xl font-black">{detail.name || `جرد ${locName}`}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-t-xs text-text-dim">
              <Badge tone={STATUS_TONE[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>
              <span className="tnum" dir="ltr">#{detail.id.slice(0, 8)}</span>
              <span>{fmtDT(detail.createdAt)}</span>
              <span>المسؤول: {detail.createdByName || "—"}</span>
              <span>{detail.name ? `${locName} · ` : ""}{COUNT_TYPE_LABEL[detail.countType ?? "full"]}{detail.categoryFilter ? `: ${detail.categoryFilter}` : ""}</span>
              {detail.submittedByName && <span>أُرسل للمراجعة: {detail.submittedByName} · {fmtDT(detail.submittedAt)}</span>}
              {detail.reopenCount > 0 && <span>أُعيد عدّه {detail.reopenCount} مرة{detail.lastReopenReason ? ` (آخرها: ${detail.lastReopenReason})` : ""}</span>}
              {detail.approvedByName && <span>اعتمده: {detail.approvedByName} · {fmtDT(detail.approvedAt)}</span>}
            </p>
            {detail.note && <p className="mt-1 text-t-sm text-text-dim">{detail.note}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="tool" size="sm" onClick={exportCsv}><MIcon name="download" className="!text-[16px]" />تصدير CSV</Button>
            <Button variant="tool" size="sm" onClick={printMinutes}><MIcon name="print" className="!text-[16px]" />محضر الجرد</Button>
            {editable && <>
              <label className="m3 z8-anim-btn inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-3 py-1.5 text-t-sm font-semibold text-text-dim hover:border-petrol hover:text-petrol">
                <MIcon name="upload_file" className="!text-[16px]" />رفع Excel / CSV
                <input type="file" accept=".xlsx,.xlsm,.csv" className="hidden" onChange={pickFile} disabled={busy} />
              </label>
              <a className="text-t-xs font-bold text-petrol hover:underline" href="data:text/csv;charset=utf-8,%EF%BB%BFbarcode%0A" download="stocktake-template.csv">قالب</a>
              <Button size="sm" onClick={submitReview} disabled={busy || counted === 0} loading={busy}><MIcon name="fact_check" className="!text-[16px]" />إرسال للمراجعة</Button>
            </>}
            {detail.status === "review" && canApprove && <>
              <Button size="sm" variant="success" onClick={approve} disabled={busy}><MIcon name="verified" className="!text-[16px]" />اعتماد وتسوية</Button>
              <Button size="sm" variant="outline" onClick={() => { setReason("reopen"); setErr(""); }} disabled={busy}><MIcon name="replay" className="!text-[16px]" />طلب إعادة العدّ</Button>
            </>}
            {(detail.status === "in_progress" || detail.status === "review") && (
              <Button size="sm" variant="danger" onClick={() => { setReason("cancel"); setErr(""); }} disabled={busy}>إلغاء الجلسة</Button>
            )}
          </div>
        </div>
        {detail.status === "review" && !canApprove && <p className="mt-3 rounded-lg bg-brass-soft p-2.5 text-t-sm font-bold text-brass">بانتظار مستخدم لديه صلاحية اعتماد الجرد.</p>}
        {detail.status === "approved" && (
          <div className="mt-3 space-y-2">
            <p className="rounded-lg bg-emerald-bg p-2.5 text-t-sm font-bold text-emerald">تمت التسوية — الجلسة مقفلة ولا تقبل التعديل.</p>
            {(detail.adjustInNo || detail.adjustOutNo) && (
              <p className="text-t-sm">سندات حركة المخزون الناتجة:{" "}
                {[detail.adjustInNo, detail.adjustOutNo].filter(Boolean).map((n) => <Link key={n} href="/inventory" className="tnum me-3 font-black text-petrol hover:underline" dir="ltr">{n}</Link>)}
                <span className="text-t-xs text-text-dim">(تبويب «السندات» في صفحة المخزون)</span></p>
            )}
            {detail.adjustNote && <p className="rounded-lg bg-brass-soft p-2.5 text-t-sm font-bold text-brass">{detail.adjustNote} — الأرصدة سُوّيت لكن لم يُسجَّل لها سند حركة؛ راجع مدير النظام.</p>}
          </div>
        )}
        {detail.status === "cancelled" && <p className="mt-3 rounded-lg bg-ink-3 p-2.5 text-t-sm text-text-dim">أُلغيت بواسطة {detail.cancelledByName || "—"} · {fmtDT(detail.cancelledAt)}{detail.cancelReason ? ` — السبب: ${detail.cancelReason}` : ""}</p>}

        {/* التقدم */}
        <div className="mt-4">
          <div className="mb-1 flex items-center justify-between text-t-xs font-bold text-text-dim">
            <span className="tnum">{counted.toLocaleString("en-US")} / {total.toLocaleString("en-US")} صنف</span>
            <span className="tnum">{pct}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-ink-3" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="تقدم الجرد">
            <div className="h-full rounded-full bg-petrol transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="الأصناف" value={total} />
          <Stat label="تم عدّها" value={counted} />
          <Stat label="متبقٍ" value={total - counted} />
          <Stat label="مطابق" value={matched} tone="text-emerald" />
          <Stat label="عجز (بالتكلفة)" value={fmtMoney(detail.shortageValue)} tone="text-ember" />
          <Stat label="زيادة (بالتكلفة)" value={fmtMoney(detail.surplusValue)} tone="text-petrol" />
          <Stat label="صافي الفرق" value={fmtMoney(net)} tone={net < 0 ? "text-ember" : net > 0 ? "text-petrol" : ""} />
        </div>
        {detail.zeroCostDiffItems > 0 && <p className="mt-3 rounded-lg bg-brass-soft p-2.5 text-t-sm text-brass">تنبيه: {detail.zeroCostDiffItems} صنف به فرق وتكلفته صفر فلم تُحسب قيمة فرقه.</p>}
        <p className="mt-2 text-t-xs text-text-dim">القيم بتكلفة الصنف وقت بدء الجلسة كما يحسبها النظام، ولا يتغير المخزون قبل الاعتماد.</p>
      </div>

      {err && <div role="alert" className="rounded-lg border border-ember/30 bg-ember-bg p-3 text-t-sm font-bold text-ember">{err}</div>}
      {msg && <div role="status" className="rounded-lg border border-emerald/30 bg-emerald-bg p-3 text-t-sm font-bold text-emerald">{msg}</div>}
      {dirty.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-brass/40 bg-brass-soft p-3 text-t-sm font-bold text-brass">
          <span>توجد تغييرات غير محفوظة ({dirty.length}).</span>
          <span className="flex gap-2">
            <Button size="sm" onClick={saveAll} disabled={busy}>حفظ</Button>
            <Button size="sm" variant="outline" onClick={() => setDraft({})} disabled={busy}>تجاهل</Button>
          </span>
        </div>
      )}

      <Tabs value={tab} onChange={setTab} items={[{ key: "count", label: "العدّ" }, { key: "report", label: `تقرير الفروقات (${diffItems})` }, { key: "log", label: "سجل العمليات" }]} />

      {tab === "count" && (
        <div className="space-y-3">
          {editable && (
            <div className="rounded-card border border-line bg-ink-2 p-3 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <label className="flex items-center gap-2 text-t-sm font-bold"><Switch checked={scanMode} onChange={(v) => { setScanMode(v); setScanHit(null); setScanMiss(""); }} />وضع المسح السريع (كل مسح = +1 ويُحفظ فوراً)</label>
              </div>
              {scanMode && (
                <div className="mt-3 grid gap-3 md:grid-cols-2">
                  <div>
                    <Input ref={scanRef} dir="ltr" autoComplete="off" aria-label="مسح الباركود" placeholder="امسح الباركود ثم Enter"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const v = e.currentTarget.value; e.currentTarget.value = ""; onScan(v); } }} />
                    {scanMiss && <p role="alert" className="mt-2 rounded-lg bg-ember-bg p-2 text-t-sm font-bold text-ember">الصنف غير موجود في نطاق الجرد: <span dir="ltr">{scanMiss}</span></p>}
                  </div>
                  {scanHit && (
                    <div className="rounded-lg border border-line bg-ink-3 p-3">
                      <p className="text-t-sm font-black">{scanHit.name}</p>
                      <p className="text-t-xs text-text-dim" dir="ltr">{scanHit.barcode}</p>
                      <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                        <div><p className="text-t-xs text-text-dim">النظام</p><p className="tnum text-t-xl font-black">{scanHit.expectedQty}</p></div>
                        <div><p className="text-t-xs text-text-dim">الفعلي</p><p className="tnum text-t-xl font-black">{scanHit.countedQty ?? 0}</p></div>
                        <div><p className="text-t-xs text-text-dim">الفرق</p><p className={`tnum text-t-xl font-black ${VAR_TEXT[varState(scanHit)]}`} dir="ltr">{signed(scanHit.difference)}</p></div>
                      </div>
                      <div className="mt-2 flex justify-center gap-2">
                        <Button size="sm" variant="outline" aria-label="إنقاص واحد" disabled={(scanHit.countedQty ?? 0) <= 0}
                          onClick={() => save(scanHit.productId, (scanHit.countedQty ?? 0) - 1, scanHit.note, scanHit.condition).then((d) => setScanHit(d.items.find((x) => x.productId === scanHit.productId) ?? null)).catch((e) => setErr(e.message))}>−</Button>
                        <Button size="sm" aria-label="زيادة واحد"
                          onClick={() => save(scanHit.productId, (scanHit.countedQty ?? 0) + 1, scanHit.note, scanHit.condition).then((d) => setScanHit(d.items.find((x) => x.productId === scanHit.productId) ?? null)).catch((e) => setErr(e.message))}>+</Button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <MIcon name="search" className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-dim rtl:right-3 ltr:left-3 !text-[18px]" />
              <Input className="rtl:!pr-9 ltr:!pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="بحث بالاسم / الباركود / التصنيف" aria-label="بحث في أصناف الجرد" />
            </div>
            {categories.length > 1 && (
              <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label="التصنيف" className="max-w-[200px]">
                <option value="">كل التصنيفات</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="تصفية الحالة">
            {FILTERS.map((f) => (
              <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                className={`rounded-full border px-3 py-1 text-t-xs font-bold transition ${filter === f.key ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim hover:border-petrol"}`}>{f.label}</button>
            ))}
            <span className="tnum self-center text-t-xs text-text-dim">{visible.length.toLocaleString("en-US")} صنف</span>
          </div>

          {visible.length === 0 ? <EmptyState icon="inventory_2" title="لا توجد أصناف مطابقة" description="غيّر البحث أو التصفية." /> : (
            <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card">
              <table className="w-full min-w-[820px] text-right text-t-sm">
                <thead className="bg-ink-3 text-t-xs text-text-dim">
                  <tr>{["الصنف", "الباركود", "النظام", "الفعلي", "الفرق", "التكلفة", "قيمة الفرق", "الحالة", ...(canEditRow ? [""] : [])].map((h, i) => <th key={i} className="p-2.5 font-bold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {visible.slice(0, shown).map((it) => {
                    const st = varState(it);
                    const val = draft[it.productId] ?? (it.countedQty == null ? "" : String(it.countedQty));
                    const isDirty = it.productId in draft && val !== (it.countedQty == null ? "" : String(it.countedQty));
                    return (
                      <tr key={it.productId} className="border-t border-line align-top">
                        <td className="max-w-[300px] p-2.5">
                          <p className="font-bold">{it.name}</p>
                          <p className="mt-0.5 text-t-xs text-text-dim">{[it.category, it.spec, it.unit].filter(Boolean).join(" • ") || "—"}</p>
                          {canEditRow
                            ? <div className="mt-1.5 flex gap-1.5">
                                <input className="min-w-0 flex-1 rounded-md border border-line bg-ink-2 p-1.5 text-t-xs" placeholder="ملاحظة (اختياري)" aria-label={`ملاحظة ${it.name}`}
                                  value={notes[it.productId] ?? it.note ?? ""} onChange={(e) => setNotes((o) => ({ ...o, [it.productId]: e.target.value }))} />
                                <select className="rounded-md border border-line bg-ink-2 p-1.5 text-t-xs" aria-label={`حالة ${it.name}`}
                                  value={conds[it.productId] ?? it.condition ?? ""} onChange={(e) => setConds((o) => ({ ...o, [it.productId]: e.target.value }))}>
                                  <option value="">الحالة</option>{Object.entries(CONDITION_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                                </select>
                              </div>
                            : <>{it.condition && <Badge tone="neutral" className="mt-1">{CONDITION_LABEL[it.condition]}</Badge>}{it.note && <p className="mt-1 text-t-xs text-text-dim">{it.note}</p>}</>}
                          {it.countEntries > 1 && <button className="mt-1 text-t-xs font-bold text-petrol hover:underline" onClick={() => showHistory(it)}>عُدّ {it.countEntries} مرات — عرض السجل</button>}
                          {it.countEntries === 1 && <button className="mt-1 text-t-xs text-text-dim hover:underline" onClick={() => showHistory(it)}>سجل العدّ</button>}
                        </td>
                        <td className="tnum p-2.5 text-t-xs" dir="ltr">{it.barcode || "—"}</td>
                        <td className="tnum p-2.5 font-bold">{it.expectedQty}</td>
                        <td className="p-2.5">
                          {canEditRow ? (
                            <input type="number" min="0" step="1" inputMode="numeric" aria-label={`الكمية المعدودة ${it.name}`}
                              className={`tnum w-24 rounded-md border bg-ink-2 p-1.5 font-bold ${isDirty ? "border-brass" : "border-line"}`} value={val}
                              onChange={(e) => setDraft((o) => ({ ...o, [it.productId]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") saveRow(it); }} />
                          ) : <span className="tnum font-bold">{it.countedQty ?? "—"}</span>}
                        </td>
                        <td className={`tnum p-2.5 font-black ${VAR_TEXT[st]}`} dir="ltr">{signed(it.difference)}</td>
                        <td className="tnum p-2.5">{fmtMoney(it.unitCost)}</td>
                        <td className={`tnum p-2.5 font-bold ${VAR_TEXT[st]}`} dir="ltr">{it.diffValue == null ? "—" : fmtMoney(it.diffValue)}</td>
                        <td className="p-2.5"><Badge tone={VAR_TONE[st]} dot>{VAR_LABEL[st]}</Badge></td>
                        {canEditRow && <td className="p-2.5"><Button size="xs" onClick={() => saveRow(it)} disabled={busy}>حفظ</Button></td>}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {visible.length > shown && (
                <div className="border-t border-line p-3 text-center">
                  <Button variant="outline" size="sm" onClick={() => setShown((n) => n + PAGE)}>عرض المزيد ({(visible.length - shown).toLocaleString("en-US")} متبقٍ)</Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {tab === "report" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-t-sm font-bold">ترتيب:</span>
            {([["shortage", "أعلى عجز"], ["surplus", "أعلى زيادة"], ["value", "أعلى قيمة"]] as [Sort, string][]).map(([k, l]) => (
              <button key={k} onClick={() => setSort(k)} aria-pressed={sort === k}
                className={`rounded-full border px-3 py-1 text-t-xs font-bold ${sort === k ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2 text-text-dim"}`}>{l}</button>
            ))}
          </div>
          {reportRows.length === 0 ? <EmptyState icon="task_alt" title="لا توجد فروقات" description="كل الأصناف المعدودة مطابقة للنظام." /> : (
            <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card">
              <table className="w-full min-w-[700px] text-right text-t-sm">
                <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["الصنف", "النظام", "الفعلي", "الفرق", "التكلفة", "قيمة الفرق", "ملاحظة / السبب"].map((h) => <th key={h} className="p-2.5 font-bold">{h}</th>)}</tr></thead>
                <tbody>
                  {reportRows.map((i) => (
                    <tr key={i.productId} className="border-t border-line">
                      <td className="p-2.5 font-bold">{i.name}</td>
                      <td className="tnum p-2.5">{i.expectedQty}</td>
                      <td className="tnum p-2.5">{i.countedQty}</td>
                      <td className={`tnum p-2.5 font-black ${VAR_TEXT[varState(i)]}`} dir="ltr">{signed(i.difference)}</td>
                      <td className="tnum p-2.5">{fmtMoney(i.unitCost)}</td>
                      <td className={`tnum p-2.5 font-bold ${VAR_TEXT[varState(i)]}`} dir="ltr">{fmtMoney(i.diffValue ?? 0)}</td>
                      <td className="p-2.5 text-t-xs text-text-dim">{i.note || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="rounded-card border border-line bg-ink-2 p-4 shadow-card">
          {timeline === null ? <p className="text-t-sm text-text-dim">جارٍ التحميل…</p>
            : timeline.length === 0 ? <p className="text-t-sm text-text-dim">لا توجد عمليات مسجلة لهذه الجلسة (الجلسات القديمة قبل تفعيل السجل لا تحتوي أحداثاً).</p>
            : <ol className="space-y-3 border-s-2 border-line ps-4">
                {timeline.map((e, i) => (
                  <li key={i}>
                    <p className="text-t-sm font-black">{ACTION_LABEL[e.action] || e.action}</p>
                    <p className="text-t-xs text-text-dim">{e.actorName || "—"} · {fmtDT(e.at)}</p>
                    <p className="text-t-sm">{e.details}</p>
                  </li>
                ))}
              </ol>}
        </div>
      )}

      <Modal open={!!hist} title={hist ? `سجل عدّ: ${hist.item.name}` : ""} onClose={() => setHist(null)}>
        {hist?.rows == null ? <p className="text-t-sm text-text-dim">جارٍ التحميل…</p> : (
          <ol className="space-y-2">
            {hist.rows.map((r) => (
              <li key={r.round} className="rounded-lg bg-ink-3 p-2.5 text-t-sm">
                <b>العدّ {r.round}:</b> <span className="tnum font-black">{r.countedQty}</span>
                {r.condition && <span className="ms-2 text-t-xs">({CONDITION_LABEL[r.condition]})</span>}
                <p className="text-t-xs text-text-dim">{r.countedByName || "—"} · {fmtDT(r.countedAt)}{r.note ? ` · ${r.note}` : ""}</p>
              </li>
            ))}
            <p className="text-t-xs text-text-dim">القيمة المعتمدة للتسوية هي آخر عدّ؛ العدّات السابقة محفوظة ولا تُحذف.</p>
          </ol>
        )}
      </Modal>

      <Modal open={reason !== null} title={reason === "reopen" ? "طلب إعادة العدّ" : "إلغاء جلسة الجرد"} onClose={() => { setReason(null); setReasonText(""); }}>
        <p className="mb-2 text-t-sm text-text-dim">{reason === "reopen" ? "ترجع الجلسة إلى «جاري الجرد» مع الإبقاء على الكميات المعدودة. السبب إلزامي ويُسجَّل." : "لن يتغير أي رصيد. يُسجَّل المستخدم والسبب ولا يُحذف شيء من التاريخ."}</p>
        <Textarea rows={3} value={reasonText} onChange={(e) => setReasonText(e.target.value)} placeholder={reason === "reopen" ? "السبب (مطلوب)" : "السبب (اختياري)"} aria-label="السبب" />
        <div className="mt-3 flex gap-2">
          <Button onClick={submitReason} disabled={busy}>{reason === "reopen" ? "إرجاع للعدّ" : "تأكيد الإلغاء"}</Button>
          <Button variant="outline" onClick={() => { setReason(null); setReasonText(""); }}>تراجع</Button>
        </div>
      </Modal>

      <Modal open={!!preview} title="معاينة الجرد من الملف" size="lg" onClose={() => { setPreview(null); setFile(null); }}>
        {preview && <>
          <p className="mb-3 text-t-sm text-text-dim">{preview.totalPieces} قطعة · {preview.matched.length} صنف مطابق · {preview.unmatched.length} باركود غير معروف</p>
          {preview.matched.some((m) => m.previousCounted != null) && <p className="mb-3 rounded-lg bg-brass-soft p-2 text-t-sm text-brass">سيتم استبدال الكميات المعدودة سابقاً للأصناف المطابقة.</p>}
          <div className="max-h-[40vh] overflow-auto">
            <table className="w-full text-t-sm"><thead><tr className="border-b text-text-dim">{["الصنف", "الباركود", "المعدود", "النظام", "الفرق"].map((h) => <th key={h} className="p-2 text-right">{h}</th>)}</tr></thead>
              <tbody>{preview.matched.map((m) => (
                <tr key={m.productId} className="border-b border-line"><td className="p-2">{m.name}</td><td className="p-2 font-mono text-t-xs">{m.barcode}</td>
                  <td className="tnum p-2 font-bold">{m.scanned}</td><td className="tnum p-2">{m.expectedQty}</td>
                  <td className={`tnum p-2 font-bold ${m.difference < 0 ? "text-ember" : m.difference > 0 ? "text-petrol" : "text-text-dim"}`} dir="ltr">{signed(m.difference)}</td></tr>))}</tbody></table>
          </div>
          {preview.unmatched.length > 0 && <div className="mt-3 rounded-lg bg-ember-bg p-3 text-t-sm text-ember"><p className="mb-1 font-bold">باركودات غير موجودة في هذه الجلسة (لن تُحفظ):</p>
            <p className="font-mono text-t-xs leading-6">{preview.unmatched.slice(0, 50).map((u) => `${u.barcode} ×${u.count}`).join(" ، ")}</p></div>}
          {preview.uncountedRemaining > 0 && <label className="mt-3 flex items-center gap-2 text-t-sm"><Switch checked={zeroRest} onChange={setZeroRest} />اعتبر {preview.uncountedRemaining} صنف لم يظهر في الملف = 0 (وإلا يبقى «لم يُعدّ» ولا تتغير أرصدته)</label>}
          <div className="mt-4 flex gap-2"><Button variant="success" onClick={commitImport} disabled={busy || preview.matched.length === 0}>حفظ الكميات</Button><Button variant="outline" onClick={() => { setPreview(null); setFile(null); }}>إغلاق</Button></div>
        </>}
      </Modal>
    </section>
  );
}
