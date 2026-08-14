"use client";

/**
 * Z8 - شاشة البوابة الذكية
 * ========================
 * تفتح اتصال WebSocket وتعرض كل سيارة داخلة لحظياً
 * مع بيانات العميل وسلة الفاتورة الجاهزة من آخر زيارة.
 */

import { useEffect, useRef, useState, useCallback } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:4001";
const WS_BASE = API_BASE.replace(/^http/, "ws");

/* ---------------------------------------------------------------- الأنواع */

type CartLine = {
  product_id: string;
  product_name: string;
  sku?: string | null;
  quantity: number;
  unit_price: number;
  old_price?: number | null;
  discount: number;
  line_total: number;
  is_service: boolean;
  price_changed: boolean;
  unavailable: boolean;
  note?: string | null;
};

type GateEvent = {
  scan_id?: string;
  status: "checked_in" | "matched" | "needs_confirm" | "unknown" | "duplicate" | "no_plate" | "error";
  message: string;
  branch_id?: string;
  plate: {
    plate_display_ar: string;
    plate_display_en: string;
    letters_ar: string;
    digits: string;
    confidence: number;
    issues?: string | null;
  };
  match_mode?: string | null;
  car?: { car_id: string; plate_number?: string; brand?: string; model?: string; year?: number; color?: string; last_odometer?: number } | null;
  customer?: { customer_id: string; name?: string; phone?: string; balance?: number } | null;
  candidates?: any[];
  queue_id?: string | null;
  already_inside?: boolean;
  stats?: {
    visits_count: number;
    last_visit_date?: string | null;
    last_visit_odometer?: number | null;
    days_since_last_visit?: number | null;
    estimated_odometer_now?: number | null;
    service_due: boolean;
    service_due_note?: string | null;
  } | null;
  cart?: {
    source: string;
    source_invoice_number?: string | null;
    source_invoice_date?: string | null;
    lines: CartLine[];
    subtotal: number;
    vat: number;
    total: number;
    warnings: string[];
  } | null;
  pos_url?: string | null;
  created_at?: string;
};

/* ------------------------------------------------------------ ألوان الحالة */

const STATUS_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  checked_in:    { label: "تم الدخول",     bg: "#0C5E66", fg: "#ffffff" },
  matched:       { label: "عميل مسجّل",     bg: "#0C5E66", fg: "#ffffff" },
  needs_confirm: { label: "يحتاج تأكيد",    bg: "#B45309", fg: "#ffffff" },
  unknown:       { label: "غير مسجّل",      bg: "#7C2D12", fg: "#ffffff" },
  duplicate:     { label: "مكرر",           bg: "#57534E", fg: "#ffffff" },
  no_plate:      { label: "لوحة غير واضحة", bg: "#57534E", fg: "#ffffff" },
  error:         { label: "خطأ",            bg: "#991B1B", fg: "#ffffff" },
};

const money = (n?: number | null) =>
  (n ?? 0).toLocaleString("ar-SA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ------------------------------------------------------- لوحة السيارة */

function PlateBadge({ letters, digits }: { letters: string; digits: string }) {
  return (
    <div className="plate" dir="rtl">
      <span className="plate__ksa">KSA</span>
      <span className="plate__letters">{letters.split("").join(" ")}</span>
      <span className="plate__sep" />
      <span className="plate__digits">{digits}</span>
    </div>
  );
}

/* ------------------------------------------------------------- الصفحة */

export default function GatePage() {
  const [branchId, setBranchId] = useState("");
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<GateEvent[]>([]);
  const [active, setActive] = useState<GateEvent | null>(null);
  const [manualPlate, setManualPlate] = useState("");
  const [busy, setBusy] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const saved = window.localStorage?.getItem("z8_branch_id") ?? "";
    setBranchId(saved);
  }, []);

  /* ---- اتصال WebSocket مع إعادة محاولة تلقائية ---- */
  const connect = useCallback(() => {
    if (!branchId) return;
    wsRef.current?.close();

    const ws = new WebSocket(`${WS_BASE}/api/auto-checkin/ws?branch_id=${branchId}`);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);

    ws.onmessage = (msg) => {
      try {
        const ev: GateEvent = JSON.parse(msg.data);
        setEvents((prev) => [ev, ...prev].slice(0, 40));
        if (ev.status !== "duplicate") setActive(ev);
        if (ev.status === "checked_in") {
          new Audio("/sounds/checkin.mp3").play().catch(() => {});
        }
      } catch {
        /* رسالة غير صالحة — نتجاهلها */
      }
    };

    ws.onclose = () => {
      setConnected(false);
      retryRef.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => ws.close();
  }, [branchId]);

  useEffect(() => {
    connect();
    const ping = setInterval(() => {
      if (wsRef.current?.readyState === WebSocket.OPEN) wsRef.current.send("ping");
    }, 25000);
    return () => {
      clearInterval(ping);
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, [connect]);

  /* ---- إدخال يدوي ---- */
  const submitManual = async () => {
    if (!manualPlate.trim() || !branchId) return;
    setBusy(true);
    try {
      const res = await fetch(`${API_BASE}/api/auto-checkin/manual`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${window.localStorage?.getItem("z8_token") ?? ""}`,
        },
        body: JSON.stringify({ plate: manualPlate, branch_id: branchId, auto_checkin: true }),
      });
      const ev: GateEvent = await res.json();
      setActive(ev);
      setEvents((p) => [ev, ...p].slice(0, 40));
      setManualPlate("");
    } finally {
      setBusy(false);
    }
  };

  /* ---- تأكيد سيارة ---- */
  const confirmCar = async (carId: string) => {
    if (!active?.scan_id) return;
    setBusy(true);
    try {
      const res = await fetch(
        `${API_BASE}/api/auto-checkin/confirm/${active.scan_id}?branch_id=${branchId}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${window.localStorage?.getItem("z8_token") ?? ""}`,
          },
          body: JSON.stringify({ car_id: carId }),
        },
      );
      setActive(await res.json());
    } finally {
      setBusy(false);
    }
  };

  const openPOS = () => {
    if (active?.pos_url) window.location.href = active.pos_url;
  };

  const st = active ? STATUS_STYLE[active.status] ?? STATUS_STYLE.error : null;

  /* --------------------------------------------------------------- العرض */

  if (!branchId) {
    return (
      <main className="gate" dir="rtl">
        <div className="setup">
          <h1>البوابة الذكية</h1>
          <p>أدخل معرّف الفرع لبدء الاستقبال</p>
          <input
            className="field"
            placeholder="Branch UUID"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                const v = (e.target as HTMLInputElement).value.trim();
                if (v) {
                  window.localStorage?.setItem("z8_branch_id", v);
                  setBranchId(v);
                }
              }
            }}
          />
        </div>
        <GateStyles />
      </main>
    );
  }

  return (
    <main className="gate" dir="rtl">
      <header className="bar">
        <div className="bar__title">
          <span className="dot" data-on={connected} />
          البوابة الذكية
        </div>
        <div className="bar__manual">
          <input
            className="field field--sm"
            value={manualPlate}
            onChange={(e) => setManualPlate(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitManual()}
            placeholder="إدخال يدوي: أ ب ح 1234"
          />
          <button className="btn btn--ghost" onClick={submitManual} disabled={busy}>
            بحث
          </button>
        </div>
      </header>

      <div className="layout">
        {/* ------------------------------- البطاقة الرئيسية */}
        <section className="stage">
          {!active && (
            <div className="idle">
              <PlateBadge letters="أبح" digits="0000" />
              <p>في انتظار أول سيارة. اللقطة هتظهر هنا تلقائياً.</p>
            </div>
          )}

          {active && st && (
            <article className="card">
              <div className="card__head" style={{ background: st.bg, color: st.fg }}>
                <span className="chip">{st.label}</span>
                <span className="conf">
                  دقة القراءة {Math.round((active.plate.confidence ?? 0) * 100)}%
                </span>
              </div>

              <div className="card__plate">
                <PlateBadge
                  letters={active.plate.letters_ar || "؟؟؟"}
                  digits={active.plate.digits || "----"}
                />
              </div>

              <p className="card__msg">{active.message}</p>

              {/* بيانات العميل والسيارة */}
              {active.customer && (
                <div className="grid">
                  <Field label="العميل" value={active.customer.name} big />
                  <Field label="الجوال" value={active.customer.phone} />
                  <Field
                    label="السيارة"
                    value={[active.car?.brand, active.car?.model, active.car?.year]
                      .filter(Boolean)
                      .join(" ")}
                  />
                  <Field label="اللون" value={active.car?.color} />
                  <Field
                    label="العداد المقدّر"
                    value={
                      active.stats?.estimated_odometer_now
                        ? `${active.stats.estimated_odometer_now.toLocaleString("ar-SA")} كم`
                        : active.car?.last_odometer
                          ? `${active.car.last_odometer.toLocaleString("ar-SA")} كم`
                          : null
                    }
                  />
                  <Field
                    label="آخر زيارة"
                    value={
                      active.stats?.days_since_last_visit != null
                        ? `منذ ${active.stats.days_since_last_visit} يوم`
                        : null
                    }
                  />
                  <Field label="عدد الزيارات" value={active.stats?.visits_count} />
                  <Field
                    label="الرصيد"
                    value={active.customer.balance ? `${money(active.customer.balance)} ر.س` : "—"}
                  />
                </div>
              )}

              {active.stats?.service_due && (
                <div className="alert alert--due">{active.stats.service_due_note}</div>
              )}

              {active.already_inside && (
                <div className="alert">السيارة مسجّل دخولها بالفعل ولم تخرج بعد.</div>
              )}

              {/* المرشحون */}
              {!!active.candidates?.length && (
                <div className="cands">
                  <h3>اختر السيارة الصحيحة</h3>
                  {active.candidates.map((c: any) => (
                    <button key={c.car_id} className="cand" onClick={() => confirmCar(c.car_id)}>
                      <strong>{c.plate_number}</strong>
                      <span>{[c.brand, c.model, c.year].filter(Boolean).join(" ")}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* سلة الفاتورة */}
              {active.cart && active.cart.lines.length > 0 && (
                <div className="cart">
                  <div className="cart__head">
                    <h3>فاتورة مقترحة من آخر زيارة</h3>
                    {active.cart.source_invoice_number && (
                      <span className="ref">مرجع: {active.cart.source_invoice_number}</span>
                    )}
                  </div>

                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>الصنف</th>
                        <th>الكمية</th>
                        <th>السعر</th>
                        <th>الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {active.cart.lines.map((l, i) => (
                        <tr key={i} data-flag={l.unavailable ? "off" : l.price_changed ? "chg" : ""}>
                          <td>
                            {l.product_name}
                            {l.note && <em className="note">{l.note}</em>}
                          </td>
                          <td>{l.quantity}</td>
                          <td>{money(l.unit_price)}</td>
                          <td>{money(l.line_total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td colSpan={3}>الإجمالي قبل الضريبة</td><td>{money(active.cart.subtotal)}</td></tr>
                      <tr><td colSpan={3}>ضريبة القيمة المضافة 15%</td><td>{money(active.cart.vat)}</td></tr>
                      <tr className="total"><td colSpan={3}>الإجمالي</td><td>{money(active.cart.total)} ر.س</td></tr>
                    </tfoot>
                  </table>

                  {active.cart.warnings.map((w, i) => (
                    <div key={i} className="alert alert--warn">{w}</div>
                  ))}
                </div>
              )}

              {/* الأزرار */}
              <div className="actions">
                {(active.status === "checked_in" || active.status === "matched") && (
                  <button className="btn btn--primary" onClick={openPOS}>
                    فتح الفاتورة في نقطة البيع
                  </button>
                )}
                {active.status === "needs_confirm" && active.car && (
                  <button
                    className="btn btn--primary"
                    onClick={() => confirmCar(active.car!.car_id)}
                    disabled={busy}
                  >
                    تأكيد ودخول
                  </button>
                )}
                {active.status === "unknown" && (
                  <a
                    className="btn btn--primary"
                    href={`/customers/new?plate=${encodeURIComponent(active.plate.plate_display_ar)}`}
                  >
                    تسجيل عميل جديد
                  </a>
                )}
                <button className="btn btn--ghost" onClick={() => setActive(null)}>
                  إخفاء
                </button>
              </div>
            </article>
          )}
        </section>

        {/* ------------------------------- السجل الجانبي */}
        <aside className="log">
          <h2>آخر اللقطات</h2>
          {events.length === 0 && <p className="log__empty">لا توجد لقطات بعد.</p>}
          {events.map((e, i) => {
            const s = STATUS_STYLE[e.status] ?? STATUS_STYLE.error;
            return (
              <button key={i} className="log__row" onClick={() => setActive(e)}>
                <span className="log__badge" style={{ background: s.bg }}>{s.label}</span>
                <span className="log__plate">{e.plate.plate_display_ar || "—"}</span>
                <span className="log__name">{e.customer?.name ?? ""}</span>
              </button>
            );
          })}
        </aside>
      </div>

      <GateStyles />
    </main>
  );
}

function Field({ label, value, big }: { label: string; value?: any; big?: boolean }) {
  return (
    <div className={`f ${big ? "f--big" : ""}`}>
      <span className="f__label">{label}</span>
      <span className="f__value">{value ?? "—"}</span>
    </div>
  );
}

/* -------------------------------------------------------------- التنسيق */

function GateStyles() {
  return (
    <style jsx global>{`
      .gate {
        --petrol: #0c5e66;
        --petrol-dark: #084950;
        --ink: #12211f;
        --muted: #6b7d7c;
        --line: #dbe5e4;
        --paper: #f5f8f8;
        min-height: 100vh;
        background: var(--paper);
        color: var(--ink);
        font-family: "IBM Plex Sans Arabic", system-ui, sans-serif;
      }

      .bar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 16px; padding: 14px 20px;
        background: var(--petrol); color: #fff;
      }
      .bar__title { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 600; }
      .bar__manual { display: flex; gap: 8px; }
      .dot { width: 10px; height: 10px; border-radius: 50%; background: #e11d48; }
      .dot[data-on="true"] { background: #22c55e; box-shadow: 0 0 0 4px rgba(34,197,94,.25); }

      .field {
        border: 1px solid var(--line); border-radius: 10px;
        padding: 10px 14px; font: inherit; background: #fff; color: var(--ink);
        min-width: 260px;
      }
      .field--sm { padding: 7px 12px; min-width: 220px; }

      .btn {
        border: 0; border-radius: 10px; padding: 10px 18px;
        font: inherit; font-weight: 600; cursor: pointer;
        text-decoration: none; display: inline-flex; align-items: center;
      }
      .btn--primary { background: var(--petrol); color: #fff; }
      .btn--primary:hover { background: var(--petrol-dark); }
      .btn--ghost { background: rgba(255,255,255,.16); color: #fff; }
      .btn:disabled { opacity: .5; cursor: not-allowed; }
      .btn:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }

      .layout {
        display: grid; grid-template-columns: 1fr 320px;
        gap: 20px; padding: 20px; align-items: start;
      }

      /* ---- اللوحة السعودية ---- */
      .plate {
        display: inline-flex; align-items: center; gap: 14px;
        background: #fff; border: 3px solid var(--ink); border-radius: 10px;
        padding: 12px 18px; box-shadow: 0 3px 0 rgba(0,0,0,.12);
      }
      .plate__ksa {
        font-size: 11px; letter-spacing: 2px; color: var(--muted);
        writing-mode: vertical-rl; text-orientation: upright;
      }
      .plate__letters { font-size: 34px; font-weight: 700; letter-spacing: 4px; }
      .plate__sep { width: 2px; height: 38px; background: var(--ink); }
      .plate__digits { font-size: 34px; font-weight: 700; letter-spacing: 3px; font-variant-numeric: tabular-nums; }

      /* ---- البطاقة ---- */
      .idle {
        display: flex; flex-direction: column; align-items: center; gap: 18px;
        padding: 80px 20px; color: var(--muted); opacity: .55;
      }
      .card { background: #fff; border-radius: 16px; overflow: hidden; box-shadow: 0 2px 16px rgba(12,94,102,.09); }
      .card__head { display: flex; justify-content: space-between; align-items: center; padding: 12px 20px; }
      .chip { font-weight: 700; font-size: 15px; }
      .conf { font-size: 13px; opacity: .85; }
      .card__plate { display: flex; justify-content: center; padding: 24px 20px 8px; }
      .card__msg { text-align: center; font-size: 17px; margin: 0 0 18px; padding: 0 20px; }

      .grid {
        display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
        gap: 1px; background: var(--line); border-block: 1px solid var(--line);
      }
      .f { background: #fff; padding: 12px 16px; display: flex; flex-direction: column; gap: 4px; }
      .f--big .f__value { font-size: 20px; font-weight: 700; color: var(--petrol); }
      .f__label { font-size: 12px; color: var(--muted); }
      .f__value { font-size: 15px; font-weight: 600; }

      .alert { margin: 12px 20px; padding: 10px 14px; border-radius: 10px; font-size: 14px;
               background: #f1f5f5; border-inline-start: 4px solid var(--muted); }
      .alert--due  { background: #fff7ed; border-inline-start-color: #ea580c; color: #7c2d12; }
      .alert--warn { background: #fefce8; border-inline-start-color: #ca8a04; color: #713f12; }

      .cands { padding: 8px 20px 16px; }
      .cands h3 { font-size: 15px; margin: 8px 0; }
      .cand { display: flex; justify-content: space-between; width: 100%;
              padding: 12px 14px; margin-bottom: 8px; border: 1px solid var(--line);
              border-radius: 10px; background: #fff; font: inherit; cursor: pointer; }
      .cand:hover { border-color: var(--petrol); background: #f0f7f7; }

      .cart { padding: 4px 20px 20px; }
      .cart__head { display: flex; justify-content: space-between; align-items: baseline; margin: 16px 0 10px; }
      .cart__head h3 { font-size: 16px; margin: 0; }
      .ref { font-size: 12px; color: var(--muted); }

      .tbl { width: 100%; border-collapse: collapse; font-size: 14px; }
      .tbl th { text-align: start; padding: 9px 10px; background: #eef4f4; color: var(--muted); font-weight: 600; }
      .tbl td { padding: 10px; border-block-end: 1px solid var(--line); }
      .tbl tr[data-flag="chg"] td { background: #fefce8; }
      .tbl tr[data-flag="off"] td { background: #fef2f2; text-decoration: line-through; opacity: .7; }
      .note { display: block; font-size: 11px; color: var(--muted); font-style: normal; }
      .tbl tfoot td { border: 0; padding: 6px 10px; color: var(--muted); }
      .tbl tfoot .total td { font-size: 17px; font-weight: 700; color: var(--petrol); padding-top: 10px; }

      .actions { display: flex; gap: 10px; padding: 16px 20px 20px; flex-wrap: wrap; }
      .actions .btn--ghost { background: #eef4f4; color: var(--ink); }

      /* ---- السجل ---- */
      .log { background: #fff; border-radius: 16px; padding: 16px; box-shadow: 0 2px 16px rgba(12,94,102,.06); }
      .log h2 { font-size: 15px; margin: 0 0 12px; color: var(--muted); }
      .log__empty { font-size: 13px; color: var(--muted); }
      .log__row { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px;
                  width: 100%; text-align: start; padding: 10px; margin-bottom: 6px;
                  border: 0; border-radius: 10px; background: #f7fafa; font: inherit; cursor: pointer; }
      .log__row:hover { background: #eef4f4; }
      .log__badge { grid-row: span 2; align-self: center; color: #fff; font-size: 11px;
                    padding: 4px 8px; border-radius: 6px; }
      .log__plate { font-weight: 700; font-size: 14px; }
      .log__name { font-size: 12px; color: var(--muted); }

      .setup { display: flex; flex-direction: column; align-items: center; gap: 14px; padding: 120px 20px; }
      .setup h1 { color: var(--petrol); margin: 0; }
      .setup p { color: var(--muted); margin: 0; }

      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
        .bar { flex-direction: column; align-items: stretch; }
        .plate__letters, .plate__digits { font-size: 26px; }
      }

      @media (prefers-reduced-motion: reduce) {
        * { transition: none !important; animation: none !important; }
      }
    `}</style>
  );
}
