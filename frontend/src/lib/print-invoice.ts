// lib/print-invoice.ts — طباعة الفاتورة بصيغتين منفصلتين بالتصميم:
//   • حراري 80مم (الكاشير) — مضغوط، QR كبير، خط قص
//   • A4 (فاتورة ضريبية رسمية) — ترويسة كاملة، جدول رسمي، بيانات العميل، QR أسفل
// الاتنين بيطبعوا تقرير التشييك الكامل مجمّعاً بمحطات خط الخدمة
import { InvoiceDetail, money } from "@/modules/invoices/types";
import { buildInvoiceView, type InvoiceView, type Pair } from "./invoice-view";
import { getCompany } from "./company";
import { getPrinting, type PrintingInfo } from "./printing";
import { STAGES, CK_LABEL, stageOf, type CkStatus } from "./service-line";

export type PrintFormat = "thermal" | "a4";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// صيغة الوقت 12/24 ساعة — إعداد النظام «sys.timeFormat» (إعداد 12)
const fmtDT = (s: string, timeFormat: "24" | "12" = "24") => {
  if (!s) return "—";

  const date = new Date(s);
  if (Number.isNaN(date.getTime())) return "—";
  const is24 = timeFormat !== "12";

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: is24 ? "h23" : "h12",
  }).formatToParts(date);

  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const base = `${get("day")}/${get("month")}/${get("year")} ${get("hour")}:${get("minute")}`;
  if (is24) return base;
  const dp = get("dayPeriod").toLowerCase();
  return `${base} ${dp.includes("p") ? "م" : "ص"}`;
};

// تذييل الفاتورة — نص مختلف للمرتجعات (إعداد 6)، مصدره DB بدل localStorage (إعداد 1)
const footerFor = (inv: InvoiceDetail, PR: PrintingInfo) =>
  inv.is_returned ? PR.footerReturn : PR.footer;

// زر طباعة يدوي يظهر فقط في وضع «معاينة قبل الطباعة» (إعداد 7) — مخفي عن الورق نفسه
const previewButton = (show: boolean) => !show ? "" : `
  <button onclick="window.print()" class="no-print"
    style="position:fixed;top:8px;inset-inline-start:8px;z-index:9;background:#1E3A8A;color:#fff;
           border:none;border-radius:8px;padding:8px 14px;font-weight:700;font-family:inherit;
           font-size:13px;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.25)">طباعة</button>
  <style>@media print { .no-print { display:none !important; } }</style>`;

// ── تقرير التشييك مجمّعاً بالمحطات (مشترك بين الصيغتين) ──
function checklistHTML(inv: InvoiceDetail, compact: boolean): string {
  const items = (inv.car?.checklist || []).filter((i) => i.status !== "pending");
  if (!items.length) return "";
  const stageBlocks = STAGES.map((st) => {
    const rows = items.filter((i) => stageOf(i.key) === st.id);
    if (!rows.length) return "";
    const body = rows.map((i) => {
      const mark = i.status === "needs" ? "" : "";
      return compact
        ? `<div class="row"><span>${mark} ${esc(i.label)}</span><b>${esc(CK_LABEL[i.status as CkStatus] ?? i.status)}</b></div>` +
          (i.note ? `<div style="font-size:9px;color:#333;margin-right:10px">${esc(i.note)}</div>` : "")
        : `<tr><td class="r">${mark} ${esc(i.label)}</td><td class="c">${esc(CK_LABEL[i.status as CkStatus] ?? i.status)}</td><td class="r">${esc(i.note || "—")}</td></tr>`;
    }).join("");
    return compact
      ? `<div style="font-weight:800;font-size:10.5px;margin-top:4px">${esc(st.title)}</div>${body}`
      : `<tr><td colspan="3" style="background:#F1F5F9;font-weight:800">${esc(st.title)}</td></tr>${body}`;
  }).join("");
  return compact
    ? `<div class="dash"></div><div style="font-weight:800;text-align:center">تقرير التشييك</div>${stageBlocks}`
    : `<h2 class="sec">تقرير التشييك — خط الخدمة</h2>
       <table><thead><tr><th class="r">البند</th><th class="c" style="width:110px">الحالة</th><th class="r" style="width:170px">ملاحظة</th></tr></thead>
       <tbody>${stageBlocks}</tbody></table>`;
}

// qrs: مصفوفة QR واحدة لكل نسخة مطبوعة (إعداد 5 — عدد النسخ، كل نسخة بعنصرها الخاص)
// autoPrint: false في وضع «معاينة قبل الطباعة» (إعداد 7) — الطباعة تنتظر ضغطة الزر بدل التلقائية
const PRINT_SCRIPT = (qrs: { id: string; tlv: string }[], autoPrint: boolean) => `
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    (function () {
      var qrs = ${JSON.stringify(qrs)};
      var autoPrint = ${autoPrint ? "true" : "false"};
      function waitImages() {
        // ── انتظار تحميل كل الصور فعلياً (الشعار) قبل الطباعة — بدل تأخير عشوائي
        //    ثابت قد يفتح الطباعة والصورة لسه ما وصلتش = طباعة ناقصة أو مشوشة ──
        var imgs = Array.prototype.slice.call(document.images);
        var pending = imgs.filter(function (im) { return !im.complete; });
        if (!pending.length) return Promise.resolve();
        return new Promise(function (resolve) {
          var left = pending.length;
          function done() { if (--left <= 0) resolve(); }
          pending.forEach(function (im) {
            im.addEventListener("load", done);
            im.addEventListener("error", done);
          });
          setTimeout(resolve, 2000); // شبكة بطيئة جداً — لا ننتظر للأبد
        });
      }
      function go() {
        qrs.forEach(function (q) {
          try {
            if (q.tlv && window.QRCode) {
              new QRCode(document.getElementById(q.id), {
                text: q.tlv, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M,
              });
            }
          } catch (e) {}
        });
        // ── انتظار خط Cairo فعلياً (بلا مهلة عشوائية) — وإلا الطباعة تنفذ
        //    بالخط الاحتياطي الرفيع قبل ما الخط السميك يوصل من الشبكة ──
        var fontReady = (document.fonts && document.fonts.ready)
          ? document.fonts.ready : Promise.resolve();
        Promise.all([waitImages(), fontReady]).then(function () {
          if (autoPrint) setTimeout(function () { window.print(); }, 150);
        });
      }
      if (document.readyState === "complete") go();
      else window.addEventListener("load", go);
    })();
  </script>`;

// ══════════════════ مكوّنات مشتركة ══════════════════

const CUR = "ر.س";
const pairsGrid = (pairs: Pair[], cols: number) => pairs.length ? `<div class="grid c${cols}">${pairs.map((p) =>
  `<div class="cell"><span class="k">${esc(p.k)}</span><b class="v${p.ltr ? " tnum" : ""}">${esc(p.v)}</b></div>`).join("")}</div>` : "";
const pairsRows = (pairs: Pair[]) => pairs.map((p) =>
  `<div class="row"><span>${esc(p.k)}</span><b class="${p.ltr ? "tnum" : ""}">${esc(p.v)}</b></div>`).join("");

// ══════════════════ الصيغة الحرارية 80مم ══════════════════

// محتوى نسخة واحدة من الإيصال — تتكرر «copies» مرة في نفس مستند الطباعة (إعداد 5)
function thermalCopyHTML(inv: InvoiceDetail, V: InvoiceView, CO: ReturnType<typeof getCompany>, PR: PrintingInfo, idx: number): string {
  const items = V.items.map((it) => `
    <div class="item">
      <div class="nm">${esc(it.label)}${it.sku ? `<span class="sku tnum">${esc(it.sku)}</span>` : ""}</div>
      <div class="ln"><span class="tnum">${it.qty} × ${money(it.unit)}</span><b class="tnum">${money(it.inc)}</b></div>
      ${it.discount > 0 ? `<div class="ln dim"><span>خصم</span><span class="tnum">- ${money(it.discount)}</span></div>` : ""}
    </div>`).join("");
  const pay = V.payments.map((p) => `<div class="row"><span>${esc(p.label)}</span><b class="tnum">${money(p.amount)}</b></div>`).join("");
  const qrId = `qrcode-${idx}`;
  return `
  <div class="head">
    ${PR.thermalShowLogo ? `<img src="${location.origin}${CO.logoUrl || "/logo-thermal.png"}" alt="" />` : ""}
    <h1>${esc(CO.name)}</h1>
    <div class="sub">الرقم الضريبي: <span class="tnum">${esc(CO.vat)}</span></div>
    ${CO.cr ? `<div class="sub">س.ت: <span class="tnum">${esc(CO.cr)}</span></div>` : ""}
    ${CO.phone ? `<div class="sub">هاتف: <span class="tnum">${esc(CO.phone)}</span></div>` : ""}
  </div>
  <div class="title">${esc(V.title.ar)}<small>${esc(V.title.en)}</small></div>
  <div class="status ${V.status.key}">${esc(V.status.ar)}</div>
  <div class="row big"><span>رقم الفاتورة</span><b class="tnum">${esc(inv.invoice_no)}</b></div>
  <div class="row"><span>التاريخ</span><b class="tnum">${fmtDT(inv.issued_at, PR.timeFormat)}</b></div>
  ${pairsRows([{ k: "الفرع", v: inv.branch_name || "" }, { k: "الكاشير", v: inv.cashier_name || "" }].filter((x) => x.v))}
  <div class="dash"></div>
  ${pairsRows(V.customer)}
  ${V.vehicle.length ? `<div class="dash"></div><div class="sec">بيانات المركبة</div>${pairsRows(V.vehicle.filter((p) => !["فني التعبئة", "الفك والتركيب", "التشييك", "العداد السابق", "المسافة منذ آخر خدمة"].includes(p.k)))}` : ""}
  <div class="dash"></div>
  <div class="items">${items}</div>
  <div class="tot">
    <div class="row"><span>الإجمالي قبل الضريبة</span><b class="tnum">${money(inv.total_ex)}</b></div>
    ${(inv.discount_total || 0) > 0 ? `<div class="row"><span>إجمالي الخصم</span><b class="tnum">${money(inv.discount_total ?? 0)}</b></div>` : ""}
    <div class="row"><span>ضريبة القيمة المضافة 15%</span><b class="tnum">${money(inv.total_vat)}</b></div>
    <div class="row grand"><span>الإجمالي</span><span class="tnum">${money(inv.total_inc)} ${CUR}</span></div>
  </div>
  <div class="box">
    ${pay}
    <div class="row"><span>المدفوع</span><b class="tnum">${money(inv.paid_total)}</b></div>
    <div class="row"><span>المتبقي (آجل)</span><b class="tnum">${money(inv.credit_total)}</b></div>
  </div>
  ${checklistHTML(inv, true)}
  ${PR.thermalShowQr ? `<div class="qr"><div id="${qrId}"></div></div>` : ""}
  <div class="foot">${esc(footerFor(inv, PR))}<br>${esc(CO.address)}</div>`;
}

function thermalHTML(inv: InvoiceDetail, embedded = false): string {
  const CO = getCompany();
  const PR = getPrinting();
  const V = buildInvoiceView(inv);
  const large = PR.thermalFontSize === "large";
  const copies = embedded ? 1 : Math.min(5, Math.max(1, PR.copies || 1));

  const body = Array.from({ length: copies }, (_, i) => thermalCopyHTML(inv, V, CO, PR, i))
    .join('<div class="dash" style="margin:10px 0"></div>');
  const qrScripts = PR.thermalShowQr
    ? Array.from({ length: copies }, (_, i) => ({ id: `qrcode-${i}`, tlv: inv.qr_tlv || "" }))
    : [];

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(CO.name)} — فاتورة ${esc(inv.invoice_no)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  /* حجم الصفحة = 80مم صراحة — بدونه المتصفح يعمل تحجيم كسري يسبب تبكسل الطباعة الحرارية */
  @page { size:80mm auto; margin:0; }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { background:#fff; -webkit-text-size-adjust:100%; text-size-adjust:100%; }
  body { font-family:"Cairo","Tahoma",sans-serif; width:80mm; padding:4mm 3mm; color:#000; font-size:${large ? 15 : 13}px; font-weight:600; text-rendering:optimizeLegibility; }
  .tnum { font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:embed; }
  .head { text-align:center; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:6px; }
  .head img { width:52px; height:52px; object-fit:contain; display:block; margin:0 auto 5px; }
  .head h1 { font-size:${large ? 17 : 15}px; font-weight:700; }
  .head .sub { font-size:${large ? 12 : 10.5}px; font-weight:600; margin-top:2px; }
  .title { text-align:center; font-size:${large ? 15 : 13}px; font-weight:700; border:1.5px solid #000; border-radius:4px; padding:3px; margin:6px 0 4px; line-height:1.3; }
  .title small { display:block; font-size:9.5px; font-weight:500; }
  .status { text-align:center; font-weight:800; font-size:${large ? 14 : 12}px; border:1.5px solid #000; border-radius:4px; padding:2px; margin-bottom:6px; letter-spacing:.3px; }
  .status.returned, .status.credit, .status.partial { background:#000; color:#fff; }
  .sec { font-weight:800; font-size:${large ? 12.5 : 11}px; margin:2px 0 1px; }
  .row { display:flex; justify-content:space-between; gap:8px; padding:2px 0; font-weight:500; }
  .row b { text-align:left; }
  .row.big { font-size:${large ? 15 : 13.5}px; }
  .box { border:1.5px dashed #000; border-radius:4px; padding:5px 6px; margin:6px 0; }
  .items .item { padding:4px 0; border-bottom:1px dotted #555; }
  .items .nm { font-weight:700; line-height:1.35; }
  .items .sku { display:block; font-size:8.5px; font-weight:500; color:#222; }
  .items .ln { display:flex; justify-content:space-between; font-weight:500; }
  .items .ln.dim { font-size:11px; color:#222; }
  .tot { border-top:2px solid #000; margin-top:4px; padding-top:4px; }
  .tot .grand { font-size:${large ? 16 : 14.5}px; font-weight:800; border-top:1.5px solid #000; margin-top:3px; padding-top:3px; }
  .dash { border-top:1.5px dashed #000; margin:6px 0; }
  .qr { text-align:center; margin:8px 0 4px; } .qr img, .qr canvas { margin:0 auto; image-rendering:pixelated; }
  .foot { text-align:center; font-size:${large ? 11.5 : 10}px; font-weight:500; border-top:1.5px dashed #000; margin-top:6px; padding-top:5px; }
  @media print { body { width:auto; } }
</style></head><body>
  ${embedded ? "" : previewButton(PR.previewBeforePrint)}
  ${body}
  ${PRINT_SCRIPT(qrScripts, !embedded && !PR.previewBeforePrint)}
</body></html>`;
}

// ══════════════════ صيغة A4 الرسمية ══════════════════

function a4CopyHTML(inv: InvoiceDetail, V: InvoiceView, CO: ReturnType<typeof getCompany>, PR: PrintingInfo, idx: number, isLast: boolean): string {
  const showDisc = V.hasDiscount;
  const itemsRows = V.items.map((it, i) => `
    <tr><td class="c tnum dim">${i + 1}</td>
        <td class="r"><b>${esc(it.label)}</b>${it.sku ? `<span class="sku tnum">${esc(it.sku)}</span>` : ""}</td>
        <td class="c tnum">${it.qty}</td>
        <td class="n tnum">${money(it.unit)}</td>
        ${showDisc ? `<td class="n tnum">${it.discount > 0 ? money(it.discount) : "—"}</td>` : ""}
        <td class="n tnum">${money(it.ex)}</td>
        <td class="n tnum">${money(it.vat)}</td>
        <td class="n tnum b">${money(it.inc)}</td></tr>`).join("");
  const payList = V.payments.map((p) => `<div class="row"><span>${esc(p.label)}</span><b class="tnum">${money(p.amount)}</b></div>`).join("");
  const qrId = `qrcode-${idx}`;
  const issued = fmtDT(inv.issued_at, PR.timeFormat);
  return `
<section class="inv"${isLast ? "" : ' style="page-break-after:always"'}>
  <header class="head">
    <div class="brand">
      <div class="logo-box"><img src="${location.origin}${CO.logoUrl || "/logo-navy.png"}" alt="" /></div>
      <div class="brand-text">
        <h1>${esc(CO.name)}</h1>
        <div class="sub">الرقم الضريبي <span class="tnum">${esc(CO.vat)}</span>${CO.cr ? ` · السجل التجاري <span class="tnum">${esc(CO.cr)}</span>` : ""}</div>
        <div class="sub muted">${esc(CO.address)}${CO.phone ? ` · هاتف <span class="tnum">${esc(CO.phone)}</span>` : ""}</div>
      </div>
    </div>
    <div class="doc">
      <div class="doc-title">${esc(V.title.ar)}<small>${esc(V.title.en)}</small></div>
      <div class="status ${V.status.key}">${esc(V.status.ar)} <small>${esc(V.status.en)}</small></div>
    </div>
  </header>

  <div class="two">
    <div class="card">
      <h2>بيانات العميل <small>Customer</small></h2>
      ${pairsRows(V.customer)}
    </div>
    <div class="card">
      <h2>بيانات الفاتورة <small>Invoice</small></h2>
      <div class="row"><span>رقم الفاتورة</span><b class="tnum">${esc(inv.invoice_no)}</b></div>
      <div class="row"><span>تاريخ الإصدار</span><b class="tnum">${issued}</b></div>
      ${pairsRows([{ k: "الفرع", v: inv.branch_name || "" }, { k: "الكاشير", v: inv.cashier_name || "" }].filter((x) => x.v))}
    </div>
  </div>

  ${V.vehicle.length ? `<div class="card"><h2>بيانات المركبة <small>Vehicle</small></h2>${pairsGrid(V.vehicle, 4)}</div>` : ""}

  <table class="items">
    <thead><tr>
      <th style="width:26px">#</th><th class="r">الصنف <small>Product</small></th><th style="width:48px">الكمية</th>
      <th style="width:78px">سعر الوحدة</th>${showDisc ? '<th style="width:70px">الخصم</th>' : ""}
      <th style="width:84px">قبل الضريبة</th><th style="width:66px">الضريبة</th><th style="width:88px">الإجمالي</th>
    </tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <div class="summary">
    <div class="card pay">
      <h2>حالة الدفع <small>Payment</small></h2>
      ${payList}
      <div class="row top"><span>الإجمالي</span><b class="tnum">${money(inv.total_inc)}</b></div>
      <div class="row"><span>المدفوع</span><b class="tnum">${money(inv.paid_total)}</b></div>
      <div class="row ${inv.credit_total > 0 ? "warn" : ""}"><span>المتبقي</span><b class="tnum">${money(inv.credit_total)}</b></div>
      ${V.extra.length ? `<h2 class="gap">معلومات إضافية <small>Additional</small></h2>${pairsRows(V.extra)}` : ""}
    </div>
    <div class="totals">
      <h2>ملخص الضريبة <small>Tax summary</small></h2>
      <div class="row"><span>الإجمالي قبل الضريبة</span><b class="tnum">${money(inv.total_ex)}</b></div>
      ${(inv.discount_total || 0) > 0 ? `<div class="row"><span>إجمالي الخصم</span><b class="tnum">${money(inv.discount_total ?? 0)}</b></div>` : ""}
      <div class="row"><span>ضريبة القيمة المضافة (15%)</span><b class="tnum">${money(inv.total_vat)}</b></div>
      <div class="grand"><span>الإجمالي شامل الضريبة <small>Total</small></span><b class="tnum">${money(inv.total_inc)} <i>${CUR}</i></b></div>
    </div>
  </div>

  ${checklistHTML(inv, false)}

  <div class="qr-foot">
    <div class="qrbox"><div id="${qrId}"></div></div>
    <div class="zatca">
      <h2>بيانات الفاتورة الإلكترونية <small>ZATCA</small></h2>
      <div class="row"><span>اسم المورد</span><b>${esc(CO.name)}</b></div>
      <div class="row"><span>الرقم الضريبي</span><b class="tnum">${esc(CO.vat)}</b></div>
      <div class="row"><span>وقت الإصدار</span><b class="tnum">${issued}</b></div>
      <div class="row"><span>الإجمالي / الضريبة</span><b class="tnum">${money(inv.total_inc)} / ${money(inv.total_vat)}</b></div>
    </div>
    <div class="sign"><div class="line"></div><span>التوقيع · Signature</span><div class="line"></div><span>ختم المنشأة · Stamp</span></div>
  </div>

  <footer class="foot"><b>${esc(footerFor(inv, PR))}</b> — ${esc(CO.name)}${CO.phone ? ` · <span class="tnum">${esc(CO.phone)}</span>` : ""}${CO.vat ? ` · الرقم الضريبي <span class="tnum">${esc(CO.vat)}</span>` : ""}</footer>
</section>`;
}

function a4HTML(inv: InvoiceDetail, embedded = false): string {
  const CO = getCompany();
  const PR = getPrinting();
  const V = buildInvoiceView(inv);
  const copies = embedded ? 1 : Math.min(5, Math.max(1, PR.copies || 1));
  const body = Array.from({ length: copies }, (_, i) => a4CopyHTML(inv, V, CO, PR, i, i === copies - 1)).join("");
  // QR فاتورة A4 الضريبي إلزامي دائماً — إعداد thermalShowQr خاص بالحرارية فقط
  const qrScripts = Array.from({ length: copies }, (_, i) => ({ id: `qrcode-${i}`, tlv: inv.qr_tlv || "" }));

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(CO.name)} — فاتورة ${esc(inv.invoice_no)}</title>
<style>
  :root { --brand:#1E3A8A; --ink:#14212b; --muted:#5b6b75; --line:#E2E8F0; --soft:#F1F5F9; --ok:#12794a; --warn:#a85a00; --bad:#b3261e; }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  @page { size:A4; margin:10mm; }
  body { font-family:"IBM Plex Sans Arabic","Cairo","Segoe UI",Tahoma,sans-serif; color:var(--ink); font-size:11.5px; line-height:1.45; ${embedded ? "padding:10mm; background:#fff;" : ""} }
  .tnum { font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:embed; }
  small { font-size:8.5px; font-weight:500; color:var(--muted); margin-inline-start:4px; }
  .c { text-align:center; } .r { text-align:right; } .n { text-align:left; } .b { font-weight:800; } .dim { color:var(--muted); }
  .head { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; padding-bottom:10px; border-bottom:2.5px solid var(--brand); }
  .brand { display:flex; gap:12px; align-items:center; min-width:0; }
  .logo-box { flex:0 0 56px; width:56px; height:56px; border:1px solid var(--line); border-radius:10px; background:var(--soft); display:grid; place-items:center; overflow:hidden; }
  .logo-box img { width:100%; height:100%; object-fit:contain; padding:6px; }
  .brand-text h1 { font-size:18px; font-weight:800; color:var(--brand); line-height:1.25; }
  .sub { font-size:10.5px; font-weight:600; margin-top:2px; } .sub.muted { color:var(--muted); font-weight:500; }
  .doc { text-align:left; flex:0 0 auto; }
  .doc-title { font-size:15px; font-weight:800; color:var(--brand); } .doc-title small { display:block; margin:0; }
  .status { display:inline-block; margin-top:6px; padding:3px 12px; border-radius:6px; font-weight:800; font-size:12px; border:1.5px solid currentColor; }
  .status small { color:inherit; opacity:.75; }
  .status.paid { color:var(--ok); } .status.partial, .status.credit { color:var(--warn); } .status.returned { color:var(--bad); }
  h2 { font-size:11.5px; font-weight:800; color:var(--brand); margin-bottom:4px; padding-bottom:3px; border-bottom:1px solid var(--line); }
  h2.gap { margin-top:10px; }
  .two { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin:10px 0; }
  .card { border:1px solid var(--line); border-radius:8px; padding:8px 10px; margin-bottom:10px; } .two .card { margin:0; }
  .row { display:flex; justify-content:space-between; gap:10px; padding:2.5px 0; border-bottom:1px dotted var(--line); } .row:last-child { border-bottom:none; }
  .row > span { color:var(--muted); } .row b { text-align:left; font-weight:700; }
  .row.top { margin-top:4px; border-top:1px solid var(--line); } .row.warn b { color:var(--warn); }
  .grid { display:grid; gap:6px 14px; } .grid.c4 { grid-template-columns:repeat(4,1fr); }
  .cell { display:flex; flex-direction:column; min-width:0; } .cell .k { font-size:9.5px; color:var(--muted); } .cell .v { font-weight:700; overflow-wrap:anywhere; }
  table.items { width:100%; border-collapse:collapse; margin:4px 0 10px; }
  .items th { background:var(--brand); color:#fff; padding:5px 4px; font-size:10px; text-align:center; font-weight:700; } .items th small { color:#dff; }
  .items td { padding:5px 6px; border-bottom:1px solid var(--line); font-size:11px; vertical-align:top; }
  .items tbody tr:nth-child(even) td { background:#F8FAFC; }
  .items .sku { display:block; font-size:8.5px; color:var(--muted); font-weight:500; }
  tr { page-break-inside:avoid; }
  .summary { display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:start; }
  .summary .card { margin:0; }
  .totals { border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  .grand { display:flex; justify-content:space-between; align-items:center; margin-top:8px; padding:9px 12px; background:var(--brand); color:#fff; border-radius:8px; font-weight:800; font-size:13px; }
  .grand small { color:#cfe; } .grand b { font-size:19px; } .grand i { font-style:normal; font-size:11px; font-weight:600; }
  h2.sec { font-size:12px; margin:12px 0 4px; border-right:4px solid var(--brand); padding-right:8px; border-bottom:none; }
  table:not(.items) { width:100%; border-collapse:collapse; margin:6px 0; } table:not(.items) th { background:var(--soft); border:1px solid var(--line); padding:4px; font-size:10px; } table:not(.items) td { border:1px solid var(--line); padding:3px 6px; font-size:10.5px; }
  .qr-foot { display:grid; grid-template-columns:auto 1fr 190px; gap:14px; align-items:center; margin-top:12px; padding-top:10px; border-top:1px solid var(--line); page-break-inside:avoid; }
  .qrbox { width:128px; height:128px; display:grid; place-items:center; } .qrbox img, .qrbox canvas { width:128px !important; height:128px !important; }
  .zatca .row { font-size:10.5px; }
  .sign { display:flex; flex-direction:column; gap:3px; font-size:9.5px; color:var(--muted); text-align:center; } .sign .line { border-bottom:1px solid #889; height:22px; }
  .foot { text-align:center; font-size:10px; color:var(--muted); border-top:1px solid var(--line); margin-top:10px; padding-top:6px; }
</style></head>

<body>
  ${embedded ? "" : previewButton(PR.previewBeforePrint)}
  ${body}
  ${PRINT_SCRIPT(qrScripts, !embedded && !PR.previewBeforePrint)}
</body>

</html>`;
}

// ══════════════════ الواجهة العامة ══════════════════

/** HTML الفاتورة جاهزاً — يُستخدم للطباعة وللمعاينة داخل النظام (embedded: بلا طباعة تلقائية ولا نسخ متعددة) */
export function invoiceHTML(inv: InvoiceDetail, format: PrintFormat = "thermal", embedded = false): string {
  return format === "a4" ? a4HTML(inv, embedded) : thermalHTML(inv, embedded);
}

export function printInvoice(inv: InvoiceDetail, format: PrintFormat = "thermal") {
  const html = invoiceHTML(inv, format);
  const w = window.open("", "_blank", format === "a4" ? "width=880,height=760" : "width=420,height=680");
  if (!w) { alert("المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع"); return; }
  w.document.write(html);
  w.document.close();
}
