"use client";
// الإعدادات ← المستخدمون والصلاحيات — صفحة كاملة: القائمة، والتعديل بصفحة مستقلة
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card } from "@/components/ui";

type UserRow = {
  id: string; email: string; full_name: string; role: string;
  branch_id: string | null; branch_name: string | null;
  permissions: string[]; is_active: boolean; last_login_at: string | null;
};

export default function UsersSettingsPage() {
  const router = useRouter();
  const { hasPerm } = useAuth();
  const canUsers = hasPerm("settings.users");
  const [users, setUsers] = useState<UserRow[]>([]);

  useEffect(() => {
    if (!canUsers) return;
    api<UserRow[]>("/settings/users").then(setUsers).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!canUsers) return <Card>لا تملك صلاحية «إدارة حسابات الموظفين».</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-[19px] font-extrabold">الإعدادات — المستخدمون والصلاحيات</h1>
        <Button onClick={() => router.push("/settings/users/new")}>+ موظف جديد</Button>
      </div>
      <Card>
        <p className="mb-3 text-[12px] text-text-dim">حسابات الموظفين وأدوارهم وصلاحياتهم على كل قسم في المنظومة — اضغط أي موظف لفتح صفحته الكاملة.</p>
        <div className="divide-y divide-line rounded-lg border border-line">
          {users.map((u) => (
            <button key={u.id} onClick={() => router.push(`/settings/users/${u.id}`)}
                    className="flex w-full flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-right text-[12.5px] transition hover:bg-ink-2">
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
              <span className="shrink-0 text-[12px] font-bold text-petrol">فتح ←</span>
            </button>
          ))}
          {users.length === 0 && (
            <p className="px-3 py-6 text-center text-[12px] text-text-dim">لا يوجد موظفون بعد — ابدأ بزر «+ موظف جديد»</p>
          )}
        </div>
      </Card>
    </div>
  );
}
