"use client";
// الإعدادات ← التصميم — تحكم موحّد للشركة كاملة: الألوان، الخط، شكل الأزرار، القائمة الجانبية
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  cacheDesign, ensureFontLoaded, FONT_LABELS_AR, FONT_LABELS_EN, FONT_STACKS_AR, FONT_STACKS_EN, BUTTON_SHAPE_LABELS,
  FONT_SCALE_LABELS, FONT_SCALE_PERCENT,
  type DesignInfo, type ArFontKey, type EnFontKey, type ButtonShape, type FontScale,
} from "@/lib/design";
import { Button, Card, ErrorNote, Field, Select, Switch } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { contrastRatio } from "@/lib/colorUtils";
import { toast } from "@/components/toast";

type ToneKey = "primaryColor" | "successColor" | "warningColor" | "errorColor";
const TONES: { key: ToneKey; label: string; fallback: string; hint: string }[] = [
  { key: "primaryColor", label: "اللون الأساسي", fallback: "#1E3A8A", hint: "لون الأزرار الرئيسية والقضيب الجانبي والعناصر النشطة" },
  { key: "successColor", label: "لون النجاح", fallback: "#22C55E", hint: "رسائل النجاح والحالات الإيجابية" },
  { key: "warningColor", label: "لون التحذير", fallback: "#F59E0B", hint: "التنبيهات والحالات المتوسطة" },
  { key: "errorColor", label: "لون الخطأ", fallback: "#EF4444", hint: "الأخطاء والإجراءات الخطرة" },
];

const FONT_KEYS_AR = Object.keys(FONT_LABELS_AR) as ArFontKey[];
const FONT_KEYS_EN = Object.keys(FONT_LABELS_EN) as EnFontKey[];
const SCALE_KEYS = Object.keys(FONT_SCALE_LABELS) as FontScale[];
const SHAPE_KEYS = Object.keys(BUTTON_SHAPE_LABELS) as ButtonShape[];
const RADIUS_PREVIEW: Record<ButtonShape, string> = { sharp: "4px", rounded: "10px", pill: "999px" };

export default function DesignSettingsPage() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm("settings.company");

  const [settings, setSettings] = useState<DesignInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!settings) return;
    ensureFontLoaded(settings.fontFamilyAr);
    ensureFontLoaded(settings.fontFamilyEn);
  }, [settings?.fontFamilyAr, settings?.fontFamilyEn]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!canManage) return;
    api<DesignInfo>("/settings/design")
      .then(setSettings)
      .catch((e) => setErr(e.message))
      .finally(() => setLoading(false));
  }, [canManage]);

  async function save(next: DesignInfo) {
    setSettings(next); // تحديث فوري للعرض — بلا انتظار الشبكة (نفس أسلوب صفحة الخلفية)
    cacheDesign(next);  // ينعكس على كامل الموقع فوراً عبر Shell
    setSaving(true);
    setErr("");
    try {
      const saved = await api<DesignInfo>("/settings/design", { method: "PUT", body: JSON.stringify(next) });
      setSettings(saved);
      cacheDesign(saved);
      toast.success("تم حفظ إعدادات التصميم");
    } catch (e: any) {
      setErr(e.message || "تعذر حفظ إعدادات التصميم");
    } finally {
      setSaving(false);
    }
  }

  async function undo() {
    setSaving(true);
    setErr("");
    try {
      const saved = await api<DesignInfo>("/settings/design/undo", { method: "POST" });
      setSettings(saved);
      cacheDesign(saved);
      toast.success("تم التراجع عن آخر تعديل");
    } catch (e: any) {
      setErr(e.message || "تعذر التراجع عن آخر تعديل");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) return <Card>لا تملك صلاحية «بيانات الشركة والمظهر».</Card>;
  if (loading || !settings) return <Card>جارِ التحميل…</Card>;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="page-title">الإعدادات — التصميم</h1>
          <p className="page-desc">
            إعداد موحّد للشركة كاملة — أي تغيير هنا ينعكس فوراً على كل المستخدمين في كل صفحات النظام.
          </p>
        </div>
        <Button variant="outline" size="sm" className="shrink-0 gap-1" disabled={!settings.hasBackup || saving} onClick={undo}>
          <MIcon name="undo" className="!text-[15px]" /> تراجع عن آخر تعديل
        </Button>
      </div>

      {/* ── الألوان ── */}
      <Card>
        <h2 className="mb-3 text-t-md font-black">الألوان</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {TONES.map((tone) => {
            const value = settings[tone.key];
            const activeColor = value || tone.fallback;
            const weakContrast = contrastRatio(activeColor, "#FFFFFF") < 4.5;
            return (
              <div key={tone.key} className="rounded-lg border border-line p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div>
                    <div className="text-t-sm font-bold">{tone.label}</div>
                    <div className="text-t-xs text-text-dim">{tone.hint}</div>
                  </div>
                  {value && (
                    <button type="button" onClick={() => save({ ...settings, [tone.key]: null })}
                            className="shrink-0 text-t-xs font-bold text-text-dim hover:text-ember">
                      استخدام الافتراضي
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input type="color" value={value || tone.fallback}
                         onChange={(e) => save({ ...settings, [tone.key]: e.target.value })}
                         className="h-9 w-12 cursor-pointer rounded-lg border border-line bg-ink-2 p-1" />
                  <input type="text" value={value || tone.fallback}
                         onChange={(e) => {
                           const v = e.target.value;
                           if (/^#[0-9A-Fa-f]{6}$/.test(v)) save({ ...settings, [tone.key]: v });
                         }}
                         className="tnum w-24 rounded-lg border border-line bg-ink-2 px-2 py-1.5 text-t-sm uppercase"
                         placeholder={tone.fallback} />
                  {!value && <span className="text-t-xs text-text-dim">افتراضي</span>}
                </div>
                {weakContrast && (
                  <div className="mt-2 flex items-start gap-1.5 text-t-xs font-bold text-brass">
                    <MIcon name="warning" className="!text-[13px]" />
                    تباين ضعيف مع النص الأبيض على الأزرار — قد يصعب قراءته لبعض المستخدمين
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* ── الخط — عربي وإنجليزي منفصلين، كل واحد يظهر تلقائياً مع لغة الواجهة المطابقة ── */}
      <Card>
        <h2 className="mb-3 text-t-md font-black">الخط</h2>
        <p className="mb-3 text-t-xs text-text-dim">
          الخط العربي يظهر تلقائياً لما واجهة النظام تكون عربي، والخط الإنجليزي لما تكون English — حسب زر ع/EN في الأعلى.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Field label="الخط العربي">
              <Select value={settings.fontFamilyAr} onChange={(e) => save({ ...settings, fontFamilyAr: e.target.value as ArFontKey })}>
                {FONT_KEYS_AR.map((k) => <option key={k} value={k}>{FONT_LABELS_AR[k]}</option>)}
              </Select>
            </Field>
            <div className="mt-2 rounded-lg border border-line bg-ink-3 p-4 text-center" style={{ fontFamily: FONT_STACKS_AR[settings.fontFamilyAr] }}>
              <div className="text-t-2xl font-extrabold">مصدر الزيوت — فاتورة رقم 1024</div>
              <div className="mt-1 text-t-sm text-text-dim">نموذج معاينة الخط العربي</div>
            </div>
          </div>
          <div>
            <Field label="الخط الإنجليزي">
              <Select value={settings.fontFamilyEn} onChange={(e) => save({ ...settings, fontFamilyEn: e.target.value as EnFontKey })}>
                {FONT_KEYS_EN.map((k) => <option key={k} value={k}>{FONT_LABELS_EN[k]}</option>)}
              </Select>
            </Field>
            <div className="mt-2 rounded-lg border border-line bg-ink-3 p-4 text-center" style={{ fontFamily: FONT_STACKS_EN[settings.fontFamilyEn] }}>
              <div className="text-t-2xl font-extrabold">Masdar Al-Zuyout — Invoice #1024</div>
              <div className="mt-1 text-t-sm text-text-dim">English font preview</div>
            </div>
          </div>
        </div>
      </Card>

      {/* ── حجم الخط — موحّد لكل صفحات النظام: نص + أزرار + أيقونات معاً بنفس النسبة ── */}
      <Card>
        <h2 className="mb-3 text-t-md font-black">حجم الخط</h2>
        <p className="mb-3 text-t-xs text-text-dim">
          يكبّر أو يصغّر كل عناصر الواجهة معاً (النص والأزرار والأيقونات) بنسبة واحدة — ينعكس فوراً على كل صفحات النظام بعد تسجيل الدخول.
        </p>
        <div className="flex flex-wrap gap-3">
          {SCALE_KEYS.map((scale) => (
            <button key={scale} type="button" onClick={() => save({ ...settings, fontScale: scale })}
                    className={`z8-anim-btn flex flex-col items-center gap-2 rounded-card border-2 px-5 py-4 transition
                      ${settings.fontScale === scale ? "border-petrol bg-petrol-soft/40" : "border-line hover:border-petrol/50"}`}>
              <span className="font-extrabold text-petrol" style={{ fontSize: `${(FONT_SCALE_PERCENT[scale] / 100) * 15}px` }}>
                Aa أب
              </span>
              <span className="text-t-xs font-bold">{FONT_SCALE_LABELS[scale]}</span>
            </button>
          ))}
        </div>
        {settings.fontScale === "xl" && (
          <div className="mt-3 flex items-start gap-1.5 text-t-xs font-bold text-brass">
            <MIcon name="warning" className="!text-[14px]" />
            الجداول المزدحمة (مثل المخزون والتقارير) قد تبدو متقاربة على الشاشات الصغيرة بهذا الحجم.
          </div>
        )}
      </Card>

      {/* ── شكل الأزرار ── */}
      <Card>
        <h2 className="mb-3 text-t-md font-black">شكل الأزرار والبطاقات</h2>
        <div className="flex flex-wrap gap-3">
          {SHAPE_KEYS.map((shape) => (
            <button key={shape} type="button" onClick={() => save({ ...settings, buttonShape: shape })}
                    className={`flex flex-col items-center gap-2 rounded-card border-2 px-5 py-4 transition
                      ${settings.buttonShape === shape ? "border-petrol bg-petrol-soft/40" : "border-line hover:border-petrol/50"}`}>
              <span className="grid h-9 w-24 place-items-center bg-petrol text-t-xs font-bold text-white"
                    style={{ borderRadius: RADIUS_PREVIEW[shape] }}>
                زر مثال
              </span>
              <span className="text-t-xs font-bold">{BUTTON_SHAPE_LABELS[shape]}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* ── حركة الأزرار — زر Button/IconButton فقط، بلا أي تأثير على القوائم أو حجمها أو مكانها ── */}
      <Card>
        <h2 className="mb-3 text-t-md font-black">حركة الأزرار</h2>
        <label className="flex max-w-xl cursor-pointer items-center justify-between gap-3 rounded-lg border border-line p-3">
          <div>
            <div className="text-t-md font-bold">تفعيل حركة الأزرار (تكبير خفيف عند التحويم والضغط)</div>
            <div className="text-t-xs text-text-dim">تخص الأزرار فقط — القوائم الجانبية والتابات بلا تغيير في الحجم أو الحركة أو المكان</div>
          </div>
          <Switch checked={settings.buttonAnimation} onChange={(v) => save({ ...settings, buttonAnimation: v })} />
        </label>
        <div className="mt-3 flex gap-2">
          <Button>زر للتجربة</Button>
          <Button variant="outline">حرّك الفأرة فوقه</Button>
        </div>
      </Card>

      {/* ── القائمة الجانبية ── */}
      <Card>
        <h2 className="mb-3 text-t-md font-black">القائمة الجانبية</h2>
        <Field label="الحالة الافتراضية عند أول دخول" hint="كل مستخدم بعدين يقدر يطوي/يوسّع القائمة بنفسه — واختياره الشخصي يتحفظ ويتفضّل على هذا الإعداد">
          <Select value={settings.sidebarDefault}
                  onChange={(e) => save({ ...settings, sidebarDefault: e.target.value as "expanded" | "collapsed" })}
                  className="max-w-xs">
            <option value="expanded">موسّعة (تعرض الأسماء)</option>
            <option value="collapsed">مطوية (أيقونات فقط)</option>
          </Select>
        </Field>
      </Card>

      {saving && <p className="text-t-xs text-text-dim">جارِ الحفظ...</p>}
      <ErrorNote msg={err} />
    </div>
  );
}
