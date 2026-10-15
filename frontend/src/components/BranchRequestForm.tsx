"use client";
// طلب أصناف لفرع — مستند يُحفظ كمسودة ثم يُرسل للموافقة
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge, Button, Card, ErrorNote, Field, Input, Select } from "@/components/ui";
import { appConfirm } from "@/components/dialog";
import { StockItemsEditor, StockLine } from "@/components/StockItemsEditor";
import { Product } from "@/modules/products/types";

type Branch = { id: string; name: string };
type Req = {
  id: string; reqNo: number | null; status: string; mine: boolean;
  requestingBranchId: string; requestingBranchName: string;
  sourceBranchId: string | null; sourceBranchName: string | null;
  note: string | null; requestedByName: string; decidedByName: string | null;
  decisionNote: string | null; createdAt: string; decidedAt: string | null;
  items: { id: string; productId: string; label: string; qtyRequested: number; qtyApproved: number | null }[];
};

const STATUS_UI: Record<string, { label: string; tone: "warn" | "info" | "neutral" | "good" }> = {
  draft: { label: "مسودة", tone: "neutral" },
  pending: { label: "بانتظار الموافقة", tone: "warn" },
  approved: { label: "تمت الموافقة", tone: "info" },
  rejected: { label: "مرفوض", tone: "neutral" },
  fulfilled: { label: "تم التنفيذ ✓", tone: "good" },
};
const WAREHOUSE = "main";

export default function BranchRequestForm({ id }: { id?: string }) {
  const router = useRouter();
  const { user } = useAuth();

  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [req, setReq] = useState<Req | null>(null);
  const [recordId, setRecordId] = useState<string | undefined>(id);
  const [branch, setBranch] = useState("");
  const [source, setSource] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<StockLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, b, r] = await Promise.all([
          api<Product[]>("/products"),
          api<Branch[]>("/branches").catch(() => [] as Branch[]),
          id ? api<Req>(`/inventory/requests/${id}`) : Promise.resolve(null),
        ]);
        if (!alive) return;
        setProducts(p);
        setBranches(b);
        if (r) {
          const byId = new Map(p.map((x) => [x.id, x]));
          setReq(r);
          setBranch(r.requestingBranchId);
          setSource(r.sourceBranchId || "");
          setNote(r.note || "");
          setItems(r.items.map((it) => ({
            productId: it.productId, productLabel: it.label,
            barcode: byId.get(it.productId)?.barcode ?? null, qty: it.qtyRequested,
          })));
        } else {
          setBranch(user?.branchId || "");
        }
      } catch (e: any) {
        if (alive) setErr(e.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [id, user?.branchId]);

  const editable = !id || (req?.status === "draft" && !!req?.mine);

  function goList() {
    try { sessionStorage.setItem("inv_tab", "requests"); } catch { /* */ }
    router.push("/inventory");
  }

  function body() {
    return {
      requestingBranchId: branch || null,
      sourceBranchId: source || null,
      note: note.trim() || null,
      items: items.filter((i) => i.productId).map((i) => ({
        productId: i.productId, productLabel: i.productLabel, qty: i.qty,
      })),
    };
  }

  async function persist(): Promise<string> {
    if (recordId) {
      await api(`/inventory/requests/${recordId}/draft`, { method: "PUT", body: JSON.stringify(body()) });
      return recordId;
    }
    const r = await api<{ id: string }>("/inventory/requests/draft", { method: "POST", body: JSON.stringify(body()) });
    setRecordId(r.id);
    return r.id;
  }

  async function saveDraft() {
    if (busy) return;
    if (!branch) { setErr("اختر الفرع الطالب أولاً"); return; }
    setBusy(true); setErr(""); setOk("");
    try {
      const wasNew = !recordId;
      const rid = await persist();
      if (wasNew) router.replace(`/inventory/requests/${rid}`);
      else setOk("تم حفظ المسودة");
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function submit() {
    if (busy) return;
    if (!branch) { setErr("اختر الفرع الطالب أولاً"); return; }
    if (items.filter((i) => i.productId).length === 0) { setErr("أضف صنفاً واحداً على الأقل"); return; }
    if (!await appConfirm("إرسال الطلب للموافقة؟ بعد الإرسال لا يمكن تعديله.")) return;
    setBusy(true); setErr(""); setOk("");
    try {
      const rid = await persist();
      await api(`/inventory/requests/${rid}/submit`, { method: "POST" });
      goList();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  async function removeDraft() {
    if (!recordId || busy) return;
    if (!await appConfirm("حذف هذه المسودة نهائياً؟")) return;
    setBusy(true); setErr("");
    try {
      await api(`/inventory/requests/${recordId}`, { method: "DELETE" });
      goList();
    } catch (e: any) { setErr(e.message); setBusy(false); }
  }

  const back = (
    <button type="button" onClick={goList} className="inline-flex items-center gap-1 text-[12.5px] font-bold text-petrol">
      ← المخزون / طلبات الفروع
    </button>
  );

  if (loading) return <div className="space-y-3">{back}<p className="text-[13px] text-text-dim">جارِ التحميل...</p></div>;
  if (id && !req) return <div className="space-y-3">{back}<ErrorNote msg={err || "الطلب غير موجود"} /></div>;

  const ui = STATUS_UI[req?.status || "draft"];
  const title = id ? `طلب أصناف ${req?.reqNo ? "#" + req.reqNo : ""}` : "طلب أصناف جديد";
  const totalQty = items.reduce((s, i) => s + (i.productId ? i.qty : 0), 0);

  return (
    <div className="space-y-4">
      {back}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h1 className="text-[19px] font-extrabold">{title}</h1>
          <Badge tone={ui.tone}>{ui.label}</Badge>
        </div>
        {editable && (
          <div className="flex flex-wrap gap-2">
            {recordId && <Button variant="ghost" onClick={removeDraft} disabled={busy}>حذف المسودة</Button>}
            <Button variant="ghost" onClick={saveDraft} disabled={busy}>{busy ? "..." : "حفظ كمسودة"}</Button>
            <Button onClick={submit} disabled={busy}>إرسال الطلب</Button>
          </div>
        )}
      </div>

      <ErrorNote msg={err} />
      {ok && <div className="rounded-lg bg-emerald-bg px-4 py-2.5 text-[12.5px] font-bold text-emerald">{ok}</div>}

      {editable ? (
        <Card className="space-y-3 p-4">
          <p className="text-[12px] text-text-dim">
            احفظ الطلب كمسودة وكمّله لاحقاً، أو أرسله للموافقة. بعد الإرسال لا يمكن تعديله.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="الفرع الطالب (اللي هيستلم الأصناف)">
              <Select value={branch} onChange={(e) => setBranch(e.target.value)}>
                <option value="">— اختر الفرع —</option>
                {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
            <Field label="المصدر (اختياري — أو خلّي المسؤول يحدده)">
              <Select value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">— بدون تحديد —</option>
                <option value={WAREHOUSE}>المستودع الرئيسي</option>
                {branches.filter((b) => b.id !== branch).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          </div>
          <StockItemsEditor products={products} items={items} onChange={setItems} />
          <Field label="ملاحظة (اختياري)">
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="مثال: نقص مفاجئ في الزيت الأكثر طلباً" />
          </Field>
          <div className="text-[12px] text-text-dim">إجمالي الكميات: <b className="tnum text-text">{totalQty}</b></div>
        </Card>
      ) : req && (
        <Card className="space-y-3 p-4">
          <div className="grid gap-2 text-[12.5px] sm:grid-cols-4">
            <div><span className="text-text-dim">الفرع الطالب:</span> <b>{req.requestingBranchName}</b></div>
            <div><span className="text-text-dim">المصدر:</span> <b>{req.sourceBranchName || "—"}</b></div>
            <div><span className="text-text-dim">بواسطة:</span> <b>{req.requestedByName}</b></div>
            <div><span className="text-text-dim">التاريخ:</span> <b>{new Date(req.createdAt).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"))}</b></div>
            {req.note && <div className="sm:col-span-4"><span className="text-text-dim">ملاحظة:</span> {req.note}</div>}
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-ink-3 text-[11.5px] font-extrabold text-text-dim">
                  <th className="px-3 py-2 text-right">الصنف</th>
                  <th className="w-28 px-3 py-2 text-right">المطلوب</th>
                  <th className="w-28 px-3 py-2 text-right">المعتمد</th>
                </tr>
              </thead>
              <tbody>
                {req.items.map((it) => (
                  <tr key={it.id} className="border-t border-line/70">
                    <td className="px-3 py-2 font-bold">{it.label}</td>
                    <td className="px-3 py-2 tnum">{it.qtyRequested}</td>
                    <td className="px-3 py-2 tnum">{it.qtyApproved ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {req.decidedByName && (
            <div className="text-[12px] text-text-dim">
              البت بواسطة {req.decidedByName}{req.decisionNote && ` — ${req.decisionNote}`}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
