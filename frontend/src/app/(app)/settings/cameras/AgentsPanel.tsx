"use client";
// الإعدادات ← كاميرات المحطات ← وكلاء المحطات: برنامج يعمل على كمبيوتر داخل شبكة المحطة ويقرأ الكاميرات (عناوين خاصة) ويتصل بالسيرفر خارجياً فقط
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { Badge, Button, Card, ErrorNote, Field, Input, Modal, Select } from "@/components/ui";
import { appConfirm } from "@/components/dialog";

type AgentCam = { id: string; name: string; ok: boolean; reason: string };
type Agent = { id: string; name: string; branchName: string; version: string | null; lastSeen: string | null; online: boolean; revoked: boolean; cameras: AgentCam[] };
type Branch = { id: string; name: string };

function ago(iso: string | null) {
  if (!iso) return "لم يتصل بعد";
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `قبل ${s} ث`;
  if (s < 3600) return `قبل ${Math.round(s / 60)} د`;
  return `قبل ${Math.round(s / 3600)} س`;
}

export function AgentsPanel() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [form, setForm] = useState({ branchId: "", name: "" });
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setAgents(await api<Agent[]>("/edge/admin/agents")); } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر التحميل"); }
  }, []);
  useEffect(() => {
    void load();
    api<Branch[]>("/branches").then((b) => { setBranches(b); setForm((f) => ({ ...f, branchId: f.branchId || b[0]?.id || "" })); }).catch(() => {});
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  async function create() {
    setBusy(true); setErr("");
    try {
      const r = await api<{ key: string }>("/edge/admin/agents", { method: "POST", body: JSON.stringify(form) });
      setShown({ name: form.name, key: r.key }); setForm((f) => ({ ...f, name: "" })); await load();
    } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر الإنشاء"); } finally { setBusy(false); }
  }
  async function revoke(a: Agent) {
    if (!(await appConfirm(`إلغاء الوكيل «${a.name}»؟ سيتوقف فوراً ويعود السيرفر لمحاولة الوصول للكاميرات مباشرة.`))) return;
    try { await api(`/edge/admin/agents/${a.id}/revoke`, { method: "POST" }); await load(); } catch (e) { setErr(e instanceof Error ? e.message : "تعذّر الإلغاء"); }
  }

  return (
    <Card>
      <div className="mb-1 flex items-center gap-2"><MIcon name="router" className="!text-[22px] text-petrol" /><h2 className="text-t-lg font-extrabold">وكلاء المحطات</h2></div>
      <p className="mb-4 text-t-sm text-text-dim">
        إن كانت الكاميرات على عناوين داخلية (192.168.x.x) فلا يصل إليها السيرفر في السحابة. ثبّت «وكيل المحطة» على كمبيوتر داخل شبكة المحطة؛ يقرأ الكاميرات محلياً
        ويتصل بالسيرفر اتصالاً خارجياً فقط — <b>بلا IP عالمي وبلا فتح منافذ</b>. عند اتصال الوكيل يتوقف السيرفر عن محاولة الوصول المباشر لكاميرات فرعه.
      </p>
      <ErrorNote msg={err} />
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div className="w-52"><Field label="الفرع"><Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>{branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field></div>
        <div className="min-w-[220px] flex-1"><Field label="اسم الوكيل"><Input value={form.name} placeholder="مثال: كمبيوتر المحطة" onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field></div>
        <Button onClick={() => void create()} disabled={busy || !form.name.trim() || !form.branchId}>إنشاء وكيل</Button>
      </div>
      {agents.length === 0 ? <div className="text-t-sm text-text-dim">لا يوجد وكلاء بعد.</div> : (
        <div className="space-y-3">
          {agents.map((a) => (
            <div key={a.id} className="border border-line p-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className={`h-2.5 w-2.5 rounded-full ${a.revoked ? "bg-text-dim" : a.online ? "bg-emerald" : "bg-ember"}`} />
                <div className="min-w-0 flex-1">
                  <div className="text-t-md font-extrabold">{a.name} <span className="text-t-sm font-bold text-text-dim">— {a.branchName}</span></div>
                  <div className="text-t-xs text-text-dim">{a.revoked ? "ملغى" : a.online ? "متصل" : "غير متصل"} · آخر نبضة: {ago(a.lastSeen)}{a.version ? ` · الإصدار ${a.version}` : ""}</div>
                </div>
                {!a.revoked && <Button size="sm" variant="danger" onClick={() => void revoke(a)}>إلغاء</Button>}
              </div>
              {a.cameras.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {a.cameras.map((c) => <span key={c.id} title={c.reason}><Badge tone={c.ok ? "good" : "danger"}>{c.name}{c.ok ? "" : ` — ${c.reason || "لا لقطة"}`}</Badge></span>)}
                </div>)}
            </div>))}
        </div>)}

      <Modal open={!!shown} onClose={() => setShown(null)} title={`مفتاح الوكيل — ${shown?.name ?? ""}`}>
        {shown && (
          <div className="space-y-3">
            <div className="text-t-sm font-bold text-ember">احفظ المفتاح الآن: لن يظهر مرة أخرى (يمكنك إلغاء الوكيل وإنشاء غيره).</div>
            <div dir="ltr" className="select-all break-all bg-ink-3 p-3 text-t-md font-bold">{shown.key}</div>
            <div className="text-t-sm text-text-dim">على كمبيوتر المحطة ضع في ملف <b>agent.env</b> بجانب البرنامج:</div>
            <pre dir="ltr" className="select-all bg-ink-3 p-3 text-t-sm">{`Z8_SERVER=${typeof window !== "undefined" ? window.location.origin : ""}\nZ8_AGENT_KEY=${shown.key}`}</pre>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(shown.key)}>نسخ المفتاح</Button><Button onClick={() => setShown(null)}>تم</Button></div>
          </div>)}
      </Modal>
    </Card>
  );
}
