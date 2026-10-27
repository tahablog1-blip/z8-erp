"use client";
// ═══════════════════════════════════════════════════════════════
// Z8 ERP — بوابة رابط الواتساب (مرحلة 3 — مركز ملاحظات الخدمة)
// المسار: frontend/src/app/booking/status/[token]/page.tsx
//
// رابط الواتساب اللي بيوصل العميل: /booking/status/{token}
// الصفحة دي بتحوّله فوراً لصفحة الحجز الرئيسية بتاعة فرعه
// والمحادثة مفتوحة تلقائياً: /booking/{branchId}?t={token}
// ═══════════════════════════════════════════════════════════════
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

const NAVY = "var(--petrol-deep)", DIM = "var(--text-dim)";

export default function StatusTokenPage() {
  const params = useParams<{ token: string }>();
  const token = typeof params?.token === "string" ? params.token : "";
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!token || token.length < 20) { setErr("الرابط غير صالح"); return; }
    let alive = true;
    fetch(`/api/service-notes/public/token-info/${token}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d: { branchId?: string }) => {
        if (!alive) return;
        if (d?.branchId) {
          window.location.replace(`/booking/${d.branchId}?t=${token}`);
        } else {
          setErr("الرابط غير صالح أو منتهي — تواصل مع الفرع");
        }
      })
      .catch(() => alive && setErr("الرابط غير صالح أو منتهي — تواصل مع الفرع"));
    return () => { alive = false; };
  }, [token]);

  return (
    <div dir="rtl" className="grid min-h-screen place-items-center px-4" style={{ background: "var(--ink3)" }}>
      <div className="w-full max-w-sm rounded-card bg-white p-6 text-center shadow-lg">
        <div className="text-t-lg font-black" style={{ color: NAVY }}>مصدر الزيوت</div>
        {!err ? (
          <p className="mt-2 text-t-md font-bold" style={{ color: DIM }}>جارِ فتح المحادثة…</p>
        ) : (
          <p className="mt-2 rounded-lg px-3 py-2 text-t-sm font-black"
             style={{ background: "var(--ember-bg)", color: "var(--ember)" }}>{err}</p>
        )}
      </div>
    </div>
  );
}
