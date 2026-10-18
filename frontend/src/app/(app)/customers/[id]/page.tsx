"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, getToken } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, Card, ErrorNote } from "@/components/ui";
import { Customer, Vehicle, Statement, money } from "@/modules/customers/types";

type Invoice = {
  id: string; invoice_no: string; issued_at: string; total_inc: number;
  paid_total: number; credit_total: number; is_returned: boolean;
};
type Tab = "info" | "invoices" | "vehicles" | "statement" | "stats";

const VIP_THRESHOLD = 10000;

const dateFmt = (s: string) =>
  new Date(s).toLocaleDateString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"), { year: "numeric", month: "2-digit", day: "2-digit" });

const waLink = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return "https://wa.me/" + (d.startsWith("0") ? "966" + d.slice(1) : d);
};

function invStatus(i: Invoice): { label: string; tone: "good" | "warn" | "info" | "neutral" } {
  if (i.is_returned) return { label: "مرتجعة", tone: "info" };
  if (i.credit_total > 0) return i.paid_total > 0 ? { label: "جزئية", tone: "warn" } : { label: "آجلة", tone: "warn" };
  return { label: "مدفوعة", tone: "good" };
}

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const router = useRouter();

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [statement, setStatement] = useState<Statement | null>(null);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [tab, setTab] = useState<Tab>("info");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [invErr, setInvErr] = useState("");
  const [stErr, setStErr] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  async function fetchPdf(inv: Invoice): Promise<Blob> {
    const token = getToken();
    const res = await fetch(`/api/invoices/${inv.id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) {
      let m = `تعذر تحميل الفاتورة (${res.status})`;
      try { const d = await res.json(); m = d?.error || d?.detail || m; } catch {}
      throw new Error(m);
    }
    return await res.blob();
  }
  async function openPdf(inv: Invoice) {
    setBusyKey("view:" + inv.id); setNotice(null);
    const w = window.open("", "_blank");
    try {
      const url = URL.createObjectURL(await fetchPdf(inv));
      if (w) w.location.href = url; else window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: any) { if (w) w.close(); setNotice({ ok: false, msg: e.message }); }
    finally { setBusyKey(null); }
  }
  async function downloadPdf(inv: Invoice) {
    setBusyKey("dl:" + inv.id); setNotice(null);
    try {
      const url = URL.createObjectURL(await fetchPdf(inv));
      const a = document.createElement("a");
      a.href = url; a.download = `${inv.invoice_no}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e: any) { setNotice({ ok: false, msg: e.message }); }
    finally { setBusyKey(null); }
  }
  async function sendWa(inv: Invoice) {
    setBusyKey("wa:" + inv.id); setNotice(null);
    try {
      await api(`/invoices/${inv.id}/send-whatsapp`, { method: "POST" });
      setNotice({ ok: true, msg: `تمت جدولة إرسال الفاتورة ${inv.invoice_no} عبر واتساب` });
    } catch (e: any) { setNotice({ ok: false, msg: e.message }); }
    finally { setBusyKey(null); }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const all = await api<Customer[]>("/customers");
        const c = all.find((x) => x.id === id) ?? null;
        if (!alive) return;
        if (!c) { setErr("العميل غير موجود"); setLoading(false); return; }
        setCustomer(c);
      } catch (e: any) { if (alive) { setErr(e.message); setLoading(false); } return; }
      try { const v = await api<Vehicle[]>(`/customers/${id}/vehicles`); if (alive) setVehicles(v); } catch {}
      try { const i = await api<Invoice[]>(`/invoices?customerId=${id}&limit=500`); if (alive) setInvoices(i); }
      catch (e: any) { if (alive) setInvErr(e.message); }
      try { const s = await api<Statement>(`/customers/${id}/statement`); if (alive) setStatement(s); }
      catch (e: any) { if (alive) setStErr(e.message); }
      if (alive) setLoading(false);
    })();
    return () => { alive = false; };
  }, [id]);

  const valid = useMemo(() => invoices.filter((i) => !i.is_returned), [invoices]);
  const total = valid.reduce((s, i) => s + i.total_inc, 0);
  const avg = valid.length ? total / valid.length : 0;
  const last = valid.length ? valid.map((i) => i.issued_at).sort().slice(-1)[0] : null;

  const months = useMemo(() => {
    const m: Record<string, number> = {};
    valid.forEach((i) => { const k = i.issued_at.slice(0, 7); m[k] = (m[k] || 0) + i.total_inc; });
    return Object.entries(m).sort(([a], [b]) => a.localeCompare(b)).slice(-6);
  }, [valid]);
  const maxMonth = Math.max(1, ...months.map(([, v]) => v));

  if (loading) return <div className="p-6 text-text-dim">جارٍ التحميل...</div>;
  if (!customer) return (
    <div className="space-y-3 p-2">
      <ErrorNote msg={err} />
      <Button variant="ghost" className="gap-1" onClick={() => router.push("/customers")}><MIcon name="arrow_forward" className="!text-[15px]" /> رجوع للعملاء</Button>
    </div>
  );

  const balance = statement?.balance ?? customer.balance ?? 0;
  const tier = balance > 0 ? { label: "مدين", tone: "warn" as const }
    : total >= VIP_THRESHOLD ? { label: "VIP", tone: "good" as const }
    : { label: "منتظم", tone: "neutral" as const };

  const tabs: [Tab, string][] = [
    ["info", "البيانات"], ["invoices", `الفواتير (${invoices.length})`],
    ["vehicles", `السيارات (${vehicles.length})`], ["statement", "كشف الحساب"], ["stats", "الإحصائيات"],
  ];
  const row = (label: string, value?: string | null) => (
    <div className="flex justify-between border-b border-line/60 py-2 text-[13px]">
      <span className="text-text-dim">{label}</span><span className="font-bold">{value || "—"}</span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* HeaderV2 */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-4 p-5">
          <div className="flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-petrol-soft text-petrol">
              <MIcon name="person" className="!text-[28px]" />
            </div>
            <div>
              <h1 className="text-[22px] font-bold leading-snug">{customer.name}</h1>
              <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[14px] text-text-dim">
                <span dir="ltr" className="tnum">{customer.phone || ""}</span>
                <Badge tone="neutral">{tier.label}</Badge>
                <Badge tone="info">{customer.customer_type === "company" ? "شركة" : "فرد"}</Badge>
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-3">
              <div className="text-left">
                <div className="text-[13px] text-text-dim">الرصيد الآجل</div>
                <div className={`tnum text-[24px] font-bold ${balance > 0 ? "text-ember" : "text-text"}`}>
                  {money(balance)} ر.س{balance > 0 && <span className="mr-1 text-[12px]">مستحق</span>}
                </div>
              </div>
              <Button variant="ghost" onClick={() => router.push("/customers")}>
                <MIcon name="arrow_forward" className="!text-[16px]" /> العملاء
              </Button>
            </div>
            {customer.phone && (
              <div className="flex gap-2">
                <a href={waLink(customer.phone)} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-3.5 py-2 text-[13px] font-semibold text-petrol hover:border-petrol">
                  <MIcon name="chat" className="!text-[16px]" /> واتساب
                </a>
                <a href={`tel:${customer.phone}`}
                   className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-3.5 py-2 text-[13px] font-semibold text-petrol hover:border-petrol">
                  <MIcon name="call" className="!text-[16px]" /> اتصال
                </a>
              </div>
            )}
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2" role="tablist">
        {tabs.map(([k, l]) => {
          const iconName = { info: "badge", invoices: "receipt_long", vehicles: "directions_car", statement: "description", stats: "bar_chart" }[k];
          return (
            <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                    className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-[14px] font-bold transition ${tab === k ? "bg-petrol-soft text-petrol" : "text-text-dim hover:bg-ink-3"}`}>
              <MIcon name={iconName} className="!text-[16px]" /> {l}
            </button>
          );
        })}
      </div>

      <Card>
        <div className="p-4">
          {tab === "info" && (
            <div className="grid gap-x-8 sm:grid-cols-2">
              {row("الاسم", customer.name)}
              {row("الجوال", customer.phone)}
              {row("البريد", customer.email)}
              {row("الرقم الضريبي", customer.vat_number)}
              {row("السجل التجاري", customer.cr_number)}
              {row("المدينة", customer.city)}
              {row("الحي", customer.district)}
              {row("الشارع", customer.street)}
              {row("رقم المبنى", customer.building_no)}
              {row("الرمز البريدي", customer.postal_code)}
              {row("الرقم الإضافي", customer.additional_no)}
              {row("تاريخ التسجيل", customer.created_at ? dateFmt(customer.created_at) : null)}
            </div>
          )}

          {tab === "invoices" && (
            <div className="space-y-2">
              <ErrorNote msg={invErr} />
              {notice && (
                <div role="status" className={`rounded-lg px-3 py-2 text-[13px] font-bold ${notice.ok ? "bg-emerald-bg text-emerald" : "bg-ember-bg text-ember"}`}>
                  {notice.msg}
                </div>
              )}
              <div className="overflow-x-auto rounded-lg border border-line">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead>
                    <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                      <th className="px-3 py-2 text-right">رقم الفاتورة</th>
                      <th className="px-3 py-2 text-right">التاريخ</th>
                      <th className="px-3 py-2 text-right">الحالة</th>
                      <th className="px-3 py-2 text-right">الإجمالي</th>
                      <th className="px-3 py-2 text-right">المدفوع</th>
                      <th className="px-3 py-2 text-right">الآجل</th>
                      <th className="px-3 py-2 text-right">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoices.length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-5 text-center text-text-dim">لا توجد فواتير</td></tr>
                    ) : invoices.map((i) => {
                      const s = invStatus(i);
                      return (
                        <tr key={i.id} className="border-t border-line/70">
                          <td className="px-3 py-2 tnum font-bold">{i.invoice_no}</td>
                          <td className="px-3 py-2 text-text-dim">{dateFmt(i.issued_at)}</td>
                          <td className="px-3 py-2"><Badge tone={s.tone}>{s.label}</Badge></td>
                          <td className="px-3 py-2 tnum font-bold">{money(i.total_inc)}</td>
                          <td className="px-3 py-2 tnum">{money(i.paid_total)}</td>
                          <td className={`px-3 py-2 tnum ${i.credit_total > 0 ? "font-bold text-ember" : ""}`}>{money(i.credit_total)}</td>
                          <td className="px-3 py-2">
                            <div className="flex gap-1.5">
                              <button onClick={() => openPdf(i)} disabled={busyKey === "view:" + i.id}
                                      aria-label={`عرض الفاتورة ${i.invoice_no} PDF`} title="عرض PDF"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol disabled:opacity-45">
                                <MIcon name="visibility" className="!text-[16px]" />
                              </button>
                              <button onClick={() => downloadPdf(i)} disabled={busyKey === "dl:" + i.id}
                                      aria-label={`تحميل الفاتورة ${i.invoice_no} PDF`} title="تحميل PDF"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol disabled:opacity-45">
                                <MIcon name="download" className="!text-[16px]" />
                              </button>
                              <button onClick={() => sendWa(i)} disabled={busyKey === "wa:" + i.id}
                                      aria-label={`إرسال الفاتورة ${i.invoice_no} واتساب`} title="إرسال واتساب"
                                      className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-ink-2 text-text-dim hover:border-petrol hover:text-petrol disabled:opacity-45">
                                <MIcon name="chat" className="!text-[16px]" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {tab === "vehicles" && (
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                    <th className="px-3 py-2 text-right">اللوحة</th>
                    <th className="px-3 py-2 text-right">الموديل</th>
                    <th className="px-3 py-2 text-right">اللون</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.length === 0 ? (
                    <tr><td colSpan={3} className="px-3 py-5 text-center text-text-dim">لا توجد سيارات مسجّلة</td></tr>
                  ) : vehicles.map((v) => (
                    <tr key={v.id} className="border-t border-line/70">
                      <td className="px-3 py-2 tnum font-bold">{v.plate}</td>
                      <td className="px-3 py-2">{[v.brand, v.make_model, v.model_year].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-3 py-2">{v.color || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {tab === "statement" && (
            <div className="space-y-2">
              <ErrorNote msg={stErr} />
              {statement && (
                <div className="max-h-96 overflow-y-auto rounded-lg border border-line">
                  <table className="w-full border-collapse text-[12px]">
                    <thead>
                      <tr className="bg-ink-3 text-[11px] font-extrabold text-text-dim">
                        <th className="px-3 py-2 text-right">التاريخ</th>
                        <th className="px-3 py-2 text-right">النوع</th>
                        <th className="px-3 py-2 text-right">المرجع</th>
                        <th className="px-3 py-2 text-right">المبلغ</th>
                        <th className="px-3 py-2 text-right">الرصيد</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.entries.length === 0 ? (
                        <tr><td colSpan={5} className="px-3 py-5 text-center text-text-dim">لا توجد حركات بعد</td></tr>
                      ) : statement.entries.map((e) => (
                        <tr key={e.id} className="border-t border-line/70">
                          <td className="px-3 py-2 text-text-dim">{dateFmt(e.created_at)}</td>
                          <td className="px-3 py-2">
                            {e.entry_type === "invoice" ? <Badge tone="warn">فاتورة آجل</Badge>
                              : e.entry_type === "payment" ? <Badge tone="good">سداد</Badge>
                              : <Badge tone="info">مرتجع</Badge>}
                          </td>
                          <td className="px-3 py-2 tnum">{e.invoice_no || "—"}</td>
                          <td className={`px-3 py-2 tnum font-bold ${e.amount > 0 ? "text-ember" : "text-emerald"}`}>{e.amount > 0 ? "+" : ""}{money(e.amount)}</td>
                          <td className="px-3 py-2 tnum font-bold">{money(e.running_balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-[11.5px] text-text-dim">لتسجيل سداد أو طباعة الكشف: من قائمة العملاء بدّل لعرض الجدول ثم «عرض».</p>
            </div>
          )}

          {tab === "stats" && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ["إجمالي المشتريات", money(total) + " ر.س"],
                  ["متوسط الفاتورة", money(avg) + " ر.س"],
                  ["عدد الزيارات", String(valid.length)],
                  ["آخر زيارة", last ? dateFmt(last) : "—"],
                ].map(([l, v]) => (
                  <div key={l} className="rounded-lg bg-ink-3 p-3 text-center">
                    <div className="text-[11.5px] text-text-dim">{l}</div>
                    <div className="tnum mt-1 text-[16px] font-black">{v}</div>
                  </div>
                ))}
              </div>
              <div>
                <p className="mb-2 text-[12.5px] font-bold">المشتريات الشهرية (آخر 6 أشهر)</p>
                {months.length === 0 ? <p className="text-text-dim">لا بيانات</p> : (
                  <div className="flex h-40 items-end gap-3">
                    {months.map(([m, v]) => (
                      <div key={m} className="flex flex-1 flex-col items-center justify-end gap-1">
                        <span className="tnum text-[11px]">{money(v)}</span>
                        <div className="w-full rounded-t bg-emerald" style={{ height: `${Math.max(4, (v / maxMonth) * 100)}px` }} />
                        <span className="tnum text-[11px] text-text-dim">{m}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
