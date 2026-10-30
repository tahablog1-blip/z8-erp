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
import Link from "next/link";
import { MIcon } from "@/components/m-icon";
import { StockCenter } from "@/components/inventory/StockCenter";
import { MovementsPanel } from "@/components/inventory/MovementsPanel";
import { AlertsPanel } from "@/components/inventory/AlertsPanel";
import { AnalyticsPanel } from "@/components/inventory/AnalyticsPanel";
import { PeriodPicker, defaultPeriod, type Period } from "@/components/inventory/shared";
import type { Loc as InvLoc } from "@/lib/inventory/types";
import {
  Badge, Button, Card, ErrorNote, Field, Input, Modal, Select, Switch, Tabs, PageHeader } from "@/components/ui";

const WAREHOUSE_LOC_ID = "main";

type Branch = { id: string; name: string };

type Level = {
  loc_type: string; loc_id: string; product_id: string; qty: number;
  category: string | null; name: string | null; spec: string | null;
  unit: string | null; min_qty: number; barcode: string | null;
  branch_name: string | null; loc_name: string; is_low: boolean;
  shelf_location: string | null;
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

const dateFmt = (s: string) =>
  new Date(s).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"), {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

export default function InventoryPage() {
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
    fulfilled: { label: "تم التنفيذ", tone: "good" },
  };

  const canReceive = hasPerm("products.view_stock", "purchasing.invoices");

  type Tab = "levels" | "vouchers" | "moves" | "requests" | "alerts" | "analytics";
  const [tab, setTab] = useState<Tab>("levels");
  useEffect(() => { if (tab === "requests") loadRequests(); }, [tab, reqFilter]);
  const [levels, setLevels] = useState<Level[]>([]);   // لا يُحمَّل إلا عند فتح نموذج التحويل/السند (لتحذير الرصيد)
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [suppliers, setSuppliers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageErr, setPageErr] = useState("");
  // مركز القيادة: الموقع والفترة مشتركان بين كل الأقسام. الفترة للحركة فقط — الرصيد الحالي لحظي.
  const [loc, setLoc] = useState("");
  const [locs, setLocs] = useState<InvLoc[]>([]);
  const [period, setPeriod] = useState<Period>(defaultPeriod());
  const [deadDays, setDeadDays] = useState(90);
  const [moveProduct, setMoveProduct] = useState<{ id: string; label: string } | null>(null);

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
      const [vo, pr, br, sp, lc] = await Promise.all([
        api<Voucher[]>("/inventory/vouchers"),
        api<Product[]>("/products").then((ps) => ps.filter((p) => !p.is_service)),
        api<Branch[]>("/branches"),
        api<string[]>("/inventory/suppliers"),
        api<InvLoc[]>("/inventory/overview/locations"),
      ]);
      setVouchers(vo); setLocs(lc);
      if (lc.length === 1) setLoc(lc[0].value);
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



  // ── فتح النماذج ──
  function openReceive() {
    setLines([]); setSupplierName(""); setNote(""); setErr(""); setReceiveOpen(true);
  }
  async function loadLevels() {
    try { setLevels(await api<Level[]>("/inventory/levels")); } catch { /* التحذير المبكر اختياري؛ الباك اند هو من يرفض الرصيد غير الكافي */ }
  }
  function openTransfer(preset?: { productId: string; productLabel: string; barcode: string | null }[], from?: string) {
    loadLevels();
    setLines((preset ?? []).map((p) => ({ productId: p.productId, productLabel: p.productLabel, barcode: p.barcode, qty: 1 })));
    setNote(""); setErr("");
    setFromLoc(from || `warehouse:${WAREHOUSE_LOC_ID}`);
    setToLoc(branches[0] ? `branch:${branches[0].id}` : "");
    setTransferOpen(true);
  }
  async function openVoucher(moveNo: string) {
    setErr(""); loadLevels();
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

  const voucherCols: Column<Voucher>[] = [
    {
      key: "moveNo", title: "رقم السند", width: "130px",
      render: (v) => <span className="tnum font-extrabold">{v.moveNo}</span>,
    },
    {
      key: "type", title: "النوع", width: "100px",
      render: (v) => v.type === "receive"
        ? <Badge tone="good">استلام</Badge>
        : v.type === "adjust" ? <Badge tone="warn">تسوية جرد</Badge>
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
      render: (v) => <span className="text-t-sm text-text-dim">{dateFmt(v.createdAt)}</span>,
    },
    {
      key: "actions", title: "", width: "90px",
      render: (v) => (
        <div className="flex justify-end">
          <Button variant="ghost" size="xs"
                  onClick={() => openVoucher(v.moveNo)}>عرض</Button>
        </div>
      ),
    },
  ];

  function printVoucher() {
    if (!voucher) return;
    const body =
      kpisHTML([
        { label: "رقم السند", value: voucher.moveNo },
        { label: "النوع", value: voucher.type === "receive" ? "سند استلام" : voucher.type === "adjust" ? "سند تسوية جرد" : "سند تحويل" },
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
    printReport(voucher.type === "receive" ? "سند استلام مخزون" : voucher.type === "adjust" ? "سند تسوية جرد" : "سند تحويل مخزون",
                `سند رقم ${voucher.moveNo}`, body);
  }

  const locName = locs.find((l) => l.value === loc)?.name;
  const canTransfer = canManageStock;
  const canStocktake = hasPerm("inventory.stocktake");
  const canPurchase = hasPerm("purchasing.orders", "purchasing.invoices");
  const TABS = [
    { key: "levels", label: "الأرصدة" },
    { key: "moves", label: "حركة المخزون" },
    { key: "vouchers", label: "السندات والتحويلات" },
    { key: "alerts", label: "التنبيهات وإعادة الطلب" },
    { key: "analytics", label: "التحليلات" },
    ...((canRequest || canApproveRequests) ? [{ key: "requests", label: "طلبات الفروع" }] : []),
  ] as { key: Tab; label: string }[];

  return (
    <div className="space-y-4">
      <PageHeader title="المخزون" description="إدارة ومتابعة المخزون والكميات والحركات والفروع والمستودعات." actions={<>{canReceive && <Button onClick={openReceive}><MIcon name="move_to_inbox" className="!text-[16px]" />استلام مخزون</Button>}
          {canTransfer && <Button variant="outline" onClick={() => openTransfer()}><MIcon name="swap_horiz" className="!text-[16px]" />تحويل مخزون</Button>}
          {canStocktake && <Link href="/inventory/stocktake" className="m3 z8-anim-btn inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-4 py-2 text-t-md font-semibold text-text hover:border-petrol hover:text-petrol"><MIcon name="fact_check" className="!text-[16px]" />جرد وتسوية</Link>}
          {hasPerm("products.create") && <Link href="/products" className="m3 z8-anim-btn inline-flex items-center gap-1.5 rounded-lg border border-line bg-ink-2 px-4 py-2 text-t-md font-semibold text-text-dim hover:border-petrol hover:text-petrol"><MIcon name="add" className="!text-[16px]" />إضافة صنف</Link>}
          {canRequest && <Button variant="ghost" onClick={openRequestModal}>طلب أصناف لفرعي</Button>}</>} />

      <ErrorNote msg={pageErr} />

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-ink-2 px-3 py-2 shadow-card">
        <PeriodPicker value={period} onChange={setPeriod} />
        <label className="flex items-center gap-1.5 text-t-xs font-bold text-text-dim">راكد بعد
          <Select value={String(deadDays)} onChange={(e) => setDeadDays(Number(e.target.value))} aria-label="مدة الركود" className="!w-auto !py-1">
            {[30, 60, 90, 180].map((d) => <option key={d} value={d}>{d} يوماً</option>)}
          </Select>
        </label>
        <p className="text-t-xs text-text-dim">الفترة للحركة فقط؛ الأرصدة والقيم لحظية من النظام.</p>
      </div>

      <Tabs value={tab} onChange={setTab} items={TABS} />

      <div>
        {tab === "levels" && (
          <StockCenter loc={loc} locs={locs} onLoc={setLoc} period={period} deadDays={deadDays} canTransfer={canTransfer} canStocktake={canStocktake}
            onTransfer={(lns, from) => openTransfer(lns, from)} onShowMoves={(id, label) => { setMoveProduct({ id, label }); setTab("moves"); }} />
        )}
        {tab === "moves" && (
          <MovementsPanel loc={loc} period={period} product={moveProduct} onClearProduct={() => setMoveProduct(null)} canCost={canManageStock} />
        )}
        {tab === "alerts" && <AlertsPanel loc={loc} deadDays={deadDays} canPurchase={canPurchase} canCost={canManageStock} />}
        {tab === "analytics" && <AnalyticsPanel loc={loc} period={period} deadDays={deadDays} onPickLoc={(v) => { setLoc(v); setTab("levels"); }} onPickCategory={() => setTab("levels")} />}
        {(tab === "vouchers" || tab === "requests") && (
          <Card className="!p-0"><div className="p-5">
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

          {tab === "requests" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex gap-1.5">
                  <Button variant={reqFilter === "pending" ? "primary" : "ghost"} size="sm" onClick={() => setReqFilter("pending")}>معلّقة</Button>
                  <Button variant={reqFilter === "all" ? "primary" : "ghost"} size="sm" onClick={() => setReqFilter("all")}>الكل</Button>
                </div>
              </div>
              {requests.length === 0 && <p className="py-10 text-center text-t-sm text-text-dim">لا طلبات حالياً</p>}
              <div className="space-y-2">
                {requests.map((r) => {
                  const ui = REQ_STATUS_UI[r.status];
                  return (
                    <div key={r.id} className="rounded-card border border-line p-3.5">
                      <div className="flex items-center justify-between">
                        <div className="text-t-md font-black">
                          {r.requestingBranchName}
                          {r.sourceBranchName && <span className="font-normal text-text-dim"> ← من {r.sourceBranchName}</span>}
                        </div>
                        <Badge tone={ui.tone}>{ui.label}</Badge>
                      </div>
                      <div className="mt-1 text-t-xs text-text-dim">
                        بواسطة {r.requestedByName} — {new Date(r.createdAt).toLocaleString((typeof document !== "undefined" && document.documentElement.lang === "en" ? "en-US" : "ar-SA-u-nu-latn"))}
                        {r.note && <span> · {r.note}</span>}
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.items.map((it) => (
                          <span key={it.id} className="rounded-none bg-ink-3 px-2.5 py-1 text-t-xs font-bold">
                            {it.label} × <span className="tnum">{it.qtyRequested}</span>
                            {r.status !== "pending" && it.qtyApproved !== null && it.qtyApproved !== it.qtyRequested && (
                              <span className="text-text-dim"> (اعتُمد {it.qtyApproved})</span>
                            )}
                          </span>
                        ))}
                      </div>
                      {(r.status === "pending" || r.status === "approved") && canApproveRequests && (
                        <div className="mt-2.5">
                          <Button size="sm" onClick={() => openDecide(r)}>
                            {r.status === "approved" ? "إعادة محاولة التنفيذ" : "مراجعة والبت"}
                          </Button>
                        </div>
                      )}
                      {r.decidedByName && (
                        <div className="mt-1.5 text-t-xs text-text-dim">
                          البت بواسطة {r.decidedByName}{r.decisionNote && ` — ${r.decisionNote}`}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          </div></Card>
        )}
      </div>

      {/* ══════════ سند استلام من مورد ══════════ */}
      <Modal open={receiveOpen} size="full" onClose={() => setReceiveOpen(false)}
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

          <p className="text-t-xs leading-5 text-text-dim">
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
      <Modal open={reqOpen} size="full" onClose={() => setReqOpen(false)} title="+ طلب أصناف لفرعي">
        <div className="space-y-3">
          <p className="text-t-sm text-text-dim">
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
            <div className="rounded-lg bg-ink-3 px-3 py-2 text-t-sm">
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
                <div key={it.id} className="flex items-center justify-between gap-2 text-t-sm">
                  <span className="flex-1">{it.label} <span className="tnum text-text-dim">(مطلوب {it.qtyRequested})</span></span>
                  <Input className="!w-20 text-center" inputMode="numeric" value={decideQtys[it.id] || ""}
                         onChange={(e) => setDecideQtys({ ...decideQtys, [it.id]: e.target.value.replace(/\D/g, "") })} />
                </div>
              ))}
              <p className="pt-1 text-t-xs text-text-dim">عدّل الكمية المعتمدة لأي صنف (موافقة جزئية) — أو سيبها زي المطلوب</p>
            </div>
            <Field label="ملاحظة القرار (اختياري)">
              <Input value={decideNote} onChange={(e) => setDecideNote(e.target.value)} />
            </Field>
            <ErrorNote msg={reqErr} />
            <div className="flex justify-between gap-2 pt-1">
              <Button variant="ghost" className="text-ember" disabled={reqBusy} onClick={() => submitDecision(false)}>رفض الطلب</Button>
              <Button className="gap-1" disabled={reqBusy || !decideSource} onClick={() => submitDecision(true)}>
                {reqBusy ? "..." : <><MIcon name="check" className="!text-[15px]" /> الموافقة وتنفيذ التحويل</>}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={transferOpen} size="full" onClose={() => setTransferOpen(false)}
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
      <Modal open={!!voucher} size="full" onClose={() => setVoucher(null)}
             title={`سند ${voucher?.moveNo ?? ""}`}>
        {voucher && (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button variant="ghost" size="xs" onClick={printVoucher}>طباعة السند</Button>
            </div>
            <div className="grid gap-2 rounded-lg bg-ink-3 p-3 text-t-sm sm:grid-cols-4">
              <div><span className="text-text-dim">النوع:</span>{" "}
                <b>{voucher.type === "receive" ? "استلام" : voucher.type === "adjust" ? "تسوية جرد" : "تحويل"}</b></div>
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

            {voucher.type === "adjust" && (
              <p className="rounded-lg bg-brass-soft p-2.5 text-t-sm font-bold text-brass">سند تسوية جرد — أثر مُعتمَد لجلسة جرد ولا يُعدَّل. للتصحيح استخدم جلسة جرد جديدة.</p>
            )}
            <p className="text-t-xs leading-5 text-text-dim">
              تعديل السند بيعكس أثر الأصناف القديمة على الأرصدة ويطبّق الجديدة مكانها في عملية واحدة.
            </p>

            <ErrorNote msg={err} />
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="ghost" onClick={() => setVoucher(null)}>إغلاق</Button>
              {canManageStock && voucher.type !== "adjust" && (
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
