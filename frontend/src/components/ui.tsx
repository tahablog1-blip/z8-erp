"use client";
// components/ui.tsx — لبنات الواجهة الأساسية بهوية Z8
import {
  useEffect, ReactNode, InputHTMLAttributes, ButtonHTMLAttributes,
  SelectHTMLAttributes, TextareaHTMLAttributes,
} from "react";

export function Button({ variant = "primary", size = "md", className = "", loading = false, disabled, children, ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "success" | "tool";
    size?: "lg" | "md" | "sm" | "xs";
    loading?: boolean;
  }) {
  const base = "m3 z8-anim-btn inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-semibold transition-colors duration-150 disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol";
  const sizes = {
    lg: "h-10 px-5 text-t-md",
    md: "h-9 px-4 text-t-sm",
    sm: "h-8 px-3 text-t-sm",
    xs: "h-7 px-2.5 text-t-xs",
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
            className={`m3 z8-anim-btn grid ${dim} shrink-0 place-items-center rounded-lg border border-line bg-ink-2 text-text-dim transition-colors duration-150 hover:border-petrol hover:text-petrol disabled:opacity-45 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol ${className}`}
            {...props}>
      {children}
    </button>
  );
}

/** سويتش بستايل أندرويد — بديل موحّد لكل أزرار التفعيل/الإلغاء (checkbox) في النظام.
 *  دائرة منزلقة داخل مسار، تتوافق تلقائياً مع اتجاه الصفحة (RTL/LTR) عبر inset-inline-start. */
export function Switch({ checked, onChange, disabled = false, size = "md", tone = "petrol", label }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: "md" | "sm";
  tone?: "petrol" | "ember" | "emerald";
  label?: string;
}) {
  const dims = size === "sm"
    ? { track: "h-[18px] w-8", thumb: "h-3.5 w-3.5", on: "calc(100% - 16px)" }
    : { track: "h-[22px] w-10", thumb: "h-[18px] w-[18px]", on: "calc(100% - 20px)" };
  const onBg = { petrol: "bg-petrol", ember: "bg-ember", emerald: "bg-emerald" }[tone];
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={`m3 relative shrink-0 rounded-full border transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-petrol ${dims.track} ${checked ? `${onBg} border-transparent` : "border-line bg-ink-4"}`}>
      <span aria-hidden
        className={`absolute top-1/2 -translate-y-1/2 rounded-full bg-ink-2 shadow-sm transition-[inset-inline-start] duration-200 ease-out ${dims.thumb}`}
        style={{ insetInlineStart: checked ? dims.on : "2px" }} />
    </button>
  );
}

/** صف إعداد جاهز: عنوان + وصف اختياري + سويتش — يغطي أغلب حالات «تفعيل/إلغاء» في صفحات الإعدادات */
export function ToggleRow({ title, hint, checked, onChange, tone, disabled }: {
  title: string; hint?: string; checked: boolean; onChange: (checked: boolean) => void;
  tone?: "petrol" | "ember" | "emerald"; disabled?: boolean;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <div>
        <div className="text-t-md font-bold">{title}</div>
        {hint && <div className="text-t-xs text-text-dim">{hint}</div>}
      </div>
      <Switch checked={checked} onChange={onChange} tone={tone} disabled={disabled} label={title} />
    </label>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-t-sm font-bold text-text-dim">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-t-xs text-text-dim">{hint}</span>}
    </label>
  );
}

export function Input({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement> & { ref?: React.Ref<HTMLInputElement> }) {
  return (
    <input
      className={`h-9 w-full rounded-lg border border-line bg-ink-2 px-3 text-t-sm text-text transition-colors duration-150 placeholder:text-text-dim/60 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 disabled:bg-ink-3 disabled:text-text-dim ${className}`}
      {...props}
    />
  );
}

export function Select({ className = "", children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={`h-9 w-full rounded-lg border border-line bg-ink-2 px-3 text-t-sm text-text transition-colors duration-150 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 disabled:bg-ink-3 disabled:text-text-dim ${className}`}
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
      className={`w-full rounded-card border border-line bg-ink-2 px-3.5 py-2.5 text-t-md transition-all duration-200 text-text placeholder:text-text-dim/60 focus:border-petrol focus:outline-none focus:ring-2 focus:ring-petrol/15 ${className}`}
      {...props}
    />
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`rounded-card border border-line bg-ink-2 p-5 shadow-card transition-shadow duration-200 ${className}`}>{children}</div>;
}

export type Tone = "success" | "warning" | "danger" | "info" | "neutral";
const TONE_CLASS: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger:  "bg-danger-soft text-danger",
  info:    "bg-info-soft text-info",
  neutral: "bg-ink-3 text-text-dim",
};
/** أسماء قديمة (good/warn) تبقى مدعومة: good = success · warn = danger (كانت حمراء في النظام) */
const LEGACY: Record<string, Tone> = { good: "success", warn: "danger" };

/** شارة حالة موحّدة لكل النظام — نفس الشكل والألوان الدلالية في كل صفحة */
export function Badge({ tone = "neutral", dot = false, className = "", children }:
  { tone?: Tone | "good" | "warn"; dot?: boolean; className?: string; children: ReactNode }) {
  const t = (LEGACY[tone] ?? tone) as Tone;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-t-xs font-bold ${TONE_CLASS[t]} ${className}`}>
      {dot && <i aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  );
}
export { Badge as StatusBadge };

/** شبكة الصفحة: 12 عموداً ≥1024px، 8 ≥768px، 4 على الجوال. المسافة ثابتة gap-4 (16px). */
export function Grid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`grid grid-cols-4 gap-4 md:grid-cols-8 lg:grid-cols-12 ${className}`}>{children}</div>;
}
const COL_LG: Record<number, string> = { 3: "lg:col-span-3", 4: "lg:col-span-4", 6: "lg:col-span-6", 8: "lg:col-span-8", 9: "lg:col-span-9", 12: "lg:col-span-12" };
const COL_MD: Record<number, string> = { 4: "md:col-span-4", 8: "md:col-span-8" };
/** span = عدد الأعمدة على الشاشة الكبيرة (3/4/6/8/9/12)؛ md = 4 (نصف) أو 8 (كامل) على التابلت؛ الجوال دائماً عرض كامل. */
export function Col({ span = 12, md = 8, children, className = "" }:
  { span?: 3 | 4 | 6 | 8 | 9 | 12; md?: 4 | 8; children: ReactNode; className?: string }) {
  return <div className={`col-span-4 min-w-0 ${COL_MD[md]} ${COL_LG[span]} ${className}`}>{children}</div>;
}

/** ترويسة صفحة موحّدة: عنوان + وصف + إجراءات (الأساسي أولاً) */
export function PageHeader({ title, description, actions, breadcrumb }:
  { title: ReactNode; description?: ReactNode; actions?: ReactNode; breadcrumb?: ReactNode }) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        {breadcrumb}
        <h1 className="page-title page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export function Tabs<T extends string>({ value, onChange, items }:
  { value: T; onChange: (v: T) => void; items: { key: T; label: string }[] }) {
  return (
    <div className="no-scrollbar flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {items.map((t) => (
        <button
          key={t.key} role="tab" aria-selected={value === t.key}
          onClick={() => onChange(t.key)}
          className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-4 py-2 text-t-md font-bold transition
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
  useEffect(() => {
    if (!open || size === "full") return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, size, onClose]);
  if (!open) return null;
  if (size === "full") return <FullScreenModal title={title} onClose={onClose}>{children}</FullScreenModal>;
  const width = size === "lg" ? "max-w-3xl" : "max-w-md";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title}
           className={`z8-pop w-full ${width} max-h-[90vh] overflow-y-auto rounded-card border border-line bg-ink-2 p-4 shadow-panel sm:p-6`}
           onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="card-title">{title}</h3>
          <button onClick={onClose} aria-label="إغلاق"
                  className="grid h-8 w-8 place-items-center rounded-lg text-text-dim transition-colors duration-150 hover:bg-ink-3 hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-petrol">
            <MIcon name="close" className="!text-[18px]" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ErrorNote({ msg }: { msg: string }) {
  if (!msg) return null;
  return <div role="alert" className="rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-t-sm font-semibold text-danger">{msg}</div>;
}

import { MIcon } from "@/components/m-icon";

/** حالة فراغ موحدة — أيقونة + عنوان + وصف قصير + إجراء اختياري */
export function EmptyState({ icon = "inbox", title, description, action }:
  { icon?: string; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="grid h-12 w-12 place-items-center rounded-card bg-ink-3 text-text-dim">
        <MIcon name={icon} className="!text-[26px]" />
      </span>
      <div className="text-t-md font-extrabold text-text">{title}</div>
      {description && <div className="max-w-xs text-t-sm leading-relaxed text-text-dim">{description}</div>}
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
            className={`pointer-events-none absolute z-[90] whitespace-nowrap rounded-md bg-text px-2 py-1 text-t-xs font-bold text-ink-2 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 ${pos}`}>
        {label}
      </span>
    </span>
  );
}

/** شريط فتات الخبز (Breadcrumb) — يستخدم فوق عنوان الصفحة في الهيدر */
export function Breadcrumb({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="breadcrumb" className="flex items-center gap-1.5 text-t-xs text-text-dim">
      {items.map((it, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="opacity-50">/</span>}
          <span className={i === items.length - 1 ? "font-bold text-text" : ""}>{it.label}</span>
        </span>
      ))}
    </nav>
  );
}