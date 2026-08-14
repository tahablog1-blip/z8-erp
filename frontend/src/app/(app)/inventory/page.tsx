"use client";
// شاشة المخزون — الأرصدة، السندات، الحركات + استلام من مورد وتحويل داخلي
// المواقع في النظام: المستودع الرئيسي (loc_id ثابت = 'main') أو أي فرع (loc_id = معرّف الفرع)
import { useEffect, useMemo, useState } from "react";
import { appAlert, appConfirm } from "@/components/dialog";
import { api } from "@/lib/api";
import { printReport, tableHTML, kpisHTML } from "@/lib/print";
import { useAuth } from "@/lib/auth";
import { DataTable, Column } from "@/components/DataTable";
import { StockItemsEditor, StockLine } from "@/components/StockItemsEditor";
import { Product } from "@/modules/products/types";
import {
  Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Tabs,
} from "@/components/ui";

const WAREHOUSE_LOC_ID = "main";

type Branch = { id: string; name: string };

type Level = {
  loc_type: string; loc_id: string; product_id: string; qty: number;
  category: string | null; name: string | null; spec: string | null;
  unit: string | null; min_qty: number; barcode: string | null;
  branch_name: string | null; loc_name: string; is_low: boolean;
};

type BranchRequest = {
  id: string; status: "pending" | "approved" | "rejected" | "fulfilled";
  requestingBranchId: string; requestingBranchName: string;
  sourceBranchId: string | null; sourceBranchName: string | null;
  note: string | null; requestedByName: string; decidedByName: string | null;
  decisionNote: string | null; createdAt: string; decidedAt: string | null;
  items: { id: string; productId: string; label: string; qtyRequested: number; qtyApproved: number | null }[];
};

type Voucher = {
  moveNo: string; type: string; from: string; to: string;
  createdAt: string; itemCount: number; totalQty: number;
};

type VoucherDetail = {
  moveNo: string; type: string;
  fromLocType: string | null; fromLocId: string | null;
  toLocType: string; toLocId: string;
  from: string; to: string; createdAt: string;
  note: string | null; supplierName: string | null;
  items: { productId: string; productLabel: string; barcode: string | null; qty: number }[];
};

type Move = {
  id: string; move_type: string; to_loc_type: string; to_loc_id: string;
  product_label: string | null; qty: number; move_no: string | null;
  supplier_name: string | null; unit_cost: number | null; created_at: string;
};

const dateFmt = (s: string) =>
  new Date(s).toLocaleString("ar-SA-u-nu-latn", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

export default function InventoryPage() {
  // ── 🔔 نقطة إعادة الطلب ──
  const [reorder, setReorder] = useState<{ productId: string; name: string; barcode: string | null; onHand: number; minQty: number; suggestedQty: number; lastSupplier: string | null }[] | null>(null);
  useEffect(() => { api<typeof reorder>("/inventory/reorder-suggestions").then(setReorder).catch(() => setReorder([])); }, []);
  const { hasPerm, user } = useAuth();
  const canManageStock = hasPerm("products.view_stock");
  const canRequest = hasPerm("inventory.request");
  const canApproveRequests = hasPerm("inventory.approve_requests");

  // ══════════ طلبات الفروع ══════════
  const [requests, setRequests] = useState<BranchRequest[]>([]);
  const [reqFilter, setReqFilter] = useState<"pending" | "all">("pending");
  const [reqOpen, setReqOpen] = useState(false);   // نافذة إنشاء طلب جديد
  const [reqItems, setReqItems] = useState<StockLine[]>([]);
  const [reqRequestingBranch, setReqRequestingBranch] = useState("");
  const [reqSourceBranch, setReqSourceBranch] = useState("");
  const [reqNote, setReqNote] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqErr, setReqErr] = useState("");
  // فتح نافذة الطلب: نعبّي "الفرع الطالب" بفرع المستخدم تلقائياً لو عنده فرع افتراضي
  function openRequestModal() {
    setReqOpen(true); setReqErr(""); setReqItems([]); setReqNote("");
    setReqRequestingBranch(user?.branchId || "");
    setReqSourceBranch("");
  }
  const [decideOpen, setDecideOpen] = useState<BranchRequest | null>(null);
  const [decideQtys, setDecideQtys] = useState<Record<string, string>>({});
  const [decideSource, setDecideSource] = useState("");
  const [decideNote, setDecideNote] = useState("");

  async function loadRequests() {
    try {
      const qs = reqFilter === "pending" ? "?status=pending" : "";
      setRequests(await api<BranchRequest[]>(`/inventory/requests${qs}`));
    } catch { /* */ }
  }

  async function submitRequest() {
    setReqErr(""); setReqBusy(true);
    try {
      await api("/inventory/requests", {
        method: "POST",
        body: JSON.stringify({
          requestingBranchId: reqRequestingBranch || null,
          sourceBranchId: reqSourceBranch || null, note: reqNote.trim() || null,
          items: reqItems.filter((it) => it.productId).map((it) => ({
            productId: it.productId, productLabel: it.productLabel, qty: it.qty,
          })),
        }),
      });
      setReqOpen(false); setReqItems([]); setReqNote(""); setReqSourceBranch(""); setReqRequestingBranch("");
      await loadRequests();
    } catch (e: any) { setReqErr(e.message); }
    finally { setReqBusy(false); }
  }

  function openDecide(r: BranchRequest) {
    setDecideOpen(r);
    setDecideSource(r.sourceBranchId || "");
    setDecideNote("");
    const q: Record<string, string> = {};
    r.items.forEach((it) => { q[it.id] = String(it.qtyRequested); });
    setDecideQtys(q);
  }

  async function submitDecision(approve: boolean) {
    if (!decideOpen) return;
    setReqBusy(true); setReqErr("");
    try {
      await api(`/inventory/requests/${decideOpen.id}/decide`, {
        method: "POST",
        body: JSON.stringify({
          approve, sourceBranchId: decideSource || null, note: decideNote.trim() || null,
          quantities: Object.fromEntries(Object.entries(decideQtys).map(([k, v]) => [k, Number(v) || 0])),
        }),
      });
      setDecideOpen(null);
      await loadRequests();
    } catch (e: any) { setReqErr(e.message); }
    finally { setReqBusy(false); }
  }

  const REQ_STATUS_UI: Record<string, { label: string; tone: "warn" | "info" | "neutral" | "good" }> = {
    pending: { label: "بانتظار الموافقة", tone: "warn" },
    approved: { label: "تمت الموافقة", tone: "info" },
    rejected: { label: "مرفوض", tone: "neutral" },
    fulfilled: { label: "تم التنفيذ ✓", tone: "good" },
  };

  const canReceive = hasPerm("products.view_stock", "purchasing.invoices");

  const [tab, setTab] = useState<"levels" | "vouchers" | "moves" | "requests">("levels");
  useEffect(() => { if (tab === "requests") loadRequests(); }, [tab, reqFilter]);
  const [levels, setLevels] = useState<Level[]>([]);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [moves, setMoves] = useState<Move[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");
  const [onlyLow, setOnlyLow] = useState(false);
  const [locFilter, setLocFilter] = useState("");

  // ── نماذج السندات ──
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [voucher, setVoucher] = useState<VoucherDetail | null>(null);
  const [lines, setLines] = useState<StockLine[]>([]);
  const [supplierName, setSupplierName] = useState("");
  const [note, setNote] = useState("");
  const [fromLoc, setFromLoc] = useState(`warehouse:${WAREHOUSE_LOC_ID}`);
  const [toLoc, setToLoc] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [lv, vo, mv, pr, br, sp] = await Promise.all([
        api<Level[]>("/inventory/levels"),
        api<Voucher[]>("/inventory/vouchers"),
        api<Move[]>("/inventory/moves?limit=100"),
        api<Product[]>("/products").then((ps) => ps.filter((p) => !p.is_service)),
        api<Branch[]>("/branches"),
        api<string[]>("/inventory/suppliers"),
      ]);
      setLevels(lv); setVouchers(vo); setMoves(mv);
      setProducts(pr); setBranches(br); setSuppliers(sp);
      setPageErr("");
    } catch (e: any) { setPageErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  // كل المواقع المتاحة للاختيار: المستودع + الفروع
  const locations = useMemo(() => [
    { value: `warehouse:${WAREHOUSE_LOC_ID}`, label: "المستودع الرئيسي" },
    ...branches.map((b) => ({ value: `branch:${b.id}`, label: `فرع ${b.name}` })),
  ], [branches]);

  // رصيد كل صنف في موقع المصدر — بيتعرض في محرّر السطور كتحذير مبكر
  const availability = useMemo(() => {
    const [t, id] = fromLoc.split(":");
    const map: Record<string, number> = {};
    levels.filter((l) => l.loc_type === t && String(l.loc_id) === id)
          .forEach((l) => { map[l.product_id] = l.qty; });
    return map;
  }, [levels, fromLoc]);

  const visibleLevels = useMemo(() => levels.filter((l) =>
    (!onlyLow || l.is_low) &&
    (!locFilter || `${l.loc_type}:${l.loc_id}` === locFilter)
  ), [levels, onlyLow, locFilter]);

  const lowCount = useMemo(() => levels.filter((l) => l.is_low).length, [levels]);

  // ── فتح النماذج ──
  function openReceive() {
    setLines([]); setSupplierName(""); setNote(""); setErr(""); setReceiveOpen(true);
  }
  function openTransfer() {
    setLines([]); setNote(""); setErr("");
    setFromLoc(`warehouse:${WAREHOUSE_LOC_ID}`);
    setToLoc(branches[0] ? `branch:${branches[0].id}` : "");
    setTransferOpen(true);
  }
  async function openVoucher(moveNo: string) {
    setErr("");
    try {
      const v = await api<VoucherDetail>(`/inventory/vouchers/${moveNo}`);
      setVoucher(v);
      setLines(v.items.map((i) => ({
        productId: i.productId, productLabel: i.productLabel,
        barcode: i.barcode, qty: i.qty,
      })));
      // رصيد المصدر بيتحسب من نفس موقع السند الأصلي
      if (v.fromLocType) setFromLoc(`${v.fromLocType}:${v.fromLocId}`);
    } catch (e: any) { await appAlert(e.message); }
  }

  const validLines = lines.filter((l) => l.productId && l.qty > 0);

  async function submitReceive() {
    setErr(""); setBusy(true);
    try {
      await api("/inventory/receive", {
        method: "POST",
        body: JSON.stringify({
          items: validLines.map((l) => ({
            productId: l.productId, productLabel: l.productLabel,
            barcode: l.barcode, qty: l.qty, unitCost: l.unitCost || 0,
          })),
          supplierName: supplierName.trim() || null,
          note: note.trim() || null,
        }),
      });
      setReceiveOpen(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function submitTransfer() {
    setErr(""); setBusy(true);
    const [fromLocType, fromLocId] = fromLoc.split(":");
    const [toLocType, toLocId] = toLoc.split(":");
    try {
      await api("/inventory/transfer", {
        method: "POST",
        body: JSON.stringify({
          fromLocType, fromLocId, toLocType, toLocId,
          items: validLines.map((l) => ({
            productId: l.productId, productLabel: l.productLabel,
            barcode: l.barcode, qty: l.qty,
          })),
          note: note.trim() || null,
        }),
      });
      setTransferOpen(false);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  async function submitVoucherEdit() {
    if (!voucher) return;
    setErr(""); setBusy(true);
    try {
      await api(`/inventory/vouchers/${voucher.moveNo}`, {
        method: "PUT",
        body: JSON.stringify({
          items: validLines.map((l) => ({
            productId: l.productId, productLabel: l.productLabel,
            barcode: l.barcode, qty: l.qty,
          })),
        }),
      });
      setVoucher(null);
      await load();
    } catch (e: any) { setErr(e.message); }
    finally { setBusy(false); }
  }

  // ══════════════════ الأعمدة ══════════════════

  const levelCols: Column<Level>[] = [
    {
      key: "name", title: "الصنف",
      render: (l) => (
        <div>
          <div className="font-extrabold">{l.name}{l.spec ? ` — ${l.spec}` : ""}</div>
          <div className="text-[11px] text-text-dim">{l.category}</div>
        </div>
      ),
    },
    { key: "loc_name", title: "الموقع", width: "180px" },
    {
      key: "qty", title: "الرصيد", width: "100px",
      render: (l) => (
        <span className={`tnum text-[14px] font-black ${l.is_low ? "text-ember" : ""}`}>{l.qty}</span>
      ),
    },
    { key: "unit", title: "الوحدة", width: "80px", render: (l) => l.unit || "—" },
    {
      key: "min_qty", title: "حد الانخفاض", width: "100px",
      render: (l) => l.min_qty > 0 ? <span className="tnum">{l.min_qty}</span>
                                   : <span className="text-text-dim">—</span>,
    },
    {
      key: "is_low", title: "الحالة", width: "110px",
      render: (l) => l.is_low
        ? <Badge tone="warn">يحتاج تزويد</Badge>
        : <Badge tone="good">كافٍ</Badge>,
    },
  ];

  const voucherCols: Column<Voucher>[] = [
    {
      key: "moveNo", title: "رقم السند", width: "130px",
      render: (v) => <span className="tnum font-extrabold">{v.moveNo}</span>,
    },
    {
      key: "type", title: "النوع", width: "100px",
      render: (v) => v.type === "receive"
        ? <Badge tone="good">استلام</Badge>
        : <Badge tone="info">تحويل</Badge>,
    },
    { key: "from", title: "من" },
    { key: "to", title: "إلى" },
    {
      key: "itemCount", title: "أصناف", width: "80px",
      render: (v) => <span className="tnum">{v.itemCount}</span>,
    },
    {
      key: "totalQty", title: "إجمالي الكمية", width: "110px",
      render: (v) => <span className="tnum font-bold">{v.totalQty}</span>,
    },
    {
      key: "createdAt", title: "التاريخ", width: "160px",
      render: (v) => <span className="text-[12px] text-text-dim">{dateFmt(v.createdAt)}</span>,
    },
    {
      key: "actions", title: "", width: "90px",
      render: (v) => (
        <div className="flex justify-end">
          <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]"
                  onClick={() => openVoucher(v.moveNo)}>عرض</Button>
        </div>
      ),
    },
  ];

  const moveCols: Column<Move>[] = [
    {
      key: "created_at", title: "التاريخ", width: "160px",
      render: (m) => <span className="text-[12px] text-text-dim">{dateFmt(m.created_at)}</span>,
    },
    {
      key: "move_no", title: "السند", width: "120px",
      render: (m) => <span className="tnum">{m.move_no || "—"}</span>,
    },
    {
      key: "move_type", title: "النوع", width: "90px",
      render: (m) => m.move_type === "receive"
        ? <Badge tone="good">استلام</Badge>
        : <Badge tone="info">تحويل</Badge>,
    },
    { key: "product_label", title: "الصنف" },
    {
      key: "qty", title: "الكمية", width: "80px",
      render: (m) => <span className="tnum font-bold">{m.qty}</span>,
    },
    {
      key: "supplier_name", title: "المورد", width: "140px",
      render: (m) => m.supplier_name || <span className="text-text-dim">—</span>,
    },
  ];

  function printVoucher() {
    if (!voucher) return;
    const body =
      kpisHTML([
        { label: "رقم السند", value: voucher.moveNo },
        { label: "النوع", value: voucher.type === "receive" ? "سند استلام" : "سند تحويل" },
        { label: "التاريخ", value: dateFmt(voucher.createdAt) },
      ]) +
      tableHTML(["البيان", "القيمة"], [
        ["من", voucher.from || "—"],
        ["إلى", voucher.to],
        ...(voucher.supplierName ? [["المورد", voucher.supplierName]] : []),
        ...(voucher.note ? [["ملاحظة", voucher.note]] : []),
      ]) +
      `<h2 class="sec">الأصناف</h2>` +
      tableHTML(["الصنف", "الباركود", "الكمية"],
        voucher.items.map((i) => [i.productLabel, i.barcode || "—", i.qty]),
        { numericCols: [2] }) +
      `<div style="display:flex;justify-content:space-between;margin-top:26px;font-size:11px">
         <div>توقيع المسلِّم: ______________</div>
         <div>توقيع المستلِم: ______________</div>
       </div>`;
    printReport(voucher.type === "receive" ? "سند استلام مخزون" : "سند تحويل مخزون",
                `سند رقم ${voucher.moveNo}`, body);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[19px] font-extrabold">المخزون</h1>

      {/* ══════════ 🔔 نقطة إعادة الطلب التلقائية ══════════ */}
      {reorder && reorder.length > 0 && (
        <div className="rounded-card border border-brass/40 bg-brass-soft/50 p-4 shadow-card">
          <h2 className="mb-2 flex items-center gap-1.5 text-[13.5px] font-black text-brass">
            🔔 أصناف وصلت حد إعادة الطلب ({reorder.length})
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead className="text-[11px] font-black text-text-dim">
                <tr>
                  <th className="px-2 py-1.5 text-right">الصنف</th>
                  <th className="px-2 py-1.5">الرصيد</th>
                  <th className="px-2 py-1.5">الحد الأدنى</th>
                  <th className="px-2 py-1.5">اقتراح الطلب</th>
                  <th className="px-2 py-1.5 text-left">آخر مورد</th>
                </tr>
              </thead>
              <tbody>
                {reorder.slice(0, 15).map((r) => (
                  <tr key={r.productId} className="border-t border-line/60">
                    <td className="px-2 py-1.5 font-bold">{r.name}</td>
                    <td className="tnum px-2 py-1.5 text-center font-black text-ember">{r.onHand}</td>
                    <td className="tnum px-2 py-1.5 text-center text-text-dim">{r.minQty}</td>
                    <td className="tnum px-2 py-1.5 text-center font-black text-emerald">+{r.suggestedQty}</td>
                    <td className="px-2 py-1.5 text-left text-text-dim">{r.lastSupplier || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10.5px] text-text-dim">الاقتراح = ضِعف الحد الأدنى − الرصيد الحالي · حدّد الحد الأدنى لكل صنف من شاشة الأصناف</p>
        </div>
      )}
        <div className="flex gap-2">
          {canReceive && <Button onClick={openReceive}>+ استلام من مورد</Button>}
          {canManageStock && <Button variant="ghost" onClick={openTransfer}>تحويل مخزون</Button>}
          {canRequest && <Button onClick={openRequestModal}>+ طلب أصناف لفرعي</Button>}
        </div>
      </div>

      <ErrorNote msg={pageErr} />

      {lowCount > 0 && (
        <div className="rounded-lg border border-ember/30 bg-ember-bg px-4 py-2.5 text-[12.5px] font-bold text-ember">
          {lowCount} رصيد وصل حد الانخفاض أو أقل — راجع تبويب الأرصدة وفلتر «الناقص فقط».
        </div>
      )}

      <Card className="!p-0">
        <div className="px-5 pt-4">
          <Tabs value={tab} onChange={setTab} items={[
            { key: "levels", label: "الأرصدة" },
            { key: "vouchers", label: "السندات" },
            { key: "moves", label: "سجل الحركات" },
            ...(((canRequest || canApproveRequests) ? [{ key: "requests", label: "طلبات الفروع" }] : []) as { key: "requests"; label: string }[]),
          ] as { key: "levels" | "vouchers" | "moves" | "requests"; label: string }[]} />
        </div>

        <div className="p-5">
          {tab === "requests" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  <Button variant={reqFilter === "pending" ? "primary" : "ghost"} className="!text-[12px]" onClick={() => setReqFilter("pending")}>معلّقة</Button>
                  <Button variant={reqFilter === "all" ? "primary" : "ghost"} className="!text-[12px]" onClick={() => setReqFilter("all")}>الكل</Button>
                </div>
              </div>
              {requests.length === 0 && <p className="py-10 text-center text-[12.5px] text-text-dim">لا طلبات حالياً</p>}
              <div className="space-y-2">
                {requests.map((r) => {
                  const ui = REQ_STATUS_UI[r.status];
                  return (
                    <div key={r.id} className="rounded-xl border border-line p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="text-[13px] font-black">
                          {r.requestingBranchName}
                          {r.sourceBranchName && <span className="font-normal text-text-dim"> ← من {r.sourceBranchName}</span>}
                        </div>
                        <Badge tone={ui.tone}>{ui.label}</Badge>
                      </div>
                      <div className="mt-1 text-[11.5px] text-text-dim">
                        بواسطة {r.requestedByName} — {new Date(r.createdAt).toLocaleString("ar-SA-u-nu-latn")}
                        {r.note && <span> · {r.note}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.items.map((it) => (
                          <span key={it.id} className="rounded-full bg-ink-3 px-2.5 py-1 text-[11px] font-bold">
                            {it.label} × <span className="tnum">{it.qtyRequested}</span>
                            {r.status !== "pending" && it.qtyApproved !== null && it.qtyApproved !== it.qtyRequested && (
                              <span className="text-text-dim"> (اعتُمد {it.qtyApproved})</span>
                            )}
                          </span>
                        ))}
                      </div>
                      {(r.status === "pending" || r.status === "approved") && canApproveRequests && (
                        <div className="mt-2.5">
                          <Button className="!text-[12px]" onClick={() => openDecide(r)}>
                            {r.status === "approved" ? "إعادة محاولة التنفيذ" : "مراجعة والبت"}
                          </Button>
                        </div>
                      )}
                      {r.decidedByName && (
                        <div className="mt-1.5 text-[11px] text-text-dim">
                          البت بواسطة {r.decidedByName}{r.decisionNote && ` — ${r.decisionNote}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {tab === "levels" && (
            <DataTable
              columns={levelCols}
              rows={visibleLevels}
              loading={loading}
              searchKeys={["name", "category", "spec", "barcode", "loc_name"]}
              searchPlaceholder="بحث بالصنف أو الموقع..."
              emptyText="لا توجد أرصدة بعد — سجّل أول استلام من مورد"
              toolbar={
                <div className="flex items-center gap-2">
                  <Select value={locFilter} onChange={(e) => setLocFilter(e.target.value)}
                          className="!w-48">
                    <option value="">كل المواقع</option>
                    {locations.map((l) => (
                      <option key={l.value} value={l.value}>{l.label}</option>
                    ))}
                  </Select>
                  <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-bold text-text-dim">
                    <input type="checkbox" checked={onlyLow}
                           onChange={(e) => setOnlyLow(e.target.checked)}
                           className="accent-petrol" />
                    الناقص فقط
                  </label>
                </div>
              }
            />
          )}

          {tab === "vouchers" && (
            <DataTable
              columns={voucherCols}
              rows={vouchers}
              loading={loading}
              searchKeys={["moveNo", "from", "to"]}
              searchPlaceholder="بحث برقم السند أو الموقع..."
              emptyText="لا توجد سندات بعد"
            />
          )}

          {tab === "moves" && (
            <DataTable
              columns={moveCols}
              rows={moves}
              loading={loading}
              searchKeys={["product_label", "move_no", "supplier_name"]}
              searchPlaceholder="بحث بالصنف أو رقم السند..."
              emptyText="لا توجد حركات بعد"
            />
          )}
        </div>
      </Card>

      {/* ══════════ سند استلام من مورد ══════════ */}
      <Modal open={receiveOpen} size="lg" onClose={() => setReceiveOpen(false)}
             title="استلام من مورد إلى المستودع">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Field label="اسم المورد" hint="اختياري — بيظهر في السند والقيد المحاسبي">
              <Input value={supplierName} list="z8-suppliers"
                     onChange={(e) => setSupplierName(e.target.value)} />
              <datalist id="z8-suppliers">
                {suppliers.map((s) => <option key={s} value={s} />)}
              </datalist>
            </Field>
            <Field label="ملاحظة">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <StockItemsEditor products={products} items={lines} onChange={setLines} withCost />

          <p className="text-[11px] leading-5 text-text-dim">
            تكلفة الوحدة بتحدّث سعر تكلفة الصنف، وبيتسجّل قيد يومية تلقائي:
            مدين المخزون / دائن الموردين بإجمالي التكلفة.
          </p>

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setReceiveOpen(false)}>إلغاء</Button>
            <Button onClick={submitReceive} disabled={busy || validLines.length === 0}>
              {busy ? "جارِ الحفظ..." : "تسجيل الاستلام"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ سند تحويل داخلي ══════════ */}
      {/* ══════════ إنشاء طلب أصناف لفرعي ══════════ */}
      <Modal open={reqOpen} size="lg" onClose={() => setReqOpen(false)} title="+ طلب أصناف لفرعي">
        <div className="space-y-3">
          <p className="text-[12px] text-text-dim">
            حدد الأصناف والكميات اللي فرعك محتاجها — الطلب هيروح لصاحب الصلاحية للموافقة والتنفيذ، مش تحويل مباشر.
          </p>
          <Field label="الفرع الطالب (اللي هيستلم الأصناف)">
            <Select value={reqRequestingBranch} onChange={(e) => setReqRequestingBranch(e.target.value)}>
              <option value="">— اختر الفرع —</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="الفرع/المخزن المصدر (اختياري — أو خلّي المسؤول يحدده)">
            <Select value={reqSourceBranch} onChange={(e) => setReqSourceBranch(e.target.value)}>
              <option value="">— بدون تحديد —</option>
              <option value={WAREHOUSE_LOC_ID}>المستودع الرئيسي</option>
              {branches.filter((b) => b.id !== reqRequestingBranch).map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </Select>
          </Field>
          <StockItemsEditor products={products} items={reqItems} onChange={setReqItems} />
          <Field label="ملاحظة (اختياري)">
            <Input value={reqNote} onChange={(e) => setReqNote(e.target.value)} placeholder="مثال: نقص مفاجئ في الزيت الأكثر طلباً" />
          </Field>
          <ErrorNote msg={reqErr} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setReqOpen(false)}>إلغاء</Button>
            <Button disabled={reqBusy || !reqRequestingBranch || reqItems.filter((it) => it.productId).length === 0} onClick={submitRequest}>
              {reqBusy ? "..." : "إرسال الطلب"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ مراجعة والبت في طلب فرع ══════════ */}
      <Modal open={!!decideOpen} size="lg" onClose={() => setDecideOpen(null)} title="مراجعة طلب الفرع">
        {decideOpen && (
          <div className="space-y-3">
            <div className="rounded-lg bg-ink-3 px-3 py-2 text-[12.5px]">
              <b>{decideOpen.requestingBranchName}</b> — بواسطة {decideOpen.requestedByName}
              {decideOpen.note && <div className="mt-1 text-text-dim">{decideOpen.note}</div>}
            </div>
            <Field label="التنفيذ من (الفرع/المخزن المصدر)">
              <Select value={decideSource} onChange={(e) => setDecideSource(e.target.value)}>
                <option value="">— اختر —</option>
                <option value={WAREHOUSE_LOC_ID}>المستودع الرئيسي</option>
                {branches.filter((b) => b.id !== decideOpen.requestingBranchId).map((b) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </Select>
            </Field>
            <div className="space-y-1.5 rounded-lg border border-line p-2.5">
              {decideOpen.items.map((it) => (
                <div key={it.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                  <span className="flex-1">{it.label} <span className="tnum text-text-dim">(مطلوب {it.qtyRequested})</span></span>
                  <Input className="!w-20 text-center" inputMode="numeric" value={decideQtys[it.id] || ""}
                         onChange={(e) => setDecideQtys({ ...decideQtys, [it.id]: e.target.value.replace(/\D/g, "") })} />
                </div>
              ))}
              <p className="pt-1 text-[10.5px] text-text-dim">عدّل الكمية المعتمدة لأي صنف (موافقة جزئية) — أو سيبها زي المطلوب</p>
            </div>
            <Field label="ملاحظة القرار (اختياري)">
              <Input value={decideNote} onChange={(e) => setDecideNote(e.target.value)} />
            </Field>
            <ErrorNote msg={reqErr} />
            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" className="text-ember" disabled={reqBusy} onClick={() => submitDecision(false)}>رفض الطلب</Button>
              <Button disabled={reqBusy || !decideSource} onClick={() => submitDecision(true)}>
                {reqBusy ? "..." : "✓ الموافقة وتنفيذ التحويل"}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={transferOpen} size="lg" onClose={() => setTransferOpen(false)}
             title="تحويل مخزون بين المواقع">
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="من">
              <Select value={fromLoc} onChange={(e) => setFromLoc(e.target.value)}>
                {locations.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </Field>
            <Field label="إلى">
              <Select value={toLoc} onChange={(e) => setToLoc(e.target.value)}>
                <option value="">— اختر الوجهة —</option>
                {locations.filter((l) => l.value !== fromLoc)
                  .map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
              </Select>
            </Field>
            <Field label="ملاحظة">
              <Input value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </div>

          <StockItemsEditor products={products} items={lines} onChange={setLines}
                            availability={availability} />

          <ErrorNote msg={err} />
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" onClick={() => setTransferOpen(false)}>إلغاء</Button>
            <Button onClick={submitTransfer}
                    disabled={busy || validLines.length === 0 || !toLoc || toLoc === fromLoc}>
              {busy ? "جارِ الحفظ..." : "تنفيذ التحويل"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ══════════ عرض / تعديل سند ══════════ */}
      <Modal open={!!voucher} size="lg" onClose={() => setVoucher(null)}
             title={`سند ${voucher?.moveNo ?? ""}`}>
        {voucher && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button variant="ghost" className="!px-2.5 !py-1 !text-[11.5px]" onClick={printVoucher}>🖨 طباعة السند</Button>
            </div>
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-[12.5px] sm:grid-cols-4">
              <div><span className="text-text-dim">النوع:</span>{" "}
                <b>{voucher.type === "receive" ? "استلام" : "تحويل"}</b></div>
              <div><span className="text-text-dim">من:</span> <b>{voucher.from}</b></div>
              <div><span className="text-text-dim">إلى:</span> <b>{voucher.to}</b></div>
              <div><span className="text-text-dim">التاريخ:</span>{" "}
                <b>{dateFmt(voucher.createdAt)}</b></div>
              {voucher.note && (
                <div className="sm:col-span-4">
                  <span className="text-text-dim">ملاحظة:</span> {voucher.note}
                </div>
              )}
            </div>

            <StockItemsEditor
              products={products} items={lines} onChange={setLines}
              availability={voucher.type === "transfer" ? availability : undefined}
            />

            <p className="text-[11px] leading-5 text-text-dim">
              تعديل السند بيعكس أثر الأصناف القديمة على الأرصدة ويطبّق الجديدة مكانها في عملية واحدة.
            </p>

            <ErrorNote msg={err} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setVoucher(null)}>إغلاق</Button>
              {canManageStock && (
                <Button onClick={submitVoucherEdit} disabled={busy || validLines.length === 0}>
                  {busy ? "جارِ الحفظ..." : "حفظ التعديلات"}
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
