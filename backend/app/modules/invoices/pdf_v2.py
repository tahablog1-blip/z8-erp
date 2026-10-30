"""فاتورة PDF A4 بتصميم موحّد (HTML → WeasyPrint)."""
from __future__ import annotations
import base64
import html as _h
from pathlib import Path
from ...core.db import fetchrow, fetch

LOGO = Path("/opt/z8-erp/frontend/public/logo-navy.png")
METHODS = {"cash": "نقدي", "card": "شبكة", "transfer": "تحويل", "credit": "آجل"}


def _e(v) -> str:
    return _h.escape("" if v is None else str(v))


def _money(v) -> str:
    return f"{float(v or 0):,.2f}"


def _qr_svg(tlv) -> str:
    if not tlv:
        return ""
    try:
        import segno
        import io
        buf = io.BytesIO()
        segno.make(tlv, error="m").save(buf, kind="svg", scale=4, border=0, xmldecl=False, svgns=True)
        b64 = base64.b64encode(buf.getvalue()).decode()
        return f'<img class="qr" src="data:image/svg+xml;base64,{b64}">'
    except Exception:
        return ""


def _logo() -> str:
    try:
        b64 = base64.b64encode(LOGO.read_bytes()).decode()
        return f'<img class="logo" src="data:image/png;base64,{b64}">'
    except Exception:
        return ""


async def _load(company_id: str, invoice_id: str):
    inv = await fetchrow(
        """SELECT i.*, b.name AS branch_name, u.full_name AS cashier_name,
                  cu.phone AS customer_phone, cu.address AS customer_address,
                  cu.vat_number AS customer_vat_master,
                  co.name AS co_name, co.vat_number AS co_vat, co.cr_number AS co_cr,
                  co.address AS co_address, co.phone AS co_phone
           FROM invoices i
           JOIN companies co ON co.id = i.company_id
           LEFT JOIN branches b ON b.id = i.branch_id
           LEFT JOIN users u ON u.id = i.created_by
           LEFT JOIN customers cu ON cu.id = i.customer_id
           WHERE i.id=$1 AND i.company_id=$2""", invoice_id, company_id)
    if not inv:
        raise ValueError("الفاتورة غير موجودة")
    items = await fetch(
        "SELECT label, qty, unit_price, unit_price_vat, discount_amount, line_ex, line_inc "
        "FROM invoice_items WHERE invoice_id=$1 ORDER BY id", invoice_id)
    pays = await fetch(
        "SELECT method, amount, created_at FROM invoice_payments WHERE invoice_id=$1 ORDER BY created_at",
        invoice_id)
    car = None
    if inv["car_id"]:
        car = await fetchrow(
            """SELECT c.plate, c.name AS model, c.brand, c.model_year, c.color,
                      c.chassis_number, c.odometer_current, c.odometer_previous,
                      f.full_name AS filler, t1.full_name AS fitter1,
                      t2.full_name AS fitter2, ch.full_name AS checker
               FROM cars c
               LEFT JOIN hr_employees f  ON f.id  = c.filler_id
               LEFT JOIN hr_employees t1 ON t1.id = c.fitter1_id
               LEFT JOIN hr_employees t2 ON t2.id = c.fitter2_id
               LEFT JOIN hr_employees ch ON ch.id = c.checker_id
               WHERE c.id=$1""", inv["car_id"])
    return inv, items, pays, car


CSS = """
@page { size: A4; margin: 11mm 11mm 18mm 11mm;
  @bottom-center { content: element(foot); } }
body { font-family: 'IBM Plex Sans Arabic','Noto Naskh Arabic','Noto Sans Arabic','DejaVu Sans',sans-serif;
  font-size: 11px; color: #14212b; direction: rtl; line-height: 1.45; }
.foot { position: running(foot); border-top: 1px solid #d5dde0; padding-top: 4px; text-align: center; font-size: 9.5px; color: #5b6b75; }
table { width: 100%; border-collapse: collapse; }
.num { direction: ltr; unicode-bidi: embed; font-variant-numeric: tabular-nums; }
.muted { color: #5b6b75; } small { font-size: 8px; color: #5b6b75; }
/* الترويسة */
table.head { border-bottom: 2.5px solid #0C5E66; margin-bottom: 8px; }
table.head td { vertical-align: top; padding: 0 0 8px 0; }
.logo { height: 50px; } .co { font-size: 17px; font-weight: 700; color: #0C5E66; }
.sub { font-size: 10px; font-weight: 600; margin-top: 2px; }
.doc { text-align: left; } .doc .t { font-size: 14px; font-weight: 700; color: #0C5E66; }
.status { display: inline-block; margin-top: 5px; padding: 2px 10px; border: 1.5px solid; border-radius: 5px; font-weight: 700; font-size: 11px; }
.st-paid { color: #12794a; } .st-partial, .st-credit { color: #a85a00; } .st-returned { color: #b3261e; }
/* بطاقات */
table.pair { margin-bottom: 8px; } table.pair > tbody > tr > td { width: 50%; vertical-align: top; padding: 0; }
.card { border: 1px solid #d5dde0; border-radius: 6px; padding: 6px 9px; margin-bottom: 8px; }
table.pair td.l { padding-left: 4px; } table.pair td.r { padding-right: 4px; }
h2 { font-size: 11px; color: #0C5E66; margin: 0 0 3px; padding-bottom: 2px; border-bottom: 1px solid #d5dde0; }
table.kv td { padding: 2px 0; border-bottom: 1px dotted #d5dde0; } table.kv tr:last-child td { border-bottom: none; }
table.kv td.k { color: #5b6b75; width: 46%; } table.kv td.v { font-weight: 700; text-align: left; }
table.veh td { width: 25%; vertical-align: top; padding: 2px 4px; } table.veh .k { font-size: 8.5px; color: #5b6b75; display: block; } table.veh .v { font-weight: 700; }
/* الأصناف */
table.items { margin: 2px 0 8px; }
.items th { background: #0C5E66; color: #fff; padding: 4px 3px; font-size: 9.5px; text-align: center; }
.items td { padding: 4px 5px; border-bottom: 1px solid #d5dde0; vertical-align: top; }
.items td.n { text-align: left; } .items td.c { text-align: center; } .items .sku { display: block; font-size: 8px; color: #5b6b75; }
thead { display: table-header-group; } tr { page-break-inside: avoid; }
/* الإجماليات */
table.sum > tbody > tr > td { width: 50%; vertical-align: top; padding: 0; } table.sum td.l { padding-left: 4px; } table.sum td.r { padding-right: 4px; }
table.sum .card { margin-bottom: 0; }
.grand { background: #0C5E66; color: #fff; border-radius: 6px; padding: 7px 10px; margin-top: 6px; }
.grand table td { color: #fff; font-weight: 700; } .grand .amt { font-size: 18px; text-align: left; }
.warn { color: #a85a00; }
/* QR + توقيع */
table.qrrow { margin-top: 10px; border-top: 1px solid #d5dde0; page-break-inside: avoid; }
table.qrrow td { vertical-align: middle; padding: 8px 6px 0; }
.qr { width: 112px; height: 112px; } .sign { text-align: center; font-size: 8.5px; color: #5b6b75; width: 170px; }
.sign .line { border-bottom: 1px solid #889; height: 20px; margin-bottom: 2px; }
"""

STATUS = {"paid": ("مدفوعة", "Paid"), "partial": ("مدفوعة جزئياً", "Partially paid"),
          "credit": ("آجلة", "On credit"), "returned": ("مرتجعة", "Returned")}


def _status(inv) -> str:
    if inv["is_returned"]:
        return "returned"
    credit = float(inv["credit_total"] or 0)
    if credit > 0:
        return "partial" if float(inv["paid_total"] or 0) > 0 else "credit"
    return "paid"


def _kv(rows) -> str:
    """صفوف مفتاح/قيمة — الفارغ يُسقط بدل عرض «—»"""
    body = "".join(
        f'<tr><td class="k">{_e(k)}</td><td class="v">{v if raw else _e(v)}</td></tr>'
        for k, v, raw in rows if v not in (None, "", 0))
    return f'<table class="kv"><tbody>{body}</tbody></table>' if body else ""


def _num(v) -> str:
    return f'<span class="num">{_e(v)}</span>'


async def build_invoice_pdf_v2(company_id: str, invoice_id: str) -> bytes:
    from weasyprint import HTML
    inv, items, pays, car = await _load(company_id, invoice_id)
    issued = inv["issued_at"].strftime("%Y-%m-%d %H:%M")
    simplified = inv["invoice_type"] == "simplified"
    st = _status(inv)
    if inv["is_returned"]:
        title_ar, title_en = "فاتورة مرتجعة", "Return Invoice"
    elif simplified:
        title_ar, title_en = "فاتورة ضريبية مبسطة", "Simplified Tax Invoice"
    else:
        title_ar, title_en = "فاتورة ضريبية", "Tax Invoice"
    cust_vat = inv["customer_vat"] or inv["customer_vat_master"]
    # القيم المالية من الفاتورة نفسها (المصدر الوحيد) — نفس ما تطبعه واجهة النظام A4/الحراري
    total_ex, total_vat, total_inc = float(inv["total_ex"] or 0), float(inv["total_vat"] or 0), float(inv["total_inc"] or 0)
    discount_total = float(inv["discount_total"] or 0)
    paid_total, credit_total = float(inv["paid_total"] or 0), float(inv["credit_total"] or 0)
    has_disc = discount_total > 0 or any(float(it["discount_amount"] or 0) > 0 for it in items)

    foot = (f'<div class="foot"><b>شكراً لتعاملكم معنا</b> — {_e(inv["co_name"])}'
            + (f' · هاتف {_num(inv["co_phone"])}' if inv["co_phone"] else "")
            + (f' · الرقم الضريبي {_num(inv["co_vat"])}' if inv["co_vat"] else "") + '</div>')

    ids = []
    if inv["co_vat"]:
        ids.append(f'الرقم الضريبي {_num(inv["co_vat"])}')
    if inv["co_cr"]:
        ids.append(f'السجل التجاري {_num(inv["co_cr"])}')
    head = (
        '<table class="head"><tr><td style="width:62%">'
        f'<table><tr><td style="width:60px">{_logo()}</td><td>'
        f'<div class="co">{_e(inv["co_name"])}</div>'
        f'<div class="sub">{" · ".join(ids)}</div>'
        f'<div class="sub muted">{_e(inv["co_address"])}'
        + (f' · هاتف {_num(inv["co_phone"])}' if inv["co_phone"] else "") + '</div>'
        '</td></tr></table></td><td class="doc">'
        f'<div class="t">{title_ar}</div><small>{title_en}</small><br>'
        f'<span class="status st-{st}">{STATUS[st][0]} <small>{STATUS[st][1]}</small></span>'
        '</td></tr></table>')

    cust = _kv([("العميل", inv["customer_name"] or "بيع نقدي", False), ("الجوال", _num(inv["customer_phone"]) if inv["customer_phone"] else "", True),
                ("الرقم الضريبي", _num(cust_vat) if cust_vat else "", True), ("العنوان", inv["customer_address"], False)])
    meta = _kv([("رقم الفاتورة", _num(inv["invoice_no"]), True), ("تاريخ الإصدار", _num(issued), True),
                ("الفرع", inv["branch_name"], False), ("الكاشير", inv["cashier_name"], False)])
    two = ('<table class="pair"><tr>'
           f'<td class="r"><div class="card"><h2>بيانات العميل <small>Customer</small></h2>{cust}</div></td>'
           f'<td class="l"><div class="card"><h2>بيانات الفاتورة <small>Invoice</small></h2>{meta}</div></td></tr></table>')

    veh_html = ""
    if car:
        def km(v):
            return f'<span class="num">{_e(v)}</span> كم' if v else ""
        cells = [("اللوحة", _num(car["plate"]) if car["plate"] else ""),
                 ("السيارة", " ".join(x for x in (car["brand"], car["model"]) if x)),
                 ("السنة", _num(car["model_year"]) if car["model_year"] else ""), ("اللون", car["color"]),
                 ("العداد الحالي", km(car["odometer_current"])), ("العداد السابق", km(car.get("odometer_previous"))),
                 ("رقم الهيكل (VIN)", _num(car["chassis_number"]) if car["chassis_number"] else ""),
                 ("فني التعبئة", car.get("filler")),
                 ("الفك والتركيب", " و".join(x for x in (car.get("fitter1"), car.get("fitter2")) if x)),
                 ("التشييك", car.get("checker"))]
        cells = [(k, v) for k, v in cells if v]
        if cells:
            rows, cur = [], []
            for k, v in cells:
                cur.append(f'<td><span class="k">{_e(k)}</span><span class="v">{v if "<span" in str(v) else _e(v)}</span></td>')
                if len(cur) == 4:
                    rows.append("<tr>" + "".join(cur) + "</tr>"); cur = []
            if cur:
                rows.append("<tr>" + "".join(cur) + "<td></td>" * (4 - len(cur)) + "</tr>")
            veh_html = f'<div class="card"><h2>بيانات المركبة <small>Vehicle</small></h2><table class="veh">{"".join(rows)}</table></div>'

    item_rows = ""
    for i, it in enumerate(items, 1):
        item_rows += (
            '<tr>'
            f'<td class="c muted">{i}</td>'
            f'<td><b>{_e(it["label"])}</b></td>'
            f'<td class="c">{_num(it["qty"])}</td>'
            f'<td class="n">{_num(_money(it["unit_price"]))}</td>'
            + (f'<td class="n">{_num(_money(it["discount_amount"])) if float(it["discount_amount"] or 0) > 0 else "—"}</td>' if has_disc else "")
            + f'<td class="n">{_num(_money(it["line_ex"]))}</td>'
            f'<td class="n">{_num(_money(float(it["line_inc"] or 0) - float(it["line_ex"] or 0)))}</td>'
            f'<td class="n"><b>{_num(_money(it["line_inc"]))}</b></td>'
            '</tr>')
    prod = ('<table class="items"><thead><tr><th style="width:22px">#</th><th>الصنف</th><th style="width:40px">الكمية</th>'
            '<th style="width:70px">سعر الوحدة</th>' + ('<th style="width:60px">الخصم</th>' if has_disc else "")
            + '<th style="width:74px">قبل الضريبة</th><th style="width:60px">الضريبة</th><th style="width:76px">الإجمالي</th>'
            f'</tr></thead><tbody>{item_rows}</tbody></table>')

    pay_rows = [(METHODS.get(p["method"], p["method"]), _num(_money(p["amount"])), True) for p in pays if float(p["amount"] or 0) > 0]
    pay_rows += [("الإجمالي", _num(_money(total_inc)), True), ("المدفوع", _num(_money(paid_total)), True),
                 ("المتبقي", _num(_money(credit_total)), True)]
    extra = _kv([("نوع العملية", "فاتورة خدمة" if inv["source"] == "car" else "بيع مباشر", False), ("نقطة البيع", inv["branch_name"], False),
                 ("الجلسة", _num(str(inv["shift_id"])[:8]) if inv.get("shift_id") else "", True)])
    pay_card = (f'<div class="card"><h2>حالة الدفع <small>Payment</small></h2>{_kv(pay_rows)}'
                + (f'<h2 style="margin-top:8px">معلومات إضافية <small>Additional</small></h2>{extra}' if extra else "") + '</div>')
    tot_rows = [("الإجمالي قبل الضريبة", _num(_money(total_ex)), True)]
    if discount_total > 0:
        tot_rows.append(("إجمالي الخصم", _num(_money(discount_total)), True))
    tot_rows.append(("ضريبة القيمة المضافة (15%)", _num(_money(total_vat)), True))
    tot_card = (f'<div class="card"><h2>ملخص الضريبة <small>Tax summary</small></h2>{_kv(tot_rows)}'
                f'<div class="grand"><table><tr><td>الإجمالي شامل الضريبة <small style="color:#cfe">Total</small></td>'
                f'<td class="amt">{_num(_money(total_inc))} ر.س</td></tr></table></div></div>')
    summary = f'<table class="sum"><tr><td class="r">{pay_card}</td><td class="l">{tot_card}</td></tr></table>'

    zatca = _kv([("اسم المورد", inv["co_name"], False), ("الرقم الضريبي", _num(inv["co_vat"]) if inv["co_vat"] else "", True),
                 ("وقت الإصدار", _num(issued), True), ("الإجمالي / الضريبة", _num(f"{_money(total_inc)} / {_money(total_vat)}"), True)])
    qrrow = ('<table class="qrrow"><tr>'
             f'<td style="width:120px">{_qr_svg(inv["qr_tlv"])}</td>'
             f'<td><h2>بيانات الفاتورة الإلكترونية <small>ZATCA</small></h2>{zatca}</td>'
             '<td class="sign"><div class="line"></div>التوقيع · Signature<div class="line" style="margin-top:6px"></div>ختم المنشأة · Stamp</td>'
             '</tr></table>')

    doc = (f'<html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>{CSS}</style></head>'
           f'<body>{foot}{head}{two}{veh_html}{prod}{summary}{qrrow}</body></html>')
    return HTML(string=doc).write_pdf()
