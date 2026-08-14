// components/m-icon.tsx — مكوّن الأيقونة الموحد (Material Symbols Rounded حصراً)
// الأحجام والألوان حسب دليل الهوية: 24px افتراضي، #64748B عادي، أبيض فوق الملون
export function MIcon({ name, className = "", filled = false }:
  { name: string; className?: string; filled?: boolean }) {
  return (
    <span aria-hidden
          className={`msr ${filled ? "msr-fill" : ""} ${className}`}>
      {name}
    </span>
  );
}
