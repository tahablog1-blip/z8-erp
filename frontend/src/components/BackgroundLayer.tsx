"use client";
// components/BackgroundLayer.tsx — خلفية موحدة ثابتة خلف كل صفحات التطبيق
// بلا خلفية فعّالة = لا يُرسم شيء خالص (صفر أثر بصري/أداء على أي شركة ما فعّلتش الميزة)
import { useEffect, useState } from "react";
import { getBackground, onBackgroundUpdate, type BackgroundInfo } from "@/lib/background";

export function BackgroundLayer() {
  const [bg, setBg] = useState<BackgroundInfo>(getBackground());
  useEffect(() => onBackgroundUpdate(() => setBg(getBackground())), []);

  if (!bg.activeImageUrl) return null;

  const fitStyle: React.CSSProperties =
    bg.fit === "contain" ? { backgroundSize: "contain", backgroundRepeat: "no-repeat" }
    : bg.fit === "repeat" ? { backgroundSize: "auto", backgroundRepeat: "repeat" }
    : { backgroundSize: "cover", backgroundRepeat: "no-repeat" };

  return (
    // z-index سالب إلزامي: أي عنصر position:fixed بدون z سالب بيطلع فوق أي عنصر
    // static عادي في ترتيب الرسم (حتى لو z-index:0) — هنا كل القضيب الجانبي والهيدر
    // واللوحة الرئيسية عناصر static، فلازم الخلفية ترسم في طبقة أعمق منهم صراحةً.
    <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none" aria-hidden>
      <div
        className="absolute inset-0 bg-center"
        style={{
          backgroundImage: `url(${bg.activeImageUrl})`,
          backgroundPosition: "center",
          filter: bg.blur > 0 ? `blur(${bg.blur}px)` : undefined,
          // تكبير خفيف يمنع ظهور حواف شفافة بايظة بسبب التمويه عند حدود العنصر
          transform: bg.blur > 0 ? "scale(1.08)" : undefined,
          ...fitStyle,
        }}
      />
      {bg.overlayDarkness > 0 && (
        <div className="absolute inset-0 bg-black" style={{ opacity: bg.overlayDarkness / 100 }} />
      )}
    </div>
  );
}

/** شفافية لوحة المحتوى الرئيسية — بتتحوّل لـ color-mix فوق نفس متغيّر الثيم الحالي (--ink2)
 *  بدل كلاس bg-ink2 الثابت، عشان الخلفية تبان من تحتها. opacity=100 (الافتراضي) = بلا أي تغيير. */
export function panelBgStyle(bg: BackgroundInfo): React.CSSProperties | undefined {
  if (!bg.activeImageUrl || bg.opacity >= 100) return undefined;
  return { backgroundColor: `color-mix(in srgb, var(--ink2) ${bg.opacity}%, transparent)` };
}
