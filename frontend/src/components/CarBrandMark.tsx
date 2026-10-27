"use client";
// components/CarBrandMark.tsx — لوجو الشركة المصنّعة + الموديل بخط صغير (بديل اسم الماركة النصي).
// اللوجو داخل مربع أبيض عشان يبان في الوضعين (كتير من اللوجوهات داكنة بخلفية شفافة).
// لو الماركة مالهاش لوجو: نعرض اسمها نصاً بنفس الشكل، فمفيش معلومة بتضيع.
import { useState } from "react";
import { brandLogoSrc } from "@/lib/carBrands";

export function CarBrandMark({ brand, model, year, size = "md", className = "" }: {
  brand: string | null | undefined; model?: string | null; year?: string | null;
  size?: "sm" | "md" | "lg"; className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const src = brandLogoSrc(brand);
  const tile = size === "lg" ? "h-10 w-10" : size === "md" ? "h-8 w-8" : "h-6 w-6";
  const sub = [model, year].filter(Boolean).join(" ");
  if (!brand && !sub) return null;
  return (
    <span className={`inline-flex min-w-0 items-center gap-2 ${className}`}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={brand || ""} title={brand || undefined} loading="lazy" onError={() => setBroken(true)}
          className={`${tile} shrink-0 rounded-lg border border-line bg-ink-2 object-contain p-1`} />
      ) : brand ? (
        <span className="shrink-0 rounded-md bg-ink-3 px-2 py-0.5 text-t-sm font-bold text-text-dim">{brand}</span>
      ) : null}
      {sub && <span className={`truncate ${size === "lg" ? "text-t-lg font-extrabold text-text" : "text-t-sm text-text-dim"}`}>{sub}</span>}
    </span>
  );
}
