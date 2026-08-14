"use client";
// مركز التحكم الكامل بالمنظومة — 5 تبويبات:
// المنشأة | المستخدمون والصلاحيات | كاميرات المحطات | الطباعة | النظام
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { useAuth } from "@/lib/auth";
import { cacheCompany } from "@/lib/company";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Tabs } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";

type Tab = "company" | "users" | "cameras" | "printing" | "system";

type Company = {
  name: string; vat_number: string | null; cr_number: string | null;
  address: string | null; phone: string | null;
};
type Branch = { id: string; name: string };
type UserRow = {
  id: string; email: string; full_name: string; role: string;
  branch_id: string | null; branch_name: string | null;
  permissions: string[]; is_active: boolean; last_login_at: string | null;
};
type PermGroup = { group: string; items: { key: string; label: string }[] };
type Camera = {
  id: string; branch_id: string; branch_name: string | null;
  station: number; name: string; rtsp_url: string; is_active: boolean;
};


// ══════════ قوالب الأدوار الجاهزة (مخطط ERP) — تملأ الصلاحيات بضغطة وتظل قابلة للتخصيص ══════════
const ROLE_PRESETS: { key: string; label: string; icon: string; desc: string; perms: string[] }[] = [
  {
    key: "manager", label: "المدير", icon: "👔",
    desc: "الفروع والتقارير والموظفين والتشغيل الكامل",
    perms: [
      "cars.create", "cars.confirm_entry", "cars.confirm_exit", "cars.edit", "cars.delete", "cars.notify",
      "invoices.prepare", "invoices.create_service", "invoices.view_pending", "invoices.view_today", "invoices.view_all",
      "invoices.edit_items", "invoices.return",
      "customers.create", "customers.edit", "customers.view_statement", "customers.record_payment",
      "products.view_stock",
      "reports.sales", "reports.cashiers",
      "treasury.create_receipt", "treasury.create_payment", "treasury.view",
      "shifts.manage_own", "shifts.view_branch",
      "hr.view", "hr.manage", "hr.attendance", "hr.leave_approve", "hr.violations",
      "branches.manage",
    ],
  },
  {
    key: "accountant", label: "المحاسب", icon: "🧮",
    desc: "الحسابات والفواتير والتحصيل والإقرارات",
    perms: [
      "accounting.view_reports", "accounting.view_vat",
      "treasury.create_receipt", "treasury.create_payment", "treasury.view", "treasury.cancel",
      "reports.sales", "reports.cashiers",
      "invoices.view_all", "invoices.view_today", "invoices.return",
      "customers.view_statement", "customers.record_payment",
      "purchasing.invoices", "purchasing.suppliers",
      "shifts.view_branch",
    ],
  },
  {
    key: "cashier", label: "الكاشير", icon: "💳",
    desc: "نقطة البيع والفواتير والتحصيل فقط",
    perms: [
      "shifts.manage_own",
      "invoices.create_service", "invoices.view_today", "invoices.view_pending",
      "customers.create",
      "cars.confirm_exit",
    ],
  },
  {
    key: "storekeeper", label: "أمين المستودع", icon: "📦",
    desc: "المخزون والاستلام والصرف والجرد والموردون",
    perms: [
      "products.create", "products.edit", "products.view_stock", "products.import",
      "purchasing.suppliers", "purchasing.quotations", "purchasing.orders", "purchasing.invoices",
    ],
  },
  {
    key: "service_line", label: "موظف خط الخدمة", icon: "🔧",
    desc: "تسجيل السيارات والمحطات والتشييكات",
    perms: [
      "cars.create", "cars.confirm_entry", "cars.confirm_exit", "cars.edit",
      "invoices.prepare",
    ],
  },
];

const STATION_LABEL: Record<number, string> = {
  1: "المحطة 1 — الدخول", 2: "المحطة 2 — الزيت", 3: "المحطة 3 — التشييك",
};

export default function SettingsPage() {
  // ── 📲 إعداد واتساب (UltraMsg) ──
  const [waInstance, setWaInstance] = useState("");
  const [waToken, setWaToken] = useState("");
  const [waMsg, setWaMsg] = useState("");
  useEffect(() => {
    api<{ waInstance: string; waToken: string }>("/auth/wa-settings")
      .then((r) => { setWaInstance(r.waInstance); setWaToken(r.waToken); }).catch(() => {});
  }, []);
  async function saveWa() {
    try {
      await api("/auth/wa-settings", { method: "PUT", body: JSON.stringify({ waInstance, waToken }) });
      setWaMsg("✅ تم الحفظ — إشعارات العميل والفواتير ستُرسل تلقائياً");
    } catch (e) { setWaMsg(`❌ ${e instanceof Error ? e.message : "فشل الحفظ"}`); }
  }
  const { user, hasPerm } = useAuth();
  const canCompany = hasPerm("settings.company");
  const canUsers = hasPerm("settings.users");

  const [tab, setTab] = useState<Tab>(canCompany ? "company" : "users");
  const [branches, setBranches] = useState<Branch[]>([]);

  // ══════════ المنشأة ══════════
  const [form, setForm] = useState<Company>({ name: "", vat_number: "", cr_number: "", address: "", phone: "" });
  const [coBusy, setCoBusy] = useState(false);
  const [coErr, setCoErr] = useState("");
  const [coOk, setCoOk] = useState("");

  // ══════════ المستخدمون ══════════
  const [users, setUsers] = useState<UserRow[]>([]);
  const [permGroups, setPermGroups] = useState<PermGroup[]>([]);
  const [uModal, setUModal] = useState<null | { mode: "create" } | { mode: "edit"; u: UserRow }>(null);
  const [uForm, setUForm] = useState({
    email: "", password: "", fullName: "", role: "employee",
    branchId: "" as string | null, permissions: [] as string[], isActive: true, newPassword: "",
  });
  const [uErr, setUErr] = useState("");
  const [uBusy, setUBusy] = useState(false);

  // ══════════ مفتاح المراقبة الذكية ══════════
  const [aiSup, setAiSup] = useState<boolean | null>(null);
  useEffect(() => {
    api<{ enabled: boolean }>("/settings/ai-supervisor").then((r) => setAiSup(r.enabled)).catch(() => setAiSup(true));
  }, []);
  async function toggleAiSup() {
    if (aiSup === null) return;
    const next = !aiSup;
    setAiSup(next);   // استجابة فورية
    try { await api("/settings/ai-supervisor", { method: "PUT", body: JSON.stringify({ enabled: next }) }); }
    catch (e: any) { setAiSup(!next); await appAlert(e.message); }
  }

  // ══════════ الكاميرات ══════════
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [camForm, setCamForm] = useState({ branchId: "", station: 1, name: "", rtspUrl: "" });
  const [camErr, setCamErr] = useState("");
  const [camBusy, setCamBusy] = useState(false);
  const [snapFor, setSnapFor] = useState<string | null>(null);
  const [snapImg, setSnapImg] = useState<{ name: string; src: string } | null>(null);

  // ══════════ الطباعة ══════════
  const [autoPrint, setAutoPrint] = useState(true);
  const [footer, setFooter] = useState("شكراً لتعاملكم معنا");
  const [prOk, setPrOk] = useState("");

  // ══════════ النظام ══════════
  const [health, setHealth] = useState<boolean | null>(null);

  useEffect(() => {
    api<Branch[]>("/branches").then((b) => {
      setBranches(b);
      setCamForm((f) => ({ ...f, branchId: f.branchId || b[0]?.id || "" }));
    }).catch(() => {});
    if (canCompany) {
      api<Company>("/settings/company")
        .then((c) => setForm({ ...c, vat_number: c.vat_number || "", cr_number: c.cr_number || "", address: c.address || "", phone: c.phone || "" }))
        .catch((e) => setCoErr(e.message));
      loadCameras();
    }
    if (canUsers) {
      loadUsers();
      api<{ groups: PermGroup[] }>("/auth/permissions-catalog").then((r) => setPermGroups(r.groups)).catch(() => {});
    }
    try {
      setAutoPrint(localStorage.getItem("z8_print_auto") !== "off");
      setFooter(localStorage.getItem("z8_print_footer") || "شكراً لتعاملكم معنا");
    } catch { /* */ }
    api("/health").then(() => setHealth(true)).catch(() => setHealth(false));
  }, []);

  // ══════════════════ المنشأة ══════════════════

  async function saveCompany() {
    setCoErr(""); setCoOk(""); setCoBusy(true);
    try {
      const saved = await api<Company>("/settings/company", { method: "PUT", body: JSON.stringify(form) });
      cacheCompany({
        name: saved.name, vat: saved.vat_number || "", cr: saved.cr_number || "",
        address: saved.address || "", phone: saved.phone || "",
      });
      setCoOk("تم الحفظ — كل المطبوعات هتستخدم البيانات الجديدة فوراً");
    } catch (e: any) { setCoErr(e.message); }
    finally { setCoBusy(false); }
  }

  // ══════════════════ المستخدمون ══════════════════

  async function loadUsers() {
    try { setUsers(await api<UserRow[]>("/settings/users")); } catch { /* */ }
  }
  function openCreateUser() {
    setUForm({ email: "", password: "", fullName: "", role: "employee", branchId: branches[0]?.id || null, permissions: [], isActive: true, newPassword: "" });
    setUErr(""); setUModal({ mode: "create" });
  }
  function openEditUser(u: UserRow) {
    setUForm({ email: u.email, password: "", fullName: u.full_name, role: u.role, branchId: u.branch_id, permissions: [...u.permissions], isActive: u.is_active, newPassword: "" });
    setUErr(""); setUModal({ mode: "edit", u });
  }
  function togglePerm(key: string) {
    setUForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key],
    }));
  }
  async function saveUser() {
    setUErr(""); setUBusy(true);
    try {
      if (uModal?.mode === "create") {
        await api("/settings/users", {
          method: "POST",
          body: JSON.stringify({
            email: uForm.email, password: uForm.password, fullName: uForm.fullName,
            role: uForm.role, branchId: uForm.branchId, permissions: uForm.permissions,
          }),
        });
      } else if (uModal?.mode === "edit") {
        await api(`/settings/users/${uModal.u.id}`, {
          method: "PUT",
          body: JSON.stringify({
            fullName: uForm.fullName, role: uForm.role, branchId: uForm.branchId,
            permissions: uForm.permissions, isActive: uForm.isActive,
            newPassword: uForm.newPassword.trim() || null,
          }),
        });
      }
      setUModal(null);
      await loadUsers();
    } catch (e: any) { setUErr(e.message); }
    finally { setUBusy(false); }
  }

  // ══════════════════ الكاميرات ══════════════════

  async function loadCameras() {
    try { setCameras(await api<Camera[]>("/cameras")); } catch { /* */ }
  }
  async function addCamera() {
    setCamErr(""); setCamBusy(true);
    try {
      await api("/cameras", { method: "POST", body: JSON.stringify(camForm) });
      setCamForm((f) => ({ ...f, name: "", rtspUrl: "" }));
      await loadCameras();
    } catch (e: any) { setCamErr(e.message); }
    finally { setCamBusy(false); }
  }
  async function removeCamera(c: Camera) {
    if (!await appConfirm(`حذف كاميرا «${c.name}»؟`)) return;
    try { await api(`/cameras/${c.id}`, { method: "DELETE" }); await loadCameras(); }
    catch (e: any) { await appAlert(e.message); }
  }
  async function testSnapshot(c: Camera) {
    setSnapFor(c.id); setSnapImg(null); setCamErr("");
    try {
      const r = await api<{ name: string; image_base64: string }>(`/cameras/${c.id}/snapshot`, { method: "POST" });
      setSnapImg({ name: r.name, src: `data:image/jpeg;base64,${r.image_base64}` });
    } catch (e: any) { setCamErr(e.message); }
    finally { setSnapFor(null); }
  }

  // ══════════════════ الطباعة ══════════════════

  function savePrinting() {
    localStorage.setItem("z8_print_auto", autoPrint ? "on" : "off");
    localStorage.setItem("z8_print_footer", footer.trim() || "شكراً لتعاملكم معنا");
    setPrOk("تم الحفظ — الفواتير الجاية هتطبق الإعدادات دي");
  }

  const tabs = [
    ...(canCompany ? [{ key: "company" as Tab, label: "المنشأة" }] : []),
    ...(canUsers ? [{ key: "users" as Tab, label: "المستخدمون والصلاحيات" }] : []),
    ...(canCompany ? [{ key: "cameras" as Tab, label: "كاميرات المحطات" }] : []),
    { key: "printing" as Tab, label: "الطباعة" },
    { key: "system" as Tab, label: "النظام" },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — مركز التحكم</h1>

      {/* ══════════ 📲 إشعارات واتساب (UltraMsg) ══════════ */}
      <Card>
        <h2 className="mb-2 text-[14px] font-black">📲 إشعارات واتساب للعملاء</h2>
        <p className="mb-3 text-[11.5px] text-text-dim">
          عند التفعيل: العميل يستلم "سيارتك جاهزة" فور اعتماد أمر العمل، وفاتورته PDF فور إتمام الدفع.
          البيانات من حسابك في ultramsg.com (Instance ID + Token).
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Instance ID">
            <Input value={waInstance} onChange={(e) => setWaInstance(e.target.value)} placeholder="instance186155" />
          </Field>
          <Field label="Token">
            <Input value={waToken} onChange={(e) => setWaToken(e.target.value)} placeholder="xxxxxxxx" />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={saveWa}>حفظ إعداد واتساب</Button>
          {waMsg && <span className="text-[12px] font-bold">{waMsg}</span>}
        </div>
      </Card>

      <Card className="!p-0">
        <div className="px-5 pt-4">
          <Tabs value={tab} onChange={(t) => setTab(t as Tab)} items={tabs} />
        </div>

        <div className="p-5">
          {/* ══════════ المنشأة ══════════ */}
          {tab === "company" && canCompany && (
            <div className="max-w-2xl space-y-3">
              <p className="text-[12px] text-text-dim">البيانات دي بتظهر في ترويسة كل الفواتير والتقارير المطبوعة.</p>
              <Field label="اسم المنشأة">
                <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </Field>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="الرقم الضريبي (VAT)">
                  <Input className="tnum" value={form.vat_number || ""} onChange={(e) => setForm({ ...form, vat_number: e.target.value })} />
                </Field>
                <Field label="السجل التجاري (CR)">
                  <Input className="tnum" value={form.cr_number || ""} onChange={(e) => setForm({ ...form, cr_number: e.target.value })} />
                </Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Field label="الهاتف (يظهر بالفاتورة)">
                  <Input className="tnum" value={form.phone || ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                </Field>
                <Field label="العنوان">
                  <Input value={form.address || ""} onChange={(e) => setForm({ ...form, address: e.target.value })} />
                </Field>
              </div>
              <ErrorNote msg={coErr} />
              {coOk && <p className="text-[12.5px] font-bold text-emerald">{coOk}</p>}
              <div className="flex justify-end">
                <Button onClick={saveCompany} disabled={coBusy || !form.name.trim()}>
                  {coBusy ? "جارِ الحفظ..." : "حفظ البيانات"}
                </Button>
              </div>
            </div>
          )}

          {/* ══════════ المستخدمون والصلاحيات ══════════ */}
          {tab === "users" && canUsers && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] text-text-dim">حسابات الموظفين وأدوارهم وصلاحياتهم على كل قسم في المنظومة.</p>
                <Button onClick={openCreateUser}>+ موظف جديد</Button>
              </div>
              <div className="divide-y divide-line rounded-lg border border-line">
                {users.map((u) => (
                  <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-[12.5px]">
                    <div className="min-w-0">
                      <div className="font-bold">
                        {u.full_name}
                        {u.role === "admin"
                          ? <span className="mr-2 rounded-full bg-petrol-soft px-2 py-0.5 text-[10.5px] font-bold text-petrol">مدير نظام</span>
                          : <span className="mr-2 rounded-full bg-ink-3 px-2 py-0.5 text-[10.5px] font-bold text-text-dim">موظف · {u.permissions.length} صلاحية</span>}
                        {!u.is_active && <span className="mr-2 rounded-full bg-ember-bg px-2 py-0.5 text-[10.5px] font-bold text-ember">معطّل</span>}
                      </div>
                      <div className="tnum text-[11px] text-text-dim" dir="ltr">{u.email}</div>
                      <div className="text-[11px] text-text-dim">
                        {u.branch_name || "كل الفروع"}
                        {u.last_login_at && <> · آخر دخول {new Date(u.last_login_at).toLocaleString("ar-SA-u-nu-latn", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</>}
                      </div>
                    </div>
                    <Button variant="ghost" className="!px-3 !py-1 !text-[11.5px]" onClick={() => openEditUser(u)}>تعديل</Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ══════════ كاميرات المحطات ══════════ */}
          {tab === "cameras" && canCompany && (
            <div className="space-y-3">
              {/* ══ مفتاح المراقبة الذكية — ستايل أندرويد ══ */}
              <div className={`flex items-center justify-between rounded-2xl border-2 p-4 transition-colors duration-300
                  ${aiSup ? "border-emerald/40 bg-emerald-bg" : "border-line bg-ink-3"}`}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[14px] font-black">
                    <MIcon name="smart_toy" filled={!!aiSup} className={`!text-[22px] ${aiSup ? "text-emerald" : "text-text-dim"}`} />
                    المراقبة الذكية بالكاميرات
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${aiSup ? "bg-emerald text-white" : "bg-ink-4 text-text-dim"}`}>
                      {aiSup === null ? "..." : aiSup ? "شغالة" : "متوقفة"}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] leading-relaxed text-text-dim">
                    صيد الأخطاء الدوري + لقطة الدخول المرجعية + الفحص الختامي قبل الدفع —
                    إيقافها يوقف كل استهلاك الذكاء للكاميرات فوراً
                  </p>
                </div>
                {/* زر أندرويد */}
                <button onClick={toggleAiSup} aria-label="تبديل المراقبة الذكية" disabled={aiSup === null}
                        className={`relative h-8 w-14 shrink-0 rounded-full transition-colors duration-300
                          ${aiSup ? "bg-emerald" : "bg-ink-4"}`}>
                  <span className={`absolute top-1 h-6 w-6 rounded-full bg-white shadow-md transition-all duration-300
                      ${aiSup ? "right-1" : "right-7"}`} />
                </button>
              </div>
              <p className="text-[12px] text-text-dim">
                سجّل كاميرا لكل محطة (RTSP) واضغط «اختبار لقطة» للتأكد من التوصيل — دي البنية اللي المراقبة الذكية هتشتغل عليها.
              </p>
              {cameras.length > 0 && (
                <div className="divide-y divide-line rounded-lg border border-line">
                  {cameras.map((c) => (
                    <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                      <div className="min-w-0">
                        <div className="font-bold">{c.name}
                          <span className="mr-2 rounded-full bg-petrol-soft px-2 py-0.5 text-[10.5px] font-bold text-petrol">
                            {STATION_LABEL[c.station]}
                          </span>
                          <span className="mr-2 text-[10.5px] text-text-dim">{c.branch_name}</span>
                        </div>
                        <div className="tnum truncate text-[11px] text-text-dim" dir="ltr">{c.rtsp_url}</div>
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                                disabled={snapFor === c.id} onClick={() => testSnapshot(c)}>
                          {snapFor === c.id ? "جارِ الالتقاط..." : "📷 اختبار لقطة"}
                        </Button>
                        <Button variant="danger" className="!px-2.5 !py-1 !text-[11.5px]" onClick={() => removeCamera(c)}>حذف</Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {snapImg && (
                <div className="rounded-lg border border-line p-2">
                  <p className="mb-1.5 text-[11.5px] font-bold text-emerald">✓ لقطة حية من «{snapImg.name}»</p>
                  <img src={snapImg.src} alt="لقطة الكاميرا" className="w-full max-w-xl rounded-md" />
                </div>
              )}
              <div className="grid gap-2 sm:grid-cols-[1fr_150px_1fr]">
                <Field label="اسم الكاميرا">
                  <Input value={camForm.name} placeholder="كاميرا حفرة الدخول"
                         onChange={(e) => setCamForm({ ...camForm, name: e.target.value })} />
                </Field>
                <Field label="المحطة">
                  <Select value={String(camForm.station)}
                          onChange={(e) => setCamForm({ ...camForm, station: Number(e.target.value) })}>
                    <option value="1">1 — الدخول</option>
                    <option value="2">2 — الزيت</option>
                    <option value="3">3 — التشييك</option>
                  </Select>
                </Field>
                <Field label="الفرع">
                  <Select value={camForm.branchId}
                          onChange={(e) => setCamForm({ ...camForm, branchId: e.target.value })}>
                    {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </Select>
                </Field>
              </div>
              <Field label="عنوان البث RTSP" hint="مثال Hikvision: rtsp://admin:PASS@192.168.8.61:554/Streaming/Channels/101">
                <Input dir="ltr" className="tnum" value={camForm.rtspUrl} placeholder="rtsp://..."
                       onChange={(e) => setCamForm({ ...camForm, rtspUrl: e.target.value })} />
              </Field>
              <ErrorNote msg={camErr} />
              <div className="flex justify-end">
                <Button onClick={addCamera}
                        disabled={camBusy || !camForm.name.trim() || !camForm.rtspUrl.trim() || !camForm.branchId}>
                  {camBusy ? "جارِ الإضافة..." : "+ إضافة الكاميرا"}
                </Button>
              </div>
            </div>
          )}

          {/* ══════════ الطباعة ══════════ */}
          {tab === "printing" && (
            <div className="max-w-xl space-y-4">
              <label className="flex cursor-pointer items-center justify-between rounded-lg border border-line p-3">
                <div>
                  <div className="text-[13px] font-bold">الطباعة التلقائية عند إصدار الفاتورة</div>
                  <div className="text-[11.5px] text-text-dim">نافذة الطباعة الحرارية تفتح لوحدها فور الإصدار</div>
                </div>
                <input type="checkbox" checked={autoPrint} className="h-4 w-4 accent-petrol"
                       onChange={(e) => setAutoPrint(e.target.checked)} />
              </label>
              <Field label="نص أسفل الفاتورة (التذييل)">
                <Input value={footer} onChange={(e) => setFooter(e.target.value)} />
              </Field>
              <div className="rounded-lg bg-ink-3 p-3 text-[12px] text-text-dim">
                صيغ الطباعة المتاحة في كل النظام: <b>حراري 80مم</b> للكاشير والتذاكر، و<b>A4 رسمي</b> للفواتير الضريبية والتقارير وكشوف الحساب — الاختيار بيظهر عند عرض أي فاتورة.
              </div>
              {prOk && <p className="text-[12.5px] font-bold text-emerald">{prOk}</p>}
              <div className="flex justify-end">
                <Button onClick={savePrinting}>حفظ إعدادات الطباعة</Button>
              </div>
            </div>
          )}

          {/* ══════════ النظام ══════════ */}
          {tab === "system" && (
            <div className="max-w-xl space-y-2 text-[12.5px]">
              <div className="flex justify-between rounded-lg border border-line p-3">
                <span className="text-text-dim">حالة الخادم</span>
                <b className={health ? "text-emerald" : "text-ember"}>{health === null ? "..." : health ? "متصل ✓" : "غير متصل ✗"}</b>
              </div>
              <div className="flex justify-between rounded-lg border border-line p-3">
                <span className="text-text-dim">المستخدم الحالي</span><b>{user?.fullName} ({user?.email})</b>
              </div>
              <div className="flex justify-between rounded-lg border border-line p-3">
                <span className="text-text-dim">الدور</span><b>{user?.role === "admin" ? "مدير النظام" : "موظف"}</b>
              </div>
              <div className="flex justify-between rounded-lg border border-line p-3">
                <span className="text-text-dim">المنصة</span><b>Z8 Platform — FastAPI + Next.js + PostgreSQL</b>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ══════════ نافذة موظف ══════════ */}
      <Modal open={!!uModal} size="lg" onClose={() => setUModal(null)}
             title={uModal?.mode === "create" ? "إضافة موظف جديد" : `تعديل — ${uModal?.mode === "edit" ? uModal.u.full_name : ""}`}>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الاسم الكامل">
              <Input value={uForm.fullName} onChange={(e) => setUForm({ ...uForm, fullName: e.target.value })} />
            </Field>
            <Field label="البريد الإلكتروني">
              <Input dir="ltr" type="email" value={uForm.email} disabled={uModal?.mode === "edit"}
                     onChange={(e) => setUForm({ ...uForm, email: e.target.value })} />
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="الدور">
              <Select value={uForm.role} onChange={(e) => setUForm({ ...uForm, role: e.target.value })}>
                <option value="employee">موظف (بصلاحيات محددة)</option>
                <option value="admin">المالك / مدير النظام (كل الصلاحيات)</option>
              </Select>
            </Field>
            <Field label="الفرع">
              <Select value={uForm.branchId || ""} onChange={(e) => setUForm({ ...uForm, branchId: e.target.value || null })}>
                <option value="">كل الفروع</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            {uModal?.mode === "create" ? (
              <Field label="كلمة المرور (8+ أحرف)">
                <Input dir="ltr" type="password" value={uForm.password}
                       onChange={(e) => setUForm({ ...uForm, password: e.target.value })} />
              </Field>
            ) : (
              <Field label="كلمة مرور جديدة (اختياري)">
                <Input dir="ltr" type="password" value={uForm.newPassword} placeholder="اتركها فارغة للإبقاء"
                       onChange={(e) => setUForm({ ...uForm, newPassword: e.target.value })} />
              </Field>
            )}
          </div>

          {uModal?.mode === "edit" && (
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-bold">
              <input type="checkbox" checked={uForm.isActive} className="h-4 w-4 accent-petrol"
                     onChange={(e) => setUForm({ ...uForm, isActive: e.target.checked })} />
              الحساب نشط (إلغاء التحديد = تعطيل الدخول)
            </label>
          )}

          {uForm.role === "employee" && (
            <div className="space-y-1.5">
              <p className="text-[11.5px] font-extrabold text-text-dim">قوالب جاهزة — اضغط قالب ليملأ الصلاحيات ثم عدّل ما تشاء:</p>
              <div className="flex flex-wrap gap-1.5">
                {ROLE_PRESETS.map((r) => {
                  const active = r.perms.length === uForm.permissions.length &&
                    r.perms.every((k) => uForm.permissions.includes(k));
                  return (
                    <button key={r.key} type="button" title={r.desc}
                            onClick={() => setUForm({ ...uForm, permissions: [...r.perms] })}
                            className={`rounded-lg px-3 py-1.5 text-[11.5px] font-bold transition
                              ${active ? "bg-petrol text-white" : "border border-line bg-ink-2 hover:border-petrol"}`}>
                      {r.icon} {r.label}
                    </button>
                  );
                })}
                <button type="button" onClick={() => setUForm({ ...uForm, permissions: [] })}
                        className="rounded-lg border border-line bg-ink-2 px-3 py-1.5 text-[11.5px] font-bold text-text-dim hover:border-ember hover:text-ember">
                  ✕ مسح الكل
                </button>
              </div>
            </div>
          )}

          {uForm.role === "employee" && permGroups.length > 0 && (
            <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border border-line p-3">
              {permGroups.map((g) => (
                <div key={g.group}>
                  <p className="mb-1 text-[11.5px] font-extrabold text-petrol">{g.group}</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {g.items.map((it) => (
                      <label key={it.key} className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <input type="checkbox" checked={uForm.permissions.includes(it.key)}
                               className="h-3.5 w-3.5 accent-petrol" onChange={() => togglePerm(it.key)} />
                        {it.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <ErrorNote msg={uErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setUModal(null)}>إلغاء</Button>
            <Button onClick={saveUser}
                    disabled={uBusy || !uForm.fullName.trim() ||
                      (uModal?.mode === "create" && (!uForm.email.trim() || uForm.password.length < 8))}>
              {uBusy ? "جارِ الحفظ..." : "حفظ"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
