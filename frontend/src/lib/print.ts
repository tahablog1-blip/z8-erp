// lib/print.ts — محرك طباعة موحّد لكل تقارير وفواتير النظام
// printReport: تقرير A4 بترويسة المنشأة | printReceipt: إيصال حراري 80مم
import { getCompany } from "./company";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const BASE_CSS = `
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif; color:#111; }
  .tnum { font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:embed; }
  table { width:100%; border-collapse:collapse; }
  th { background:#eef3f4; border:1px solid #c9d4d6; padding:6px 8px; font-size:11.5px; }
  td { border:1px solid #dbe3e4; padding:5px 8px; font-size:11.5px; }
  .r { text-align:right; } .c { text-align:center; } .b { font-weight:700; }
  h2.sec { font-size:13px; margin:14px 0 6px; border-right:4px solid #0C5E66; padding-right:8px; }
  .kpis { display:flex; gap:8px; flex-wrap:wrap; margin:8px 0; }
  .kpi { flex:1; min-width:120px; border:1px solid #c9d4d6; border-radius:8px; padding:8px; text-align:center; }
  .kpi .v { font-size:15px; font-weight:800; } .kpi .t { font-size:10.5px; color:#556; }
`;

function reportShell(title: string, subtitle: string, bodyHTML: string) {
  const co = getCompany();
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  ${BASE_CSS}
  @page { size:A4; margin:12mm; }
  body { font-size:12px; }
  .head { display:flex; justify-content:space-between; align-items:flex-start;
          border-bottom:2px solid #0C5E66; padding-bottom:8px; margin-bottom:10px; }
  .head h1 { font-size:17px; color:#0C5E66; }
  .head .sub { font-size:10.5px; color:#445; margin-top:2px; }
  .title { font-size:15px; font-weight:800; margin:6px 0 2px; }
  .subtitle { font-size:11px; color:#556; margin-bottom:10px; }
  .foot { position:fixed; bottom:0; left:0; right:0; text-align:center;
          font-size:9.5px; color:#667; border-top:1px solid #ccc; padding-top:4px; }
</style></head><body>
  <img src="${location.origin}/logo-navy.png" style="width:40px;height:40px;object-fit:contain;display:block;margin:2mm auto" />
  <div class="head">
    <div>
      <h1>${esc(co.name)}</h1>
      <div class="sub">الرقم الضريبي: <span class="tnum">${esc(co.vat)}</span> — س.ت: <span class="tnum">${esc(co.cr)}</span></div>
      ${co.address ? `<div class="sub">${esc(co.address)}${co.phone ? ` — هاتف: <span class="tnum">${esc(co.phone)}</span>` : ""}</div>` : ""}
    </div>
    <div class="sub tnum">${new Date().toLocaleString("ar-SA-u-nu-latn")}</div>
  </div>
  <div class="title">${esc(title)}</div>
  ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}
  ${bodyHTML}
  <div class="foot">${esc(co.name)} — نظام Z8</div>
  <script>window.addEventListener("load",function(){setTimeout(function(){window.print()},250)});</script>
</body></html>`;
}

function receiptShell(title: string, bodyHTML: string, extraScript = "") {
  const co = getCompany();
  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  ${BASE_CSS}
  body { width:80mm; padding:4mm 3mm; font-size:11px; }
  td, th { border:none; padding:2px; }
  .dash { border-top:1px dashed #000; margin:6px 0; }
  .perfo { text-align:center; letter-spacing:3px; color:#000; margin:8px 0; font-size:10px; }
  .hd { text-align:center; }
  .hd h1 { font-size:14px; font-weight:800; }
  .hd .sub { font-size:10px; }
  .row { display:flex; justify-content:space-between; padding:1.5px 0; }
  .big { font-size:22px; font-weight:900; text-align:center; }
  @media print { body { width:auto; } }
</style></head><body>
  <div class="hd">
    <h1>${esc(co.name)}</h1>
    <div class="sub">الرقم الضريبي: <span class="tnum">${esc(co.vat)}</span></div>
  </div>
  <div class="dash"></div>
  ${bodyHTML}
  <script>${extraScript};window.addEventListener("load",function(){setTimeout(function(){window.print()},300)});</script>
</body></html>`;
}

function openAndWrite(html: string, w = 860, h = 700) {
  const win = window.open("", "_blank", `width=${w},height=${h}`);
  if (!win) { alert("المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع"); return; }
  win.document.write(html);
  win.document.close();
}

/** طباعة تقرير A4 بترويسة المنشأة — مرّر جسم HTML جاهز (جداول/بطاقات) */
export function printReport(title: string, subtitle: string, bodyHTML: string) {
  openAndWrite(reportShell(title, subtitle, bodyHTML));
}

/** طباعة إيصال حراري 80مم (تذاكر، سندات...) */
export function printReceipt(title: string, bodyHTML: string, extraScript = "") {
  openAndWrite(receiptShell(title, bodyHTML, extraScript), 420, 680);
}

/** أدوات بناء جداول سريعة للتقارير */
export function tableHTML(headers: string[], rows: (string | number)[][], opts?: { numericCols?: number[] }) {
  const num = new Set(opts?.numericCols ?? []);
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const trs = rows.map((r) =>
    `<tr>${r.map((c, i) => `<td class="${num.has(i) ? "c tnum" : "r"}">${esc(c)}</td>`).join("")}</tr>`
  ).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

export function kpisHTML(items: { label: string; value: string }[]) {
  return `<div class="kpis">${items.map((k) =>
    `<div class="kpi"><div class="v tnum">${esc(k.value)}</div><div class="t">${esc(k.label)}</div></div>`
  ).join("")}</div>`;
}
