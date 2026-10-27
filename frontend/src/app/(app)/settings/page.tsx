"use client";
// (app)/settings/page.tsx — لوحة مركز الإعدادات: حالة النظام الفعلية، الإعدادات السريعة، الأقسام، الأخيرة، تنبيهات الأمان، إعداد المنصة.
// كل ما يُعرض مصدره الخادم؛ ما لا يتوفر يظهر «غير متاح» (لا حالة مفترضة من الواجهة).
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorNote, PageHeader } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { useSettings } from "@/components/settings/SettingsContext";
import { DEFAULT_QUICK, GROUPS, ITEMS } from "@/lib/settings/registry";

type Status = {
  generatedAt: string; server: { ok: boolean }; database: { ok: boolean; latencyMs?: number };
  printing: { configured: boolean };
  backups: { app: { count: number; latestAt: string | null }; database: { count: number; latestAt: string | null } | null } | null;
  whatsapp: { enabled: boolean; state: string | null; number: string | null } | null;
  integrations: { failed24h: number; total24h: number; lastEventAt: string | null } | null;
  security: { activeUsers: number; admins: number; adminsWithout2fa: number; usersWith2fa: number; lockedAccounts: number; activeSessions: number } | null;
  alerts: { key: string; severity: "warning" | "danger"; title: string; detail: string; path: string }[];
};
type Dash = { companyName: string; branchesCount: number; usersCount: number; usersActive: number; rolesCount: number; setup: { key: string; label: string; ok: boolean; path: string; hint: string }[] };
const WA_STATE: Record<string, string> = { ready: "جاهز", qr: "بانتظار ربط الرقم", starting: "قيد التشغيل", disconnected: "غير متصل", unreachable: "البوابة لا تستجيب", disabled: "غير مفعّل" };
const ago = (s: string | null | undefined) => { if (!s) return null; const d = Math.floor((Date.now() - new Date(s).getTime()) / 86400000); return d <= 0 ? "اليوم" : d === 1 ? "أمس" : `قبل ${d} يوماً`; };

function StatusCard({ icon, label, value, tone, sub }: { icon: string; label: string; value: string; tone: "ok" | "warn" | "bad" | "na"; sub?: string }) {
  const c = { ok: "text-emerald", warn: "text-brass", bad: "text-ember", na: "text-text-dim" }[tone];
  return (
    <div className="min-w-0 rounded-card border border-line bg-ink-2 p-3.5 shadow-card">
      <div className="flex items-center gap-2 text-t-sm font-bold text-text-dim"><MIcon name={icon} className="!text-[18px]" /><span className="truncate">{label}</span></div>
      <div className={`mt-1 truncate text-t-lg font-black ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 truncate text-t-xs text-text-dim">{sub}</div>}
    </div>
  );
}

export default function SettingsDashboard() {
  const { user } = useAuth();
  const { items, prefs, go, toggleFav } = useSettings();
  const [st, setSt] = useState<Status | null>(null);
  const [dash, setDash] = useState<Dash | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    api<Status>("/settings/status").then(setSt).catch((e: unknown) => setErr(e instanceof Error ? e.message : "تعذر تحميل حالة النظام"));
    api<Dash>("/settings/dashboard").then(setDash).catch(() => undefined);
  }, []);

  const byId = new Map(items.map((i) => [i.id, i]));
  const quickIds = prefs.favorites.length ? prefs.favorites : DEFAULT_QUICK;
  const quick = quickIds.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 8);
  const recents = prefs.recents.map((r) => byId.get(r.id)).filter((x): x is NonNullable<typeof x> => !!x);
  const groups = GROUPS.map((g) => ({ ...g, items: items.filter((i) => i.group === g.id) })).filter((g) => g.items.length);
  const setup = dash?.setup ?? [];
  const done = setup.filter((s) => s.ok).length;
  const lastBackup = st?.backups ? [st.backups.app.latestAt, st.backups.database?.latestAt].filter(Boolean).sort().reverse()[0] ?? null : undefined;

  return (
    <div className="space-y-5">
      <PageHeader title="الإعدادات" description="إدارة إعدادات Z8 ERP والمنشأة والفروع والمستخدمين والنظام." />
      <ErrorNote msg={err} />

      {/* ── حالة النظام (فعلية من الخادم) ── */}
      <section aria-label="حالة النظام">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6">
          <StatusCard icon="dns" label="الخادم" value={st ? (st.server.ok ? "يعمل" : "لا يستجيب") : "جارِ الفحص…"} tone={st ? (st.server.ok ? "ok" : "bad") : "na"} />
          <StatusCard icon="database" label="قاعدة البيانات" value={st ? (st.database.ok ? "متصلة" : "لا تستجيب") : "جارِ الفحص…"} tone={st ? (st.database.ok ? "ok" : "bad") : "na"} sub={st?.database.ok ? `زمن الاستجابة ${st.database.latencyMs} م.ث` : undefined} />
          <StatusCard icon="hub" label="التكاملات (24 ساعة)" value={!st ? "…" : st.integrations ? (st.integrations.failed24h ? `${st.integrations.failed24h} فاشلة` : st.integrations.total24h ? "بلا إخفاقات" : "لا نشاط") : "غير متاح"} tone={!st?.integrations ? "na" : st.integrations.failed24h ? "bad" : "ok"} sub={st?.integrations ? `${st.integrations.total24h} عملية` : "تحتاج صلاحية التكاملات"} />
          <StatusCard icon="print" label="الطباعة" value={!st ? "…" : st.printing.configured ? "مضبوطة" : "لم تُضبط بعد"} tone={!st ? "na" : st.printing.configured ? "ok" : "warn"} />
          <StatusCard icon="chat" label="واتساب" value={!st ? "…" : st.whatsapp ? (WA_STATE[st.whatsapp.state ?? ""] ?? st.whatsapp.state ?? "—") : "غير متاح"} tone={!st?.whatsapp ? "na" : st.whatsapp.state === "ready" ? "ok" : st.whatsapp.enabled ? "warn" : "na"} sub={st?.whatsapp?.number ?? undefined} />
          <StatusCard icon="backup" label="آخر نسخة احتياطية" value={st === null ? "…" : lastBackup === undefined ? "غير متاح" : lastBackup ? (ago(lastBackup) ?? "—") : "لا توجد"} tone={lastBackup === undefined || st === null ? "na" : lastBackup ? ((Date.now() - new Date(lastBackup).getTime()) / 86400000 >= 7 ? "warn" : "ok") : "warn"} sub={st?.backups ? `تطبيق: ${st.backups.app.count}${st.backups.database ? ` · قاعدة بيانات: ${st.backups.database.count}` : ""}` : "تحتاج صلاحية الشركة"} />
        </div>
      </section>

      {/* ── تنبيهات الأمان ── */}
      {st && st.alerts.length > 0 && (
        <section aria-label="تنبيهات" className="space-y-2">
          <h2 className="text-t-md font-extrabold">تنبيهات تحتاج انتباهك</h2>
          {st.alerts.map((a) => (
            <div key={a.key} role="alert" className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-4 py-2.5 ${a.severity === "danger" ? "border-ember/30 bg-ember-bg" : "border-brass/30 bg-brass-bg"}`}>
              <span><b className={a.severity === "danger" ? "text-ember" : "text-brass"}>{a.title}</b> <span className="text-t-sm text-text-dim">— {a.detail}</span></span>
              {a.path && <Button size="sm" variant="ghost" onClick={() => void go(a.path)}>فتح</Button>}
            </div>))}
        </section>)}

      {/* ── الإعدادات السريعة ── */}
      <section aria-label="الإعدادات السريعة">
        <h2 className="mb-2 text-t-md font-extrabold">{prefs.favorites.length ? "المفضلة" : "الإعدادات السريعة"}</h2>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {quick.map((l) => (
            <button key={l.id} onClick={() => void go(l.path)} className="flex flex-col items-center gap-1.5 rounded-card border border-line bg-ink-2 p-3 text-center transition hover:border-petrol">
              <span className="grid h-9 w-9 place-items-center rounded-lg bg-petrol-soft text-petrol"><MIcon name={l.icon} className="!text-[18px]" /></span>
              <span className="text-t-xs font-bold">{l.title}</span>
            </button>))}
        </div>
        {!prefs.favorites.length && <p className="mt-1.5 text-t-xs text-text-dim">ثبّت إعداداتك الأكثر استخداماً بالنجمة في القائمة الجانبية لتظهر هنا.</p>}
      </section>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* ── الأقسام ── */}
        <section aria-label="الأقسام" className="space-y-3 xl:col-span-2">
          <h2 className="text-t-md font-extrabold">الأقسام</h2>
          {groups.map((g) => (
            <Card key={g.id} className="!p-0">
              <div className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-t-sm font-black"><MIcon name={g.icon} className="!text-[18px] text-petrol" />{g.title}</div>
              <ul className="grid divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
                {g.items.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 px-4 py-3 sm:border-b sm:border-line">
                    <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-petrol-soft text-petrol"><MIcon name={i.icon} className="!text-[18px]" /></span>
                    <span className="min-w-0 flex-1">
                      <button onClick={() => void go(i.path)} className="block text-start text-t-sm font-extrabold hover:text-petrol">{i.title}</button>
                      <span className="block text-t-xs leading-relaxed text-text-dim">{i.desc}</span>
                    </span>
                    <button type="button" aria-pressed={prefs.favorites.includes(i.id)} aria-label={`تثبيت ${i.title}`} onClick={() => toggleFav(i.id)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-text-dim hover:bg-ink-3">
                      <MIcon name="star" className={`!text-[16px] ${prefs.favorites.includes(i.id) ? "text-brass" : ""}`} style={prefs.favorites.includes(i.id) ? { fontVariationSettings: "'FILL' 1" } : undefined} /></button>
                  </li>))}
              </ul>
            </Card>))}
        </section>

        <div className="space-y-4">
          {/* ── إعداد النظام (فحص فعلي) ── */}
          <Card>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-t-md font-extrabold">إعداد النظام</h2>
              {setup.length > 0 && <span className="text-t-xs font-bold text-text-dim">{done} من {setup.length} مكتمل</span>}
            </div>
            {setup.length > 0 && <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-ink-3" role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={setup.length}>
              <div className="h-full rounded-full bg-emerald transition-all" style={{ width: `${(done / setup.length) * 100}%` }} /></div>}
            <ul className="space-y-1.5">
              {setup.map((s) => (
                <li key={s.key}>
                  <button onClick={() => s.path && void go(s.path)} className="flex w-full items-center gap-2.5 rounded-lg border border-line px-3 py-2 text-start hover:border-petrol">
                    <MIcon name={s.ok ? "check_circle" : "pending"} className={`!text-[18px] ${s.ok ? "text-emerald" : "text-brass"}`} />
                    <span className="min-w-0 flex-1"><span className="block text-t-sm font-bold">{s.label}</span><span className="block truncate text-t-xs text-text-dim">{s.hint}</span></span>
                    {s.ok ? <Badge tone="success">مكتمل</Badge> : <Badge tone="warning">يحتاج إعداد</Badge>}
                  </button>
                </li>))}
              {!setup.length && <li className="text-t-sm text-text-dim">جارِ تحميل حالة الإعداد…</li>}
            </ul>
          </Card>

          {/* ── الأخيرة ── */}
          {recents.length > 0 && (
            <Card>
              <h2 className="mb-2 text-t-md font-extrabold">استُخدمت مؤخراً</h2>
              <ul className="space-y-1">{recents.map((r) => (
                <li key={r.id}><button onClick={() => void go(r.path)} className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-start text-t-sm font-bold hover:bg-ink-3"><MIcon name={r.icon} className="!text-[18px] text-petrol" />{r.title}</button></li>))}</ul>
            </Card>)}

          {st?.security && (
            <Card>
              <h2 className="mb-2 text-t-md font-extrabold">ملخص الأمان</h2>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-t-sm">
                <div><dt className="text-t-xs text-text-dim">مستخدمون نشطون</dt><dd className="tnum font-black">{st.security.activeUsers}</dd></div>
                <div><dt className="text-t-xs text-text-dim">جلسات نشطة (30 يوماً)</dt><dd className="tnum font-black">{st.security.activeSessions}</dd></div>
                <div><dt className="text-t-xs text-text-dim">مصادقة ثنائية مفعّلة</dt><dd className="tnum font-black">{st.security.usersWith2fa}</dd></div>
                <div><dt className="text-t-xs text-text-dim">مديرون بلا مصادقة ثنائية</dt><dd className={`tnum font-black ${st.security.adminsWithout2fa ? "text-ember" : ""}`}>{st.security.adminsWithout2fa}</dd></div>
              </dl>
            </Card>)}
        </div>
      </div>
      <p className="text-t-xs text-text-dim">{user?.fullName ? `المستخدم الحالي: ${user.fullName}. ` : ""}كل المؤشرات أعلاه تُجلب من الخادم لحظة فتح الصفحة؛ ما لا تملك صلاحيته يظهر «غير متاح».</p>
    </div>
  );
}
