"use client";
// components/ui.tsx — لبنات الواجهة الأساسية بهوية Z8
import {
  ReactNode, InputHTMLAttributes, ButtonHTMLAttributes,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from "react";

export function Button({ variant = "primary", size = "md", className = "", loading = false, disabled, children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "tool";
    size?: "lg" | "md" | "sm" | "xs";
    loading?: boolean;
  }) {
  const base = "m3 inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";
  const sizes = {
    lg: "px-5 py-2.5 text-[14px]",
    md: "px-4 py-2 text-[13px]",
    sm: "px-3 py-1.5 text-[12px]",
    xs: "px-2 py-1 text-[11px]",
  }[size];
  const styles = {
    primary:   "bg-petrol text-white hover:brightness-110",
    secondary: "bg-petrol-soft text-petrol hover:brightness-95",
    outline:   "border border-line bg-ink-2 text-text hover:border-petrol hover:text-petrol",
    ghost:     "border border-line bg-ink-2 text-petrol hover:border-petrol",
    danger:    "border border-ember/30 bg-ember-bg text-ember hover:bg-ember hover:text-white",
    success:   "border border-emerald/30 bg-emerald-bg text-emerald hover:bg-emerald hover:text-white",
    tool:      "border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol",
  }[variant];
  return (
    <button className={`${base} ${sizes} ${styles} ${className}`} disabled={disabled || loading} {...props}>
      {loading && (
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" aria-hidden />
      )}
      {children}
    </button>
  );
}

export function IconButton({ className = "", size = "md", label, children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { size?: "md" | "sm"; label: string }) {
  const dim = size === "sm" ? "h-8 w-8" : "h-9 w-9";
  return (
    <button aria-label={label} title={label}
            className={`m3 grid ${dim} shrink-0 place-items-center rounded-lg border border-line bg-ink-2 text-text-dim transition-colors duration-150 hover:border-petrol hover:text-petrol disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol ${className}`}
            {...props}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-bold text-text-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-text-dim">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-xl border border-line bg-ink-2 px-3.5 py-2.5 text-[13px] transition-all duration-200 text-text placeholder:text-text-dim/60 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 disabled:bg-ink-3 disabled:text-text-dim ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`w-full rounded-xl border border-line bg-ink-2 px-3.5 py-2.5 text-[13px] transition-all duration-200 text-text focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 disabled:bg-ink-3 disabled:text-text-dim ${className}`}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={2}
      className={`w-full rounded-xl border border-line bg-ink-2 px-3.5 py-2.5 text-[13px] transition-all duration-200 text-text placeholder:text-text-dim/60 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-line bg-ink-2 p-5 shadow-card transition-shadow duration-200 ${className}`}>{children}</div>;
}

export function Badge({ tone = "neutral", children }:
  { tone?: "neutral" | "good" | "warn" | "info"; children: ReactNode }) {
  const styles = {
    neutral: "bg-ink-3 text-text-dim",
    good:    "bg-emerald-bg text-emerald",
    warn:    "bg-ember-bg text-ember",
    info:    "bg-brass-soft text-brass",
  }[tone];
  return <span className={`inline-block rounded-full px-2.5 py-1 text-[11px] font-bold ${styles}`}>{children}</span>;
}

export function Tabs<T extends string>({ value, onChange, items }:
  { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="flex gap-1 border-b border-line" role="tablist">
      {items.map((t) => (
        <button
          key={t.key} role="tab" aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px border-b-2 px-4 py-2 text-[13px] font-bold transition
            ${value === t.key
              ? "border-petrol text-petrol"
              : "border-transparent text-text-dim hover:text-text"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

import FullScreenModal from "@/components/FullScreenModal";

export function Modal({ open, title, children, onClose, size = "md" }:
  { open: boolean; title: string; children: ReactNode; onClose: () => void; size?: "md" | "lg" | "full" }) {
  if (!open) return null;
  if (size === "full") return <FullScreenModal title={title} onClose={onClose}>{children}</FullScreenModal>;
  const width = size === "lg" ? "max-w-3xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[3px]" onClick={onClose}>
      <div className={`z8-pop w-full ${width} max-h-[90vh] overflow-y-auto rounded-[28px] border border-line bg-ink-2 p-6 shadow-panel`}
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-[15px] font-extrabold text-text">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق"
                  className="grid h-8 w-8 place-items-center rounded-full text-text-dim transition-all duration-200 hover:rotate-90 hover:bg-ink-3 hover:text-text">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div className="rounded-lg border border-ember/30 bg-ember-bg px-3 py-2 text-[12.5px] font-semibold text-ember">{msg}</div>;
}

import { MIcon } from "@/components/m-icon";

/** حالة فراغ موحدة — أيقونة + عنوان + وصف قصير + إجراء اختياري */
export function EmptyState({ icon = "inbox", title, description, action }:
  { icon?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-3 text-text-dim">
        <MIcon name={icon} className="!text-[26px]" />
      </span>
      <div className="text-[13.5px] font-extrabold text-text">{title}</div>
      {description && <div className="max-w-xs text-[12.5px] leading-relaxed text-text-dim">{description}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** تلميح يظهر عند التحويم — يُستخدم بشكل أساسي في القضيب الجانبي عند الانكماش */
export function Tooltip({ label, children, side = "end" }:
  { label: string; children: ReactNode; side?: "end" | "bottom" }) {
  const pos = side === "end"
    ? "right-full top-1/2 -translate-y-1/2 mr-2"
    : "top-full left-1/2 -translate-x-1/2 mt-2";
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip"
            className={`pointer-events-none absolute z-[90] whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-[11px] font-bold text-white opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${pos}`}>
        {label}
      </span>
    </span>
  );
}

/** شريط فتات الخبز (Breadcrumb) — يستخدم فوق عنوان الصفحة في الهيدر */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-[11.5px] text-text-dim">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="opacity-50">/</span>}
          <span className={i === items.length - 1 ? "font-bold text-text" : ""}>{it.label}</span>
        </span>
      ))}
    </nav>
  );
}