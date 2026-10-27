"use client";
// تحليلات عملية: الداخل مقابل الخارج، الأعلى حركة، حسب الموقع/التصنيف/العلامة. لا رسوم بلا قرار؛ لا اتجاه لقيمة المخزون لأن النظام لا يحفظ لقطات تاريخية.
import { Button, EmptyState, ErrorNote } from "@/components/ui";
import { Skeleton } from "@/components/dashboard/Widget";
import type { Analytics } from "@/lib/inventory/types";
import { Panel, fmtM, fmtN, qs, useFetch, type Period } from "./shared";

function InOutChart({ rows }: { rows: Analytics["trend"] }) {
  if (rows.length === 0) return <EmptyState icon="show_chart" title="لا حركة في الفترة" />;
  const max = Math.max(1, ...rows.flatMap((r) => [r.in, r.out]));
  const W = 640, H = 160, bw = Math.max(3, Math.min(18, (W - 20) / rows.length / 2.6));
  const step = (W - 20) / rows.length;
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-44 w-full min-w-[420px]" role="img" aria-label="الداخل مقابل الخارج يومياً" style={{ direction: "ltr" }}>
        <line x1="10" x2={W - 10} y1={H} y2={H} stroke="var(--line)" />
        {rows.map((r, i) => {
          const x = 10 + i * step + step / 2;
          const hi = (r.in / max) * (H - 10), ho = (r.out / max) * (H - 10);
          return (
            <g key={r.date}>
              <rect x={x - bw - 1} y={H - hi} width={bw} height={hi} rx="2" fill="var(--emerald)"><title>{`${r.date} — داخل ${r.in}`}</title></rect>
              <rect x={x + 1} y={H - ho} width={bw} height={ho} rx="2" fill="var(--ember)"><title>{`${r.date} — خارج ${r.out}`}</title></rect>
              {(rows.length <= 12 || i % Math.ceil(rows.length / 10) === 0) && <text x={x} y={H + 14} fontSize="10" textAnchor="middle" fill="var(--text-dim)">{r.date.slice(5)}</text>}
            </g>
          );
        })}
      </svg>
      <p className="flex gap-4 text-t-xs text-text-dim"><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald" />داخل</span><span className="inline-flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-ember" />خارج (بيع/تحويل/تسوية)</span></p>
    </div>
  );
}

export function AnalyticsPanel({ loc, period, deadDays, onPickLoc, onPickCategory }: {
  loc: string; period: Period; deadDays: number; onPickLoc: (v: string) => void; onPickCategory: (c: string) => void;
}) {
  const { data, loading, error, reload } = useFetch<Analytics>(`/inventory/overview/analytics?${qs({ loc, from: period.from, to: period.to, deadDays })}`);
  if (error) return <div><ErrorNote msg={error} /><Button size="sm" variant="outline" onClick={reload}>إعادة المحاولة</Button></div>;
  if (loading && !data) return <Skeleton className="w-full" height={360} />;
  if (!data) return null;
  const cv = data.canCost;
  const tbl = "w-full text-t-sm";
  const th = "p-2 text-start text-t-xs font-bold text-text-dim";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="الداخل مقابل الخارج" icon="swap_vert"><InOutChart rows={data.trend} /></Panel>
        <Panel title="الأعلى حركة (مبيعات الفترة)" icon="bolt">
          {data.topMovers.length === 0 ? <EmptyState icon="bolt" title="لا مبيعات في الفترة" /> : (
            <table className={tbl}><thead><tr><th className={th}>الصنف</th><th className={th}>الكمية</th>{cv && <th className={th}>الإيراد</th>}<th className={th}>معدل/يوم</th></tr></thead>
              <tbody>{data.topMovers.map((m) => <tr key={m.id} className="border-t border-line"><td className="p-2 font-bold">{m.name}{m.spec ? ` — ${m.spec}` : ""}</td><td className="tnum p-2 font-black">{fmtN(m.qty)}</td>{cv && <td className="tnum p-2">{fmtM(m.revenue)}</td>}<td className="tnum p-2 text-text-dim">{m.perDay}</td></tr>)}</tbody></table>)}
        </Panel>
      </div>
      <Panel title="حسب الموقع" icon="warehouse">
        <div className="overflow-x-auto"><table className={`${tbl} min-w-[520px]`}><thead><tr>{["الموقع", "الأصناف", "الكمية", ...(cv ? ["القيمة"] : []), "منخفض", "نافد"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
          <tbody>{data.byLocation.map((l) => <tr key={l.value} onClick={() => onPickLoc(l.value)} className="cursor-pointer border-t border-line hover:bg-ink-3/50"><td className="p-2 font-bold">{l.name}</td><td className="tnum p-2">{fmtN(l.skus)}</td><td className="tnum p-2">{fmtN(l.units)}</td>{cv && <td className="tnum p-2">{fmtM(l.value_amt)}</td>}<td className="tnum p-2 text-brass">{fmtN(l.low)}</td><td className="tnum p-2 text-ember">{fmtN(l.out)}</td></tr>)}</tbody></table></div>
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="حسب التصنيف" icon="category">
          {data.byCategory.length === 0 ? <EmptyState icon="category" title="لا بيانات" /> : (
            <table className={tbl}><thead><tr>{["التصنيف", "الأصناف", "الكمية", ...(cv ? ["القيمة"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{data.byCategory.map((c) => <tr key={c.category} onClick={() => onPickCategory(c.category)} className="cursor-pointer border-t border-line hover:bg-ink-3/50"><td className="p-2 font-bold">{c.category}</td><td className="tnum p-2">{fmtN(c.skus)}</td><td className="tnum p-2">{fmtN(c.units)}</td>{cv && <td className="tnum p-2">{fmtM(c.value)}</td>}</tr>)}</tbody></table>)}
        </Panel>
        <Panel title="حسب العلامة التجارية" icon="sell">
          {data.byBrand.length === 0 ? <EmptyState icon="sell" title="لا علامات مسجلة" description="تُسجَّل العلامة للزيوت من شاشة الأصناف." /> : (
            <table className={tbl}><thead><tr>{["العلامة", "الأصناف", "الكمية", ...(cv ? ["القيمة"] : [])].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
              <tbody>{data.byBrand.map((b) => <tr key={b.brand} className="border-t border-line"><td className="p-2 font-bold">{b.brand}</td><td className="tnum p-2">{fmtN(b.skus)}</td><td className="tnum p-2">{fmtN(b.units)}</td>{cv && <td className="tnum p-2">{fmtM(b.value)}</td>}</tr>)}</tbody></table>)}
        </Panel>
      </div>
    </div>
  );
}
