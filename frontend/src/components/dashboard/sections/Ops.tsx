"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { Executive } from "@/lib/dashboard/types";
import { fmtCurrency } from "@/lib/dashboard/format";
import { useDx } from "@/lib/dashboard/i18n";
import { MIcon } from "@/components/m-icon";

type Shift = { shift: { branch_name: string | null }; sales: { totalInc: number; invoiceCount: number } } | null;

/** شريط التشغيل اللحظي: طابور الخدمة + جلسة الكاشير الحالية */
export function OpsStrip({ data }: { data: Executive | null }) {
  const { d } = useDx();
  const { hasPerm } = useAuth();
  const canShift = hasPerm("shifts.manage_own");
  const [shift, setShift] = useState<Shift>(null);
  useEffect(() => { if (canShift) api<Shift>("/shifts/current").then((r) => setShift(r?.sales ? r : null)).catch(() => {}); }, [canShift]);
  const o = data?.ops;
  if (!o && !(canShift && shift)) return null;
  const cell = (label: string, v: number, icon: string, tone: string) => (
    <div className="flex items-center gap-2 rounded-card border border-line bg-ink-2 px-3 py-2">
      <span className={`grid h-8 w-8 place-items-center rounded-lg ${tone}`}><MIcon name={icon} className="!text-[18px]" /></span>
      <span><span className="tnum block text-t-lg font-black leading-none">{v}</span><span className="text-t-xs text-text-dim">{label}</span></span>
    </div>
  );
  return (
    <div className="flex flex-wrap items-stretch gap-2" aria-label={d("ops.title")}>
      {o && <>
        {cell(d("ops.queued"), o.queued, "hourglass_top", "bg-brass-bg text-brass")}
        {cell(d("ops.inService"), o.inService, "build", "bg-petrol-soft text-petrol")}
        {cell(d("ops.done"), o.doneToday, "task_alt", "bg-emerald-bg text-emerald")}
      </>}
      {canShift && shift && (
        <Link href="/sales" className="flex items-center gap-2 rounded-lg border border-emerald/30 bg-emerald-bg px-3 py-2 text-t-sm font-bold text-emerald">
          <MIcon name="schedule" className="!text-[18px]" />
          <span>{shift.shift.branch_name ?? ""} · <b className="tnum">{fmtCurrency(shift.sales.totalInc, 2)}</b> ({shift.sales.invoiceCount})</span>
        </Link>
      )}
    </div>
  );
}
