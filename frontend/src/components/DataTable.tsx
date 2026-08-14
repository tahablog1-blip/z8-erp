"use client";
// components/DataTable.tsx — الجدول الذكي الموحّد: مكوّن واحد لكل شاشات النظام
// (بحث فوري، حالات تحميل/فراغ، أعمدة معرّفة تصريحياً) — بدل تكرار كود الجداول 30 مرة
import { ReactNode, useMemo, useState } from "react";

export type Column<T> = {
  key: string;
  title: string;
  render?: (row: T) => ReactNode;   // بدون render → عرض القيمة النصية للحقل
  width?: string;
};

export function DataTable<T extends Record<string, any>>({
  columns, rows, loading, searchKeys, searchPlaceholder = "بحث...",
  emptyText = "لا توجد بيانات بعد", toolbar,
}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  searchKeys?: (keyof T)[];
  searchPlaceholder?: string;
  emptyText?: string;
  toolbar?: ReactNode;
}) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    if (!q.trim() || !searchKeys?.length) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)));
  }, [rows, q, searchKeys]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {searchKeys?.length ? (
          <input
            value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder}
            className="w-64 max-w-full rounded-xl border border-line bg-ink-2 px-3.5 py-2.5 text-[12.5px] transition-all duration-200 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15"
          />
        ) : <span />}
        {toolbar}
      </div>

      <div className="max-h-[65vh] overflow-auto rounded-card border border-line bg-ink-2 shadow-card">
        <table className="w-full border-collapse text-[13px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-ink-3 text-text-dim">
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}
                    className="whitespace-nowrap px-3 py-2.5 text-right text-[12px] font-extrabold">
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [1, 2, 3].map((sk) => (
                <tr key={sk} className="border-t border-line/70">
                  {columns.map((c) => (
                    <td key={c.key} className="px-3 py-3.5"><div className="h-3.5 animate-pulse rounded-full bg-ink-4/70" /></td>
                  ))}
                </tr>
              ))
            ) : filtered.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-text-dim">
                {q ? "لا توجد نتائج مطابقة للبحث" : emptyText}
              </td></tr>
            ) : filtered.map((row, i) => (
              <tr key={row.id ?? i} className="border-t border-line/70 odd:bg-ink-3/25 transition-colors duration-150 hover:bg-petrol-soft/40">
                {columns.map((c) => (
                  <td key={c.key} className="px-3 py-2.5 align-middle">
                    {c.render ? c.render(row) : String(row[c.key] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
