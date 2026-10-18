"use client";
// components/toast.tsx — نظام الإشعارات الموحد (Toast) — بديل الرسائل العشوائية
// toast.success("...") / toast.error("...") / toast.warning("...") / toast.info("...")
// <ToastHost/> يتركب مرة واحدة في Shell. بدون Emojis — أيقونات Material Symbols فقط.
import { useEffect, useState } from "react";
import { MIcon } from "@/components/m-icon";

type Tone = "success" | "error" | "warning" | "info";
type ToastItem = { id: number; tone: Tone; message: string; title?: string };

let _push: ((t: Omit<ToastItem, "id">) => void) | null = null;
let _seq = 0;

function emit(tone: Tone, message: string, title?: string) {
  _push?.({ tone, message, title });
}

export const toast = {
  success: (message: string, title?: string) => emit("success", message, title),
  error: (message: string, title?: string) => emit("error", message, title),
  warning: (message: string, title?: string) => emit("warning", message, title),
  info: (message: string, title?: string) => emit("info", message, title),
};

const TONE_STYLES: Record<Tone, { icon: string; chip: string }> = {
  success: { icon: "check_circle", chip: "bg-emerald-bg text-emerald" },
  error: { icon: "error", chip: "bg-ember-bg text-ember" },
  warning: { icon: "warning", chip: "bg-brass-soft text-brass" },
  info: { icon: "info", chip: "bg-petrol-soft text-petrol" },
};

const TONE_LABEL: Record<Tone, string> = {
  success: "تم بنجاح",
  error: "حدث خطأ",
  warning: "تنبيه",
  info: "معلومة",
};

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    _push = (t) => {
      const id = ++_seq;
      setItems((prev) => [...prev, { ...t, id }]);
      window.setTimeout(() => {
        setItems((prev) => prev.filter((x) => x.id !== id));
      }, 4500);
    };
    return () => { _push = null; };
  }, []);

  function dismiss(id: number) {
    setItems((prev) => prev.filter((x) => x.id !== id));
  }

  if (items.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-4 z-[80] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6" aria-live="polite">
      {items.map((t) => {
        const s = TONE_STYLES[t.tone];
        return (
          <div key={t.id}
               role="status"
               className="z8-pop pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-xl border border-line bg-ink-2 p-3.5 shadow-lg">
            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${s.chip}`}>
              <MIcon name={s.icon} className="!text-[18px]" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <div className="text-[12.5px] font-extrabold text-text">{t.title || TONE_LABEL[t.tone]}</div>
              <div className="mt-0.5 text-[12px] leading-relaxed text-text-dim">{t.message}</div>
            </div>
            <button onClick={() => dismiss(t.id)} aria-label="إغلاق الإشعار"
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-text-dim transition hover:bg-ink-3 hover:text-text">
              <MIcon name="close" className="!text-[15px]" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
