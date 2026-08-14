"use client";
// شاشة الفروع — النموذج الذهبي لكل شاشات الموديولات الجاية:
// DataTable موحّد + Modal إنشاء/تعديل + أفعال محكومة بالصلاحيات + أخطاء عربية واضحة
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { Button, Card, Field, Input, Modal, ErrorNote } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";

type Branch = {
  id: string; name: string;
  capacity_sir: number; capacity_hafr: number; capacity_rafaat: number;
  lines: string[]; is_frozen: boolean; created_at: string;
};

const EMPTY = { name: "", capacitySir: 0, capacityHafr: 0, capacityRafaat: 0, lines: [] as string[] };

export default function BranchesPage() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm("branches.manage");

  const [rows, setRows] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<null | { mode: "create" } | { mode: "edit"; id: string }>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try { setRows(await api<Branch[]>("/branches")); }
    catch (e: any) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  function openCreate() {
    setForm({ ...EMPTY }); setErr(""); setModal({ mode: "create" });
  }
  function openEdit(b: Branch) {
    setForm({ name: b.name, capacitySir: b.capacity_sir,
              capacityHafr: b.capacity_hafr, capacityRafaat: b.capacity_rafaat,
              lines: b.lines || [] });
    setErr(""); setModal({ mode: "edit", id: b.id });
  }

  async function save() {
    setErr(""); setBusy(true);
    try {
      if (modal?.mode === "create") {
        await api("/branches", { method: "POST", body: JSON.stringify(form) });
      } else if (modal?.mode === "edit") {
        await api(`/branches/${modal.id}`, { method: "PUT", body: JSON.stringify(form) });
      }
      setModal(null);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function toggleFreeze(b: Branch) {
    try {
      await api(`/branches/${b.id}`, { method: "PUT",
        body: JSON.stringify({ is_frozen: !b.is_frozen }) });
      await load();
    } catch (e: any) { await appAlert(e.message); }
  }

  async function remove(b: Branch) {
    if (!await appConfirm(`إلغاء تفعيل فرع «${b.name}»؟ البيانات التاريخية المرتبطة به تبقى محفوظة.`)) return;
    try { await api(`/branches/${b.id}`, { method: "DELETE" }); await load(); }
    catch (e: any) { await appAlert(e.message); }
  }

  const columns: Column<Branch>[] = [
    { key: "name", title: "اسم الفرع",
      render: (b) => <span className="font-extrabold">{b.name}</span> },
    { key: "capacity_sir",    title: "خطوط السير",  width: "110px",
      render: (b) => <span className="tnum">{b.capacity_sir}</span> },
    { key: "capacity_hafr",   title: "سعة الحفرة",  width: "110px",
      render: (b) => <span className="tnum">{b.capacity_hafr}</span> },
    { key: "capacity_rafaat", title: "سعة الرافعات", width: "110px",
      render: (b) => <span className="tnum">{b.capacity_rafaat}</span> },
    { key: "is_frozen", title: "الحالة", width: "110px",
      render: (b) => b.is_frozen
        ? <span className="rounded-full bg-ember-bg px-2.5 py-1 text-[11px] font-bold text-ember">مجمّد</span>
        : <span className="rounded-full bg-emerald-bg px-2.5 py-1 text-[11px] font-bold text-emerald">نشط</span> },
    ...(canManage ? [{
      key: "actions", title: "", width: "300px",
      render: (b: Branch) => (
        <div className="flex justify-end gap-1.5">
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => printBookingQR(b)}>QR الحجز</Button>
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => openEdit(b)}>تعديل</Button>
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => toggleFreeze(b)}>
            {b.is_frozen ? "فك التجميد" : "تجميد"}
          </Button>
          <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => remove(b)}>حذف</Button>
        </div>
      ),
    } satisfies Column<Branch>] : []),
  ];

  // ══════════ لوحة QR حجز الدور (تُطبع وتُعلَّق عند مدخل الفرع) ══════════
  function printBookingQR(b: Branch) {
    const url = `${window.location.origin}/booking/${b.id}`;
    const w = window.open("", "_blank", "width=520,height=760");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
      <title>QR حجز الدور — ${b.name}</title>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"><\/script>
      <style>
        body{font-family:'Cairo','Segoe UI',sans-serif;margin:0;padding:28px;text-align:center;color:#0F2D52}
        .card{border:3px solid #0F2D52;border-radius:24px;padding:28px 22px;max-width:400px;margin:0 auto}
        h1{font-size:24px;margin:0 0 2px}h2{font-size:15px;color:#16A34A;margin:0 0 16px}
        #qr{display:flex;justify-content:center;margin:14px 0}
        #qr img,#qr canvas{border:10px solid #fff;outline:2px solid #E2E8F0;border-radius:12px}
        .steps{text-align:right;font-size:13px;line-height:2;margin:14px 8px 4px;font-weight:700}
        .steps b{color:#16A34A}
        .url{font-size:10px;color:#51617A;direction:ltr;margin-top:10px;word-break:break-all}
        @media print{.noprint{display:none}}
        .noprint{margin-top:18px}
        button{background:#16A34A;color:#fff;border:0;border-radius:10px;padding:10px 26px;font-size:14px;font-weight:900;font-family:inherit;cursor:pointer}
      </style></head><body>
      <div class="card">
        <h1>مصدر الزيوت</h1>
        <h2>${b.name} — احجز دورك قبل الوصول 🚗</h2>
        <div id="qr"></div>
        <div class="steps">
          <b>١.</b> امسح الكود بكاميرا جوالك<br>
          <b>٢.</b> سجّل بياناتك ولوحة سيارتك<br>
          <b>٣.</b> تابع دورك مباشرة من جوالك<br>
          <b>٤.</b> عند وصولك يتأكد دخولك تلقائياً ✨
        </div>
        <div class="url">${url}</div>
      </div>
      <div class="noprint"><button onclick="window.print()">🖨 طباعة</button></div>
      <script>new QRCode(document.getElementById("qr"), { text: "${url}", width: 210, height: 210, correctLevel: QRCode.CorrectLevel.M });<\/script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">الفروع</h1>
      </div>

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          searchKeys={["name"]}
          searchPlaceholder="بحث باسم الفرع..."
          emptyText="لا توجد فروع بعد — أضف أول فرع"
          toolbar={canManage && <Button onClick={openCreate}>+ فرع جديد</Button>}
        />
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)}
             title={modal?.mode === "create" ? "فرع جديد" : "تعديل الفرع"}>
        <div className="space-y-3">
          <Field label="اسم الفرع">
            <Input value={form.name} autoFocus
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label={`خطوط السير (${form.lines.length})`} hint="فرع واحد ممكن يكون فيه أكثر من سير — كل خط باسمه">
              <div className="space-y-1.5">
                {form.lines.map((ln, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input value={ln} placeholder={`سير ${i + 1}`}
                           onChange={(e) => setForm({ ...form,
                             lines: form.lines.map((x, xi) => xi === i ? e.target.value : x) })} />
                    <button type="button" aria-label="حذف الخط"
                            onClick={() => setForm({ ...form, lines: form.lines.filter((_, xi) => xi !== i) })}
                            className="shrink-0 rounded-md px-2 py-1.5 text-text-dim hover:bg-ember-bg hover:text-ember">✕</button>
                  </div>
                ))}
                <button type="button"
                        onClick={() => setForm({ ...form, lines: [...form.lines, `سير ${form.lines.length + 1}`] })}
                        className="w-full rounded-lg border border-dashed border-line py-1.5 text-[12px] font-bold text-text-dim hover:border-petrol hover:text-petrol">
                  + إضافة خط سير
                </button>
              </div>
            </Field>
            <Field label="سعة الحفرة">
              <Input type="number" min={0} className="tnum" value={form.capacityHafr}
                     onChange={(e) => setForm({ ...form, capacityHafr: +e.target.value || 0 })} />
            </Field>
            <Field label="سعة الرافعات">
              <Input type="number" min={0} className="tnum" value={form.capacityRafaat}
                     onChange={(e) => setForm({ ...form, capacityRafaat: +e.target.value || 0 })} />
            </Field>
          </div>
          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button>
            <Button onClick={save} disabled={busy || form.name.trim().length < 2}>
              {busy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
