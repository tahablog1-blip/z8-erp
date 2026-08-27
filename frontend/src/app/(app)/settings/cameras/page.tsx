"use client";
// الإعدادات ← كاميرات المحطات — صفحة كاملة: المراقبة الذكية + الكاميرات
import { useCallback, useEffect, useState } from "react";
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

/** يجمّع لقطات "غير مسجّلة" بالأرقام فقط (تتجاهل اختلاف الحروف بين القراءات)
 *  ويختار أشيع تركيبة حروف كتخمين مبدئي — نفس السيارة قد تُقرأ بحروف مختلفة
 *  كل مرة، فتجميعها بالأرقام يعطي "مطابقة إلكترونية" حقيقية بدل تكرار الصفوف. */
function groupUnknownScans(scans: any[]) {
  const byDigits = new Map<string, any[]>();
  for (const s of scans) {
    const digits = (s.plate_normalized || "").split("-")[0] || s.id;
    if (!byDigits.has(digits)) byDigits.set(digits, []);
    byDigits.get(digits)!.push(s);
  }
  return Array.from(byDigits.entries()).map(([digits, group]) => {
    const letterCounts = new Map<string, number>();
    for (const s of group) {
      const letters = (s.plate_normalized || "").split("-")[1] || "";
      if (!letters) continue;
      letterCounts.set(letters, (letterCounts.get(letters) || 0) + 1);
    }
    let bestLetters = "";
    let bestCount = 0;
    letterCounts.forEach((count, letters) => { if (count > bestCount) { bestCount = count; bestLetters = letters; } });
    const best = group.find((s) => (s.plate_normalized || "").split("-")[1] === bestLetters) || group[0];
    return { ...best, digits, guessedLetters: bestLetters, sightings: group.length, branch_id: best.branch_id };
  }).sort((a, b) => b.sightings - a.sightings);
}

const QUICK_BRANDS = ["تويوتا", "هيونداي", "نيسان", "كيا", "فورد", "شيفروليه", "هوندا", "لكزس", "مازدا", "أخرى"];
const QUICK_COLORS = ["أبيض", "أسود", "فضي", "رمادي", "أحمر", "أزرق", "بني", "أخرى"];

/** نموذج تسجيل سريع للوحة غير معروفة — إدخال البيانات يحفظ السيارة ويدخلها الطابور فوراً */
function QuickRegisterModal({ scan, onClose, onSaved }: { scan: any; onClose: () => void; onSaved: () => void }) {
  const parts = (scan.plate_normalized || "-").split("-");
  const numbers = scan.digits || parts[0] || "";
  const [letters, setLetters] = useState(scan.guessedLetters || parts[1] || "");
  const [form, setForm] = useState({
    customerName: "", customerPhone: "", brand: "", name: "", modelYear: "",
    color: "", chassisNumber: "", odometerCurrent: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function save() {
    if (!form.customerName.trim() || !form.customerPhone.trim() || !form.brand || !form.name.trim()) {
      setErr("اسم العميل والجوال والماركة والموديل إجبارية"); return;
    }
    setBusy(true); setErr("");
    try {
      await api("/cars", {
        method: "POST",
        body: JSON.stringify({
          branchId: scan.branch_id, plateLetters: letters, plateNumbers: numbers, plateType: "saudi",
          brand: form.brand, name: form.name, modelYear: form.modelYear, color: form.color,
          chassisNumber: form.chassisNumber || "00000000000000000",
          customerName: form.customerName, customerPhone: form.customerPhone,
          odometerCurrent: Number(form.odometerCurrent) || 0,
        }),
      });
      onSaved();
    } catch (e: any) { setErr(e.message || "تعذر الحفظ"); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-2xl bg-white p-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-[15px] font-black">تسجيل سيارة جديدة</h3>
        <p className="mb-3 text-[12px] text-text-dim">
          {scan.sightings > 1 ? `رُصدت اللوحة ${scan.sightings} مرات — أفضل قراءة للحروف تلقائياً، عدّلها لو غير صحيحة` : "أكمل البيانات ليدخل الطابور فوراً"}
        </p>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Field label="الأرقام">
            <Input className="tnum" value={numbers} disabled />
          </Field>
          <Field label="الحروف — عدّلها لو التخمين غير صحيح">
            <Input dir="ltr" className="tnum" value={letters}
                   onChange={(e) => setLetters(e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))} />
          </Field>
          <Field label="اسم العميل *"><Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} /></Field>
          <Field label="جوال العميل *"><Input className="tnum" value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} /></Field>
          <Field label="الماركة *">
            <Select value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}>
              <option value="">اختر</option>
              {QUICK_BRANDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </Select>
          </Field>
          <Field label="الموديل *"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="سنة الصنع"><Input className="tnum" value={form.modelYear} onChange={(e) => setForm({ ...form, modelYear: e.target.value })} /></Field>
          <Field label="اللون">
            <Select value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })}>
              <option value="">اختر</option>
              {QUICK_COLORS.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          </Field>
          <Field label="الممشى الحالي">
            <Input className="tnum" value={form.odometerCurrent}
                   onChange={(e) => setForm({ ...form, odometerCurrent: e.target.value.replace(/[^0-9]/g, "") })} />
          </Field>
        </div>
        <ErrorNote msg={err} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>إلغاء</Button>
          <Button onClick={save} disabled={busy}>{busy ? "جارِ الحفظ..." : "✓ حفظ وتأكيد الدخول"}</Button>
        </div>
      </div>
    </div>
  );
}

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

  // ── 🩺 فحص كل الكاميرات دفعة واحدة — بدون الدخول على كل كاميرا ──
  const [healthBusy, setHealthBusy] = useState(false);
  const [health, setHealth] = useState<Record<string, boolean>>({});
  const [healthAt, setHealthAt] = useState<string>("");

  // ═══ 🎛 مركز تحكم البوابة الذكية — كل الإعدادات في مكان واحد منظم ═══
  const [gwOn, setGwOn] = useState<boolean | null>(null);
  const [gwRunning, setGwRunning] = useState(false);
  const [gwCams, setGwCams] = useState<
    { id: string; name: string; is_active: boolean; ok: boolean | null; last: string }[]>([]);
  const [visionModel, setVisionModel] = useState("");
  const [visionModels, setVisionModels] = useState<Record<string, string>>({});

  const loadGate = useCallback(() => {
    api<{ enabled: boolean; running: boolean }>("/auto-checkin/watcher-status")
      .then((r) => { setGwOn(r.enabled); setGwRunning(r.running); }).catch(() => setGwOn(null));
    api<{ cameras: any[] }>("/auto-checkin/cameras-status")
      .then((r) => setGwCams(r.cameras)).catch(() => {});
    api<{ model: string; available: Record<string, string> }>("/auto-checkin/vision-model")
      .then((r) => { setVisionModel(r.model); setVisionModels(r.available); }).catch(() => {});
  }, []);

  async function toggleMaster() {
    if (gwOn === null) return;
    const r = await api<{ enabled: boolean; running: boolean }>(
      `/auto-checkin/watcher-toggle?enabled=${!gwOn}`, { method: "POST" }).catch(() => null);
    if (r) { setGwOn(r.enabled); setGwRunning(r.running); }
  }

  async function toggleGwCam(id: string, enabled: boolean) {
    await api(`/auto-checkin/camera-toggle?camera_id=${id}&enabled=${enabled}`, { method: "POST" }).catch(() => {});
    setGwCams((l) => l.map((c) => (c.id === id ? { ...c, is_active: enabled } : c)));
  }

  async function changeModel(m: string) {
    setVisionModel(m);
    await api(`/auto-checkin/vision-model?model=${encodeURIComponent(m)}`, { method: "POST" }).catch(() => {});
  }

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

  useEffect(() => {
    loadGate();
    const t = setInterval(loadGate, 10000);
    return () => clearInterval(t);
  }, [loadGate]);

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
  async function checkAll() {
    setHealthBusy(true); setCamErr("");
    try {
      const r = await api<{ cameras: { id: string; ok: boolean }[]; all_ok: boolean }>(
        "/cameras/health-check", { method: "POST" });
      const map: Record<string, boolean> = {};
      r.cameras.forEach((c) => { map[c.id] = c.ok; });
      setHealth(map);
      setHealthAt(new Date().toLocaleTimeString("ar-SA-u-nu-latn", { hour: "2-digit", minute: "2-digit" }));
    } catch (e: any) { setCamErr(e.message); }
    finally { setHealthBusy(false); }
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
      {/* ═══ 🎛 مركز تحكم البوابة الذكية — رسمي ومنظم في مكان واحد ═══ */}
      <Card>
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="flex items-center gap-2 text-[14.5px] font-black">
                🎛 البوابة الذكية — الدخول التلقائي
                <span className={`inline-block h-2.5 w-2.5 rounded-full ${gwOn && gwRunning ? "animate-pulse bg-emerald" : gwOn === false ? "bg-ember" : "bg-line"}`} />
              </h2>
              <p className="mt-0.5 text-[11.5px] text-text-dim">
                أي لوحة معروفة (ملف سابق أو حجز) تظهر أمام الكاميرا = دخول/تأكيد وصول فوري — بلا أي تدخل
              </p>
            </div>
            {/* المفتاح الرئيسي */}
            <button onClick={toggleMaster} disabled={gwOn === null}
                    className="relative inline-flex h-7 w-13 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
                    style={{ background: gwOn ? "#16A34A" : "#CBD5E1", width: 52 }}>
              <span className="absolute h-6 w-6 rounded-full bg-white shadow transition-all"
                    style={{ right: gwOn ? 2 : 24 }} />
            </button>
          </div>

          {/* كاميرات البوابة — مفتاح مستقل + مؤشر حي لكل كاميرا */}
          <div className="grid gap-2 sm:grid-cols-2">
            {gwCams.map((c) => (
              <div key={c.id} className="flex items-center justify-between rounded-xl border border-line bg-ink-2 px-3.5 py-2.5">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ background: !c.is_active ? "#CBD5E1" : c.ok === null ? "#F59E0B" : c.ok ? "#16A34A" : "#DC2626" }} />
                  <span className="truncate text-[12.5px] font-bold">{c.name}</span>
                  {c.last && <span className="tnum shrink-0 text-[10px] text-text-dim">{c.last}</span>}
                </span>
                <button onClick={() => toggleGwCam(c.id, !c.is_active)}
                        className="relative inline-flex h-6 shrink-0 items-center rounded-full transition-colors"
                        style={{ background: c.is_active ? "#16A34A" : "#CBD5E1", width: 44 }}>
                  <span className="absolute h-5 w-5 rounded-full bg-white shadow transition-all"
                        style={{ right: c.is_active ? 2 : 22 }} />
                </button>
              </div>
            ))}
            {gwCams.length === 0 && (
              <p className="col-span-full py-2 text-center text-[11.5px] text-text-dim">لا كاميرات مسجلة على محطة الدخول بعد</p>
            )}
          </div>

          {/* نموذج قراءة اللوحات */}
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-ink-2 px-3.5 py-2.5">
            <span className="text-[12.5px] font-black">🧠 نموذج قراءة اللوحات:</span>
            <select className="rounded-lg border border-line bg-ink px-3 py-1.5 text-[12px] font-bold"
                    value={visionModel} onChange={(e) => changeModel(e.target.value)}>
              {Object.entries(visionModels).map(([id, label]) => (
                <option key={id} value={id}>{label}</option>
              ))}
            </select>
            <span className="text-[10.5px] text-text-dim">يُطبق فوراً ويُحفظ بشكل دائم</span>
          </div>

          <p className="text-[10.5px] font-bold text-text-dim">
            🟢 تلتقط · 🔴 لا تستجيب · 🟠 بانتظار أول التقاط · ⚪ موقوفة — تتحدث كل 10 ثوانٍ
          </p>
        </div>
      </Card>

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
          {/* ══ تشغيل وفحص كل الكاميرات بضغطة — بدون فتح كل كاميرا ══ */}
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-ink-2 p-3">
            <Button onClick={checkAll} disabled={healthBusy || cameras.length === 0}>
              {healthBusy ? "جارِ فحص الكاميرات…" : "🩺 تشغيل وفحص كل الكاميرات"}
            </Button>
            {healthAt && (
              <span className="text-[12px] font-bold">
                {Object.values(health).every(Boolean) && Object.keys(health).length > 0
                  ? <span className="text-emerald">✓ كل الكاميرات تعمل بشكل صحيح</span>
                  : <span className="text-ember">⚠ {Object.values(health).filter((v) => !v).length} كاميرا لا تستجيب</span>}
                <span className="mr-2 text-text-dim">· آخر فحص {healthAt}</span>
              </span>
            )}
          </div>
          <p className="text-[12px] text-text-dim">
            سجّل كاميرا لكل محطة (RTSP) واضغط «اختبار لقطة» للتأكد من التوصيل — دي البنية اللي المراقبة الذكية هتشتغل عليها.
          </p>
          {cameras.length > 0 && (
            <div className="divide-y divide-line rounded-lg border border-line">
              {cameras.map((c) => (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-[12.5px]">
                  <div className="min-w-0">
                    <div className="font-bold">
                      {health[c.id] !== undefined && (
                        <span className={`ml-1.5 inline-block h-2.5 w-2.5 rounded-full ${health[c.id] ? "bg-emerald" : "bg-ember"}`}
                              title={health[c.id] ? "تعمل ✓" : "لا تستجيب ✗"} />
                      )}
                      {c.name}
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
