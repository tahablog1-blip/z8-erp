"use client";
// الإعدادات ← كاميرات المحطات — صفحة كاملة: المراقبة الذكية + الكاميرات
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { MIcon } from "@/components/m-icon";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Field, Input, Select } from "@/components/ui";
import { appAlert, appConfirm } from "@/components/dialog";

type Branch = { id: string; name: string };
type Camera = {
  id: string; branch_id: string; branch_name: string | null;
  station: number; name: string; rtsp_url: string; is_active: boolean;
};

const STATION_LABEL: Record<number, string> = {
  1: "المحطة 1 — الدخول", 2: "المحطة 2 — الزيت", 3: "المحطة 3 — التشييك",
};

export default function CamerasSettingsPage() {
  const { hasPerm } = useAuth();
  const canCompany = hasPerm("settings.company");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [camForm, setCamForm] = useState({ branchId: "", station: 1, name: "", rtspUrl: "" });
  const [camErr, setCamErr] = useState("");
  const [camBusy, setCamBusy] = useState(false);
  const [snapFor, setSnapFor] = useState<string | null>(null);
  const [snapImg, setSnapImg] = useState<{ name: string; src: string } | null>(null);

  // ── مفتاح المراقبة الذكية ──
  const [aiSup, setAiSup] = useState<boolean | null>(null);

  async function loadCameras() {
    try { setCameras(await api<Camera[]>("/cameras")); } catch { /* */ }
  }

  useEffect(() => {
    if (!canCompany) return;
    api<Branch[]>("/branches").then((b) => {
      setBranches(b);
      setCamForm((f) => ({ ...f, branchId: f.branchId || b[0]?.id || "" }));
    }).catch(() => {});
    loadCameras();
    api<{ enabled: boolean }>("/settings/ai-supervisor").then((r) => setAiSup(r.enabled)).catch(() => setAiSup(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleAiSup() {
    if (aiSup === null) return;
    const next = !aiSup;
    setAiSup(next);   // استجابة فورية
    try { await api("/settings/ai-supervisor", { method: "PUT", body: JSON.stringify({ enabled: next }) }); }
    catch (e: any) { setAiSup(!next); await appAlert(e.message); }
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

  if (!canCompany) return <Card>لا تملك صلاحية «بيانات الشركة والمظهر».</Card>;

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — كاميرات المحطات</h1>
      <Card>
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
      </Card>
    </div>
  );
}
