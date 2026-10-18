"use client";
// عرض الأصناف ككروت (Odoo-style) — كل كارت يفتح صفحة الصنف
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MIcon } from "@/components/m-icon";
import { Product, money } from "@/modules/products/types";

const PAGE_SIZE = 80;

export default function ProductCards({ rows, search, loading }: {
  rows: Product[]; search: string; loading?: boolean;
}) {
  const [page, setPage] = useState(0);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((p) =>
      [p.name, p.category, p.spec, p.barcode].some((v) => (v || "").toLowerCase().includes(q)),
    );
  }, [rows, search]);

  useEffect(() => { setPage(0); }, [search, rows.length]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  const cur = Math.min(page, pages - 1);
  const slice = list.slice(cur * PAGE_SIZE, (cur + 1) * PAGE_SIZE);
  const from = list.length === 0 ? 0 : cur * PAGE_SIZE + 1;
  const to = Math.min((cur + 1) * PAGE_SIZE, list.length);

  const pagerBtn =
    "rounded-lg border border-line bg-ink-2 px-3 py-1.5 font-bold text-text transition hover:border-petrol hover:text-petrol disabled:opacity-40";

  const pager = (
    <div className="flex items-center justify-between text-[12px]">
      <span className="tnum text-text-dim">{from}-{to} / {list.length}</span>
      <div className="flex gap-2">
        <button type="button" disabled={cur === 0} onClick={() => setPage(cur - 1)}
          className={pagerBtn}>السابق</button>
        <span className="self-center tnum text-text-dim">{cur + 1} / {pages}</span>
        <button type="button" disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}
          className={pagerBtn}>التالي</button>
      </div>
    </div>
  );

  if (loading) return <p className="p-6 text-center text-[13px] text-text-dim">جارِ التحميل...</p>;
  if (list.length === 0) return <p className="p-6 text-center text-[13px] text-text-dim">لا توجد أصناف مطابقة.</p>;
  return (
    <div className="space-y-3">
      {pager}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {slice.map((p) => {
          const stock = Number(p.stock_qty ?? 0);
          const low = stock < 0 || ((p.min_qty || 0) > 0 && stock <= p.min_qty);
          return (
            <Link key={p.id} href={`/products/${p.id}`}
              className="flex gap-3 rounded-2xl border border-line bg-ink-2 p-3 text-text shadow-card transition hover:border-petrol hover:shadow-md">
              <div className="flex h-[76px] w-[76px] shrink-0 items-center justify-center overflow-hidden rounded-xl bg-ink-3">
                {p.has_image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/products/public/product-image/${p.id}`} alt="" loading="lazy"
                    className="h-full w-full object-cover" />
                ) : (
                  <MIcon name="inventory_2" className="!text-[30px] text-text-dim" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[13px] font-extrabold leading-snug">
                  {p.name}{p.spec ? ` — ${p.spec}` : ""}
                </div>
                {p.barcode && (
                  <div dir="ltr" className="mt-0.5 truncate text-right font-mono text-[11px] text-text-dim">[{p.barcode}]</div>
                )}
                <div className="mt-1 text-[12px]">السعر: <b className="tnum">{money(p.price_vat)}</b> ر.س</div>
                {p.is_service ? (
                  <div className="text-[12px] text-text-dim">خدمة</div>
                ) : (
                  <div className={`text-[12px] ${low ? "font-bold text-ember" : "text-text-dim"}`}>
                    المخزون (الفروع): <span className="tnum">{stock}</span>
                  </div>
                )}
              </div>
            </Link>
          );
        })}
      </div>
      {pager}
    </div>
  );
}
