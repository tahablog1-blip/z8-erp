"use client";
// components/InvoicePrintAnimation.tsx — عند إصدار الفاتورة: طابعة حرارية والورقة بتتطبع وتطلع من الفتحة
// (حركة متقطعة steps() زي تغذية الورق الحقيقية) ثم علامة تأكيد وتختفي تلقائياً. الضغط في أي مكان يقفلها.
// prefers-reduced-motion: القاعدة العامة في globals.css بتلغي الحركة، فبتظهر الورقة بوضعها النهائي ثابتة.
import { useEffect } from "react";
import { MIcon } from "@/components/m-icon";
import { money } from "@/modules/products/types";

export type PrintLine = { label: string; qty: number };

const TEETH = 13;
// حافة القص المسنّنة في أول الورقة (أول ما يخرج من الفتحة)
const ZIGZAG = `polygon(${Array.from({ length: TEETH * 2 + 1 }, (_, i) =>
  `${((i / (TEETH * 2)) * 100).toFixed(2)}% ${i % 2 === 0 ? "7px" : "0"}`).join(",")},100% 100%,0 100%)`;

export function InvoicePrintAnimation({ invoiceNo, total, lines, onDone }: {
  invoiceNo: string; total: number; lines: PrintLine[]; onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 3600);
    return () => clearTimeout(t);
  }, [onDone]);

  const shown = lines.slice(0, 4);
  const more = lines.length - shown.length;
  const now = new Date().toLocaleString(
    typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn",
    { dateStyle: "short", timeStyle: "short" });

  return (
    <div className="z8-print-backdrop fixed inset-0 z-[80] grid place-items-center bg-slate-900/55 p-4 backdrop-blur-[2px]"
         onClick={onDone} role="status" aria-live="polite" aria-label={`تم إصدار الفاتورة ${invoiceNo}`}>
      <div className="relative w-[272px]" onClick={(e) => e.stopPropagation()}>
        {/* نافذة خروج الورق — بتقص الورقة عند فتحة الطابعة */}
        <div className="relative h-[300px] overflow-hidden">
          <div className="z8-receipt absolute inset-x-5 bottom-0 bg-white px-4 pb-6 pt-5 text-slate-800 shadow-lg"
               style={{ clipPath: ZIGZAG }}>
            <div className="text-center">
              <div className="text-[13px] font-black">مصدر الزيوت</div>
              <div className="text-[10px] text-slate-500">فاتورة ضريبية مبسطة</div>
            </div>
            <div className="my-2 border-t border-dashed border-slate-300" />
            <div className="flex justify-between text-[10.5px]"><span>رقم الفاتورة</span><b className="tnum" dir="ltr">{invoiceNo}</b></div>
            <div className="flex justify-between text-[10.5px] text-slate-500"><span>التاريخ</span><span className="tnum">{now}</span></div>
            <div className="my-2 border-t border-dashed border-slate-300" />
            <ul className="space-y-1 text-[10.5px]">
              {shown.map((l, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">{l.label}</span><span className="tnum shrink-0">× {l.qty}</span>
                </li>
              ))}
              {more > 0 && <li className="text-slate-500">+ {more} بنود أخرى</li>}
            </ul>
            <div className="my-2 border-t border-dashed border-slate-300" />
            <div className="flex items-baseline justify-between">
              <span className="text-[11px] font-bold">الإجمالي شامل الضريبة</span>
              <span className="tnum text-[15px] font-black">{money(total)} <span className="text-[10px] font-bold">ر.س</span></span>
            </div>
            {/* باركود شكلي */}
            <div className="mt-3 flex h-7 items-stretch justify-center gap-[2px]" aria-hidden>
              {Array.from({ length: 34 }).map((_, i) => (
                <span key={i} className="bg-slate-800" style={{ width: (i * 7) % 5 === 0 ? 3 : 1.5 }} />
              ))}
            </div>
          </div>
        </div>

        {/* جسم الطابعة */}
        <div className="z8-printer-body relative z-10 -mt-1 h-[84px] rounded-2xl bg-gradient-to-b from-slate-700 to-slate-900 shadow-2xl ring-1 ring-black/30">
          <div className="absolute inset-x-4 top-3 h-2 rounded-full bg-black/80 shadow-inner" aria-hidden />
          <div className="absolute inset-x-6 bottom-3 flex items-center justify-between">
            <span className="text-[10px] font-black tracking-widest text-slate-400">Z8 · PRINT</span>
            <span className="flex items-center gap-1.5 text-[9.5px] text-slate-400">
              <span className="z8-printer-led h-2 w-2 animate-pulse rounded-full bg-emerald-400" aria-hidden />جاهزة
            </span>
          </div>
          <div className="absolute inset-x-8 bottom-9 flex justify-between" aria-hidden>
            {Array.from({ length: 6 }).map((_, i) => <span key={i} className="h-[3px] w-6 rounded bg-black/40" />)}
          </div>
        </div>

        {/* علامة التأكيد بعد انتهاء الطباعة */}
        <div className="z8-print-done mt-4 flex items-center justify-center gap-2 rounded-full bg-emerald px-4 py-2 text-[13px] font-black text-white shadow-lg">
          <MIcon name="check_circle" filled className="!text-[20px]" />
          تم إصدار الفاتورة
        </div>
      </div>
    </div>
  );
}
