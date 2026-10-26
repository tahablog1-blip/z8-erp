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
  const fields = "";

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title} dir={document.documentElement.dir || "rtl"}
         className="fixed inset-0 z-[1000] flex flex-col bg-ink text-text">
      <div className="flex shrink-0 items-center justify-between border-b border-line bg-ink-2 px-4 py-3 shadow-sm md:px-8">
        <h3 className="text-[18px] font-extrabold text-text">{title}</h3>
        <button type="button" onClick={onClose}
                className="flex items-center gap-1 rounded-lg border border-line bg-ink-2 px-4 py-1.5 text-[13px] font-bold hover:bg-ink-3">
          رجوع <MIcon name="close" className="!text-[15px]" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-5xl p-3 md:p-6">
          <div className={`rounded-2xl border border-line bg-ink-2 p-4 shadow-sm md:p-6 ${fields} ${bar}:sticky ${bar}:bottom-0 ${bar}:z-10 ${bar}:mt-4 ${bar}:border-t ${bar}:border-line ${bar}:bg-ink-2 ${bar}:py-3`}>
            {children}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
