"use client";
// بطاقة المنتج المتحركة: مواصفات + قوة المنتج + يصلح لماذا — تظهر للعميل في تطبيق الحجز عند الضغط على (i) في بطاقة الزيت.
// ما يُكتب هنا يراه العميل ويقرّر به: راجعه مع كتالوج الشركة المصنّعة قبل الحفظ.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";

type Card = { viscosity: string; standard: string; baseType: string; protection: number; economy: number; heat: number; strengths: string[]; suitableFor: string[]; description: string };
const EMPTY: Card = { viscosity: "", standard: "", baseType: "", protection: 0, economy: 0, heat: 0, strengths: ["", "", "", ""], suitableFor: [], description: "" };
const QUICK = ["بنزين", "ديزل", "هايبرد", "تيربو", "مسافات طويلة", "محركات حديثة", "سيارات قديمة", "الأجواء الحارة"];
const RATE: [keyof Card, string][] = [["protection", "الحماية"], ["economy", "توفير الوقود"], ["heat", "تحمّل الحرارة"]];

export function ProductCardEditor({ id, canEdit }: { id: string; canEdit: boolean }) {
  const [c, setC] = useState<Card>(EMPTY);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<Partial<Card>>(`/products/${id}/card`).then((d) => setC({ ...EMPTY, ...d, strengths: [...(d.strengths ?? []), "", "", "", ""].slice(0, 4) })).catch(() => undefined);
  }, [id]);

  const toggle = (x: string) => setC((p) => ({ ...p, suitableFor: p.suitableFor.includes(x) ? p.suitableFor.filter((y) => y !== x) : [...p.suitableFor, x].slice(0, 8) }));

  async function save() {
    setBusy(true); setMsg(null);
    try {
      await api(`/products/${id}/card`, { method: "PUT", body: JSON.stringify(c) });
      setMsg({ ok: true, t: "تم حفظ بطاقة المنتج — تظهر في التطبيق خلال لحظات" });
    } catch (e: any) { setMsg({ ok: false, t: e.message }); } finally { setBusy(false); }
  }

  return (
    <div className="space-y-3">
      <p className="text-t-sm text-text-dim">تظهر للعميل في التطبيق كبطاقة متحركة. اترك الحقول فارغة لإخفاء الجزء. راجع المعلومات مع كتالوج الشركة المصنّعة.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="اللزوجة"><Input dir="ltr" value={c.viscosity} placeholder="5W-30" maxLength={30} disabled={!canEdit} onChange={(e) => setC({ ...c, viscosity: e.target.value })} /></Field>
        <Field label="المواصفة (API / ACEA)"><Input dir="ltr" value={c.standard} placeholder="API SP / ACEA C3" maxLength={60} disabled={!canEdit} onChange={(e) => setC({ ...c, standard: e.target.value })} /></Field>
        <Field label="نوع الزيت">
          <Select value={c.baseType} disabled={!canEdit} onChange={(e) => setC({ ...c, baseType: e.target.value })}>
            <option value="">غير محدد</option><option value="synthetic">صناعي بالكامل</option><option value="semi">نصف صناعي</option><option value="mineral">معدني</option>
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {RATE.map(([k, label]) => (
          <Field key={k} label={`${label} (0–5)`}>
            <Select value={String(c[k])} disabled={!canEdit} onChange={(e) => setC({ ...c, [k]: Number(e.target.value) })}>
              <option value="0">لا يظهر</option>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </Select>
          </Field>
        ))}
      </div>
      <Field label="نقاط القوة (حتى 4)">
        <div className="grid gap-2 sm:grid-cols-2">
          {c.strengths.map((s, i) => (
            <Input key={i} value={s} maxLength={90} disabled={!canEdit} placeholder={`ميزة ${i + 1}`}
                   onChange={(e) => setC({ ...c, strengths: c.strengths.map((x, j) => (j === i ? e.target.value : x)) })} />
          ))}
        </div>
      </Field>
      <Field label="يصلح لـ">
        <div className="flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} type="button" disabled={!canEdit} onClick={() => toggle(q)}
                    className={`rounded-full border px-3 py-1 text-t-sm font-bold ${c.suitableFor.includes(q) ? "border-petrol bg-petrol text-white" : "border-line bg-ink-2"}`}>{q}</button>
          ))}
        </div>
        <Input className="mt-2" value={c.suitableFor.filter((x) => !QUICK.includes(x)).join("، ")} disabled={!canEdit} placeholder="خيارات أخرى مفصولة بفاصلة (مثل: تويوتا، هيونداي)"
               onChange={(e) => setC({ ...c, suitableFor: [...c.suitableFor.filter((x) => QUICK.includes(x)), ...e.target.value.split(/[,،]/).map((x) => x.trim()).filter(Boolean)].slice(0, 8) })} />
      </Field>
      <Field label="وصف مختصر (اختياري)"><Textarea rows={2} maxLength={300} value={c.description} disabled={!canEdit} onChange={(e) => setC({ ...c, description: e.target.value })} /></Field>
      {msg && <div className={`text-t-sm font-bold ${msg.ok ? "text-emerald" : "text-ember"}`}>{msg.t}</div>}
      {canEdit && <Button onClick={save} disabled={busy}>{busy ? "جارٍ الحفظ…" : "حفظ بطاقة المنتج"}</Button>}
    </div>
  );
}
