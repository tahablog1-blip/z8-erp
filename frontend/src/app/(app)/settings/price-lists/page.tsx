"use client";
// الإعدادات ← قوائم الأسعار — كل قائمة فيها أسعار مخصّصة لأصناف معيّنة (الباقي
// يفضل على السعر العادي). عيّن عميلاً على قائمة من شاشة العملاء وسعره في البيع
// والفواتير يتحول تلقائياً. حذف القائمة يرجّع كل عملائها للسعر العادي.
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Button, Card, ErrorNote, Field, Input, PageHeader } from "@/components/ui";
import { MIcon } from "@/components/m-icon";
import { appConfirm } from "@/components/dialog";
import { PriceList, PriceListItem } from "@/modules/price-lists/types";
import { money } from "@/modules/products/types";

export default function PriceListsSettingsPage() {
  const { hasPerm } = useAuth();
  const canManage = hasPerm("products.price_lists");

  const [lists, setLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  const [selectedId, setSelectedId] = useState<string | null | "new">(null);
  const [nameForm, setNameForm] = useState("");
  const [busy, setBusy] = useState(false);

  const [items, setItems] = useState<PriceListItem[]>([]);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [rowBusy, setRowBusy] = useState<string | null>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function load() {
    api<PriceList[]>("/price-lists").then(setLists).catch((e) => setErr(e.message)).finally(() => setLoading(false));
  }
  useEffect(() => { if (canManage) load(); }, [canManage]);

  async function loadItems(listId: string, search: string) {
    setItemsLoading(true);
    try {
      const rows = await api<PriceListItem[]>(
        `/price-lists/${listId}/items${search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ""}`
      );
      setItems(rows);
      setDrafts({});
    } catch (e: any) { setErr(e.message); }
    finally { setItemsLoading(false); }
  }

  function openList(pl: PriceList) {
    setSelectedId(pl.id); setNameForm(pl.name); setErr(""); setItemSearch("");
    loadItems(pl.id, "");
  }
  function openNew() { setSelectedId("new"); setNameForm(""); setErr(""); setItems([]); }
  function closeEditor() { setSelectedId(null); setItems([]); setItemSearch(""); setErr(""); }

  useEffect(() => {
    if (!selectedId || selectedId === "new") return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => loadItems(selectedId, itemSearch), 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemSearch]);

  async function saveName() {
    const name = nameForm.trim();
    if (!name) return;
    setErr(""); setBusy(true);
    try {
      if (selectedId === "new") {
        const created = await api<PriceList>("/price-lists", { method: "POST", body: JSON.stringify({ name }) });
        load();
        openList(created);
      } else if (selectedId) {
        await api(`/price-lists/${selectedId}`, { method: "PUT", body: JSON.stringify({ name }) });
        load();
      }
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function removeList(pl: PriceList) {
    if (!(await appConfirm(`حذف قائمة «${pl.name}»؟ أي عميل معيّن عليها يرجع للسعر العادي تلقائياً.`))) return;
    setErr("");
    try {
      await api(`/price-lists/${pl.id}`, { method: "DELETE" });
      if (selectedId === pl.id) closeEditor();
      load();
    } catch (e: any) { setErr(e.message); }
  }

  async function savePrice(productId: string) {
    if (selectedId === "new" || !selectedId) return;
    const raw = drafts[productId];
    const priceVat = Number(raw);
    if (!raw || isNaN(priceVat) || priceVat < 0) return;
    setRowBusy(productId);
    try {
      await api(`/price-lists/${selectedId}/items/${productId}`, {
        method: "PUT", body: JSON.stringify({ priceVat }),
      });
      setItems((prev) => prev.map((it) => it.product_id === productId
        ? { ...it, price_vat: priceVat, is_override: true } : it));
      setDrafts((d) => { const n = { ...d }; delete n[productId]; return n; });
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setRowBusy(null); }
  }

  async function clearPrice(productId: string) {
    if (selectedId === "new" || !selectedId) return;
    setRowBusy(productId);
    try {
      await api(`/price-lists/${selectedId}/items/${productId}`, { method: "DELETE" });
      setItems((prev) => prev.map((it) => it.product_id === productId
        ? { ...it, price_vat: it.base_price_vat, is_override: false } : it));
      load();
    } catch (e: any) { setErr(e.message); }
    finally { setRowBusy(null); }
  }

  if (!canManage) return <Card>لا تملك صلاحية «إدارة قوائم الأسعار».</Card>;

  const editing = selectedId !== null;
  const selectedList = typeof selectedId === "string" && selectedId !== "new"
    ? lists.find((l) => l.id === selectedId) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <PageHeader title="الإعدادات — قوائم الأسعار" description="قوائم الأسعار." />
          <p className="page-desc">
            عيّن أسعاراً خاصة لأصناف معيّنة ثم اربط القائمة بعميل من شاشة العملاء — باقي الأصناف تفضل بسعرها العادي.
          </p>
        </div>
        <Button onClick={openNew}>+ قائمة جديدة</Button>
      </div>

      {err && !editing && <ErrorNote msg={err} />}

      {loading ? (
        <Card>جارِ التحميل…</Card>
      ) : lists.length === 0 ? (
        <Card className="text-center text-t-md text-text-dim">لا توجد قوائم أسعار بعد.</Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {lists.map((pl) => (
            <Card key={pl.id} className="!p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-t-md font-extrabold">{pl.name}</div>
                  <div className="text-t-xs text-text-dim">{pl.item_count} صنف مخصّص</div>
                </div>
              </div>
              <div className="mt-3 flex gap-1.5">
                <Button variant="outline" size="sm" className="flex-1" onClick={() => openList(pl)}>تعديل</Button>
                <Button variant="danger" size="sm" onClick={() => removeList(pl)}>
                  <MIcon name="delete" className="!text-[16px]" />
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {editing && (
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-t-md font-black">
              {selectedId === "new" ? "قائمة أسعار جديدة" : `تعديل — ${selectedList?.name}`}
            </h2>
            <Button variant="ghost" className="gap-1" onClick={closeEditor}><MIcon name="close" className="!text-[14px]" /> إغلاق</Button>
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-[1fr_120px]">
            <Field label="اسم القائمة">
              <Input value={nameForm} autoFocus onChange={(e) => setNameForm(e.target.value)} />
            </Field>
            <Button className="self-end" onClick={saveName} disabled={busy || !nameForm.trim()}>
              {busy ? "جارِ الحفظ..." : selectedId === "new" ? "إنشاء" : "حفظ الاسم"}
            </Button>
          </div>

          {selectedId !== "new" && (
            <>
              <Field label="بحث عن صنف">
                <Input value={itemSearch} placeholder="الاسم، الفئة، اللزوجة، الباركود..."
                       onChange={(e) => setItemSearch(e.target.value)} />
              </Field>

              <div className="mt-3 overflow-x-auto">
                {itemsLoading ? (
                  <p className="p-4 text-center text-t-md text-text-dim">جارِ التحميل…</p>
                ) : items.length === 0 ? (
                  <p className="p-4 text-center text-t-md text-text-dim">لا توجد أصناف مطابقة.</p>
                ) : (
                  <table className="w-full text-t-sm">
                    <thead>
                      <tr className="border-b border-line text-text-dim">
                        <th className="px-2 py-1.5 text-right">الصنف</th>
                        <th className="px-2 py-1.5 text-right">السعر العادي</th>
                        <th className="px-2 py-1.5 text-right">سعر هذه القائمة</th>
                        <th className="px-2 py-1.5 text-right"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => {
                        const draft = drafts[it.product_id];
                        const busyRow = rowBusy === it.product_id;
                        return (
                          <tr key={it.product_id} className="border-b border-line/50">
                            <td className="px-2 py-1.5">
                              <div className="font-bold">{[it.category, it.name, it.spec].filter(Boolean).join(" — ")}</div>
                              {it.barcode && <div dir="ltr" className="text-t-xs text-text-dim">[{it.barcode}]</div>}
                            </td>
                            <td className="px-2 py-1.5 tnum text-text-dim">{money(it.base_price_vat)}</td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center gap-1">
                                <Input type="number" min={0} step={0.01} className="tnum w-24"
                                       value={draft ?? (it.is_override ? String(it.price_vat) : "")}
                                       placeholder={money(it.base_price_vat)}
                                       onChange={(e) => setDrafts((d) => ({ ...d, [it.product_id]: e.target.value }))} />
                                {it.is_override && !draft && (
                                  <span className="rounded-none bg-petrol/10 px-1.5 py-0.5 text-t-xs font-bold text-petrol">مخصّص</span>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex gap-1">
                                <Button size="sm" variant="outline" disabled={busyRow || !draft}
                                        onClick={() => savePrice(it.product_id)}>
                                  <MIcon name="check" className="!text-[16px]" />
                                </Button>
                                {it.is_override && (
                                  <Button size="sm" variant="danger" disabled={busyRow}
                                          onClick={() => clearPrice(it.product_id)}>
                                    <MIcon name="close" className="!text-[16px]" />
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}

          <ErrorNote msg={err} />
        </Card>
      )}
    </div>
  );
}
