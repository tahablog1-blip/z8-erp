// lib/customers/format.ts — تنسيق موحّد (يبني على lib/dashboard/format و lib/format)
import { fmtCurrency, fmtMoney } from "@/lib/dashboard/format";
export { fmtCurrency, fmtMoney };

const iso = (s: string) => `⁦${s}⁩`;
const p2 = (n: number) => String(n).padStart(2, "0");
/** 26/10/2026 — تاريخ ميلادي ثابت الاتجاه */
export function fmtD(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s); if (isNaN(+d)) return "—";
  return iso(`${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()}`);
}
export function fmtDT(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s); if (isNaN(+d)) return "—";
  return iso(`${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}`);
}
export function ago(s: string | null | undefined, en = false): string {
  if (!s) return "—";
  const days = Math.floor((Date.now() - +new Date(s)) / 86400000);
  if (days <= 0) return en ? "Today" : "اليوم";
  if (days === 1) return en ? "Yesterday" : "أمس";
  if (days < 30) return en ? `${days} days ago` : `قبل ${days} يوم`;
  if (days < 365) return en ? `${Math.floor(days / 30)} mo ago` : `قبل ${Math.floor(days / 30)} شهر`;
  return en ? `${Math.floor(days / 365)} y ago` : `قبل ${Math.floor(days / 365)} سنة`;
}
export const initials = (name: string) => (name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("") || "؟").toUpperCase();

/** تنزيل CSV يفتحه Excel مباشرة (BOM + UTF-8) */
export function downloadCsv(filename: string, headers: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const body = [headers, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob(["﻿" + body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
