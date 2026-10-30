"use client";
// نظام الحوارات الموحد — بديل رسائل المتصفح الخام (confirm/alert) بتصميم Z8:
// appConfirm("...")  ← بيرجع Promise<boolean> — استخدمه بـ await مكان confirm()
// appAlert("...")    ← رسالة تنبيه بنفس الشكل مكان alert()
// <DialogHost/> بيتركب مرة واحدة في Shell — ولو مش متركب بيرجع لحوار المتصفح بأمان.
import { useEffect, useState } from "react";
import { MIcon } from "@/components/m-icon";

type Req = { kind: "confirm" | "alert"; message: string; resolve: (v: boolean) => void };

let _push: ((r: Req) => void) | null = null;

export function appConfirm(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    _push ? _push({ kind: "confirm", message, resolve })
          : resolve(window.confirm(message)));
}

export function appAlert(message: string): Promise<boolean> {
  return new Promise((resolve) =>
    _push ? _push({ kind: "alert", message, resolve })
          : (window.alert(message), resolve(true)));
}

export function DialogHost() {
  const [queue, setQueue] = useState<Req[]>([]);
  useEffect(() => {
    _push = (r) => setQueue((p) => [...p, r]);
    return () => { _push = null; };
  }, []);

  const cur = queue[0];
  function close(v: boolean) {
    cur?.resolve(v);
    setQueue((p) => p.slice(1));
  }

  // كيبورد: Enter = تأكيد، Esc = إلغاء
  useEffect(() => {
    if (!cur) return;
    function onKey(e: KeyboardEvent) {
      // Enter = تأكيد، إلا في الإجراءات الخطرة (حذف/مرتجع...) — لازم ضغطة صريحة على الزر
      if (e.key === "Enter" && !/حذف|مسح|إلغاء|مرتجع|إنهاء|إغلاق الجلسة/.test(cur!.message)) { e.preventDefault(); close(true); }
      if (e.key === "Escape") { e.preventDefault(); close(cur!.kind === "alert"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  if (!cur) return null;
  const danger = cur.kind === "confirm" &&
    /حذف|مسح|إلغاء|مرتجع|إنهاء|إغلاق الجلسة/.test(cur.message);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
         onClick={() => close(cur.kind === "alert")}>
      <div className="z8-pop w-full max-w-sm rounded-card border border-line bg-ink-2 p-5 shadow-panel"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-card
              ${danger ? "bg-ember-bg text-ember" : "bg-petrol-soft text-petrol"}`}>
            <MIcon name={danger ? "delete" : cur.kind === "alert" ? "info" : "help"} className="!text-[21px]" />
          </span>
          <p className="pt-1 text-t-md font-bold leading-relaxed">{cur.message}</p>
        </div>
        <div className="mt-4 flex justify-start gap-2">
          <button onClick={() => close(true)} autoFocus
                  className={`rounded-card px-5 py-2.5 text-t-md font-black text-white shadow-card transition-all duration-200 hover:-translate-y-px hover:brightness-110 active:scale-[.97]
                      ${danger ? "bg-ember" : "bg-petrol"}`}>
            {cur.kind === "alert" ? "حسناً" : danger ? "نعم — نفّذ" : "تأكيد"}
          </button>
          {cur.kind === "confirm" && (
            <button onClick={() => close(false)}
                    className="rounded-card border border-line bg-ink-2 px-5 py-2.5 text-t-md font-bold transition-all duration-200 hover:border-petrol hover:text-petrol">
              إلغاء
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
