"use client";
// الإعدادات ← تابلت الكاشير: رموز الدخول (9 أرقام) لكل فرع، رموز الكاشيرين، الأجهزة المفعّلة
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, PageHeader, Select } from "@/components/ui";
import { appConfirm } from "@/components/dialog";

type Code = { kind: string; label: string; hasCode: boolean; rotatedAt: string | null; actsAsUserId: string | null; actsAsName: string | null };
type Person = { id: string; fullName: string };
type BranchBlock = { branchId: string; branchName: string; codes: Code[]; cashiers: (Person & { hasPin: boolean })[]; candidates: Record<string, Person[]> };
type Device = { id: string; name: string; branchName: string; lastSeenAt: string; revoked: boolean };

const KIND_HINT: Record<string, string> = {
  cashier: "يفتح بطاقات كاشيري الفرع (لكل كاشير رمزه الخاص).",
  service_notes: "يفتح قسم ملاحظات الخدمة باسم المستخدم المختار.",
  cars: "يفتح تسجيل السيارات في الدور باسم المستخدم المختار.",
  workorder: "يفتح إصدار أمر العمل باسم المستخدم المختار.",
};

export default function TerminalSettingsPage() {
  const [data, setData] = useState<BranchBlock[] | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [err, setErr] = useState("");
  const [pick, setPick] = useState<Record<string, string>>({});          // branch|kind → user id
  const [shown, setShown] = useState<{ label: string; branch: string; code: string } | null>(null);
  const [pinFor, setPinFor] = useState<{ id: string; name: string } | null>(null);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const [o, d] = await Promise.all([api<{ branches: BranchBlock[] }>("/terminal/admin/overview"), api<Device[]>("/terminal/admin/devices")]);
      setData(o.branches); setDevices(d); setErr("");
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر التحميل"); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function makeCode(b: BranchBlock, c: Code) {
    const key = `${b.branchId}|${c.kind}`;
    const acts = c.kind === "cashier" ? null : (pick[key] || c.actsAsUserId);
    if (c.kind !== "cashier" && !acts) { setErr("اختر المستخدم أولاً"); return; }
    if (c.hasCode && !(await appConfirm("سيتوقف الرمز الحالي عن العمل ويصبح الرمز الجديد هو المعتمد. متابعة؟"))) return;
    setBusy(key); setErr("");
    try {
      const r = await api<{ code: string }>("/terminal/admin/codes", { method: "POST", body: JSON.stringify({ branchId: b.branchId, kind: c.kind, actsAsUserId: acts }) });
      setShown({ label: c.label, branch: b.branchName, code: r.code });
      await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر الإنشاء"); }
    finally { setBusy(""); }
  }

  async function removeCode(b: BranchBlock, c: Code) {
    if (!(await appConfirm(`حذف رمز «${c.label}» لفرع ${b.branchName}؟`))) return;
    try { await api("/terminal/admin/codes/delete", { method: "POST", body: JSON.stringify({ branchId: b.branchId, kind: c.kind }) }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذّر الحذف"); }
  }

  async function savePin() {
    if (!pinFor) return;
    setBusy("pin"); setErr("");
    try { await api("/terminal/admin/pin", { method: "POST", body: JSON.stringify({ userId: pinFor.id, pin }) }); setPinFor(null); setPin(""); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذّر الحفظ"); }
    finally { setBusy(""); }
  }

  async function toggleDevice(d: Device) {
    if (!d.revoked && !(await appConfirm(`إيقاف الجهاز «${d.name}»؟ سيُقطع فوراً ويحتاج رمز تفعيل جديداً.`))) return;
    try { await api(`/terminal/admin/devices/${d.id}/${d.revoked ? "restore" : "revoke"}`, { method: "POST" }); await load(); }
    catch (e) { setErr(e instanceof Error ? e.message : "تعذّر التنفيذ"); }
  }

  return (
    <div className="space-y-4">
      <PageHeader title="تابلت الكاشير" description="رموز الدخول المكوّنة من 9 أرقام لكل فرع، ورموز الكاشيرين، والأجهزة المفعّلة. الرمز يظهر مرة واحدة فقط عند إنشائه." />
      <ErrorNote msg={err} />
      {!data ? <Card>جارِ التحميل…</Card> : data.map((b) => (
        <Card key={b.branchId}>
          <h2 className="mb-3 text-t-lg font-extrabold">{b.branchName}</h2>
          <div className="divide-y divide-line">
            {b.codes.map((c) => {
              const key = `${b.branchId}|${c.kind}`;
              const cands = b.candidates[c.kind] || [];
              return (
                <div key={c.kind} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-[200px] flex-1">
                    <div className="text-t-md font-extrabold">{c.label}</div>
                    <div className="text-t-xs text-text-dim">{KIND_HINT[c.kind]}</div>
                    {c.actsAsName && <div className="text-t-xs text-text-dim">يعمل باسم: <b>{c.actsAsName}</b></div>}
                  </div>
                  {c.kind !== "cashier" && (
                    <div className="w-56">
                      <Select value={pick[key] ?? c.actsAsUserId ?? ""} onChange={(e) => setPick({ ...pick, [key]: e.target.value })}>
                        <option value="">اختر المستخدم…</option>
                        {cands.map((u) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                      </Select>
                    </div>)}
                  <Badge tone={c.hasCode ? "good" : "warn"}>{c.hasCode ? "مضبوط" : "غير مضبوط"}</Badge>
                  <Button size="sm" onClick={() => void makeCode(b, c)} disabled={busy === key}>{c.hasCode ? "تغيير الرمز" : "إنشاء رمز"}</Button>
                  {c.hasCode && <Button size="sm" variant="ghost" onClick={() => void removeCode(b, c)}>حذف</Button>}
                </div>);
            })}
          </div>
          <h3 className="mb-2 mt-5 text-t-md font-extrabold">رموز الكاشيرين</h3>
          {b.cashiers.length === 0 ? <div className="text-t-sm text-text-dim">لا يوجد كاشيرون مرتبطون بهذا الفرع (المستخدم يحتاج فرعاً وصلاحية إصدار فواتير).</div> : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {b.cashiers.map((u) => (
                <div key={u.id} className="flex items-center gap-3 border border-line p-2.5">
                  <div className="grid h-9 w-9 place-items-center rounded-full bg-petrol-soft font-black text-petrol">{u.fullName.trim().charAt(0)}</div>
                  <div className="min-w-0 flex-1"><div className="truncate text-t-sm font-bold">{u.fullName}</div><div className="text-t-xs text-text-dim">{u.hasPin ? "رمزه مضبوط" : "بلا رمز"}</div></div>
                  <Button size="sm" variant="ghost" onClick={() => { setPinFor({ id: u.id, name: u.fullName }); setPin(""); }}>{u.hasPin ? "تغيير" : "ضبط"}</Button>
                </div>))}
            </div>)}
        </Card>))}
      <Card>
        <h2 className="mb-3 text-t-lg font-extrabold">الأجهزة المفعّلة</h2>
        {devices.length === 0 ? <div className="text-t-sm text-text-dim">لم يُفعَّل أي جهاز بعد.</div> : (
          <div className="divide-y divide-line">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 py-2.5">
                <MIcon name="tablet_android" className="!text-[22px] text-text-dim" />
                <div className="min-w-0 flex-1"><div className="text-t-sm font-bold">{d.name} — {d.branchName}</div><div className="text-t-xs text-text-dim">آخر ظهور: {new Date(d.lastSeenAt).toLocaleString("en-GB")}</div></div>
                {d.revoked && <Badge tone="danger">موقوف</Badge>}
                <Button size="sm" variant={d.revoked ? "ghost" : "danger"} onClick={() => void toggleDevice(d)}>{d.revoked ? "استعادة" : "إيقاف"}</Button>
              </div>))}
          </div>)}
      </Card>

      <Modal open={!!shown} onClose={() => setShown(null)} title="الرمز الجديد">
        {shown && (
          <div className="space-y-3 text-center">
            <div className="text-t-sm text-text-dim">{shown.label} — فرع {shown.branch}</div>
            <div dir="ltr" className="tnum bg-ink-3 py-4 text-t-3xl font-black tracking-[0.3em]">{shown.code}</div>
            <div className="text-t-sm font-bold text-ember">احفظ الرمز الآن: لن يظهر مرة أخرى (يمكنك تغييره بإنشاء رمز جديد).</div>
            <div className="flex justify-center gap-2">
              <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(shown.code)}>نسخ</Button>
              <Button onClick={() => setShown(null)}>تم</Button>
            </div>
          </div>)}
      </Modal>
      <Modal open={!!pinFor} onClose={() => setPinFor(null)} title={`رمز الكاشير — ${pinFor?.name ?? ""}`}>
        <div className="space-y-3">
          <Field label="الرمز (من 4 إلى 8 أرقام)"><Input dir="ltr" className="tnum text-center" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} autoFocus /></Field>
          <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setPinFor(null)}>إلغاء</Button><Button onClick={() => void savePin()} disabled={pin.length < 4 || busy === "pin"}>حفظ</Button></div>
        </div>
      </Modal>
    </div>
  );
}
