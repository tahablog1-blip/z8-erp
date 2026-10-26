"use client";
// BarcodeLabels — طباعة ملصقات الباركود (Code 128) مع معاينة حقيقية: الصنف/SKU/السعر/عدد النسخ + مقاس الملصق.
// عرض وطباعة فقط — لا يغيّر أي بيانات.
import { useMemo, useState } from "react";
import { Button, Field, Input, Modal, Select, Switch } from "@/components/ui";
import { barcodeSvg } from "@/lib/code128";
import { MIcon } from "@/components/m-icon";
import { fmtMoney } from "@/lib/customers/format";

export type LabelItem = { id: string; name: string; spec?: string | null; sku: string | null; barcode: string | null; priceVat: number };
const SIZES = { "50x30": { w: 50, h: 30, label: "ملصق 50×30 مم (رول)" }, "40x25": { w: 40, h: 25, label: "ملصق 40×25 مم (رول)" }, "a4": { w: 63, h: 38, label: "ورقة A4 — 3 أعمدة" } } as const;
const esc = (s: unknown) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function labelsHTML(items: LabelItem[], copies: number, size: keyof typeof SIZES, opt: { name: boolean; sku: boolean; price: boolean }): string {
  const S = SIZES[size];
  const cell = (it: LabelItem) => {
    const code = it.barcode || it.sku || "";
    return `<div class="lb">${opt.name ? `<div class="nm">${esc([it.name, it.spec].filter(Boolean).join(" "))}</div>` : ""}
      <div class="bc">${code ? barcodeSvg(code, { height: 34 }) : '<div class="none">بلا باركود</div>'}</div>
      <div class="ft"><span class="tnum">${esc(code)}</span>${opt.sku && it.sku && it.sku !== code ? `<span class="tnum">${esc(it.sku)}</span>` : ""}${opt.price ? `<b class="tnum">${fmtMoney(it.priceVat, 2)} ر.س</b>` : ""}</div></div>`;
  };
  const all = items.flatMap((it) => Array.from({ length: copies }, () => cell(it))).join("");
  const page = size === "a4" ? "@page{size:A4;margin:10mm}.sheet{display:grid;grid-template-columns:repeat(3,63mm);gap:2mm}" : `@page{size:${S.w}mm ${S.h}mm;margin:0}.sheet{display:block}.lb{page-break-after:always}`;
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>ملصقات الباركود</title><style>
    ${page}*{box-sizing:border-box;margin:0;padding:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{font-family:"IBM Plex Sans Arabic","Cairo",Tahoma,sans-serif;color:#000}.tnum{direction:ltr;unicode-bidi:embed;font-variant-numeric:tabular-nums}
    .lb{width:${S.w}mm;height:${S.h}mm;padding:1.5mm 2mm;display:flex;flex-direction:column;justify-content:space-between;overflow:hidden;${size === "a4" ? "border:.2mm dashed #bbb;" : ""}}
    .nm{font-size:${size === "40x25" ? 7 : 8.5}px;font-weight:700;line-height:1.2;max-height:2.4em;overflow:hidden;text-align:center}
    .bc{text-align:center;flex:1;display:flex;align-items:center;justify-content:center}.bc svg{max-width:100%;height:${size === "40x25" ? 9 : 12}mm;width:auto}
    .ft{display:flex;justify-content:space-between;gap:2mm;font-size:7.5px;align-items:center}.none{font-size:8px;color:#666}
  </style></head><body><div class="sheet">${all}</div></body></html>`;
}

export function BarcodeLabels({ open, items, onClose }: { open: boolean; items: LabelItem[]; onClose: () => void }) {
  const [copies, setCopies] = useState("1"); const [size, setSize] = useState<keyof typeof SIZES>("50x30");
  const [opt, setOpt] = useState({ name: true, sku: false, price: true });
  const n = Math.min(100, Math.max(1, Number(copies) || 1));
  const missing = items.filter((i) => !(i.barcode || i.sku)).length;
  const html = useMemo(() => (open ? labelsHTML(items.slice(0, 6), 1, size, opt) : ""), [open, items, size, opt]);
  function print() {
    const w = window.open("", "_blank", "width=700,height=600"); if (!w) { alert("المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة"); return; }
    w.document.write(labelsHTML(items, n, size, opt)); w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
  }
  const S = SIZES[size];
  return (
    <Modal open={open} size="lg" onClose={onClose} title="طباعة ملصقات الباركود">
      <div className="space-y-3">
        <div className="grid gap-2.5 sm:grid-cols-3">
          <Field label="مقاس الملصق"><Select value={size} onChange={(e) => setSize(e.target.value as keyof typeof SIZES)}>{Object.entries(SIZES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</Select></Field>
          <Field label="عدد النسخ لكل صنف"><Input type="number" min={1} max={100} className="tnum" value={copies} onChange={(e) => setCopies(e.target.value)} /></Field>
          <div className="space-y-1 pt-1 text-t-sm">
            {([["name", "اسم الصنف"], ["sku", "رمز SKU"], ["price", "السعر شامل الضريبة"]] as const).map(([k, l]) => (
              <label key={k} className="flex items-center justify-between gap-2"><span>{l}</span><Switch checked={opt[k]} onChange={(v) => setOpt({ ...opt, [k]: v })} /></label>))}
          </div>
        </div>
        {missing > 0 && <p role="alert" className="rounded-lg bg-brass-bg px-3 py-2 text-t-sm font-bold text-brass">{missing} صنف بلا باركود ولا SKU — لن يظهر له رمز.</p>}
        <div className="rounded-xl border border-line bg-ink-3 p-2">
          <div className="mb-1 text-t-xs font-bold text-text-dim">معاينة (أول {Math.min(6, items.length)} من {items.length} صنف) — الإجمالي {items.length * n} ملصق</div>
          <iframe title="معاينة الملصقات" srcDoc={html} sandbox="" style={{ width: "100%", height: size === "a4" ? 260 : Math.max(120, S.h * 4.2 + 20), border: 0, background: "#fff" }} />
        </div>
        <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>إغلاق</Button><Button onClick={print} disabled={!items.length}><MIcon name="print" className="!text-[18px]" />طباعة</Button></div>
      </div>
    </Modal>
  );
}
