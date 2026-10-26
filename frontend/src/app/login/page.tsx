"use client";
// شاشة الدخول — بنفس حسابات النظام الحالي (نفس bcrypt hashes في القاعدة)
// + مؤشر فحص اتصال ذاتي: بيقولك فوراً لو الباك اند مش واصل قبل ما تكتب بياناتك
import { PasswordInput } from "@/components/PasswordInput";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input, ErrorNote } from "@/components/ui";
import { NAV_MODULES } from "@/modules/registry";

type ConnState = "checking" | "ok" | "down";

/** الاكتشاف التلقائي الاحتياطي: المدير → لوحة القيادة، والموظف → أول شاشة مسموحة له. */
function autoLandingPath(u: any): string {
  if (!u || u.role === "admin") return "/dashboard";
  const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
  const first = NAV_MODULES.find(
    (m) => !m.adminOnly && (m.permissions.length === 0 || m.permissions.some((p) => perms.includes(p)))
  );
  return first?.path || "/dashboard";
}

/** هل المستخدم يملك صلاحية الوصول لمسار معيّن؟ — تأمين الوجهة المخصّصة (إعداد 8)
 *  قبل استخدامها، حتى لو اختارت الإدارة مساراً أصبح لاحقاً غير متاح لهذا الدور. */
function canAccess(u: any, path: string): boolean {
  if (!u) return false;
  if (u.role === "admin") return true;
  const mod = NAV_MODULES.find((m) => m.path === path);
  if (!mod || mod.adminOnly) return false;
  const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
  return mod.permissions.length === 0 || mod.permissions.some((p) => perms.includes(p));
}

export default function LoginPage() {
  const { login, completeTotp } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<ConnState>("checking");
  // الخطوة الثانية: المصادقة الثنائية (2FA) — تظهر بس لو الحساب مفعّلها
  const [tempToken, setTempToken] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState("");

  // فحص الاتصال بالباك اند عند فتح الشاشة وكل 5 ثواني لو واقع
  useEffect(() => {
    let stop = false;
    async function check() {
      try {
        const r = await fetch("/api/health", { cache: "no-store" });
        if (!stop) setConn(r.ok ? "ok" : "down");
      } catch {
        if (!stop) setConn("down");
      }
    }
    check();
    const t = setInterval(() => { if (conn !== "ok") check(); }, 5000);
    return () => { stop = true; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(""); setBusy(true);
    try {
      const r = await login(email, password);
      if (r.requiresTotp) {
        setTempToken(r.tempToken);
        return;
      }
      const dest = r.landingPath && canAccess(r.user, r.landingPath) ? r.landingPath : autoLandingPath(r.user);
      router.replace(dest);
    } catch (e: any) {
      // فشل fetch نفسه (مش رد من السيرفر) = مشكلة اتصال مش بيانات
      const msg = String(e?.message || "");
      if (msg.includes("Failed to fetch") || msg.includes("NetworkError")) {
        setErr("تعذّر الوصول للخادم — تأكد أن الباك اند شغال (START-Z8.bat)");
        setConn("down");
      } else {
        setErr(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!tempToken) return;
    setErr(""); setBusy(true);
    try {
      const { user: u, landingPath } = await completeTotp(tempToken, totpCode.trim());
      const dest = landingPath && canAccess(u, landingPath) ? landingPath : autoLandingPath(u);
      router.replace(dest);
    } catch (e: any) {
      setErr(e?.message || "كود غير صحيح");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid z8-min-h-screen content-start justify-items-center bg-ink p-4 pt-8 sm:pt-14">
      {/* خلفية بترولية هادئة أعلى الشاشة — استمرارية بصرية مع قضيب التطبيق */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-32 bg-petrol-deep sm:h-44" />
      <div className="relative w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-3 text-white">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 p-2">
            <img src="/logo-white.png" alt="مصدر الزيوت" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="text-[17px] font-extrabold">مصدر الزيوت</div>
            <div className="text-[11px] text-white/65">منصة الإدارة</div>
          </div>
        </div>

        {tempToken ? (
          <form onSubmit={submitTotp}
                className="space-y-4 rounded-card border border-line bg-ink-2 p-6 shadow-panel">
            <div className="text-center">
              <div className="text-[14px] font-extrabold">التحقق بخطوتين</div>
              <p className="mt-1 text-[11.5px] text-text-dim">
                افتح تطبيق المصادقة واكتب الكود المكوّن من 6 أرقام — أو أحد أكواد الاسترجاع الاحتياطية
              </p>
            </div>
            <Field label="كود التحقق">
              <Input dir="ltr" value={totpCode} required autoFocus maxLength={11}
                     placeholder="000000"
                     className="text-center text-[18px] tracking-[0.3em]"
                     onChange={(e) => setTotpCode(e.target.value)} />
            </Field>
            <ErrorNote msg={err} />
            <Button type="submit" disabled={busy} className="w-full justify-center">
              {busy ? "جارِ التحقق..." : "تأكيد"}
            </Button>
            <button type="button" onClick={() => { setTempToken(null); setTotpCode(""); setErr(""); }}
                    className="w-full text-center text-[11.5px] font-bold text-text-dim hover:text-text">
              ← رجوع لتسجيل الدخول
            </button>
          </form>
        ) : (
        <form onSubmit={submit}
              className="space-y-4 rounded-card border border-line bg-ink-2 p-6 shadow-panel">
          {/* مؤشر حالة الاتصال بالخادم */}
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold ${
            conn === "ok"   ? "bg-emerald-bg text-emerald"
            : conn === "down" ? "bg-ember-bg text-ember"
            : "bg-brass-soft text-brass"}`}>
            <span className={`h-2 w-2 rounded-full ${
              conn === "ok" ? "bg-emerald"
              : conn === "down" ? "bg-ember animate-pulse"
              : "bg-brass animate-pulse"}`} />
            {conn === "ok" && "متصل بالخادم"}
            {conn === "checking" && "جارِ فحص الاتصال بالخادم..."}
            {conn === "down" && "تعذّر الاتصال بالخادم — تأكد من اتصالك بالإنترنت وحاول مرة أخرى"}
          </div>

          <Field label="البريد الإلكتروني">
            <Input dir="ltr" type="email" value={email} required autoFocus
                   placeholder="admin@z8.com"
                   onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="كلمة المرور">
            <PasswordInput dir="ltr" type="password" value={password} required minLength={6}
                   onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote msg={err} />
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? "جارِ الدخول..." : "تسجيل الدخول"}
          </Button>
        </form>
        )}
      </div>
    </div>
  );
}
