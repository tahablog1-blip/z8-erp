"use client";
// الإعدادات ← الأدوار والصلاحيات — Permission Matrix حقيقية ومتصلة بالقاعدة
// تحل محل ROLE_PRESETS المُثبّتة سابقاً في كود صفحة تعديل الموظف: أي تعديل هنا
// ينعكس فوراً على قوالب التعبئة السريعة في /settings/users/[userId].
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Field, Input, Switch, Textarea } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type Role = {
  id: string; name: string; icon: string; description: string | null;
  permissions: string[]; is_system: boolean; users_count: number;
};
type PermGroup = { group: string; items: { key: string; label: string }[] };

const EMPTY_FORM = { name: "", icon: "🧩", description: "", permissions: [] as string[] };

export default function RolesSettingsPage() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm("settings.users");

  const [roles, setRoles] = useState<Role[]>([]);
  const [permGroups, setPermGroups] = useState<PermGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null | "new">(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function load() {
    api<Role[]>("/settings/roles").then(setRoles).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!canManage) return;
    load();
    api<{ groups: PermGroup[] }>("/auth/permissions-catalog").then((r) => setPermGroups(r.groups)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openRole(r: Role) {
    setSelectedId(r.id);
    setForm({ name: r.name, icon: r.icon, description: r.description || "", permissions: [...r.permissions] });
    setErr("");
  }

  function openNew() {
    setSelectedId("new");
    setForm(EMPTY_FORM);
    setErr("");
  }

  function closeEditor() { setSelectedId(null); setErr(""); }

  function togglePerm(key: string) {
    setForm((f) => ({
      ...f,
      permissions: f.permissions.includes(key) ? f.permissions.filter((k) => k !== key) : [...f.permissions, key],
    }));
  }

  async function save() {
    setErr(""); setBusy(true);
    try {
      if (selectedId === "new") {
        await api("/settings/roles", { method: "POST", body: JSON.stringify(form) });
      } else if (selectedId) {
        await api(`/settings/roles/${selectedId}`, { method: "PUT", body: JSON.stringify(form) });
      }
      closeEditor();
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function remove(r: Role) {
    if (!confirm(`حذف دور «${r.name}»؟`)) return;
    setErr("");
    try {
      await api(`/settings/roles/${r.id}`, { method: "DELETE" });
      if (selectedId === r.id) closeEditor();
      load();
    } catch (e: any) { setErr(e.message); }
  }

  if (!canManage) return <Card>لا تملك صلاحية «إدارة حسابات الموظفين».</Card>;

  const editing = selectedId !== null;
  const selectedRole = typeof selectedId === "string" && selectedId !== "new"
    ? roles.find((r) => r.id === selectedId) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[19px] font-extrabold">الإعدادات — الأدوار والصلاحيات</h1>
          <p className="mt-0.5 text-[12px] text-text-dim">
            كل دور مجموعة صلاحيات جاهزة — طبّقه على أي موظف بضغطة من صفحته، وأي تعديل هنا ينعكس فوراً.
          </p>
        </div>
        <Button onClick={openNew}>+ دور جديد</Button>
      </div>

      {err && !editing && <ErrorNote msg={err} />}

      {loading ? (
        <Card>جارِ التحميل…</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {roles.map((r) => (
            <Card key={r.id} className="!p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="text-[22px] leading-none">{r.icon}</span>
                  <div className="min-w-0">
                    <div className="truncate text-[13px] font-extrabold">{r.name}</div>
                    <div className="text-[11px] text-text-dim">
                      {r.permissions.length} صلاحية · {r.users_count} موظف
                    </div>
                  </div>
                </div>
                {r.is_system && (
                  <span className="shrink-0 rounded-full bg-ink-3 px-2 py-0.5 text-[10px] font-bold text-text-dim">أساسي</span>
                )}
              </div>
              {r.description && <p className="mt-2 text-[11.5px] text-text-dim">{r.description}</p>}
              <div className="mt-3 flex gap-1.5">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openRole(r)}>تعديل</Button>
                {!r.is_system && (
                  <Button variant="danger" size="sm" onClick={() => remove(r)}
                          disabled={r.users_count > 0} title={r.users_count > 0 ? "انقل الموظفين أولاً" : undefined}>
                    <MIcon name="delete" className="!text-[16px]" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[14px] font-black">
              {selectedId === "new" ? "دور جديد" : `تعديل — ${selectedRole?.name}`}
            </h2>
            <Button variant="ghost" className="gap-1" onClick={closeEditor}><MIcon name="close" className="!text-[14px]" /> إغلاق</Button>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_90px_2fr]">
            <Field label="اسم الدور">
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </Field>
            <Field label="أيقونة">
              <Input className="text-center" value={form.icon}
                     onChange={(e) => setForm({ ...form, icon: e.target.value })} maxLength={4} />
            </Field>
            <Field label="وصف مختصر (اختياري)">
              <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </Field>
          </div>

          {permGroups.length > 0 && (
            <div className="grid gap-3 lg:grid-cols-2">
              {permGroups.map((g) => (
                <div key={g.group} className="rounded-lg border border-line p-3">
                  <p className="mb-1.5 text-[12px] font-extrabold text-petrol">{g.group}</p>
                  <div className="grid gap-1 sm:grid-cols-2">
                    {g.items.map((it) => (
                      <label key={it.key} className="flex cursor-pointer items-center gap-2 text-[12px]">
                        <Switch size="sm" checked={form.permissions.includes(it.key)} onChange={() => togglePerm(it.key)} />
                        {it.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="mt-2 text-[11.5px] font-bold text-text-dim">المحدد: {form.permissions.length} صلاحية</p>

          <ErrorNote msg={err} />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={closeEditor}>إلغاء</Button>
            <Button onClick={save} disabled={busy || !form.name.trim()}>
              {busy ? "جارِ الحفظ..." : "حفظ الدور"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
