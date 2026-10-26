// components/PlateBadge.tsx — لوحة السيارة السعودية: صورة اللوحة (شعار المملكة + شريط KSA) والرقم والحروف فوقها.
// الأرقام يسار الشعار والحروف يمينه (نفس ترتيب اللوحة الحقيقية). الصورة في public/plate-ksa.png (186×43، مكبّرة 4×).
const RATIO = 186 / 43;          // نسبة أبعاد صورة اللوحة
const SIZES = { sm: 112, md: 140, lg: 216 } as const;   // العرض بالبكسل

/** لوحة السيارة — تبقى بيضاء بنص داكن في الوضعين (زي اللوحة الحقيقية) */
export function PlateBadge({ plate, size = "md" }: { plate: string | null; size?: "sm" | "md" | "lg" }) {
  const raw = (plate || "").trim();
  // أرقام وحروف بأي ترتيب/حالة ("111 AAA" أو "aaa 111" أو "١١١ ااا") — لا يتداخل النص مع شعار اللوحة أبداً
  const digits = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/\D/g, "");
  const letters = raw.replace(/[0-9٠-٩\-_.]/g, "").replace(/\s+/g, " ").trim().toUpperCase();
  const m = digits && letters ? [raw, digits, letters] : null;
  const width = SIZES[size];
  const height = width / RATIO;
  const font = Math.round(height * 0.56);     // حجم الخط نسبةً لارتفاع اللوحة
  const zone = "absolute inset-y-0 flex items-center justify-center font-black leading-none text-slate-900";
  return (
    <span dir="ltr" role="img" aria-label={raw ? `لوحة ${raw}` : "بدون لوحة"}
      className="relative inline-block shrink-0 select-none align-middle"
      style={{ width, height, fontSize: font }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/plate-ksa.png" alt="" draggable={false} className="absolute inset-0 h-full w-full" />
      {m ? (
        <>
          <span className={`${zone} tnum tracking-wider`} style={{ left: "6%", width: "36%" }}>{m[1]}</span>
          <span className={`${zone} uppercase tracking-widest`} style={{ left: "57%", width: "34%" }}>{m[2].replace(/\s+/g, " ")}</span>
        </>
      ) : raw ? (
        <span className={`${zone} px-[6%]`} style={{ left: 0, width: "92%", fontSize: font * 0.8 }}>{raw}</span>
      ) : null}
    </span>
  );
}
