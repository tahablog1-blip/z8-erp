"use client";
// components/DataTable.tsx — الجدول الذكي الموحّد: مكوّن واحد لكل شاشات النظام
// (بحث فوري، حالات تحميل/فراغ، أعمدة معرّفة تصريحياً) — بدل تكرار كود الجداول 30 مرة
import { ReactNode, useEffect, useMemo, useState } from "react";

/** عدد الصفوف المرسومة في كل دفعة — الجداول الكبيرة (آلاف الأصناف) كانت بترسم كل الصفوف مرة واحدة وتبطّأ الموبايل */
const PAGE_SIZE = 100;

export type Column<T> = {
  key: string;
  title: ReactNode;   // نص عادي أو عنصر (مثال: چكبوكس "تحديد الكل" في هيدر عمود التحديد)
  render?: (row: T) => ReactNode;   // بدون render → عرض القيمة النصية للحقل
  width?: string;
};

export function DataTable<T extends Record<string, any>>({
  columns, rows, loading, searchKeys, searchPlaceholder = "بحث...",
  emptyText = "لا توجد بيانات بعد", toolbar,
  searchOutside = false,
  searchClassName,
  searchValue,
  onSearchChange,
  searchOnly = false,

}: {
  columns: Column<T>[];
  rows: T[];
  loading?: boolean;
  searchKeys?: (keyof T)[];
  searchPlaceholder?: string;
  emptyText?: string;
  toolbar?: ReactNode;
  searchOutside?: boolean;
  searchClassName?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  searchOnly?: boolean;
}) {
  const [internalQ, setInternalQ] = useState("");
  const q = searchValue ?? internalQ;
  const setQ = onSearchChange ?? setInternalQ;

  const filtered = useMemo(() => {
    if (!q.trim() || !searchKeys?.length) return rows;
    const needle = q.trim().toLowerCase();
    return rows.filter((r) =>
      searchKeys.some((k) => String(r[k] ?? "").toLowerCase().includes(needle)));
  }, [rows, q, searchKeys]);

  const [limit, setLimit] = useState(PAGE_SIZE);
  useEffect(() => { setLimit(PAGE_SIZE); }, [q, rows]);
  const shown = filtered.length > limit ? filtered.slice(0, limit) : filtered;

  const searchInput = searchKeys?.length ? (
    <input
      value={q}
      onChange={(e) => setQ(e.target.value)}
      placeholder={searchPlaceholder}
      className={`h-9 w-full min-w-0 rounded-lg border border-line bg-ink-2 px-3 text-t-sm transition-colors duration-150 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 ${searchClassName ?? ""}`}
    />
  ) : null;

  if (searchOnly) {
    return <div className="min-w-0">{searchInput}</div>;
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {!searchOutside ? (
          searchKeys?.length ? searchInput : <span />
        ) : null}

        {toolbar}
      </div>
      <div className="max-h-[65vh] overflow-auto rounded-card border border-line bg-ink-2 shadow-card">
        <table className="w-full border-collapse text-t-sm">
          <thead className="sticky top-0 z-10">
            <tr className="bg-ink-3 text-text-dim">
              {columns.map((c) => (
                <th key={c.key} style={{ width: c.width }}
                  className="whitespace-nowrap bg-ink-3 px-3 py-2.5 text-start text-t-xs font-extrabold">
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
            ) : shown.map((row, i) => (
              <tr key={row.id ?? i} className="border-t border-line transition-colors duration-150 hover:bg-ink-3/50">
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
      {filtered.length > shown.length && (
        <div className="mt-3 flex items-center justify-center gap-3 text-t-sm text-text-dim">
          <span className="tnum">عرض {shown.length} من {filtered.length}</span>
          <button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)}
            className="rounded-lg border border-line bg-ink-2 px-3 py-1.5 font-bold text-petrol transition hover:border-petrol">
            عرض المزيد
          </button>
        </div>
      )}
    </div>
  );
}
