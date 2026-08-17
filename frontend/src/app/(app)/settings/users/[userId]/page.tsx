"use client";
// الإعدادات ← موظف — صفحة كاملة للإضافة (/settings/users/new) والتعديل (/settings/users/{id})
// شبكة الصلاحيات كاملة على مساحة الصفحة بدل مربع منبثق مزدحم
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Field, Input, Select } from "@/components/ui";

type Branch = { id: string; name: string };
type UserRow = {
  id: string; email: string; full_name: string; role: string;
  branch_id: string | null; branch_name: string | null;
  permissions: string[]; is_active: boolean; last_login_at: string | null;
};
type PermGroup = { group: string; items: { key: string; label: string }[] };

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
      "service_notes.view", "service_notes.create", "service_notes.manage",
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
      "service_notes.view",
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
    desc: "تسجيل السيارات والمحطات والتشييكات وملاحظات الخدمة",
    perms: [
      "cars.create", "cars.confirm_entry", "cars.confirm_exit", "cars.edit",
      "invoices.prepare",
      "service_notes.view", "service_notes.create",
    ],
  },
];

export default function UserEditorPage() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = typeof params?.userId === "string" ? params.userId : "";
  const isNew = userId === "new";

  const { hasPerm } = useAuth();
  const canUsers = hasPerm("settings.users");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [permGroups, setPermGroups] = useState<PermGroup[]>([]);
  const [loaded, setLoaded] = useState(isNew);
  const [notFound, setNotFound] = useState(false);
  const [uForm, setUForm] = useState({
    email: "", password: "", fullName: "", role: "employee",
    branchId: "" as string | null, permissions: [] as string[], isActive: true, newPassword: "",
  });
  const [uErr, setUErr] = useState("");
  const [uBusy, setUBusy] = useState(false);
  const [savedName, setSavedName] = useState("");

  useEffect(() => {
    if (!canUsers) return;
    api<Branch[]>("/branches").then((b) => {
      setBranches(b);
      if (isNew) setUForm((f) => ({ ...f, branchId: f.branchId || b[0]?.id || null }));
    }).catch(() => {});
    api<{ groups: PermGroup[] }>("/auth/permissions-catalog").then((r) => setPermGroups(r.groups)).catch(() => {});
    if (!isNew) {
      api<UserRow[]>("/settings/users").then((list) => {
        const u = list.find((x) => x.id === userId);
        if (!u) { setNotFound(true); setLoaded(true); return; }
        setSavedName(u.full_name);
        setUForm({
          email: u.email, password: "", fullName: u.full_name, role: u.role,
          branchId: u.branch_id, permissions: [...u.permissions],
          isActive: u.is_active, newPassword: "",
        });
        setLoaded(true);
      }).catch(() => { setNotFound(true); setLoaded(true); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  function togglePerm(key: string) {
    setUForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key],
    }));
  }

  async function saveUser() {
    setUErr(""); setUBusy(true);
    try {
      if (isNew) {
        await api("/settings/users", {
          method: "POST",
          body: JSON.stringify({
            email: uForm.email, password: uForm.password, fullName: uForm.fullName,
            role: uForm.role, branchId: uForm.branchId, permissions: uForm.permissions,
          }),
        });
      } else {
        await api(`/settings/users/${userId}`, {
          method: "PUT",
          body: JSON.stringify({
            fullName: uForm.fullName, role: uForm.role, branchId: uForm.branchId,
            permissions: uForm.permissions, isActive: uForm.isActive,
            newPassword: uForm.newPassword.trim() || null,
          }),
        });
      }
      router.push("/settings/users");
    } catch (e: any) { setUErr(e.message); setUBusy(false); }
  }

  if (!canUsers) return <Card>لا تملك صلاحية «إدارة حسابات الموظفين».</Card>;
  if (!loaded) return <Card>جارِ التحميل…</Card>;
  if (notFound) return <Card>الموظف غير موجود. <Button variant="ghost" onClick={() => router.push("/settings/users")}>→ رجوع للقائمة</Button></Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">
          {isNew ? "إضافة موظف جديد" : `تعديل — ${savedName}`}
        </h1>
        <Button variant="ghost" onClick={() => router.push("/settings/users")}>→ رجوع للقائمة</Button>
      </div>

      <Card>
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="الاسم الكامل">
              <Input value={uForm.fullName} onChange={(e) => setUForm({ ...uForm, fullName: e.target.value })} />
            </Field>
            <Field label="البريد الإلكتروني">
              <Input dir="ltr" type="email" value={uForm.email} disabled={!isNew}
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
            {isNew ? (
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

          {!isNew && (
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] font-bold">
              <input type="checkbox" checked={uForm.isActive} className="h-4 w-4 accent-petrol"
                     onChange={(e) => setUForm({ ...uForm, isActive: e.target.checked })} />
              الحساب نشط (إلغاء التحديد = تعطيل الدخول)
            </label>
          )}
        </div>
      </Card>

      {uForm.role === "employee" && (
        <Card>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-[12px] font-extrabold text-text-dim">قوالب جاهزة — اضغط قالب ليملأ الصلاحيات ثم عدّل ما تشاء:</p>
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

            {/* شبكة الصلاحيات — على كامل مساحة الصفحة بلا تمرير داخلي */}
            {permGroups.length > 0 && (
              <div className="grid gap-3 lg:grid-cols-2">
                {permGroups.map((g) => (
                  <div key={g.group} className="rounded-lg border border-line p-3">
                    <p className="mb-1.5 text-[12px] font-extrabold text-petrol">{g.group}</p>
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
            <p className="text-[11.5px] font-bold text-text-dim">
              المحدد: {uForm.permissions.length} صلاحية
            </p>
          </div>
        </Card>
      )}

      <ErrorNote msg={uErr} />
      <div className="flex justify-end gap-2 pb-6">
        <Button variant="ghost" onClick={() => router.push("/settings/users")}>إلغاء</Button>
        <Button onClick={saveUser}
                disabled={uBusy || !uForm.fullName.trim() ||
                  (isNew && (!uForm.email.trim() || uForm.password.length < 8))}>
          {uBusy ? "جارِ الحفظ..." : "حفظ"}
        </Button>
      </div>
    </div>
  );
}
