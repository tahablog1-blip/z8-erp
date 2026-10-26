// components/PlateBadge.tsx — لوحة السيارة بشكل لوحة سعودية (أرقام | حروف): العلامة البصرية لعرض السيارات
/** لوحة السيارة — أرقام | حروف. تبقى بيضاء بنص داكن في الوضعين (زي اللوحة الحقيقية) */
export function PlateBadge({ plate, size = "md" }: { plate: string | null; size?: "sm" | "md" | "lg" }) {
  const raw = (plate || "").trim();
  const m = raw.match(/^(\d+)\s*([A-Za-z\u0600-\u06FF\s]+)$/);
  const text = size === "lg" ? "text-[22px] sm:text-[26px]" : size === "md" ? "text-[16px]" : "text-[14px]";
  const pad = size === "lg" ? "px-3 py-1" : "px-2 py-0.5";
  return (
    <span dir="ltr" role="img" aria-label={raw ? `لوحة ${raw}` : "بدون لوحة"}
      className="inline-flex shrink-0 items-stretch overflow-hidden rounded-md border-2 border-slate-800 bg-white text-slate-900 shadow-sm">
      <span className="w-2 bg-blue-700" aria-hidden />
      {m ? (
        <>
          <span className={`${pad} ${text} tnum font-black leading-tight tracking-wider`}>{m[1]}</span>
          <span className="w-px bg-slate-400" aria-hidden />
          <span className={`${pad} ${text} font-black uppercase leading-tight tracking-widest`}>{m[2].replace(/\s+/g, " ")}</span>
        </>
      ) : (
        <span className={`${pad} ${text} font-black leading-tight`}>{raw || "بدون لوحة"}</span>
      )}
    </span>
  );
}
