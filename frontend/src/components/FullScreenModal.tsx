"use client";
// شاشة كاملة فوق التطبيق كله (portal على body) — بتغطي القائمة الجانبية والشريط العلوي
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { MIcon } from "@/components/m-icon";

export default function FullScreenModal({ title, onClose, children }: {
  title: string; onClose: () => void; children: ReactNode;
}) {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (typeof document === "undefined") return null;

  // آخر div داخل المحتوى = صف الأزرار، يثبت أسفل الشاشة
  const bar = "[&>div>div:last-child]";
  const fields = "[&_input]:border-slate-300 [&_select]:border-slate-300 [&_input]:bg-white [&_select]:bg-white";

  return createPortal(
    <div dir={document.documentElement.dir || "rtl"}
         className="fixed inset-0 z-[1000] flex flex-col bg-slate-100">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm md:px-8">
        <h3 className="text-[18px] font-extrabold text-slate-900">{title}</h3>
        <button type="button" onClick={onClose}
                className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-4 py-1.5 text-[13px] font-bold hover:bg-slate-50">
          رجوع <MIcon name="close" className="!text-[15px]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-3 md:p-6">
          <div className={`rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:p-6 ${fields} ${bar}:sticky ${bar}:bottom-0 ${bar}:z-10 ${bar}:mt-4 ${bar}:border-t ${bar}:border-slate-200 ${bar}:bg-white ${bar}:py-3`}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
