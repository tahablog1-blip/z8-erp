"use client";
// components/ui.tsx — لبنات الواجهة الأساسية بهوية Z8 (بترولي/عنبري، نهاري أولاً)
import {
  ReactNode, InputHTMLAttributes, ButtonHTMLAttributes,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from "react";

export function Button({ variant = "primary", className = "", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  // Material 3: شكل stadium + طبقة حالة بدل القفزات + تموّج لمس
  const base = "m3 inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-bold transition-shadow duration-200 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";
  const styles = {
    primary: "bg-petrol text-white elev-1 hover:elev-2",
    ghost:   "border border-line bg-ink-2 text-petrol hover:border-petrol",
    danger:  "border border-ember/40 bg-ember-bg text-ember hover:bg-ember hover:text-white",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...props} />;
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

/** شارة حالة صغيرة — نفس ألوان الحالات في كل الجداول */
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

/** تبويبات داخل الشاشة — شاشة المخزون بتفصل أقسامها بيها بدل صفحات منفصلة */
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

export function Modal({ open, title, children, onClose, size = "md" }:
  { open: boolean; title: string; children: ReactNode; onClose: () => void; size?: "md" | "lg" }) {
  if (!open) return null;
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
