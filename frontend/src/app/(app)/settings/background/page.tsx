"use client";
// الإعدادات ← الخلفية — معرض خلفيات متعدد للنظام كامل + تحكم بالشفافية/التمويه/التعتيم/العرض
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { cacheBackground } from "@/lib/background";
import { Button, Card, ErrorNote, Field, Select } from "@/components/ui";
import { MIcon } from "@/components/m-icon";

type Bg = { id: string; name: string; image_url: string; created_at: string | null };
type BgSettings = {
  activeId: string | null; activeImageUrl: string | null;
  opacity: number; overlayDarkness: number; blur: number; fit: "cover" | "contain" | "repeat";
};

export default function BackgroundSettingsPage() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm("settings.company");

  const [list, setList] = useState<Bg[]>([]);
  const [settings, setSettings] = useState<BgSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  function load() {
    Promise.all([
      api<Bg[]>("/settings/backgrounds"),
      api<BgSettings>("/settings/background-settings"),
    ]).then(([bgs, s]) => { setList(bgs); setSettings(s); })
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }
  useEffect(() => { if (canManage) load(); }, [canManage]);

  function pickFile() { fileRef.current?.click(); }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { setErr("الملف المختار مش صورة"); return; }
    if (file.size > 3_000_000) { setErr("حجم الصورة أكبر من 3 ميجابايت — اختر صورة أصغر"); return; }
    setErr(""); setUploadBusy(true);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = reject;
        r.readAsDataURL(file);
      });
      const created = await api<Bg>("/settings/backgrounds", {
        method: "POST", body: JSON.stringify({ name: file.name.replace(/\.[^.]+$/, "") || "خلفية", imageBase64: b64 }),
      });
      setList((prev) => [created, ...prev]);
    } catch (e: any) { setErr(e.message || "تعذر رفع الخلفية"); }
    finally { setUploadBusy(false); }
  }

  async function activate(id: string | null) {
    if (!settings) return;
    setErr("");
    try {
      const saved = await api<BgSettings>("/settings/background-settings", {
        method: "PUT", body: JSON.stringify({ ...settings, activeId: id }),
      });
      setSettings(saved);
      cacheBackground(saved);
    } catch (e: any) { setErr(e.message); }
  }

  async function remove(bg: Bg) {
    if (!confirm(`حذف الخلفية «${bg.name}»؟`)) return;
    setErr("");
    try {
      await api(`/settings/backgrounds/${bg.id}`, { method: "DELETE" });
      setList((prev) => prev.filter((b) => b.id !== bg.id));
      if (settings?.activeId === bg.id) {
        const saved = await api<BgSettings>("/settings/background-settings");
        setSettings(saved);
        cacheBackground(saved);
      }
    } catch (e: any) { setErr(e.message); }
  }

  async function saveControls(patch: Partial<BgSettings>) {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next); // تحديث فوري للعرض — بلا انتظار الشبكة
    setSavingSettings(true);
    try {
      const saved = await api<BgSettings>("/settings/background-settings", { method: "PUT", body: JSON.stringify(next) });
      setSettings(saved);
      cacheBackground(saved);
    } catch (e: any) { setErr(e.message); }
    finally { setSavingSettings(false); }
  }

  if (!canManage) return <Card>لا تملك صلاحية «بيانات الشركة والمظهر».</Card>;
  if (loading || !settings) return <Card>جارِ التحميل…</Card>;

  return (
    <div className="space-y-4">
      <h1 className="text-[19px] font-extrabold">الإعدادات — الخلفية</h1>
      <p className="text-[12.5px] text-text-dim">
        خلفية موحدة تظهر خلف كل صفحات النظام بعد تسجيل الدخول — ارفع كذا خلفية، فعّل أي واحدة، واحذف ما لا تحتاجه.
      </p>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[14px] font-black">معرض الخلفيات</h2>
          <Button onClick={pickFile} disabled={uploadBusy}>{uploadBusy ? "جارِ الرفع..." : "+ رفع خلفية جديدة"}</Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* بطاقة «بلا خلفية» — الوضع الافتراضي الآمن */}
          <button type="button" onClick={() => activate(null)}
                  className={`relative overflow-hidden rounded-xl border-2 p-3 text-right transition
                    ${!settings.activeId ? "border-petrol" : "border-line hover:border-petrol/50"}`}>
            <div className="grid h-28 place-items-center rounded-lg bg-ink-3 text-[11px] font-bold text-text-dim">بلا خلفية</div>
            <div className="mt-2 flex items-center justify-between text-[12px] font-bold">
              <span>الوضع الافتراضي</span>
              {!settings.activeId && <MIcon name="check_circle" className="!text-[18px] text-petrol" />}
            </div>
          </button>

          {list.map((bg) => (
            <div key={bg.id}
                 className={`relative overflow-hidden rounded-xl border-2 p-3 text-right transition
                   ${settings.activeId === bg.id ? "border-petrol" : "border-line"}`}>
              <button type="button" onClick={() => activate(bg.id)} className="block w-full">
                <div className="h-28 rounded-lg bg-ink-3 bg-cover bg-center" style={{ backgroundImage: `url(${bg.image_url})` }} />
                <div className="mt-2 flex items-center justify-between text-[12px] font-bold">
                  <span className="truncate">{bg.name}</span>
                  {settings.activeId === bg.id && <MIcon name="check_circle" className="!text-[18px] shrink-0 text-petrol" />}
                </div>
              </button>
              <button type="button" onClick={() => remove(bg)} title="حذف"
                      className="absolute left-2 top-2 grid h-7 w-7 place-items-center rounded-lg bg-ink/80 text-white hover:bg-ember">
                <MIcon name="delete" className="!text-[16px]" />
              </button>
            </div>
          ))}
        </div>
        {list.length === 0 && (
          <p className="mt-3 text-[11.5px] text-text-dim">لا توجد خلفيات مرفوعة بعد — ابدأ برفع أول خلفية.</p>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-[14px] font-black">التحكم بالعرض</h2>
        <div className="max-w-xl space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-[12.5px] font-bold">
              <span>شفافية لوحة المحتوى</span><span className="tnum text-text-dim">{settings.opacity}%</span>
            </div>
            <input type="range" min={20} max={100} value={settings.opacity} className="w-full accent-petrol"
                   onChange={(e) => setSettings({ ...settings, opacity: Number(e.target.value) })}
                   onMouseUp={(e) => saveControls({ opacity: Number((e.target as HTMLInputElement).value) })}
                   onTouchEnd={(e) => saveControls({ opacity: Number((e.target as HTMLInputElement).value) })} />
            <p className="mt-0.5 text-[11px] text-text-dim">100% = لوحة المحتوى معتّمة بالكامل (بلا تأثير بصري) — كل ما قلّلت، الخلفية تبان أكتر من تحتها.</p>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12.5px] font-bold">
              <span>تعتيم الخلفية (Overlay)</span><span className="tnum text-text-dim">{settings.overlayDarkness}%</span>
            </div>
            <input type="range" min={0} max={100} value={settings.overlayDarkness} className="w-full accent-petrol"
                   onChange={(e) => setSettings({ ...settings, overlayDarkness: Number(e.target.value) })}
                   onMouseUp={(e) => saveControls({ overlayDarkness: Number((e.target as HTMLInputElement).value) })}
                   onTouchEnd={(e) => saveControls({ overlayDarkness: Number((e.target as HTMLInputElement).value) })} />
            <p className="mt-0.5 text-[11px] text-text-dim">طبقة سوداء فوق الصورة نفسها — تساعد وضوح النص فوق صور فاتحة أو مزدحمة.</p>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12.5px] font-bold">
              <span>درجة التمويه (Blur)</span><span className="tnum text-text-dim">{settings.blur}px</span>
            </div>
            <input type="range" min={0} max={20} value={settings.blur} className="w-full accent-petrol"
                   onChange={(e) => setSettings({ ...settings, blur: Number(e.target.value) })}
                   onMouseUp={(e) => saveControls({ blur: Number((e.target as HTMLInputElement).value) })}
                   onTouchEnd={(e) => saveControls({ blur: Number((e.target as HTMLInputElement).value) })} />
          </div>
          <Field label="طريقة العرض">
            <Select value={settings.fit} onChange={(e) => saveControls({ fit: e.target.value as BgSettings["fit"] })}>
              <option value="cover">تمدد لتغطية الشاشة (Cover)</option>
              <option value="contain">احتواء كامل الصورة (Contain)</option>
              <option value="repeat">تكرار (Repeat)</option>
            </Select>
          </Field>
          {savingSettings && <p className="text-[11px] text-text-dim">جارِ الحفظ...</p>}
        </div>
      </Card>

      <ErrorNote msg={err} />
    </div>
  );
}
