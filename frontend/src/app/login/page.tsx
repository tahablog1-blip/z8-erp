"use client";
// شاشة الدخول — بنفس حسابات النظام الحالي (نفس bcrypt hashes في القاعدة)
// + مؤشر فحص اتصال ذاتي: بيقولك فوراً لو الباك اند مش واصل قبل ما تكتب بياناتك
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { Button, Field, Input, ErrorNote } from "@/components/ui";
import { NAV_MODULES } from "@/modules/registry";

type ConnState = "checking" | "ok" | "down";

/** وجهة ما بعد الدخول: المدير → لوحة القيادة، والموظف → أول شاشة مسموحة له.
 *  لو بيانات المستخدم مش راجعة من login (احتياط) → السلوك القديم بلا كسر. */
function landingPath(u: any): string {
  if (!u || u.role === "admin") return "/dashboard";
  const perms: string[] = Array.isArray(u.permissions) ? u.permissions : [];
  const first = NAV_MODULES.find(
    (m) => !m.adminOnly && (m.permissions.length === 0 || m.permissions.some((p) => perms.includes(p)))
  );
  return first?.path || "/dashboard";
}

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [conn, setConn] = useState<ConnState>("checking");

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
      const u = await login(email, password);
      router.replace(landingPath(u));
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

  return (
    <div className="grid min-h-screen place-items-center bg-ink p-4">
      {/* خلفية بترولية هادئة أعلى الشاشة — استمرارية بصرية مع قضيب التطبيق */}
      <div className="pointer-events-none fixed inset-x-0 top-0 h-56 bg-petrol-deep" />
      <div className="relative w-full max-w-sm">
        <div className="mb-5 flex items-center justify-center gap-3 text-white">
          <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/10 p-2">
            <img src="/logo-white.png" alt="مصدر الزيوت" className="h-full w-full object-contain" />
          </div>
          <div>
            <div className="text-[17px] font-extrabold">مصدر الزيوت</div>
            <div className="text-[11px] text-white/65">منصة الإدارة — Python + Next.js</div>
          </div>
        </div>

        <form onSubmit={submit}
              className="space-y-4 rounded-card border border-line bg-ink-2 p-6 shadow-panel">
          {/* مؤشر حالة الاتصال بالخادم */}
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-[12px] font-bold ${
            conn === "ok"   ? "bg-emerald-500/10 text-emerald-600"
            : conn === "down" ? "bg-red-500/10 text-red-500"
            : "bg-amber-500/10 text-amber-600"}`}>
            <span className={`h-2 w-2 rounded-full ${
              conn === "ok" ? "bg-emerald-500"
              : conn === "down" ? "bg-red-500 animate-pulse"
              : "bg-amber-500 animate-pulse"}`} />
            {conn === "ok" && "متصل بالخادم"}
            {conn === "checking" && "جارِ فحص الاتصال بالخادم..."}
            {conn === "down" && "الخادم غير متاح — شغّل START-Z8.bat ثم انتظر ثواني"}
          </div>

          <Field label="البريد الإلكتروني">
            <Input dir="ltr" type="email" value={email} required autoFocus
                   placeholder="admin@z8.com"
                   onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="كلمة المرور">
            <Input dir="ltr" type="password" value={password} required minLength={6}
                   onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <ErrorNote msg={err} />
          <Button type="submit" disabled={busy || conn === "down"} className="w-full justify-center">
            {busy ? "جارِ الدخول..." : "تسجيل الدخول"}
          </Button>
          <p className="text-center text-[11px] text-text-dim">
            نفس حسابك الحالي — كلمات المرور لم تتغير
          </p>
        </form>
      </div>
    </div>
  );
}
