"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { Button, ErrorNote, Input } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { Widget } from "../Widget";

type Answer = { answer: string; rows: Record<string, unknown>[]; columns: string[] };

/** مركز الذكاء: اسأل بياناتك + الملخص الصباحي + كشف الشذوذ (نفس endpoints السابقة، بدون تغيير في السلوك) */
export function AiPanel() {
  const { hasPerm } = useAuth();
  const { t } = useLang();
  const can = hasPerm("reports.view");
  const [q, setQ] = useState(""), [busy, setBusy] = useState(false), [err, setErr] = useState(""), [ans, setAns] = useState<Answer | null>(null);
  const [brief, setBrief] = useState(""), [briefBusy, setBriefBusy] = useState(false);
  const [anom, setAnom] = useState(""), [anomBusy, setAnomBusy] = useState(false);

  useEffect(() => {
    if (can) api<{ brief: string }>("/reports/daily-brief").then((r) => setBrief(r.brief)).catch(() => setBrief(""));
  }, [can]);
  if (!can) return null;

  async function ask() {
    if (!q.trim()) return;
    setBusy(true); setErr(""); setAns(null);
    try { setAns(await api<Answer>("/reports/ask", { method: "POST", body: JSON.stringify({ question: q }) })); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function refreshBrief() {
    setBriefBusy(true);
    try { setBrief((await api<{ brief: string }>("/reports/daily-brief?force=true")).brief); } catch { /* */ } finally { setBriefBusy(false); }
  }
  async function runAnomalies() {
    setAnomBusy(true);
    try { setAnom((await api<{ report: string }>("/reports/anomalies")).report); } catch { /* */ } finally { setAnomBusy(false); }
  }
  const wait = t("dash.preparing", "جارِ التحضير...");
  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Widget title={t("dash.askYourData", "اسأل بياناتك")} icon="auto_awesome">
        <div className="space-y-2.5">
          <div className="flex gap-2">
            <Input value={q} placeholder={t("dash.aiPlaceholder", "مثال: أكتر 5 أصناف مبيعاً الشهر ده؟")} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} />
            <Button onClick={ask} disabled={busy}>{busy ? wait : t("dash.ask", "اسأل")}</Button>
          </div>
          <ErrorNote msg={err} />
          {ans && (
            <div className="space-y-2">
              {ans.answer && <p className="rounded-xl bg-petrol-soft px-3 py-2.5 text-t-sm font-bold leading-relaxed">{ans.answer}</p>}
              {ans.rows.length > 0 && (
                <div className="max-h-56 overflow-auto rounded-lg border border-line">
                  <table className="w-full text-t-xs">
                    <thead><tr className="bg-ink-3 text-text-dim">{ans.columns.map((c) => <th key={c} className="px-2.5 py-1.5 text-start font-extrabold">{c}</th>)}</tr></thead>
                    <tbody>{ans.rows.map((r, i) => <tr key={i} className="border-t border-line/60">{ans.columns.map((c) => <td key={c} className="tnum px-2.5 py-1.5">{String(r[c] ?? "—")}</td>)}</tr>)}</tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </Widget>
      <div className="space-y-3">
        <Widget title={t("dash.morningBrief", "الملخص الصباحي")} icon="wb_sunny" actions={
          <Button variant="ghost" size="xs" disabled={briefBusy} onClick={refreshBrief}>{briefBusy ? wait : t("dash.refresh", "تحديث")}</Button>}>
          <p className="whitespace-pre-line text-t-sm leading-relaxed">{brief || wait}</p>
        </Widget>
        <Widget title={t("dash.anomalyDetection", "كشف الشذوذ المالي")} icon="policy" actions={
          <Button variant="ghost" size="xs" disabled={anomBusy} onClick={runAnomalies}>{anomBusy ? t("dash.checking", "جارِ الفحص...") : t("dash.checkNow", "افحص الآن")}</Button>}>
          {anom ? <p className="whitespace-pre-line text-t-sm leading-relaxed">{anom}</p> : <MIcon name="policy" className="!text-[22px] text-text-dim/50" />}
        </Widget>
      </div>
    </div>
  );
}
