"use client";
// لوحة القيادة — مركز قيادة ERP بطراز عالمي: تيكر بورصة + مؤشرات بسباركلاين +
// رسم هندسي بمحاور وشبكة ومتوسط متحرك + عداد تشغيل دائري. رسوم SVG يدوية بلا مكتبات.
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Input } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { money } from "@/modules/invoices/types";

type Dash = {
  today: { total: number; count: number ; profit: number };
  month: { total: number; count: number; vat: number ; profit: number };
  cars: { queued: number; inService: number; doneToday?: number };
  lowStock: number;
  creditOutstanding: number;
  series: { date: string; total: number; count: number }[];
  payMethods: { method: string; total: number }[];
  counts?: { customers: number; suppliers: number; products: number };
  topProducts?: { label: string; qty: number; total: number }[];
  recentInvoices?: { no: string; customer: string; total: number; source: string; onCredit: boolean; at: string }[];
  newCustomers?: { today: number; week: number; latest: { name: string; phone: string | null }[] };
  topSuppliers?: { name: string; total: number; count: number }[];
  topCustomers?: { name: string; phone: string | null; visits: number; total: number }[];
};
type ShiftReport = { shift: { branch_name: string | null }; sales: { totalInc: number; invoiceCount: number } } | null;
type MiniInvoice = { id: string; invoice_no: string; customer_name: string | null; total_inc: number; issued_at: string; is_returned: boolean };

const PAY_AR: Record<string, string> = { cash: "نقدي", card: "شبكة", transfer: "تحويل", credit: "آجل" };
const PAY_COLOR: Record<string, string> = { cash: "#22C55E", card: "#3B82F6", transfer: "#8B5CF6", credit: "#F59E0B" };

/* تنسيق أرقام مضغوط بأسلوب لوحات البورصة: 12.4k */
const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}م` : v >= 1000 ? `${(v / 1000).toFixed(1)}ك` : money(v);

/* Δ% — سهم صاعد/هابط بأسلوب شاشات الأسهم */
function Delta({ curr, prev }: { curr: number; prev: number }) {
  if (!prev) return <span className="tnum text-[10.5px] font-bold text-text-dim">جديد</span>;
  const pct = Math.round(((curr - prev) / prev) * 100);
  const up = pct >= 0;
  return (
    <span className={`tnum inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10.5px] font-black
        ${up ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>
      <svg viewBox="0 0 8 8" className={`h-2 w-2 ${up ? "" : "rotate-180"}`}>
        <path d="M4 0 L8 6 L0 6 Z" fill="currentColor" />
      </svg>
      {Math.abs(pct)}%
    </span>
  );
}

/* ── سباركلاين مصغر — جوه بطاقات المؤشرات ── */
function Spark({ data, color = "var(--petrol)", id }: { data: number[]; color?: string; id: string }) {
  if (data.length < 2) return null;
  const W = 120, H = 34, P = 2;
  const max = Math.max(...data, 1), min = Math.min(...data, 0);
  const span = max - min || 1;
  const pts = data.map((v, i) => [
    P + (i * (W - P * 2)) / (data.length - 1),
    H - P - ((v - min) / span) * (H - P * 2),
  ]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0]},${H} L${pts[0][0]},${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-9 w-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.3" fill={color} />
    </svg>
  );
}

/* ── الرسم الرئيسي الهندسي: محاور + شبكة + مساحة + متوسط متحرك 7 أيام + تعليق القمة ── */
function EngineChart({ series }: { series: Dash["series"] }) {
  if (!series.length) return <p className="py-10 text-center text-[12px] text-text-dim">لا توجد بيانات بعد</p>;
  const W = 640, H = 220, L = 46, R = 10, T = 14, B = 24;
  const iw = W - L - R, ih = H - T - B;
  const max = Math.max(...series.map((s) => s.total), 1) * 1.08;
  const X = (i: number) => L + (i * iw) / Math.max(series.length - 1, 1);
  const Y = (v: number) => T + ih - (v / max) * ih;
  const pts = series.map((s, i) => [X(i), Y(s.total)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${X(series.length - 1)},${T + ih} L${X(0)},${T + ih} Z`;
  // متوسط متحرك 7 أيام
  const ma = series.map((_, i) => {
    const win = series.slice(Math.max(0, i - 6), i + 1);
    return win.reduce((s, d) => s + d.total, 0) / win.length;
  });
  const maLine = ma.map((v, i) => `${i ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(" ");
  const peak = series.reduce((b, s, i) => (s.total > series[b].total ? i : b), 0);
  const grid = [0.25, 0.5, 0.75, 1];

  // ── التتبع اللحظي بالماوس: أقرب نقطة لموضع المؤشر ──
  const [hov, setHov] = useState<number | null>(null);
  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * W;
    const idx = Math.round(((vx - L) / iw) * Math.max(series.length - 1, 1));
    setHov(Math.max(0, Math.min(series.length - 1, idx)));
  }
  const tipW = 118;
  const tipX = hov === null ? 0 : Math.max(L, Math.min(X(hov) - tipW / 2, W - R - tipW));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full cursor-crosshair" role="img"
         aria-label="الإيراد اليومي بمحاور"
         onMouseMove={onMove} onMouseLeave={() => setHov(null)}>
      <defs>
        <linearGradient id="eng-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--petrol)" stopOpacity="0.20" />
          <stop offset="100%" stopColor="var(--petrol)" stopOpacity="0.01" />
        </linearGradient>
      </defs>
      {/* الشبكة والمحور الرأسي */}
      {grid.map((g) => (
        <g key={g}>
          <line x1={L} x2={W - R} y1={Y(max * g)} y2={Y(max * g)}
                stroke="var(--line)" strokeWidth="1" strokeDasharray={g === 1 ? "" : "3 4"} />
          <text x={L - 6} y={Y(max * g) + 3} textAnchor="end" fontSize="8.5" fill="var(--text-dim)" className="tnum">
            {compact(max * g)}
          </text>
        </g>
      ))}
      <line x1={L} x2={W - R} y1={T + ih} y2={T + ih} stroke="var(--line)" strokeWidth="1.2" />
      {/* المساحة والخط الرئيسي */}
      <path d={area} fill="url(#eng-area)" />
      <path d={line} fill="none" stroke="var(--petrol)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      {/* المتوسط المتحرك */}
      <path d={maLine} fill="none" stroke="var(--brass)" strokeWidth="1.6" strokeDasharray="5 4" opacity="0.9" />
      {/* النقاط + تواريخ */}
      {pts.map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="2.6" fill="var(--ink2)" stroke="var(--petrol)" strokeWidth="1.8">
            <title>{`${series[i].date} — ${money(series[i].total)} ر.س (${series[i].count} فاتورة)`}</title>
          </circle>
          {i % 2 === 0 && (
            <text x={x} y={H - 8} textAnchor="middle" fontSize="8" fill="var(--text-dim)" className="tnum">
              {series[i].date.slice(8)}/{series[i].date.slice(5, 7)}
            </text>
          )}
        </g>
      ))}
      {/* تعليق القمة */}
      {series[peak].total > 0 && (
        <g>
          <line x1={X(peak)} x2={X(peak)} y1={Y(series[peak].total)} y2={T} stroke="var(--emerald)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
          <rect x={Math.min(X(peak) - 34, W - R - 68)} y={T - 12} width="68" height="15" rx="7.5" fill="var(--emerald)" opacity="0.14" />
          <text x={Math.min(X(peak), W - R - 34)} y={T - 1} textAnchor="middle" fontSize="8.5" fill="var(--emerald)" fontWeight="bold" className="tnum">
            ⬆ قمة {compact(series[peak].total)}
          </text>
        </g>
      )}
      {/* نبض آخر نقطة */}
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="5" fill="var(--petrol)" opacity="0.25">
        <animate attributeName="r" values="4;9;4" dur="2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.3;0;0.3" dur="2s" repeatCount="indefinite" />
      </circle>

      {/* ══ التتبع اللحظي: خط متعامد + نقطة مضيئة + بطاقة قيم ══ */}
      {hov !== null && (
        <g pointerEvents="none">
          <line x1={X(hov)} x2={X(hov)} y1={T} y2={T + ih}
                stroke="var(--petrol)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.55" />
          <circle cx={X(hov)} cy={Y(series[hov].total)} r="5"
                  fill="var(--petrol)" stroke="var(--ink2)" strokeWidth="2" />
          <circle cx={X(hov)} cy={Y(ma[hov])} r="3.5"
                  fill="var(--brass)" stroke="var(--ink2)" strokeWidth="1.5" />
          <g>
            <rect x={tipX} y={T + 2} width={tipW} height="40" rx="8"
                  fill="var(--ink2)" stroke="var(--line)" strokeWidth="1"
                  style={{ filter: "drop-shadow(0 2px 6px rgba(15,23,42,.18))" }} />
            <text x={tipX + tipW / 2} y={T + 14} textAnchor="middle" fontSize="8.5"
                  fill="var(--text-dim)" fontWeight="bold" className="tnum">
              {series[hov].date.slice(8)}/{series[hov].date.slice(5, 7)} — {series[hov].count} فاتورة
            </text>
            <text x={tipX + tipW / 2} y={T + 26} textAnchor="middle" fontSize="10.5"
                  fill="var(--petrol)" fontWeight="900" className="tnum">
              {money(series[hov].total)} ر.س
            </text>
            <text x={tipX + tipW / 2} y={T + 37} textAnchor="middle" fontSize="8"
                  fill="var(--brass)" fontWeight="bold" className="tnum">
              متوسط 7ي: {money(ma[hov])}
            </text>
          </g>
        </g>
      )}
    </svg>
  );
}

/* ── عداد دائري (Gauge) — طاقة تشغيل اليوم ── */
function Gauge({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(1, value / total) : 0;
  const R2 = 46, C = Math.PI * R2; // نصف دائرة
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 120 70" className="w-40">
        <path d={`M14,64 A${R2},${R2} 0 0 1 106,64`} fill="none" stroke="var(--ink4)" strokeWidth="11" strokeLinecap="round" />
        <path d={`M14,64 A${R2},${R2} 0 0 1 106,64`} fill="none" stroke="var(--petrol)" strokeWidth="11" strokeLinecap="round"
              strokeDasharray={`${pct * C} ${C}`} className="transition-all duration-700" />
        <text x="60" y="52" textAnchor="middle" fontSize="19" fontWeight="900" fill="var(--text)" className="tnum">
          {Math.round(pct * 100)}%
        </text>
        <text x="60" y="65" textAnchor="middle" fontSize="7.5" fill="var(--text-dim)">{value} من {total}</text>
      </svg>
      <span className="mt-1 text-[11px] font-bold text-text-dim">{label}</span>
    </div>
  );
}

/* ── دائرة طرق الدفع ── */
function PayDonut({ methods }: { methods: Dash["payMethods"] }) {
  const total = methods.reduce((s, m) => s + m.total, 0);
  if (!total) return <p className="py-6 text-center text-[12px] text-text-dim">لا توجد مدفوعات بعد</p>;
  const R2 = 42, C = 2 * Math.PI * R2;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <svg viewBox="0 0 110 110" className="h-28 w-28 -rotate-90">
          {methods.map((m) => {
            const frac = m.total / total, dash = frac * C, off = -acc * C; acc += frac;
            return <circle key={m.method} cx="55" cy="55" r={R2} fill="none" stroke={PAY_COLOR[m.method] || "#94A3B8"}
                           strokeWidth="13" strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={off}
                           className="transition-all duration-500" />;
          })}
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="tnum text-[11px] font-black text-text-dim">{compact(total)}</span>
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {methods.map((m) => (
          <div key={m.method} className="flex items-center justify-between gap-2 text-[11.5px] font-bold">
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: PAY_COLOR[m.method] || "#94A3B8" }} />
              {PAY_AR[m.method] || m.method}
            </span>
            <span className="tnum text-text-dim">{money(m.total)} · {Math.round((m.total / total) * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, hasPerm } = useAuth();
  const canSeeShift = hasPerm("shifts.manage_own");
  const canSeeInvoices = hasPerm("invoices.view_today", "invoices.view_all");

  const [dash, setDash] = useState<Dash | null>(null);
  const [shift, setShift] = useState<ShiftReport>(null);
  const [recent, setRecent] = useState<MiniInvoice[]>([]);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [lastSync, setLastSync] = useState<Date | null>(null);

  // ── مركز قيادة حي: تحديث تلقائي كل 15 ثانية ──
  useEffect(() => {
    let stop = false;
    async function sync() {
      api<{ status: string }>("/health").then(() => !stop && setApiOk(true)).catch(() => !stop && setApiOk(false));
      api<Dash>("/reports/dashboard").then((d) => { if (!stop) { setDash(d); setLastSync(new Date()); } }).catch(() => {});
      if (canSeeShift) api<ShiftReport>("/shifts/current").then((r) => !stop && setShift(r)).catch(() => {});
      if (canSeeInvoices) api<MiniInvoice[]>("/invoices?limit=7").then((r) => !stop && setRecent(r)).catch(() => {});
    }
    sync();
    const t = setInterval(sync, 15000);
    return () => { stop = true; clearInterval(t); };
  }, [canSeeShift, canSeeInvoices]);

  // مشتقات التيكر والمؤشرات
  const todayStr = new Date().toISOString().slice(0, 10);
  const yesterdayTotal = dash?.series?.filter((s) => s.date !== todayStr).slice(-1)[0]?.total ?? 0;
  const week = useMemo(() => (dash?.series ?? []).slice(-7), [dash]);
  const weekTotal = week.reduce((s, d) => s + d.total, 0);
  const prevWeekTotal = (dash?.series ?? []).slice(-14, -7).reduce((s, d) => s + d.total, 0);
  const avgInvoice = dash && dash.today.count > 0 ? dash.today.total / dash.today.count : 0;
  const revSpark = (dash?.series ?? []).map((s) => s.total);
  const cntSpark = (dash?.series ?? []).map((s) => s.count);

  // ══════════ مركز الذكاء ══════════
  const [aiQ, setAiQ] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [aiAns, setAiAns] = useState<null | { answer: string; rows: any[]; columns: string[] }>(null);
  const [brief, setBrief] = useState<string>("");
  const [briefBusy, setBriefBusy] = useState(false);
  const [anom, setAnom] = useState<string>("");
  const [anomBusy, setAnomBusy] = useState(false);
  const canAi = hasPerm("reports.view");
  useEffect(() => {
    if (canAi) api<{ brief: string }>("/reports/daily-brief").then((r) => setBrief(r.brief)).catch(() => {});
  }, [canAi]);

  async function askAi() {
    if (aiQ.trim().length < 3) return;
    setAiErr(""); setAiBusy(true); setAiAns(null);
    try {
      setAiAns(await api("/reports/ask", { method: "POST", body: JSON.stringify({ question: aiQ }) }));
    } catch (e: any) { setAiErr(e.message); }
    finally { setAiBusy(false); }
  }
  async function refreshBrief() {
    setBriefBusy(true);
    try { const r = await api<{ brief: string }>("/reports/daily-brief?force=true"); setBrief(r.brief); }
    catch (e: any) { setBrief(e.message); }
    finally { setBriefBusy(false); }
  }
  async function runAnomalies() {
    setAnomBusy(true); setAnom("");
    try { const r = await api<{ report: string }>("/reports/anomalies"); setAnom(r.report); }
    catch (e: any) { setAnom(e.message); }
    finally { setAnomBusy(false); }
  }

  const dateAr = new Date().toLocaleDateString("ar-SA", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="space-y-4">

      {/* ══════════ رأس القيادة ══════════ */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-[21px] font-black">أهلاً {user?.fullName?.split(" ")[0] || "المدير"} 👋</h1>
          <p className="text-[11.5px] font-bold text-text-dim">{dateAr} — لوحة القيادة الحية</p>
        </div>
        <div className="flex items-center gap-3">
          {canSeeShift && (shift ? (
            <Link href="/sales" className="flex items-center gap-2 rounded-xl border border-line bg-ink-2 px-3 py-1.5 text-[11.5px] font-bold shadow-card transition hover:border-petrol">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald" />
              وردية مفتوحة · <b className="tnum">{money(shift.sales.totalInc)}</b> ({shift.sales.invoiceCount})
            </Link>
          ) : (
            <Link href="/sales" className="rounded-xl bg-brass-soft px-3 py-1.5 text-[11.5px] font-black text-brass">
              ⚠ افتح وردية ←
            </Link>
          ))}
          {apiOk !== null && (
            <span className={`flex items-center gap-1.5 text-[11px] font-bold ${apiOk ? "text-emerald" : "text-ember"}`}>
              <span className={`h-2 w-2 animate-pulse rounded-full ${apiOk ? "bg-emerald" : "bg-ember"}`} />
              {apiOk ? "متصل" : "منقطع"}
              {lastSync && <span className="tnum text-text-dim">· {lastSync.toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}</span>}
            </span>
          )}
        </div>
      </div>

      {/* ══════════ شريط التيكر — أسلوب شاشات البورصة ══════════ */}
      {dash && (
        <div className="scrollbar-none flex items-stretch gap-0 overflow-x-auto rounded-card bg-[#0F172A] px-1 py-2.5 shadow-panel">
          {[
            { l: "مبيعات اليوم", v: `${money(dash.today.total)}`, d: <Delta curr={dash.today.total} prev={yesterdayTotal} /> },
            { l: "فواتير اليوم", v: `${dash.today.count}`, d: null },
            { l: "متوسط الفاتورة", v: money(avgInvoice), d: null },
            { l: "أسبوع", v: compact(weekTotal), d: <Delta curr={weekTotal} prev={prevWeekTotal} /> },
            { l: "الشهر", v: compact(dash.month.total), d: null },
            { l: "ضريبة الشهر", v: compact(dash.month.vat), d: null },
            { l: "آجل قائم", v: compact(dash.creditOutstanding), d: null, warn: dash.creditOutstanding > 0 },
            { l: "نواقص مخزون", v: `${dash.lowStock}`, d: null, warn: dash.lowStock > 0 },
          ].map((t, i) => (
            <div key={i} className="flex min-w-fit items-center gap-2.5 border-l border-white/10 px-4 last:border-l-0">
              <span className="text-[10px] font-bold text-white/50">{t.l}</span>
              <span className={`tnum text-[14px] font-black ${t.warn ? "text-amber-400" : "text-white"}`}>{t.v}</span>
              {t.d}
            </div>
          ))}
        </div>
      )}

      {/* ══════════ يحتاج انتباهك ══════════ */}
      {dash && (() => {
        const alerts: { icon: string; tone: string; text: string; href: string }[] = [];
        if (dash.lowStock > 0) alerts.push({ icon: "warning", tone: "text-ember", text: `${dash.lowStock} صنف تحت الحد الأدنى`, href: "/inventory" });
        if (dash.creditOutstanding > 0) alerts.push({ icon: "schedule", tone: "text-brass", text: `${money(dash.creditOutstanding)} آجل غير محصل`, href: "/sales/history" });
        if (dash.cars.queued > 0) alerts.push({ icon: "directions_car", tone: "text-petrol", text: `${dash.cars.queued} سيارة في الطابور`, href: "/cars" });
        if ((dash.newCustomers?.today ?? 0) > 0) alerts.push({ icon: "person_add", tone: "text-emerald", text: `${dash.newCustomers!.today} عميل جديد اليوم`, href: "/customers" });
        if (!alerts.length) return null;
        return (
          <div className="flex flex-wrap gap-2">
            {alerts.map((a, i) => (
              <Link key={i} href={a.href}
                    className="flex items-center gap-1.5 rounded-full border border-line bg-ink-2 px-3 py-1.5 text-[11.5px] font-bold shadow-card transition-all duration-200 hover:-translate-y-px hover:border-petrol">
                <MIcon name={a.icon} className={`!text-[15px] ${a.tone}`} /> {a.text}
              </Link>
            ))}
          </div>
        );
      })()}

      {/* ══════════ مؤشرات KPI بسباركلاين مدمج ══════════ */}
      {dash ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { l: "مبيعات اليوم", v: money(dash.today.total), unit: "ر.س", d: <Delta curr={dash.today.total} prev={yesterdayTotal} />, spark: revSpark, color: "var(--petrol)", id: "sp1" },
            { l: "ربح اليوم (قبل المصاريف)", v: money(dash.today.profit ?? 0), unit: "ر.س", d: <></>, spark: [] as number[], color: "var(--emerald)", id: "spProfit" },
            { l: "فواتير اليوم", v: String(dash.today.count), unit: "فاتورة", d: <Delta curr={dash.today.count} prev={dash.series.filter((s) => s.date !== todayStr).slice(-1)[0]?.count ?? 0} />, spark: cntSpark, color: "#8B5CF6", id: "sp2" },
            { l: "متوسط الفاتورة", v: money(avgInvoice), unit: "ر.س", d: null, spark: revSpark.map((v, i) => (cntSpark[i] ? v / cntSpark[i] : 0)), color: "#22C55E", id: "sp3" },
            { l: "إيراد الشهر", v: money(dash.month.total), unit: `${dash.month.count} فاتورة`, d: null, spark: revSpark, color: "#F59E0B", id: "sp4" },
          ].map((k) => (
            <div key={k.id}
                 className="rounded-card border border-line bg-ink-2 p-4 shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-text-dim">{k.l}</span>
                {k.d}
              </div>
              <div className="tnum mt-1 text-[20px] font-black leading-none" style={{ color: k.color }}>
                {k.v} <span className="text-[10px] font-bold text-text-dim">{k.unit}</span>
              </div>
              <div className="mt-2"><Spark data={k.spark} color={k.color} id={k.id} /></div>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-28 animate-pulse rounded-card border border-line bg-ink-2" />
          ))}
        </div>
      )}

      {/* ══════════ الرسم الرئيسي + عمود التشغيل ══════════ */}
      {dash && (
        <div className="grid gap-3 lg:grid-cols-[1.9fr_1fr]">
          <Card>
            <div className="mb-1 flex items-center justify-between">
              <h2 className="flex items-center gap-1.5 text-[13.5px] font-black">
                <MIcon name="monitoring" className="!text-[19px] text-petrol" /> الإيراد اليومي — 14 يوم
              </h2>
              <div className="flex items-center gap-3 text-[10px] font-bold text-text-dim">
                <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded bg-petrol" /> الإيراد</span>
                <span className="flex items-center gap-1"><span className="h-0.5 w-4 rounded border-t-2 border-dashed border-brass" /> متوسط 7 أيام</span>
              </div>
            </div>
            <EngineChart series={dash.series} />
          </Card>
          <div className="space-y-3">
            <Card className="!py-4">
              <h2 className="mb-1 text-center text-[12.5px] font-black">طاقة التشغيل اليوم</h2>
              <Gauge value={dash.cars.doneToday ?? 0}
                     total={(dash.cars.doneToday ?? 0) + dash.cars.inService + dash.cars.queued}
                     label={`${dash.cars.queued} انتظار · ${dash.cars.inService} خدمة · ${dash.cars.doneToday ?? 0} اكتملت`} />
            </Card>
            <Card>
              <h2 className="mb-2 text-[12.5px] font-black">طرق الدفع — الشهر</h2>
              <PayDonut methods={dash.payMethods} />
            </Card>
          </div>
        </div>
      )}

      {/* ══════════ الأكثر مبيعاً + أفضل الموردين + العملاء الجدد ══════════ */}
      {dash && (
        <div className="grid gap-3 lg:grid-cols-3">
          {dash.topProducts && dash.topProducts.length > 0 && (
            <Card>
              <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-black">
                <MIcon name="trophy" className="!text-[18px] text-brass" /> الأكثر مبيعاً — الشهر
              </h2>
              {dash.topProducts.map((tp, i) => {
                const max = dash.topProducts![0].total || 1;
                return (
                  <div key={i} className="py-1.5">
                    <div className="flex items-center justify-between text-[11.5px] font-bold">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="tnum grid h-5 w-5 shrink-0 place-items-center rounded-md bg-ink-3 text-[10px] font-black text-text-dim">{i + 1}</span>
                        <span className="truncate">{tp.label}</span>
                      </span>
                      <span className="tnum shrink-0 text-text-dim">{money(tp.total)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-3">
                      <div className="h-full rounded-full bg-petrol transition-all duration-500" style={{ width: `${(tp.total / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
          {dash.topSuppliers && dash.topSuppliers.length > 0 && (
            <Card>
              <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-black">
                <MIcon name="local_shipping" className="!text-[18px] text-petrol" /> أفضل الموردين — الشهر
              </h2>
              {dash.topSuppliers.map((s, i) => {
                const max = dash.topSuppliers![0].total || 1;
                return (
                  <div key={i} className="py-1.5">
                    <div className="flex items-center justify-between text-[11.5px] font-bold">
                      <span className="truncate">{s.name}</span>
                      <span className="tnum shrink-0 text-text-dim">{money(s.total)}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-3">
                      <div className="h-full rounded-full bg-brass transition-all duration-500" style={{ width: `${(s.total / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
            </Card>
          )}
          {dash.newCustomers && (
            <Card>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-[13px] font-black">
                  <MIcon name="person_add" className="!text-[18px] text-emerald" /> العملاء الجدد
                </h2>
                <span className="tnum rounded-full bg-emerald-bg px-2 py-0.5 text-[10.5px] font-black text-emerald">+{dash.newCustomers.week} أسبوع</span>
              </div>
              {dash.newCustomers.latest.length === 0 ? (
                <p className="py-3 text-center text-[11.5px] text-text-dim">لا يوجد بعد</p>
              ) : dash.newCustomers.latest.map((c, i) => (
                <div key={i} className="flex items-center gap-2 border-t border-line/60 py-1.5 first:border-t-0">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-petrol-soft text-[11px] font-black text-petrol">
                    {c.name.trim().charAt(0)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{c.name}</span>
                  <span className="tnum text-[10.5px] text-text-dim">{c.phone || "—"}</span>
                </div>
              ))}
            </Card>
          )}

          {/* ── 👑 العملاء الأكثر زيارة ── */}
          {dash.topCustomers && dash.topCustomers.length > 0 && (
            <Card>
              <h2 className="mb-2 flex items-center gap-1.5 text-[13px] font-black">
                <MIcon name="loyalty" className="!text-[18px] text-petrol" /> العملاء الأكثر زيارة
              </h2>
              {dash.topCustomers.map((c, i) => (
                <div key={i} className="flex items-center gap-2 border-t border-line/60 py-1.5 first:border-t-0">
                  <span className={`tnum grid h-6 w-6 place-items-center rounded-md text-[10px] font-black
                      ${i === 0 ? "bg-brass-soft text-brass" : "bg-ink-3 text-text-dim"}`}>
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12px] font-bold">{c.name}</div>
                    <div className="tnum text-[10px] text-text-dim">{c.phone || "—"}</div>
                  </div>
                  <div className="text-left">
                    <div className="tnum text-[12.5px] font-black text-petrol">{c.visits} زيارة</div>
                    <div className="tnum text-[10px] text-text-dim">{money(c.total)} ر.س</div>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      )}

      {/* ══════════ آخر الفواتير — مباشر ══════════ */}
      {canSeeInvoices && recent.length > 0 && (
        <Card className="!p-0 overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <h2 className="text-[13px] font-extrabold">آخر الفواتير — مباشر</h2>
            <Link href="/sales/history" className="text-[11.5px] font-bold text-petrol hover:underline">السجل الكامل ←</Link>
          </div>
          <div className="divide-y divide-line/60">
            {recent.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-4 py-2 text-[12px] transition-colors hover:bg-ink-3/40">
                <span className="tnum font-black text-petrol">#{i.invoice_no}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{i.customer_name || "بيع نقدي"}</span>
                {i.is_returned && <span className="rounded-full bg-ember-bg px-2 py-0.5 text-[10px] font-black text-ember">مرتجعة</span>}
                <span className="tnum font-black">{money(i.total_inc)}</span>
                <span className="tnum text-[10.5px] text-text-dim">
                  {new Date(i.issued_at).toLocaleTimeString("ar-SA", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ══════════ إجراءات سريعة ══════════ */}
      <div className="flex flex-wrap gap-2">
        {[
          { href: "/sales/direct", icon: "point_of_sale", label: "بيع مباشر" },
          { href: "/sales", icon: "receipt_long", label: "فاتورة خدمة" },
          { href: "/cars", icon: "directions_car", label: "تسجيل سيارة" },
          { href: "/products", icon: "inventory_2", label: "صنف جديد" },
          { href: "/customers", icon: "person_add", label: "عميل جديد" },
          { href: "/reports", icon: "monitoring", label: "التقارير" },
        ].map((a) => (
          <Link key={a.href} href={a.href}
                className="flex items-center gap-1.5 rounded-xl border border-line bg-ink-2 px-3.5 py-2 text-[12.5px] font-bold text-text shadow-card transition-all duration-200 hover:-translate-y-px hover:border-petrol hover:text-petrol hover:shadow-md">
            <MIcon name={a.icon} className="!text-[17px]" /> {a.label}
          </Link>
        ))}
      </div>

      {/* ══════════ مركز الذكاء — في القاع ══════════ */}
      {canAi && (
        <div className="grid gap-3 lg:grid-cols-2">
          <Card className="space-y-2.5">
            <h2 className="flex items-center gap-1.5 text-[13.5px] font-black">
              <MIcon name="auto_awesome" className="!text-[19px] text-petrol" /> اسأل بياناتك
            </h2>
            <div className="flex gap-2">
              <Input value={aiQ} placeholder="مثال: أكتر 5 أصناف مبيعاً الشهر ده؟"
                     onChange={(e) => setAiQ(e.target.value)}
                     onKeyDown={(e) => e.key === "Enter" && askAi()} />
              <Button onClick={askAi} disabled={aiBusy}>{aiBusy ? "..." : "اسأل"}</Button>
            </div>
            <ErrorNote msg={aiErr} />
            {aiAns && (
              <div className="space-y-2">
                {aiAns.answer && <p className="rounded-xl bg-petrol-soft px-3 py-2.5 text-[13px] font-bold leading-relaxed">{aiAns.answer}</p>}
                {aiAns.rows.length > 0 && (
                  <div className="max-h-56 overflow-auto rounded-lg border border-line">
                    <table className="w-full text-[11.5px]">
                      <thead><tr className="bg-ink-3 text-text-dim">
                        {aiAns.columns.map((c) => <th key={c} className="px-2.5 py-1.5 text-right font-extrabold">{c}</th>)}
                      </tr></thead>
                      <tbody>
                        {aiAns.rows.map((r, i) => (
                          <tr key={i} className="border-t border-line/60">
                            {aiAns.columns.map((c) => <td key={c} className="tnum px-2.5 py-1.5">{String(r[c] ?? "—")}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </Card>
          <div className="space-y-3">
            <Card className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-[13.5px] font-black">
                  <MIcon name="wb_sunny" className="!text-[19px] text-brass" /> الملخص الصباحي
                </h2>
                <Button variant="ghost" className="!px-2 !py-1 !text-[10.5px]" disabled={briefBusy} onClick={refreshBrief}>
                  {briefBusy ? "..." : "تحديث"}
                </Button>
              </div>
              <p className="whitespace-pre-line text-[12.5px] leading-relaxed">{brief || "جارِ التحضير..."}</p>
            </Card>
            <Card className="space-y-2">
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-1.5 text-[13.5px] font-black">
                  <MIcon name="policy" className="!text-[19px] text-ember" /> كشف الشذوذ المالي
                </h2>
                <Button variant="ghost" className="!px-2 !py-1 !text-[10.5px]" disabled={anomBusy} onClick={runAnomalies}>
                  {anomBusy ? "جارِ الفحص..." : "افحص الآن"}
                </Button>
              </div>
              {anom && <p className="whitespace-pre-line text-[12.5px] leading-relaxed">{anom}</p>}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
