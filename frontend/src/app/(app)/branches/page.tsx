"use client";
// شاشة الفروع — النموذج الذهبي لكل شاشات الموديولات الجاية:
// DataTable موحّد + Modal إنشاء/تعديل + أفعال محكومة بالصلاحيات + أخطاء عربية واضحة
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useLang } from "@/lib/i18n";
import { DataTable, Column } from "@/components/DataTable";
import { Button, Card, Field, Input, Select, Badge, Modal, ErrorNote, PageHeader } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";
import { MIcon } from "@/components/m-icon";

type BranchCategory = "service" | "retail";

type Branch = {
  id: string; name: string; category: BranchCategory;
  capacity_sir: number; capacity_hafr: number; capacity_rafaat: number;
  lines: string[]; is_frozen: boolean; created_at: string;
  manager_user_id: string | null; manager_name: string | null;
  address: string | null; invoice_prefix: string | null;
  independent_invoice_numbering: boolean;
};

type UserRow = { id: string; full_name: string; is_active: boolean };

const EMPTY = { name: "", category: "service" as BranchCategory,
                capacitySir: 0, capacityHafr: 0, capacityRafaat: 0, lines: [] as string[],
                managerUserId: "", address: "", invoicePrefix: "", independentInvoiceNumbering: false };

export default function BranchesPage() {
  const { hasPerm } = useAuth();
  const { t, lang } = useLang();
  const canManage = hasPerm("branches.manage");

  const [rows, setRows] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
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
  useEffect(() => {
    load();
    // قائمة المستخدمين اختيارية (لاختيار مدير الفرع) — لو المستخدم الحالي
    // بلا صلاحية settings.users نتجاهل الفشل بصمت ونعرض الحقل بدون قائمة
    api<UserRow[]>("/settings/users").then(setUsers).catch(() => {});
  }, []);

  function openCreate() {
    setForm({ ...EMPTY }); setErr(""); setModal({ mode: "create" });
  }
  function openEdit(b: Branch) {
    setForm({ name: b.name, category: b.category || "service", capacitySir: b.capacity_sir,
              capacityHafr: b.capacity_hafr, capacityRafaat: b.capacity_rafaat,
              lines: b.lines || [], managerUserId: b.manager_user_id || "",
              address: b.address || "", invoicePrefix: b.invoice_prefix || "",
              independentInvoiceNumbering: !!b.independent_invoice_numbering });
    setErr(""); setModal({ mode: "edit", id: b.id });
  }

  async function save() {
    setErr(""); setBusy(true);
    // ملاحظة: الفروع (بخلاف باقي الموديولات) تتعامل مع "" كقيمة صريحة للمسح،
    // لا null — الراوتر هنا بيفلتر v is not None فتفضل null بلا أي تأثير
    const body = { ...form, address: form.address.trim(), invoicePrefix: form.invoicePrefix.trim() };
    try {
      if (modal?.mode === "create") {
        await api("/branches", { method: "POST", body: JSON.stringify(body) });
      } else if (modal?.mode === "edit") {
        await api(`/branches/${modal.id}`, { method: "PUT", body: JSON.stringify(body) });
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
    const message = `${t("branches.deleteConfirm", "إلغاء تفعيل فرع")} «${b.name}»؟ ${t("branches.historyNote", "البيانات التاريخية المرتبطة به تبقى محفوظة.")}`;

    if (!await appConfirm(message)) return;

    try {
      await api(`/branches/${b.id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      await appAlert(e.message);
    }
  }


  const columns: Column<Branch>[] = [
    { key: "name", title: t("branches.name", "اسم الفرع"),
      render: (b) => <span className="font-extrabold">{b.name}</span> },
    { key: "category", title: t("branches.category", "فئة الفرع"), width: "110px",
      render: (b) => b.category === "retail"
        ? <Badge tone="info">{t("branches.categoryRetail", "تجزئة")}</Badge>
        : <Badge tone="good">{t("branches.categoryService", "خدمة")}</Badge> },
    { key: "manager_name", title: t("branches.manager", "المدير"), width: "140px",
      render: (b) => b.manager_name || <span className="text-text-dim">—</span> },
    { key: "capacity_sir",    title: t("branches.lines", "خطوط السير"),  width: "110px",
      render: (b) => <span className="tnum">{b.category === "retail" ? "—" : b.capacity_sir}</span> },
    { key: "capacity_hafr",   title: t("branches.capacityHafr", "سعة الحفرة"),  width: "110px",
      render: (b) => <span className="tnum">{b.category === "retail" ? "—" : b.capacity_hafr}</span> },
    { key: "capacity_rafaat", title: t("branches.capacityRafaat", "سعة الرافعات"), width: "110px",
      render: (b) => <span className="tnum">{b.category === "retail" ? "—" : b.capacity_rafaat}</span> },
    { key: "is_frozen", title: t("branches.status", "الحالة"), width: "110px",
      render: (b) => b.is_frozen
        ? <Badge tone="danger">
          {t("branches.frozen", "مجمّد")}
        </Badge>
        : <Badge tone="success">
          {t("branches.active", "نشط")}
        </Badge> },
    ...(canManage ? [{
      key: "actions", title: "", width: "300px",
      render: (b: Branch) => (
        <div className="flex justify-end gap-1.5">
          {b.category !== "retail" && (
            <Button variant="ghost" size="xs" onClick={() => printBookingQR(b)}>
              {t("branches.bookingQR", "QR الحجز")}
            </Button>
          )}
          <Button variant="ghost" size="xs" onClick={() => openEdit(b)}>
            {t("branches.edit", "تعديل")}
          </Button>
          <Button variant="ghost" size="xs" onClick={() => toggleFreeze(b)}>
            {b.is_frozen ? t("branches.unfreeze", "فك التجميد") : t("branches.freeze", "تجميد")}
          </Button>
          <Button variant="danger" size="xs" onClick={() => remove(b)}>
            {t("branches.delete", "حذف")}
          </Button>
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
        body{font-family:'Cairo','Segoe UI',sans-serif;margin:0;padding:28px;text-align:center;color:#1E3A8A}
        .card{border:3px solid #1E3A8A;border-radius:24px;padding:28px 22px;max-width:400px;margin:0 auto}
        h1{font-size:24px;margin:0 0 2px}h2{font-size:15px;color:#1E3A8A;margin:0 0 16px}
        #qr{display:flex;justify-content:center;margin:14px 0}
        #qr img,#qr canvas{border:10px solid #fff;outline:2px solid #E2E8F0;border-radius:12px}
        .steps{text-align:right;font-size:13px;line-height:2;margin:14px 8px 4px;font-weight:700}
        .steps b{color:#1E3A8A}
        .url{font-size:10px;color:#51617A;direction:ltr;margin-top:10px;word-break:break-all}
        @media print{.noprint{display:none}}
        .noprint{margin-top:18px}
        button{background:#1E3A8A;color:#fff;border:0;border-radius:10px;padding:10px 26px;font-size:14px;font-weight:900;font-family:inherit;cursor:pointer}
      </style></head><body>
      <div class="card">
        <h1>مصدر الزيوت</h1>
        <h2>${b.name} — احجز دورك قبل الوصول</h2>
        <div id="qr"></div>
        <div class="steps">
          <b>١.</b> امسح الكود بكاميرا جوالك<br>
          <b>٢.</b> سجّل بياناتك ولوحة سيارتك<br>
          <b>٣.</b> تابع دورك مباشرة من جوالك<br>
          <b>٤.</b> عند وصولك يتأكد دخولك تلقائياً
        </div>
        <div class="url">${url}</div>
      </div>
      <div class="noprint"><button onclick="window.print()">طباعة</button></div>
      <script>new QRCode(document.getElementById("qr"), { text: "${url}", width: 210, height: 210, correctLevel: QRCode.CorrectLevel.M });<\/script>
      </body></html>`);
    w.document.close();
  }

  return (
    <div className="space-y-4">
      <PageHeader title={t("branches.title", "الفروع")} description="إدارة فروع الشركة وأكوادها وبوابات الحجز." />

      <Card>
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          searchKeys={["name"]}
          searchPlaceholder={t("branches.search", "بحث باسم الفرع...")}
          emptyText={t("branches.empty", "لا توجد فروع بعد — أضف أول فرع")}
          toolbar={canManage && <Button onClick={openCreate}> {t("branches.new", "+ فرع جديد")}
          </Button>}
        />
      </Card>

      <Modal open={!!modal} onClose={() => setModal(null)}
             title={modal?.mode === "create" ? t("branches.createTitle", "فرع جديد") : t("branches.editTitle", "تعديل الفرع")}>
        <div className="space-y-3">
          <Field label={t("branches.name", "اسم الفرع")}>
            <Input value={form.name} autoFocus
                   onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label={t("branches.category", "فئة الفرع")}
                 hint={form.category === "retail"
                   ? t("branches.categoryRetailHint", "بيع بالقطعة فقط — بدون طابور خدمة سيارات")
                   : t("branches.categoryServiceHint", "ورشة تغيير زيت كاملة — سير/حفرة/رافعات وطابور خدمة")}>
            <Select value={form.category}
                    onChange={(e) => {
                      const category = e.target.value as BranchCategory;
                      setForm(category === "retail"
                        ? { ...form, category, capacitySir: 0, capacityHafr: 0, capacityRafaat: 0, lines: [] }
                        : { ...form, category });
                    }}>
              <option value="service">{t("branches.categoryService", "خدمة")}</option>
              <option value="retail">{t("branches.categoryRetail", "تجزئة")}</option>
            </Select>
          </Field>
          {form.category === "service" && (
            <div className="grid grid-cols-3 gap-2">
              <Field label={t("branches.lines", "خطوط السير")} hint={t("branches.linesHint", "فرع واحد ممكن يكون فيه أكثر من سير — كل خط باسمه")}>
                <div className="space-y-1.5">
                  {form.lines.map((ln, i) => (
                    <div key={i} className="flex items-center gap-1.5">
                      <Input value={ln} placeholder={t("branches.linePlaceholder", `سير ${i + 1}`)}
                             onChange={(e) => setForm({ ...form,
                               lines: form.lines.map((x, xi) => xi === i ? e.target.value : x) })} />
                      <button type="button" aria-label="حذف الخط"
                              onClick={() => setForm({ ...form, lines: form.lines.filter((_, xi) => xi !== i) })}
                              className="shrink-0 rounded-md px-2 py-1.5 text-text-dim hover:bg-ember-bg hover:text-ember">
                        <MIcon name="delete" className="!text-[16px]" />
                      </button>
                    </div>
                  ))}
                  <button type="button"
                          onClick={() => setForm({ ...form, lines: [...form.lines, `سير ${form.lines.length + 1}`] })}
                          className="z8-anim-btn w-full rounded-lg border border-dashed border-line py-1.5 text-t-sm font-bold text-text-dim hover:border-petrol hover:text-petrol">
                   {t("branches.addLine", "+ إضافة خط سير")}
                  </button>
                </div>
              </Field>
              <Field label={t("branches.capacityHafr", "سعة الحفرة")}>
                <Input type="number" min={0} className="tnum" value={form.capacityHafr}
                       onChange={(e) => setForm({ ...form, capacityHafr: +e.target.value || 0 })} />
              </Field>
              <Field label={t("branches.capacityRafaat", "سعة الرافعات")}>
                <Input type="number" min={0} className="tnum" value={form.capacityRafaat}
                       onChange={(e) => setForm({ ...form, capacityRafaat: +e.target.value || 0 })} />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Field label={t("branches.manager", "مدير الفرع")}>
              <Select value={form.managerUserId}
                      onChange={(e) => setForm({ ...form, managerUserId: e.target.value })}>
                <option value="">{t("branches.noManager", "بدون تحديد")}</option>
                {users.filter((u) => u.is_active).map((u) => (
                  <option key={u.id} value={u.id}>{u.full_name}</option>
                ))}
              </Select>
            </Field>
            <Field label={t("branches.address", "العنوان")}>
              <Input value={form.address}
                     onChange={(e) => setForm({ ...form, address: e.target.value })} />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-2 rounded-lg border border-line bg-ink-3 p-2.5">
            <label className="col-span-full flex cursor-pointer items-center justify-between">
              <div>
                <div className="text-t-sm font-bold">{t("branches.independentNumbering", "ترقيم فواتير مستقل لهذا الفرع")}</div>
                <div className="text-t-xs text-text-dim">
                  {t("branches.independentNumberingHint", "تسلسل خاص بالفرع بدل التسلسل العام المشترك بين كل الفروع")}
                </div>
              </div>
              <input type="checkbox" className="h-4 w-4"
                     checked={form.independentInvoiceNumbering}
                     onChange={(e) => setForm({ ...form, independentInvoiceNumbering: e.target.checked })} />
            </label>
            {form.independentInvoiceNumbering && (
              <Field label={t("branches.invoicePrefix", "بادئة رقم الفاتورة")} hint={t("branches.invoicePrefixHint", "فاضي = أول 3 حروف من اسم الفرع")}>
                <Input value={form.invoicePrefix} className="tnum" maxLength={10}
                       onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value.toUpperCase() })} />
              </Field>
            )}
          </div>

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>
              {t("branches.cancel", "إلغاء")}
            </Button>
            <Button onClick={save} disabled={busy || form.name.trim().length < 2}>
              {busy ? t("branches.saving", "جارِ الحفظ...") : t("branches.save", "حفظ")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
