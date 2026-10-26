"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { MIcon } from "@/components/m-icon";
import { useDx } from "@/lib/dashboard/i18n";

export function Skeleton({ className = "", height }: { className?: string; height?: number }) {
  return <div className={`dash-skeleton rounded-md ${className}`} style={height ? { height } : undefined} aria-hidden />;
}

export function SectionError({ onRetry }: { onRetry?: () => void }) {
  const { d } = useDx();
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-8 text-center text-t-sm text-text-dim">
      <MIcon name="error" className="!text-[26px] text-ember" />
      <span>{d("sectionFail")}</span>
      {onRetry && <button onClick={onRetry} className="rounded-md border border-line px-3 py-1 text-t-xs font-bold text-petrol hover:border-petrol">{d("retry")}</button>}
    </div>
  );
}

export function SectionEmpty({ icon = "insights", title, hint }: { icon?: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 py-8 text-center">
      <MIcon name={icon} className="!text-[28px] text-text-dim/60" />
      <div className="text-t-sm font-bold">{title}</div>
      {hint && <div className="max-w-xs text-t-xs text-text-dim">{hint}</div>}
    </div>
  );
}

/** غلاف موحّد لكل أقسام اللوحة: عنوان + إجراء + حالات التحميل/الخطأ/الفراغ */
export function Widget({ title, icon, href, hrefLabel, actions, loading, failed, onRetry, className = "", bodyClassName = "", skeletonHeight = 180, children }: {
  title: string; icon?: string; href?: string; hrefLabel?: string; actions?: ReactNode;
  loading?: boolean; failed?: boolean; onRetry?: () => void;
  className?: string; bodyClassName?: string; skeletonHeight?: number; children?: ReactNode;
}) {
  const { d } = useDx();
  return (
    <section className={`flex min-w-0 flex-col rounded-card border border-line bg-ink-2 shadow-card ${className}`} aria-busy={loading || undefined}>
      <header className="flex items-center justify-between gap-2 px-4 pb-1 pt-3.5 sm:px-5">
        <h2 className="flex min-w-0 items-center gap-1.5 text-t-md font-black">
          {icon && <MIcon name={icon} className="!text-[19px] text-petrol" />}
          <span className="truncate">{title}</span>
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          {href && (
            <Link href={href} className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-t-xs font-bold text-petrol hover:bg-petrol-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">
              {hrefLabel ?? d("viewAll")} <MIcon name="chevron_left" className="!text-[16px] ltr:rotate-180" />
            </Link>
          )}
        </div>
      </header>
      <div className={`min-w-0 flex-1 px-4 pb-4 pt-2 sm:px-5 ${bodyClassName}`}>
        {loading ? <Skeleton className="w-full" height={skeletonHeight} /> : failed ? <SectionError onRetry={onRetry} /> : children}
      </div>
    </section>
  );
}
