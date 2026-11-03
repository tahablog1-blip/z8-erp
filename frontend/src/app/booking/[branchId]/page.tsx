"use client";
// الحجز عبر الويب ملغى: الحجز من تطبيق مصدر الزيوت فقط وأنت أمام الفرع (فحص الموقع يتم داخل التطبيق).
export default function BookingMovedToApp() {
  return (
    <main dir="rtl" style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "inherit" }}>
      <div style={{ maxWidth: 420, textAlign: "center", lineHeight: 1.9 }}>
        <h1 style={{ fontSize: 22, fontWeight: 900, marginBottom: 12 }}>الحجز متاح عبر التطبيق</h1>
        <p style={{ fontWeight: 600 }}>
          لحجز دورك حمّل تطبيق «مصدر الزيوت»، وفعّل الموقع، واحجز وأنت أمام الفرع.
        </p>
      </div>
    </main>
  );
}
