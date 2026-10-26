// lib/dashboard/periods.ts — فترات الفلتر الشامل (تواريخ محلية بصيغة YYYY-MM-DD)
export type PeriodKey = "today" | "week" | "month" | "prevMonth" | "quarter" | "year" | "custom";
export type Range = { from: string; to: string };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function rangeFor(key: Exclude<PeriodKey, "custom">, now = new Date()): Range {
  const y = now.getFullYear(), m = now.getMonth();
  switch (key) {
    case "today": return { from: iso(now), to: iso(now) };
    case "week": {                      // الأسبوع يبدأ السبت (السعودية)
      const d = new Date(now); d.setDate(d.getDate() - ((d.getDay() + 1) % 7));
      return { from: iso(d), to: iso(now) };
    }
    case "month": return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case "prevMonth": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case "quarter": return { from: iso(new Date(y, Math.floor(m / 3) * 3, 1)), to: iso(now) };
    case "year": return { from: iso(new Date(y, 0, 1)), to: iso(now) };
  }
}

export const PERIODS: { key: Exclude<PeriodKey, "custom">; ar: string; en: string }[] = [
  { key: "today", ar: "اليوم", en: "Today" },
  { key: "week", ar: "هذا الأسبوع", en: "This week" },
  { key: "month", ar: "هذا الشهر", en: "This month" },
  { key: "prevMonth", ar: "الشهر السابق", en: "Last month" },
  { key: "quarter", ar: "هذا الربع", en: "This quarter" },
  { key: "year", ar: "هذه السنة", en: "This year" },
];

/** يملأ الأيام الناقصة بصفر عشان الرسم الزمني متصل (الباك اند بيرجع بس الأيام اللي فيها حركة) */
export function fillDays<T extends { date: string }>(rows: T[], range: Range, zero: (date: string) => T): T[] {
  const map = new Map(rows.map((r) => [r.date, r]));
  const out: T[] = [];
  const d = new Date(range.from + "T00:00:00"); const end = new Date(range.to + "T00:00:00");
  for (let i = 0; d <= end && i < 800; i++, d.setDate(d.getDate() + 1)) {
    const k = iso(d); out.push(map.get(k) ?? zero(k));
  }
  return out;
}

/** تجميع الأيام: يومي لو ≤ 45 يوم، أسبوعي لو ≤ 200، وإلا شهري */
export function bucketize<T extends { date: string }>(rows: T[], sum: (a: T, b: T) => T): { rows: T[]; unit: "day" | "week" | "month" } {
  const n = rows.length;
  if (n <= 45) return { rows, unit: "day" };
  const unit = n <= 200 ? "week" : "month";
  const groups = new Map<string, T>();
  for (const r of rows) {
    const d = new Date(r.date + "T00:00:00");
    let key: string;
    if (unit === "week") { const w = new Date(d); w.setDate(w.getDate() - ((w.getDay() + 1) % 7)); key = iso(w); }
    else key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    const prev = groups.get(key);
    groups.set(key, prev ? sum(prev, { ...r, date: key }) : { ...r, date: key });
  }
  return { rows: [...groups.values()], unit };
}
