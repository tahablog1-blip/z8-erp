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
                      c.chassis_number, c.odometer_current,
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
@page { size: A4; margin: 14mm 12mm 26mm 12mm;
  @bottom-center { content: element(foot); } }
body { font-family: 'Noto Naskh Arabic','Noto Sans Arabic','DejaVu Sans',sans-serif;
  font-size: 11.5px; color: #1a1a2e; direction: rtl; }
.foot { position: running(foot); border-top: 2px solid #14143c; padding-top: 4px;
  font-size: 10.5px; display: flex; justify-content: space-between; }
.head { display: flex; justify-content: space-between; align-items: flex-start; }
.logo { height: 54px; } .qr { width: 120px; height: 120px; }
.title { display: flex; justify-content: space-between; align-items: center; margin: 14px 0 8px; }
.title h1 { font-size: 22px; color: #1f2fb5; margin: 0; font-weight: 700; }
.title .en { direction: ltr; }
h2 { font-size: 14px; color: #14143c; border-bottom: 2px solid #14143c;
  padding-bottom: 2px; margin: 14px 0 6px; }
table { width: 100%; border-collapse: collapse; }
td, th { border: 1px solid #d9dce6; padding: 5px 7px; vertical-align: top; }
th { background: #f4f6fb; color: #14143c; font-weight: 700; text-align: center; }
td.k { width: 34%; background: #fafbfe; color: #14143c; font-weight: 700; }
td.n { text-align: center; direction: ltr; }
.two-col { display: flex; gap: 10px; align-items: flex-start; margin-top: 8px; }
.two-col > div { flex: 1; min-width: 0; }
.two-col h2 { margin-top: 0; }
thead { display: table-header-group; } tr { page-break-inside: avoid; }
.tot td { font-weight: 700; text-align: center; }
.grand { background: #14143c; color: #fff; }
"""


def _row(k: str, v) -> str:
    val = "—" if v in (None, "") else _e(v)
    return f'<tr><td class="k">{_e(k)}</td><td>{val}</td></tr>'


async def build_invoice_pdf_v2(company_id: str, invoice_id: str) -> bytes:
    from weasyprint import HTML
    inv, items, pays, car = await _load(company_id, invoice_id)
    issued = inv["issued_at"].strftime("%Y-%m-%d %H:%M")
    simplified = inv["invoice_type"] == "simplified"
    title_ar = "فاتورة ضريبية مبسطة" if simplified else "فاتورة ضريبية"
    title_en = "Simplified Tax Invoice" if simplified else "Tax Invoice"
    cust_vat = inv["customer_vat"] or inv["customer_vat_master"]

    cr_part = f'س.ت {_e(inv["co_cr"])}' if inv["co_cr"] else ""
    vat_part = f'ض.ق.م {_e(inv["co_vat"])}' if inv["co_vat"] else ""
    foot = (f'<div class="foot"><span>{_e(inv["co_name"])}'
            + (f' — {cr_part}' if cr_part else '') + '</span>'
            f'<span>{vat_part}</span></div>')

    head = (f'<div class="head"><div>{_logo()}</div><div>'
            f'<b>{_e(inv["co_name"])}</b><br>{_e(inv["co_address"])}<br>{_e(inv["co_phone"])}</div></div>')
    title = (f'<div class="title"><h1>{title_ar}</h1><h1 class="en">{title_en}</h1>'
             f'{_qr_svg(inv["qr_tlv"])}</div>')

    # ── بيانات الفاتورة ──
    info_rows = "".join([
        _row("رقم الفاتورة", inv["invoice_no"]),
        _row("التاريخ", issued),
        _row("الفرع", inv["branch_name"]),
        _row("الكاشير", inv["cashier_name"]),
        _row("العميل", inv["customer_name"] or "بيع نقدي"),
        _row("الرقم الضريبي للعميل", cust_vat),
        _row("الجوال", inv["customer_phone"]),
        _row("العنوان", inv["customer_address"]),
    ])
    info = f'<h2>بيانات الفاتورة</h2><table><tbody>{info_rows}</tbody></table>'

    car_html = ""
    if car:
        car_rows = "".join([
            _row("اللوحة", car["plate"]),
            _row("الماركة / الموديل",
                 " ".join(x for x in (car["brand"], car["model"], car["model_year"]) if x)),
            _row("اللون", car["color"]),
            _row("رقم الشاصي", car["chassis_number"]),
            _row("قراءة العداد", car["odometer_current"]),
        ])
        car_html = f'<h2>بيانات السيارة</h2><table><tbody>{car_rows}</tbody></table>'

    two_col = ('<div class="two-col"><div>' + info + '</div>'
               + (f'<div>{car_html}</div>' if car_html else '') + '</div>')

    # ── الأصناف ──
    item_rows = ""
    for it in items:
        item_rows += (
            '<tr>'
            f'<td>{_e(it["label"])}</td>'
            f'<td class="n">{_e(it["qty"])}</td>'
            f'<td class="n">{_money(it["unit_price_vat"])}</td>'
            f'<td class="n">{_money(it["discount_amount"])}</td>'
            f'<td class="n">{_money(it["line_ex"])}</td>'
            f'<td class="n">{_money(it["line_inc"])}</td>'
            '</tr>'
        )
    prod = ('<h2>الأصناف</h2><table><thead><tr>'
            '<th>الصنف</th><th>الكمية</th><th>السعر شامل الضريبة</th>'
            '<th>الخصم</th><th>الإجمالي قبل الضريبة</th><th>الإجمالي شامل الضريبة</th>'
            f'</tr></thead><tbody>{item_rows}</tbody></table>')

    # ── الإجماليات ──
    subtotal = sum(float(it["line_ex"] or 0) for it in items)
    inc_total = sum(float(it["line_inc"] or 0) for it in items)
    vat_total = inc_total - subtotal
    grand_total = inc_total
    totals = ('<h2>الإجماليات</h2><table class="tot"><tr>'
              '<th>الإجمالي قبل الضريبة</th><th>ضريبة القيمة المضافة 15%</th>'
              '<th>الإجمالي شامل الضريبة</th></tr><tr>'
              f'<td>{_money(subtotal)}</td><td>{_money(vat_total)}</td>'
              f'<td class="grand">{_money(grand_total)}</td></tr></table>')

    # ── الدفعات ──
    pay_html = ""
    if pays:
        pay_rows = "".join(
            '<tr>'
            f'<td>{METHODS.get(p["method"], _e(p["method"]))}</td>'
            f'<td class="n">{_money(p["amount"])}</td>'
            f'<td class="n">{p["created_at"].strftime("%Y-%m-%d %H:%M")}</td>'
            '</tr>'
            for p in pays
        )
        pay_html = ('<h2>الدفعات</h2><table><thead><tr>'
                    '<th>طريقة الدفع</th><th>المبلغ</th><th>الوقت</th>'
                    f'</tr></thead><tbody>{pay_rows}</tbody></table>')

    doc = (f'<html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>{CSS}</style></head>'
           f'<body>{foot}{head}{title}{two_col}{prod}{totals}{pay_html}'
           '<p style="text-align:center;margin-top:14px">شكراً لتعاملكم معنا</p></body></html>')
    return HTML(string=doc).write_pdf()
