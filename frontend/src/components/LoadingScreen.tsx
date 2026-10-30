"use client";
// شاشة تحميل فاخرة بحواف حادة: صفيحة الشعار في المنتصف تحيط بها أقواس ذهبية نابضة في الزوايا
// ولمعة ناعمة تمرّ على الصفيحة، وتحتها شريط تقدّم ذهبي رفيع — لصفحات التحميل الكاملة
// (أما العناصر الصغيرة داخل صفحة ظاهرة، كصف جدول أو قائمة منسدلة، فتبقى بنص بسيط).
import { getCompany } from "@/lib/company";

export function LoadingScreen({ label, compact = false }: { label?: string; compact?: boolean }) {
  const logoUrl = getCompany().logoUrl || "/logo-navy.png";
  const size = compact ? 72 : 104;
  const frame = size + 28;

  return (
    <div role="status" aria-live="polite"
         className={`flex flex-col items-center justify-center gap-6 ${compact ? "py-10" : "min-h-[58vh] py-16"}`}>
      <div className="relative" style={{ width: frame, height: frame }}>
        <span className="z8-ld-corner z8-ld-corner--tl" />
        <span className="z8-ld-corner z8-ld-corner--tr" />
        <span className="z8-ld-corner z8-ld-corner--bl" />
        <span className="z8-ld-corner z8-ld-corner--br" />
        <div className="z8-ld-plate absolute flex items-center justify-center"
             style={{ width: size, height: size, top: (frame - size) / 2, insetInlineStart: (frame - size) / 2 }}>
          <img src={logoUrl} alt="" className="z8-ld-logo object-contain" style={{ width: size * 0.6, height: size * 0.6 }} />
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <div className="z8-ld-track" aria-hidden><span className="z8-ld-bar" /></div>
        <p className="text-t-sm font-bold tracking-wide" style={{ color: "var(--text-dim)" }}>{label || "جارِ التحميل"}</p>
      </div>
    </div>
  );
}
