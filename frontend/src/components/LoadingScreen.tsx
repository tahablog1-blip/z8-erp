"use client";
// شاشة تحميل فاخرة: شعار الشركة في المنتصف بحلقة ذهبية دوّارة + نبض هادئ —
// بديل نص "جارِ التحميل..." العادي، لصفحات التحميل الكاملة (مش العناصر الصغيرة
// جوا صفحة أصلاً ظاهرة، زي صف في جدول أو قائمة منسدلة — تلك تفضل نص بسيط).
import { getCompany } from "@/lib/company";

export function LoadingScreen({ label, compact = false }: { label?: string; compact?: boolean }) {
  const logoUrl = getCompany().logoUrl || "/logo-navy.png";
  const size = compact ? 64 : 96;
  const ring = size + 26;

  return (
    <div className={`flex flex-col items-center justify-center gap-5 ${compact ? "py-10" : "min-h-[58vh] py-16"}`}>
      <div className="relative flex items-center justify-center" style={{ width: ring + 10, height: ring + 10 }}>
        {/* توهج خلفي ناعم */}
        <span
          className="z8-loader-glow absolute rounded-full"
          style={{ width: ring + 30, height: ring + 30, background: "radial-gradient(circle, var(--brass-soft) 0%, transparent 72%)" }}
        />
        {/* حلقة ذهبية دوّارة */}
        <span
          className="z8-loader-ring absolute rounded-full"
          style={{
            width: ring, height: ring,
            background: "conic-gradient(from 0deg, transparent 0%, var(--brass) 20%, transparent 40%, transparent 100%)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px))",
          }}
        />
        {/* صفيحة محايدة تحت الشعار — تضمن وضوحه أيًا كان لونه أو وضع الواجهة (نهاري/ليلي) */}
        <div
          className="z8-loader-breathe relative flex items-center justify-center rounded-full shadow-lg"
          style={{ width: size, height: size, background: "#fff", border: "1px solid var(--line)" }}
        >
          <img src={logoUrl} alt="" className="object-contain" style={{ width: size * 0.6, height: size * 0.6 }} />
        </div>
      </div>
      <div className="flex items-center gap-2">
        <p className="text-[13px] font-bold" style={{ color: "var(--text-dim)" }}>{label || "جارِ التحميل"}</p>
        <span className="flex gap-1">
          <span className="z8-loader-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--brass)", animationDelay: "0ms" }} />
          <span className="z8-loader-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--brass)", animationDelay: "160ms" }} />
          <span className="z8-loader-dot h-1.5 w-1.5 rounded-full" style={{ background: "var(--brass)", animationDelay: "320ms" }} />
        </span>
      </div>
    </div>
  );
}
