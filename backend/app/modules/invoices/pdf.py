"""فاتورة PDF A4 عربية — fpdf2 + خط تاهوما من ويندوز + تشكيل RTL.
لو المكتبات مش متثبتة: رسالة واضحة توجّه لتشغيل INSTALL-Z8."""
from __future__ import annotations
import os
from ...core.db import fetchrow, fetch


def _rtl(text: str) -> str:
    import arabic_reshaper
    from bidi.algorithm import get_display
    return get_display(arabic_reshaper.reshape(str(text or "")))


def _font_path() -> str:
    for p in (r"C:\Windows\Fonts\tahoma.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        if os.path.exists(p):
            return p
    raise FileNotFoundError("خط عربي غير متاح")


async def build_invoice_pdf(company_id: str, invoice_id: str) -> bytes:
    from fpdf import FPDF  # lazy — رسالة أوضح لو ناقصة

    inv = await fetchrow(
        """SELECT i.*, c.name AS co_name, c.vat_number AS co_vat,
                  cu.phone AS customer_phone, b.name AS branch_name
           FROM invoices i
           JOIN companies c ON c.id = i.company_id
           LEFT JOIN customers cu ON cu.id = i.customer_id
           LEFT JOIN branches b ON b.id = i.branch_id
           WHERE i.id=$1 AND i.company_id=$2""", invoice_id, company_id)
    if not inv:
        raise ValueError("الفاتورة غير موجودة")
    items = await fetch(
        "SELECT label, qty, unit_price_vat, line_inc FROM invoice_items WHERE invoice_id=$1",
        invoice_id)

    pdf = FPDF(format="A4")
    pdf.add_page()
    font = _font_path()
    pdf.add_font("AR", "", font)
    pdf.add_font("AR", "B", font.replace("tahoma.ttf", "tahomabd.ttf")
                 if os.path.exists(font.replace("tahoma.ttf", "tahomabd.ttf")) else font)

    W = 190  # عرض المحتوى
    def line(txt, size=11, bold=False, h=7, align="C"):
        pdf.set_font("AR", "B" if bold else "", size)
        pdf.cell(W, h, _rtl(txt), align=align, new_x="LMARGIN", new_y="NEXT")

    # الرأس
    line(inv["co_name"] or "مصدر الزيوت", 16, True, 9)
    line(f'الرقم الضريبي: {inv["co_vat"] or ""}', 10)
    line("فاتورة ضريبية مبسطة", 12, True, 8)
    pdf.ln(2)
    line(f'رقم الفاتورة: {inv["invoice_no"]}    التاريخ: {inv["issued_at"].strftime("%Y-%m-%d %H:%M")}', 10, align="R")
    line(f'الفرع: {inv["branch_name"] or "—"}    العميل: {inv["customer_name"] or "بيع نقدي"}', 10, align="R")
    # ── فريق العمل المحفوظ لحظة اعتماد أمر العمل — يظهر فقط لفواتير الخدمة المرتبطة بسيارة ──
    if inv.get("car_id"):
        team = await fetchrow(
            """SELECT f.full_name  AS filler,
                      t1.full_name AS fitter1,
                      t2.full_name AS fitter2,
                      ch.full_name AS checker
               FROM cars c
               LEFT JOIN hr_employees f  ON f.id  = c.filler_id
               LEFT JOIN hr_employees t1 ON t1.id = c.fitter1_id
               LEFT JOIN hr_employees t2 ON t2.id = c.fitter2_id
               LEFT JOIN hr_employees ch ON ch.id = c.checker_id
               WHERE c.id=$1""", inv["car_id"])
        if team:
            parts = []
            if team["filler"]:
                parts.append(f'التعبئة: {team["filler"]}')
            fitters = " و".join(x for x in (team["fitter1"], team["fitter2"]) if x)
            if fitters:
                parts.append(f'الفك والتركيب: {fitters}')
            if team["checker"]:
                parts.append(f'التشييك: {team["checker"]}')
            if parts:
                line("فريق العمل — " + "  ·  ".join(parts), 9.5, align="R")
    pdf.ln(3)

    # جدول الأصناف
    cols = [90, 25, 35, 40]  # الاسم/الكمية/السعر/الإجمالي (RTL: نرسم يمين→يسار)
    heads = ["الإجمالي", "السعر", "الكمية", "الصنف"]
    pdf.set_font("AR", "B", 10)
    pdf.set_fill_color(22, 58, 112); pdf.set_text_color(255, 255, 255)
    for wdt, hd in zip([40, 35, 25, 90], heads):
        pdf.cell(wdt, 8, _rtl(hd), border=1, align="C", fill=True)
    pdf.ln()
    pdf.set_text_color(0, 0, 0); pdf.set_font("AR", "", 9.5)
    for it in items:
        pdf.cell(40, 7, f'{float(it["line_inc"]):.2f}', border=1, align="C")
        pdf.cell(35, 7, f'{float(it["unit_price_vat"]):.2f}', border=1, align="C")
        pdf.cell(25, 7, str(it["qty"]), border=1, align="C")
        pdf.cell(90, 7, _rtl(str(it["label"])[:48]), border=1, align="R")
        pdf.ln()
    pdf.ln(3)

    # الإجماليات
    for lbl, val in (("الإجمالي قبل الضريبة", inv["total_ex"]),
                     ("ضريبة القيمة المضافة 15%", inv["total_vat"]),
                     ("الإجمالي شامل الضريبة", inv["total_inc"])):
        pdf.set_font("AR", "B" if "شامل" in lbl else "", 11)
        pdf.cell(120, 8, f'{float(val):.2f}', align="L")
        pdf.cell(70, 8, _rtl(lbl), align="R", new_x="LMARGIN", new_y="NEXT")

    pdf.ln(4)
    line("شكراً لتعاملكم معنا", 10)
    return bytes(pdf.output())
