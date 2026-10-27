"use client";
// جرد المخزون — مركز قيادة الجرد: مؤشرات حقيقية من /inventory/stocktakes/summary + قائمة الجلسات (بحث/موقع/حالة) + شاشة العدّ.
// لا تعديل للمخزون من هنا: الاعتماد والتسوية يتمّان في الباك اند عبر مسارات الجرد القائمة وبصلاحياتها.
import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, EmptyState, ErrorNote, Field, Input, Modal, Select, Textarea, PageHeader } from "@/components/ui";
import { KpiCard, KpiSkeleton } from "@/components/dashboard/KpiCard";
import { CountScreen } from "@/components/stocktake/CountScreen";
import { fmtDT, downloadCsv } from "@/lib/customers/format";
import { fmtMoney } from "@/lib/dashboard/format";
import { kpisHTML, printReport, tableHTML } from "@/lib/print";
import {
  STATUS_LABEL, STATUS_TONE, signed,
  type Branch, type Session, type StocktakeDetail, type Summary,
} from "@/lib/stocktake/types";

const PER = 15;

export default function StocktakePage() {
  const { user, hasPerm } = useAuth();
  const canCreate = hasPerm("inventory.stocktake");
  const canApprove = hasPerm("inventory.stocktake_approve");
  const isAdmin = user?.role === "admin";

  const [sessions, setSessions] = useState<Session[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [detail, setDetail] = useState<StocktakeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const [fLoc, setFLoc] = useState("");          // "" | "warehouse" | branchId
  const [fStatus, setFStatus] = useState("");
  const [fQ, setFQ] = useState("");
  const [page, setPage] = useState(1);

  const [showCreate, setShowCreate] = useState(false);
  const [locType, setLocType] = useState<"warehouse" | "branch">("branch");
  const [locId, setLocId] = useState("");
  const [note, setNote] = useState("");
  const [jobName, setJobName] = useState("");
  const [countType, setCountType] = useState<"full" | "category">("full");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState<string[]>([]);

  useEffect(() => { if (showCreate && !categories.length) api<string[]>("/products/cascade/categories").then(setCategories).catch(() => undefined); }, [showCreate, categories.length]);

  const locName = useCallback((type: string, id: string) =>
    type === "warehouse" ? "المستودع الرئيسي" : branches.find((b) => String(b.id) === String(id))?.name || `الفرع ${id}`, [branches]);

  const reload = useCallback(async () => {
    const [rows, sum] = await Promise.all([
      api<Session[]>("/inventory/stocktakes"),
      api<Summary>("/inventory/stocktakes/summary"),
    ]);
    setSessions(rows); setSummary(sum);
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      setLoading(true); setError("");
      try {
        const [, br] = await Promise.all([reload(), api<Branch[]>("/branches").then((b) => live && setBranches(b))]);
        void br;
      } catch (e) { if (live) setError(e instanceof Error ? e.message : "تعذر تحميل بيانات الجرد"); }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [reload]);

  useEffect(() => {
    if (!isAdmin && user?.branchId) { setLocType("branch"); setLocId(user.branchId); }
    else if (isAdmin && branches.length) setLocId((p) => p || branches[0].id);
  }, [isAdmin, user?.branchId, branches]);

  async function open(id: string) {
    setBusy(true); setError("");
    try { setDetail(await api<StocktakeDetail>(`/inventory/stocktakes/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : "تعذر فتح جلسة الجرد"); }
    finally { setBusy(false); }
  }

  async function create() {
    if (busy || (locType === "branch" && !locId)) return;
    if (countType === "category" && !category) { setError("اختر التصنيف المراد جرده."); return; }
    setBusy(true); setError("");
    try {
      const d = await api<StocktakeDetail>("/inventory/stocktakes", {
        method: "POST", body: JSON.stringify({
          locType, locId: locType === "warehouse" ? "main" : locId, note: note.trim() || null,
          name: jobName.trim() || null, countType, category: countType === "category" ? category : null,
        }),
      });
      setShowCreate(false); setNote(""); setJobName(""); setCountType("full"); setCategory("");
      await reload(); setDetail(d);
    } catch (e) { setError(e instanceof Error ? e.message : "تعذر إنشاء الجرد"); }
    finally { setBusy(false); }
  }

  const filtered = useMemo(() => {
    const s = fQ.trim().toLowerCase();
    return sessions.filter((x) =>
      (!fLoc || (fLoc === "warehouse" ? x.locType === "warehouse" : x.locType === "branch" && String(x.locId) === fLoc))
      && (!fStatus || x.status === fStatus)
      && (!s || [x.note, x.createdByName, x.approvedByName, locName(x.locType, x.locId), x.id].some((v) => (v || "").toLowerCase().includes(s))));
  }, [sessions, fLoc, fStatus, fQ, locName]);
  useEffect(() => setPage(1), [fLoc, fStatus, fQ]);
  const pages = Math.max(1, Math.ceil(filtered.length / PER));
  const rows = filtered.slice((page - 1) * PER, page * PER);

  function exportList() {
    downloadCsv("stocktakes.csv", ["الموقع", "التاريخ", "المنشئ", "الأصناف", "المعدود", "أصناف بفرق", "قيمة العجز", "قيمة الزيادة", "الحالة"],
      filtered.map((x) => [locName(x.locType, x.locId), x.createdAt, x.createdByName, x.totalItems, x.countedItems, x.diffItems, x.shortageValue, x.surplusValue, STATUS_LABEL[x.status] || x.status]));
  }
  function printList() {
    printReport("جرد المخزون — قائمة الجلسات", `${filtered.length} جلسة`,
      (summary ? kpisHTML([
        { label: "إجمالي الجلسات", value: String(summary.total) }, { label: "مفتوحة", value: String(summary.open) },
        { label: "قيد المراجعة", value: String(summary.review) }, { label: "معتمدة", value: String(summary.approved) },
        { label: "العجز المعتمد", value: fmtMoney(summary.shortageValue) }, { label: "الزيادة المعتمدة", value: fmtMoney(summary.surplusValue) },
      ]) : "") + tableHTML(["الموقع", "التاريخ", "المنشئ", "الأصناف", "بفرق", "العجز", "الزيادة", "الحالة"],
        filtered.map((x) => [locName(x.locType, x.locId), fmtDT(x.createdAt), x.createdByName || "—", `${x.countedItems}/${x.totalItems}`, x.diffItems, fmtMoney(x.shortageValue), fmtMoney(x.surplusValue), STATUS_LABEL[x.status] || x.status]),
        { numericCols: [3, 4, 5, 6] }));
  }

  const onChange = useCallback((d: StocktakeDetail) => { setDetail(d); reload().catch(() => undefined); }, [reload]);

  if (!canCreate) {
    return <main dir="rtl" className="mx-auto max-w-5xl p-6"><div className="rounded-card border border-brass/40 bg-brass-soft p-5 text-t-sm font-bold text-brass">ليس لديك صلاحية إدارة الجرد الفعلي. راجع مدير النظام لمنحك صلاحية inventory.stocktake.</div></main>;
  }

  return (
    <main dir="rtl" className="mx-auto max-w-[1500px] space-y-4 p-4 md:p-6">
      {detail ? (
        <CountScreen detail={detail} locName={locName(detail.locType, detail.locId)} canApprove={canApprove} onChange={onChange} onClose={() => setDetail(null)} />
      ) : (<>
        <PageHeader title="جرد المخزون" description="إدارة عمليات الجرد ومراجعة فروقات المخزون واعتماد التسويات." actions={<><Button variant="tool" onClick={exportList} disabled={!filtered.length}><MIcon name="download" className="!text-[18px]" />تصدير</Button>
            <Button variant="tool" onClick={printList} disabled={!filtered.length}><MIcon name="print" className="!text-[18px]" />طباعة</Button>
            <Button onClick={() => { setShowCreate(true); setError(""); }}><MIcon name="add" className="!text-[18px]" />إنشاء جرد</Button></>} />

        {error && <ErrorNote msg={error} />}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 2xl:grid-cols-7">
          {loading || !summary ? Array.from({ length: 7 }).map((_, i) => <KpiSkeleton key={i} />) : (<>
            <KpiCard label="إجمالي الجرد" icon="inventory" value={String(summary.total)} sub={summary.cancelled ? `${summary.cancelled} ملغاة` : undefined} />
            <KpiCard label="الجرد المفتوح" icon="edit_note" value={String(summary.open)} accent="var(--brass)" />
            <KpiCard label="قيد المراجعة" icon="fact_check" value={String(summary.review)} accent="var(--brass)" sub={summary.review ? "تحتاج اعتماد" : undefined} subTone="warning" />
            <KpiCard label="تم الاعتماد" icon="verified" value={String(summary.approved)} accent="var(--emerald)" />
            <KpiCard label="إجمالي الزيادة" icon="trending_up" value={fmtMoney(summary.surplusValue)} accent="var(--petrol)" tip="قيمة الزيادة في الجلسات المعتمدة بالتكلفة" />
            <KpiCard label="إجمالي العجز" icon="trending_down" value={fmtMoney(summary.shortageValue)} accent="var(--ember)" tip="قيمة العجز في الجلسات المعتمدة بالتكلفة" />
            <KpiCard label="صافي الفرق" icon="balance" value={fmtMoney(summary.netValue)} accent={summary.netValue < 0 ? "var(--ember)" : "var(--petrol)"} sub="الجلسات المعتمدة" />
          </>)}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <MIcon name="search" className="pointer-events-none absolute top-1/2 -translate-y-1/2 text-text-dim rtl:right-3 ltr:left-3 !text-[18px]" />
            <Input className="rtl:!pr-9 ltr:!pl-9" value={fQ} onChange={(e) => setFQ(e.target.value)} placeholder="بحث بالموقع / المنشئ / الملاحظة" aria-label="بحث في الجلسات" />
          </div>
          {isAdmin && (
            <Select value={fLoc} onChange={(e) => setFLoc(e.target.value)} aria-label="الموقع" className="max-w-[220px]">
              <option value="">كل المواقع</option><option value="warehouse">المستودع الرئيسي</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          )}
          <Select value={fStatus} onChange={(e) => setFStatus(e.target.value)} aria-label="الحالة" className="max-w-[180px]">
            <option value="">كل الحالات</option>
            {Object.entries(STATUS_LABEL).filter(([k]) => k !== "draft").map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>

        {loading ? <div className="rounded-card border border-line bg-ink-2 p-6 text-t-sm text-text-dim">جارٍ تحميل الجلسات…</div>
          : filtered.length === 0 ? (
            <EmptyState icon="inventory" title={sessions.length ? "لا توجد جلسات مطابقة" : "لا توجد عمليات جرد بعد"} description={sessions.length ? "غيّر البحث أو التصفية." : "أنشئ أول جلسة جرد لموقعك لمقارنة الفعلي بالنظام."}
              action={sessions.length ? undefined : <Button onClick={() => setShowCreate(true)}>إنشاء جرد</Button>} />
          ) : (
            <div className="overflow-x-auto rounded-card border border-line bg-ink-2 shadow-card">
              <table className="w-full min-w-[860px] text-right text-t-sm">
                <thead className="bg-ink-3 text-t-xs text-text-dim"><tr>{["الموقع", "التاريخ", "المنشئ", "التقدم", "أصناف بفرق", "العجز", "الزيادة", "الحالة", ""].map((h, i) => <th key={i} className="p-3 font-bold">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const p = s.totalItems ? Math.round((s.countedItems / s.totalItems) * 100) : 0;
                    return (
                      <tr key={s.id} className="cursor-pointer border-t border-line hover:bg-ink-3/50" onClick={() => open(s.id)}>
                        <td className="p-3 font-bold">{s.name || locName(s.locType, s.locId)}{s.name && <span className="block text-t-xs font-normal text-text-dim">{locName(s.locType, s.locId)}</span>}<span className="tnum block text-t-xs font-normal text-text-dim" dir="ltr">#{s.id.slice(0, 8)}</span></td>
                        <td className="p-3 text-t-xs">{fmtDT(s.createdAt)}</td>
                        <td className="p-3">{s.createdByName || "—"}</td>
                        <td className="p-3">
                          <span className="tnum text-t-xs">{s.countedItems}/{s.totalItems} · {p}%</span>
                          <div className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-ink-3"><div className="h-full bg-petrol" style={{ width: `${p}%` }} /></div>
                        </td>
                        <td className="tnum p-3" dir="ltr">{signed(s.diffItems).replace("+", "")}</td>
                        <td className="tnum p-3 text-ember">{s.shortageValue ? fmtMoney(s.shortageValue) : "—"}</td>
                        <td className="tnum p-3 text-petrol">{s.surplusValue ? fmtMoney(s.surplusValue) : "—"}</td>
                        <td className="p-3"><Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status] || s.status}</Badge></td>
                        <td className="p-3"><Button variant="ghost" size="xs" onClick={(e) => { e.stopPropagation(); open(s.id); }} disabled={busy}>فتح</Button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {pages > 1 && (
                <div className="flex items-center justify-between border-t border-line p-3 text-t-sm">
                  <span className="tnum text-text-dim">{page} / {pages}</span>
                  <span className="flex gap-2"><Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>السابق</Button><Button size="sm" variant="outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>التالي</Button></span>
                </div>
              )}
            </div>
          )}
      </>)}

      <Modal open={showCreate} title="إنشاء عملية جرد" onClose={() => setShowCreate(false)}>
        <div className="space-y-3">
          {isAdmin ? (<>
            <Field label="الموقع">
              <Select value={locType === "warehouse" ? "warehouse" : locId} onChange={(e) => { if (e.target.value === "warehouse") setLocType("warehouse"); else { setLocType("branch"); setLocId(e.target.value); } }}>
                <option value="warehouse">المستودع الرئيسي</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </>) : <p className="text-t-sm text-text-dim">موقع الجرد: {locName("branch", user?.branchId || "")}</p>}
          <Field label="اسم الجرد (اختياري)"><Input value={jobName} maxLength={120} onChange={(e) => setJobName(e.target.value)} placeholder="مثال: جرد نهاية الربع" /></Field>
          <Field label="نوع الجرد">
            <Select value={countType} onChange={(e) => setCountType(e.target.value as "full" | "category")} aria-label="نوع الجرد">
              <option value="full">جرد كامل لأصناف الموقع</option><option value="category">جرد جزئي حسب التصنيف</option>
            </Select>
          </Field>
          {countType === "category" && (
            <Field label="التصنيف">
              <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="التصنيف">
                <option value="">اختر التصنيف</option>{categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </Select>
            </Field>
          )}
          <Field label="ملاحظات (اختياري)"><Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="سبب الجرد أو أي ملاحظات…" /></Field>
          <p className="text-t-xs leading-6 text-text-dim">إنشاء الجلسة يأخذ لقطة للأرصدة الحالية ويجهّز كل أصناف الموقع للعدّ. لا يتغير المخزون حتى الاعتماد.</p>
          <div className="flex gap-2"><Button onClick={create} loading={busy} disabled={busy || (locType === "branch" && !locId)}>إنشاء وبدء العدّ</Button><Button variant="outline" onClick={() => setShowCreate(false)}>إلغاء</Button></div>
        </div>
      </Modal>
    </main>
  );
}
