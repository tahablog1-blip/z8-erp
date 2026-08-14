// lib/print-invoice.ts — طباعة الفاتورة بصيغتين منفصلتين بالتصميم:
//   • حراري 80مم (الكاشير) — مضغوط، QR كبير، خط قص
//   • A4 (فاتورة ضريبية رسمية) — ترويسة كاملة، جدول رسمي، بيانات العميل، QR أسفل
// الاتنين بيطبعوا تقرير التشييك الكامل مجمّعاً بمحطات خط الخدمة
import { InvoiceDetail, PAYMENT_LABELS, money } from "@/modules/invoices/types";
import { getCompany } from "./company";
import { STAGES, CK_LABEL, stageOf, type CkStatus } from "./service-line";

export type PrintFormat = "thermal" | "a4";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const fmtDT = (s: string) =>
  new Date(s).toLocaleString("ar-SA-u-nu-latn", {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });

const footerText = () => {
  try { return localStorage.getItem("z8_print_footer") || "شكراً لتعاملكم معنا"; }
  catch { return "شكراً لتعاملكم معنا"; }
};

// ── تقرير التشييك مجمّعاً بالمحطات (مشترك بين الصيغتين) ──
function checklistHTML(inv: InvoiceDetail, compact: boolean): string {
  const items = (inv.car?.checklist || []).filter((i) => i.status !== "pending");
  if (!items.length) return "";
  const stageBlocks = STAGES.map((st) => {
    const rows = items.filter((i) => stageOf(i.key) === st.id);
    if (!rows.length) return "";
    const body = rows.map((i) => {
      const mark = i.status === "needs" ? "⚠" : "✓";
      return compact
        ? `<div class="row"><span>${mark} ${esc(i.label)}</span><b>${esc(CK_LABEL[i.status as CkStatus] ?? i.status)}</b></div>` +
          (i.note ? `<div style="font-size:9px;color:#333;margin-right:10px">${esc(i.note)}</div>` : "")
        : `<tr><td class="r">${mark} ${esc(i.label)}</td><td class="c">${esc(CK_LABEL[i.status as CkStatus] ?? i.status)}</td><td class="r">${esc(i.note || "—")}</td></tr>`;
    }).join("");
    return compact
      ? `<div style="font-weight:800;font-size:10.5px;margin-top:4px">${esc(st.title)}</div>${body}`
      : `<tr><td colspan="3" style="background:#eef3f4;font-weight:800">${esc(st.title)}</td></tr>${body}`;
  }).join("");
  return compact
    ? `<div class="dash"></div><div style="font-weight:800;text-align:center">تقرير التشييك</div>${stageBlocks}`
    : `<h2 class="sec">تقرير التشييك — خط الخدمة</h2>
       <table><thead><tr><th class="r">البند</th><th class="c" style="width:110px">الحالة</th><th class="r" style="width:170px">ملاحظة</th></tr></thead>
       <tbody>${stageBlocks}</tbody></table>`;
}

/** الممشى التقريبي عند التغيير القادم — تقدير تقريبي فقط:
 *  فترة 5000 كم للزيوت المعدنية/نصف التخليقية، 10000 كم لو الصنف مكتوب عليه "سانتتيك/توليف/Synthetic" */
function nextServiceEstimate(inv: InvoiceDetail): number | null {
  const cur = inv.car?.odometer_current;
  if (!cur) return null;
  const hasOilItem = inv.items.some((it) => /زيت|oil/i.test(it.label));
  if (!hasOilItem) return null;
  const synthetic = inv.items.some((it) => /سانتتيك|توليف|synthetic|full\s*syn/i.test(it.label));
  return cur + (synthetic ? 10000 : 5000);
}

function carHTML(inv: InvoiceDetail, compact: boolean): string {
  const c = inv.car;
  if (!c) return "";
  const delta = c.odometer_current && c.odometer_previous
    ? c.odometer_current - c.odometer_previous : null;
  const nextDue = nextServiceEstimate(inv);
  const pairs: [string, string][] = [
    ["اللوحة", c.plate || "—"],
    ["السيارة", [c.brand, c.model, c.model_year].filter(Boolean).join(" ") || "—"],
  ];
  if (c.color) pairs.push(["اللون", c.color]);
  if (c.chassis_number) pairs.push(["رقم الهيكل (VIN)", c.chassis_number]);
  if (c.odometer_current) pairs.push(["العداد الحالي", `${c.odometer_current} كم`]);
  if (c.odometer_previous) pairs.push(["العداد السابق", `${c.odometer_previous} كم`]);
  if (delta !== null && delta > 0) pairs.push(["المسافة منذ آخر خدمة", `${delta} كم`]);
  if (nextDue) pairs.push(["الممشى التقريبي للتغيير القادم", `${nextDue} كم (تقريبي)`]);
  // ── فريق العمل المحفوظ لحظة اعتماد أمر العمل ──
  const t = c as typeof c & {
    filler_name?: string | null; fitter1_name?: string | null;
    fitter2_name?: string | null; checker_name?: string | null;
  };
  const fitters = [t.fitter1_name, t.fitter2_name].filter(Boolean).join(" و");
  if (t.filler_name) pairs.push(["فني التعبئة", t.filler_name]);
  if (fitters) pairs.push(["الفك والتركيب", fitters]);
  if (t.checker_name) pairs.push(["التشييك", t.checker_name]);
  if (compact) {
    return `<div class="box">${pairs.map(([k, v]) =>
      `<div class="row"><span>${esc(k)}</span><b class="tnum">${esc(v)}</b></div>`).join("")}</div>`;
  }
  return `<h2 class="sec">بيانات المركبة</h2>
    <table><tbody>${pairs.map(([k, v]) =>
      `<tr><td class="r" style="width:200px;background:#f6f8f8;font-weight:700">${esc(k)}</td><td class="r tnum">${esc(v)}</td></tr>`).join("")}
    </tbody></table>`;
}

const QR_SCRIPT = (tlv: string) => `
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script>
    (function () {
      var tlv = ${JSON.stringify(tlv || "")};
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
        try {
          if (tlv && window.QRCode) {
            new QRCode(document.getElementById("qrcode"), {
              text: tlv, width: 150, height: 150, correctLevel: QRCode.CorrectLevel.M,
            });
          }
        } catch (e) {}
        // ── انتظار خط Cairo فعلياً (بلا مهلة عشوائية) — وإلا الطباعة تنفذ
        //    بالخط الاحتياطي الرفيع قبل ما الخط السميك يوصل من الشبكة ──
        var fontReady = (document.fonts && document.fonts.ready)
          ? document.fonts.ready : Promise.resolve();
        Promise.all([waitImages(), fontReady]).then(function () {
          setTimeout(function () { window.print(); }, 150);
        });
      }
      if (document.readyState === "complete") go();
      else window.addEventListener("load", go);
    })();
  </script>`;

// ══════════════════ الصيغة الحرارية 80مم ══════════════════

function thermalHTML(inv: InvoiceDetail): string {
  const CO = getCompany();
  const title = inv.is_returned ? "فاتورة مرتجعة"
    : inv.invoice_type === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة";

  const itemsRows = inv.items.map((it) => `
    <tr><td class="r">${esc(it.label)}${it.barcode ? `<br><span style="font-size:8.5px;font-weight:500;color:#222">${esc(it.barcode)}</span>` : ""}</td>
        <td class="c tnum">${it.qty}</td>
        <td class="c tnum">${money(it.unit_price_vat)}</td>
        <td class="c tnum b">${money(it.line_inc)}</td></tr>`).join("");

  const payRows = inv.payments.map((p) =>
    `<div class="row"><span>${PAYMENT_LABELS[p.method] ?? esc(p.method)}</span><b class="tnum">${money(p.amount)}</b></div>`
  ).join("");

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(inv.invoice_no)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@500;600;700&display=swap" rel="stylesheet">
<style>
  /* ── تثبيت حجم الصفحة صراحة = 80مم بالظبط — بدون هذا السطر المتصفح "يخمّن"
     حجم ورق الطابعة ويعمل تحجيم (Scale) تلقائي كسري للمحتوى ليطابقه،
     وأي تحجيم كسري أثناء الطباعة هو السبب الأول للتبكسل — مش الخط ولا الوزن ── */
  @page { size:80mm auto; margin:0; }
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { background:#fff; -webkit-text-size-adjust:100%; text-size-adjust:100%; }
  body {
    /* Cairo وزن حقيقي متوسط (600) — خط عربي بضربات واضحة أصلاً،
       بخلاف Tahoma/Arial اللي بتاخد "Bold صناعي" بيطلع باهت على الطباعة الحرارية */
    font-family:"Cairo","Tahoma",sans-serif;
    width:80mm; padding:4mm 3mm; color:#000; font-size:13px; font-weight:600;
    text-rendering:optimizeLegibility;
  }
  .tnum { font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:embed; }
  .c { text-align:center; } .r { text-align:right; } .b { font-weight:700; }
  .head { text-align:center; border-bottom:2px solid #000; padding-bottom:6px; margin-bottom:6px; }
  .head img { image-rendering:auto; }
  .head h1 { font-size:15px; font-weight:700; }
  .head .sub { font-size:10.5px; font-weight:600; margin-top:2px; }
  .title { text-align:center; font-size:13px; font-weight:700; border:1.5px solid #000; border-radius:4px; padding:4px; margin:6px 0; }
  .row { display:flex; justify-content:space-between; padding:2px 0; font-weight:500; }
  .box { border:1.5px dashed #000; border-radius:4px; padding:5px 6px; margin:6px 0; }
  table { width:100%; border-collapse:collapse; margin:6px 0; }
  th { border-top:1.5px solid #000; border-bottom:1.5px solid #000; padding:4px 2px; font-size:10.5px; font-weight:700; }
  td { padding:4px 2px; border-bottom:1px dotted #555; font-weight:500; }
  .tot { border-top:2px solid #000; margin-top:4px; padding-top:4px; }
  .tot .grand { font-size:13px; font-weight:700; border-top:1.5px solid #000; margin-top:3px; padding-top:3px; }
  .dash { border-top:1.5px dashed #000; margin:6px 0; }
  .qr { text-align:center; margin:8px 0 4px; } .qr img, .qr canvas { margin:0 auto; image-rendering:pixelated; }
  .foot { text-align:center; font-size:10px; font-weight:500; border-top:1.5px dashed #000; margin-top:6px; padding-top:5px; }
  @media print { body { width:auto; } }
</style></head><body>
  <div class="head">
    <img src="${location.origin}/logo-thermal.png" alt="" style="width:52px;height:52px;object-fit:contain;display:block;margin:0 auto 5px" />
    <h1>${esc(CO.name)}</h1>
    <div class="sub">الرقم الضريبي: <span class="tnum">${esc(CO.vat)}</span></div>
    <div class="sub">س.ت: <span class="tnum">${esc(CO.cr)}</span> — ${esc(inv.branch_name || "")}</div>
    ${CO.phone ? `<div class="sub">هاتف: <span class="tnum">${esc(CO.phone)}</span></div>` : ""}
  </div>
  <div class="title">${title}</div>
  <div class="dash"></div>
  <div class="row"><span>الرقم الضريبي</span><b class="tnum">${esc(CO.vat)}</b></div>
  <div class="row"><span>س.ت</span><b class="tnum">${esc(CO.cr)}</b></div>
  <div class="row"><span>رقم الفاتورة</span><b class="tnum">${esc(inv.invoice_no)}</b></div>
  <div class="row"><span>الفرع</span><b>${esc(inv.branch_name || "—")}</b></div>
  <div class="row"><span>نقطة البيع</span><b>${esc(inv.branch_name || "—")}${inv.source === "car" ? " (خدمة)" : " (مباشر)"}</b></div>
  <div class="row"><span>أنشئت بواسطة</span><b>${esc(inv.cashier_name || "—")}</b></div>
  <div class="dash"></div>
  <div class="row"><span>العميل</span><b>${esc(inv.customer_name || "بيع نقدي")}</b></div>
  ${inv.customer_phone ? `<div class="row"><span>الجوال</span><b class="tnum">${esc(inv.customer_phone)}</b></div>` : ""}
  ${inv.customer_vat ? `<div class="row"><span>الرقم الضريبي للعميل</span><b class="tnum">${esc(inv.customer_vat)}</b></div>` : ""}
  ${inv.car?.plate ? `
  <div class="dash"></div>
  <div class="row"><span>اللوحة</span><b class="tnum">${esc(inv.car.plate)}</b></div>
  ${inv.car.brand ? `<div class="row"><span>الماركة</span><b>${esc(inv.car.brand)}</b></div>` : ""}
  ${inv.car.model ? `<div class="row"><span>الموديل</span><b>${esc(inv.car.model)}</b></div>` : ""}
  ${inv.car.model_year ? `<div class="row"><span>موديل عام</span><b class="tnum">${esc(inv.car.model_year)}</b></div>` : ""}
  ${inv.car.color ? `<div class="row"><span>اللون</span><b>${esc(inv.car.color)}</b></div>` : ""}
  ${inv.car.chassis_number ? `<div class="row"><span>رقم الهيكل</span><b class="tnum">${esc(inv.car.chassis_number)}</b></div>` : ""}
  ${inv.car.odometer_current ? `<div class="row"><span>عداد الكيلومترات</span><b class="tnum">${inv.car.odometer_current}</b></div>` : ""}
  ${(() => { const nx = nextServiceEstimate(inv); return nx ? `<div class="row"><span>الممشى التقريبي القادم</span><b class="tnum">${nx} (تقريبي)</b></div>` : ""; })()}
  ` : ""}
  <div class="row"><span>التاريخ</span><b class="tnum">${fmtDT(inv.issued_at)}</b></div>
  <table>
    <thead><tr><th class="r">الصنف</th><th class="c">كمية</th><th class="c">سعر</th><th class="c">إجمالي</th></tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>
  <div class="tot">
    <div class="row"><span>الإجمالي قبل الضريبة</span><b class="tnum">${money(inv.total_ex)}</b></div>
    <div class="row"><span>ضريبة القيمة المضافة 15%</span><b class="tnum">${money(inv.total_vat)}</b></div>
    <div class="row grand"><span>الإجمالي شامل الضريبة</span><span class="tnum">${money(inv.total_inc)} ر.س</span></div>
  </div>
  <div class="box">${payRows}${inv.credit_total > 0 ? `<div class="row"><span>آجل في ذمة العميل</span><b class="tnum">${money(inv.credit_total)}</b></div>` : ""}</div>
  ${checklistHTML(inv, true)}
  <div class="qr"><div id="qrcode"></div></div>
  <div class="foot">${esc(footerText())}<br>${esc(getCompany().address)}</div>
  ${QR_SCRIPT(inv.qr_tlv || "")}
</body></html>`;
}

// ══════════════════ صيغة A4 الرسمية ══════════════════

function a4HTML(inv: InvoiceDetail): string {
  const CO = getCompany();
  const title = inv.is_returned ? "فاتورة مرتجعة"
    : inv.invoice_type === "standard" ? "فاتورة ضريبية" : "فاتورة ضريبية مبسطة";

  const itemsRows = inv.items.map((it) => {
    const gross = it.line_inc + it.discount_amount;
    const discPct = gross > 0 && it.discount_amount > 0 ? (it.discount_amount / gross) * 100 : 0;
    return `
    <tr><td class="r">${esc(it.label)}${it.barcode ? `<br><span style="font-size:8px;color:#555">${esc(it.barcode)}</span>` : ""}</td>
        <td class="c tnum">${it.qty}</td>
        <td class="c tnum">${money(it.unit_price)}</td>
        <td class="c tnum">${discPct > 0 ? discPct.toFixed(1) + "%" : "—"}</td>
        <td class="c tnum">${money(it.line_vat)}</td>
        <td class="c tnum">${money(it.line_ex)}</td>
        <td class="c tnum b">${money(it.line_inc)}</td></tr>`;
  }).join("");

  const payRows = inv.payments.map((p) =>
    `<span style="display:inline-block;border:1px solid #c9d4d6;border-radius:14px;padding:3px 10px;margin-left:6px;font-size:11px">
       ${PAYMENT_LABELS[p.method] ?? esc(p.method)}: <b class="tnum">${money(p.amount)}</b></span>`).join("");

  return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">
<title>${esc(inv.invoice_no)}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  @page { size:A4; margin:12mm; }
  body { font-family:"IBM Plex Sans Arabic","Segoe UI",Tahoma,sans-serif; color:#111; font-size:12px; }
  .tnum { font-variant-numeric:tabular-nums; direction:ltr; unicode-bidi:embed; }
  .c { text-align:center; } .r { text-align:right; } .b { font-weight:700; }
  .head { display:flex; justify-content:space-between; border-bottom:3px solid #0C5E66; padding-bottom:10px; }
  .head h1 { font-size:19px; color:#0C5E66; }
  .head .sub { font-size:10.5px; color:#445; margin-top:2px; }
  .badge { border:2px solid #0C5E66; color:#0C5E66; border-radius:8px; padding:6px 14px; font-size:14px; font-weight:800; align-self:center; }
  .meta { display:grid; grid-template-columns:1fr 1fr; gap:4px 24px; margin:10px 0; font-size:11.5px; }
  .meta .row { display:flex; justify-content:space-between; border-bottom:1px dotted #ccd; padding:3px 0; }
  table { width:100%; border-collapse:collapse; margin:8px 0; }
  th { background:#0C5E66; color:#fff; border:1px solid #0C5E66; padding:5px 3px; font-size:9.5px; text-align:center; line-height:1.3; }
  td { border:1px solid #c9d4d6; padding:4px 5px; font-size:10.5px; }
  h2.sec { font-size:12.5px; margin:12px 0 4px; border-right:4px solid #0C5E66; padding-right:8px; }
  .totals { width:280px; margin-right:auto; margin-left:0; }
  .totals td { font-size:12px; }
  .totals .grand td { background:#0C5E66; color:#fff; font-weight:800; font-size:13px; }
  .qr-foot { display:flex; justify-content:space-between; align-items:flex-end; margin-top:14px; }
  .foot { text-align:center; font-size:10px; color:#556; border-top:1px solid #ccc; margin-top:16px; padding-top:6px; }
</style></head><body>
  <div class="head">
    <img src="${location.origin}/logo-navy.png" alt="" style="width:44px;height:44px;object-fit:contain;display:block;margin:0 auto 4px" />
    <div>
      <h1>${esc(CO.name)}</h1>
      <div class="sub">الرقم الضريبي: <span class="tnum">${esc(CO.vat)}</span> — السجل التجاري: <span class="tnum">${esc(CO.cr)}</span></div>
      <div class="sub">${esc(CO.address)}${CO.phone ? ` — هاتف: <span class="tnum">${esc(CO.phone)}</span>` : ""}</div>
    </div>
    <div class="badge">${title}</div>
  </div>

  <div class="meta">
    <div class="row"><span>رقم الفاتورة</span><b class="tnum">${esc(inv.invoice_no)}</b></div>
    <div class="row"><span>تاريخ الإصدار</span><b class="tnum">${fmtDT(inv.issued_at)}</b></div>
    <div class="row"><span>الفرع</span><b>${esc(inv.branch_name || "—")}</b></div>
    <div class="row"><span>الكاشير</span><b>${esc(inv.cashier_name || "—")}</b></div>
    <div class="row"><span>العميل</span><b>${esc(inv.customer_name || "بيع نقدي")}</b></div>
    <div class="row"><span>جوال العميل</span><b class="tnum">${esc(inv.customer_phone || "—")}</b></div>
    ${inv.customer_vat ? `<div class="row"><span>الرقم الضريبي للعميل</span><b class="tnum">${esc(inv.customer_vat)}</b></div>` : ""}
  </div>

  ${carHTML(inv, false)}

  <h2 class="sec">الأصناف — Products</h2>
  <table>
    <thead><tr>
      <th class="r">الصنف<br><span style="font-weight:400;font-size:9px">PRODUCT</span></th>
      <th style="width:64px">الكمية<br><span style="font-weight:400;font-size:9px">QTY</span></th>
      <th style="width:84px">سعر الوحدة<br><span style="font-weight:400;font-size:9px">UNIT PRICE</span></th>
      <th style="width:64px">الخصم %<br><span style="font-weight:400;font-size:9px">DISC</span></th>
      <th style="width:52px">الضريبة<br><span style="font-weight:400;font-size:9px">VAT</span></th>
      <th style="width:90px">قبل الضريبة<br><span style="font-weight:400;font-size:9px">SUBTOTAL EX</span></th>
      <th style="width:90px">الإجمالي<br><span style="font-weight:400;font-size:9px">SUBTOTAL</span></th>
    </tr></thead>
    <tbody>${itemsRows}</tbody>
  </table>

  <table class="totals">
    <tbody>
      <tr><td class="r">الإجمالي قبل الضريبة <span style="font-weight:400;font-size:9px">Subtotal</span></td><td class="c tnum">${money(inv.total_ex)}</td></tr>
      <tr><td class="r">ضريبة القيمة المضافة 15% <span style="font-weight:400;font-size:9px">Taxes</span></td><td class="c tnum">${money(inv.total_vat)}</td></tr>
      <tr class="grand"><td class="r">الإجمالي <span style="font-weight:400;font-size:9px">Total</span></td><td class="c tnum">${money(inv.total_inc)} ر.س</td></tr>
    </tbody>
  </table>

  <h2 class="sec">بيانات إضافية — Extra Info</h2>
  <table>
    <tbody>
      <tr>
        <td class="r" style="width:180px;background:#f6f8f8;font-weight:700">البائع <span style="font-weight:400;font-size:9px">Salesman</span></td>
        <td class="r">${esc(inv.cashier_name || "—")}</td>
        <td class="r" style="width:180px;background:#f6f8f8;font-weight:700">نوع العملية <span style="font-weight:400;font-size:9px">Operation Type</span></td>
        <td class="r">${inv.source === "car" ? "فاتورة خدمة" : "بيع مباشر"}</td>
      </tr>
      <tr>
        <td class="r" style="background:#f6f8f8;font-weight:700">مرجع الفاتورة <span style="font-weight:400;font-size:9px">Receipt Ref</span></td>
        <td class="r tnum">${esc(inv.invoice_no)}</td>
        <td class="r" style="background:#f6f8f8;font-weight:700">الشركة <span style="font-weight:400;font-size:9px">Company</span></td>
        <td class="r">${esc(CO.name)}</td>
      </tr>
      <tr>
        <td class="r" style="background:#f6f8f8;font-weight:700">نقطة البيع <span style="font-weight:400;font-size:9px">Point of Sale</span></td>
        <td class="r">${esc(inv.branch_name || "—")}</td>
        <td class="r" style="background:#f6f8f8;font-weight:700">الوردية <span style="font-weight:400;font-size:9px">Shift</span></td>
        <td class="r tnum">${esc(inv.shift_id ? inv.shift_id.slice(0, 8) : "—")}</td>
      </tr>
    </tbody>
  </table>

  <div class="meta" style="margin-top:16px">
    <div class="row" style="border-bottom:none">التاريخ — Date: ______________________</div>
    <div class="row" style="border-bottom:none">التوقيع — Signature: ______________________</div>
  </div>

  <div style="margin:6px 0">${payRows}
    ${inv.credit_total > 0 ? `<span style="display:inline-block;border:1px solid #B0451F;color:#B0451F;border-radius:14px;padding:3px 10px;font-size:11px">آجل: <b class="tnum">${money(inv.credit_total)}</b></span>` : ""}
  </div>

  ${checklistHTML(inv, false)}

  <div class="qr-foot">
    <div style="font-size:10.5px;color:#445">
      ختم وتوقيع المنشأة: ______________________
    </div>
    <div id="qrcode"></div>
  </div>

  <div class="foot">${esc(footerText())} — ${esc(CO.name)}</div>
  ${QR_SCRIPT(inv.qr_tlv || "")}
</body></html>`;
}

// ══════════════════ الواجهة العامة ══════════════════

export function printInvoice(inv: InvoiceDetail, format: PrintFormat = "thermal") {
  const html = format === "a4" ? a4HTML(inv) : thermalHTML(inv);
  const w = window.open("", "_blank", format === "a4" ? "width=880,height=760" : "width=420,height=680");
  if (!w) { alert("المتصفح منع نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذا الموقع"); return; }
  w.document.write(html);
  w.document.close();
}
