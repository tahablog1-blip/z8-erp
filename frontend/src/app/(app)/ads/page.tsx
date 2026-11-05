"use client";
// إعلانات تطبيق العميل: تظهر في الصفحة الرئيسية للتطبيق (صورة + عنوان + نص + رابط اختياري)
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button, Card, Field, Input, Textarea, Badge, Modal, ErrorNote, PageHeader } from "@/components/ui";
import { appConfirm } from "@/components/dialog";

type Ad = { id: string; title: string; body: string; link: string; is_active: boolean; sort: number; has_image: boolean };
const EMPTY = { title: "", body: "", link: "", isActive: true, sort: 0, imageData: undefined as string | undefined };

function readImage(file: File): Promise<string> {
  // تصغير الصورة في المتصفح قبل الرفع (أقصى عرض 1000px، JPEG) حتى تبقى خفيفة على الجوال
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = () => rej(new Error("تعذّر قراءة الصورة"));
    fr.onload = () => {
      const img = new Image();
      img.onerror = () => rej(new Error("الملف ليس صورة صالحة"));
      img.onload = () => {
        const k = Math.min(1, 1000 / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL("image/jpeg", 0.82));
      };
      img.src = String(fr.result);
    };
    fr.readAsDataURL(file);
  });
}

export default function AdsPage() {
  const [ads, setAds] = useState<Ad[]>([]);
  const [modal, setModal] = useState<{ id?: string } | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const load = () => api<Ad[]>("/cars/ads").then(setAds).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  function openNew() { setForm({ ...EMPTY }); setErr(""); setModal({}); }
  function openEdit(a: Ad) {
    setForm({ title: a.title, body: a.body || "", link: a.link || "", isActive: a.is_active, sort: a.sort, imageData: undefined });
    setErr(""); setModal({ id: a.id });
  }
  async function save() {
    setErr(""); setBusy(true);
    try {
      const body = JSON.stringify({ ...form, imageData: form.imageData });
      if (modal?.id) await api(`/cars/ads/${modal.id}`, { method: "PUT", body });
      else await api("/cars/ads", { method: "POST", body });
      setModal(null); await load();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }
  async function remove(a: Ad) {
    if (!await appConfirm(`حذف الإعلان «${a.title}»؟`)) return;
    await api(`/cars/ads/${a.id}`, { method: "DELETE" }); await load();
  }

  return (
    <div className="space-y-4">
      <PageHeader title="إعلانات التطبيق" description="تظهر في الصفحة الرئيسية لتطبيق العميل بالترتيب (الأصغر أولاً)."
        actions={<Button onClick={openNew}>إعلان جديد</Button>} />
      <ErrorNote msg={modal ? "" : err} />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {ads.map((a) => (
          <Card key={a.id}>
            {a.has_image && /* eslint-disable-next-line @next/next/no-img-element */
              <img src={`/api/cars/public/ad-image/${a.id}`} alt="" className="mb-2 h-32 w-full rounded object-cover" />}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-t-md font-black">{a.title}</div>
                {a.body && <div className="mt-0.5 line-clamp-2 text-t-sm text-text-dim">{a.body}</div>}
              </div>
              <Badge tone={a.is_active ? "good" : undefined}>{a.is_active ? "ظاهر" : "مخفي"}</Badge>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="ghost" onClick={() => openEdit(a)}>تعديل</Button>
              <Button variant="ghost" onClick={() => remove(a)}>حذف</Button>
            </div>
          </Card>
        ))}
        {!ads.length && <p className="col-span-full py-10 text-center text-text-dim">لا توجد إعلانات بعد</p>}
      </div>

      <Modal open={!!modal} title={modal?.id ? "تعديل إعلان" : "إعلان جديد"} onClose={() => setModal(null)}>
        <div className="space-y-3">
          <ErrorNote msg={err} />
          <Field label="العنوان"><Input value={form.title} maxLength={120} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="النص (اختياري)"><Textarea value={form.body} maxLength={400} rows={3} onChange={(e) => setForm({ ...form, body: e.target.value })} /></Field>
          <Field label="رابط عند الضغط (اختياري)"><Input dir="ltr" value={form.link} placeholder="https://" onChange={(e) => setForm({ ...form, link: e.target.value })} /></Field>
          <Field label="الصورة" hint="تُصغَّر تلقائياً. اترك الحقل فارغاً للإبقاء على الصورة الحالية.">
            <input type="file" accept="image/*" onChange={async (e) => {
              const f = e.target.files?.[0]; if (!f) return;
              try { setForm({ ...form, imageData: await readImage(f) }); } catch (x: any) { setErr(x.message); }
            }} />
            {form.imageData && <button type="button" className="mt-1 text-t-xs text-ember" onClick={() => setForm({ ...form, imageData: "" })}>إزالة الصورة</button>}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الترتيب"><Input type="number" dir="ltr" value={form.sort} onChange={(e) => setForm({ ...form, sort: Number(e.target.value) || 0 })} /></Field>
            <label className="flex items-center gap-2 pt-6 text-t-sm font-bold">
              <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> ظاهر في التطبيق
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModal(null)}>إلغاء</Button>
            <Button onClick={save} disabled={busy || !form.title.trim()}>{busy ? "جارٍ الحفظ…" : "حفظ"}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
