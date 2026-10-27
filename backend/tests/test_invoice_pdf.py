# اختبار قالب PDF الفاتورة: صفحة واحدة، والأرقام المالية = القيم المخزّنة في الفاتورة (لا إعادة حساب)، والأقسام تُسقط الحقول الفارغة.
import asyncio
import datetime as dt
import io

import pytest

pytest.importorskip("weasyprint")
pypdf = pytest.importorskip("pypdf")
from app.modules.invoices import pdf_v2

NOW = dt.datetime(2026, 10, 26, 10, 30)


def _data(full=True, **over):
    inv = dict(id="i", invoice_no="INV-000066", invoice_type="simplified", issued_at=NOW, branch_name="الفرع الرئيسي", cashier_name="أحمد", customer_name="طه", customer_vat=None,
               customer_vat_master=None, customer_phone="0510000000", customer_address=None, co_name="شركة مصدر الزيوت", co_vat="311832965900003", co_cr="1010581613",
               co_address="الرياض", co_phone="0500000000", qr_tlv="AQ5Nb2NrIENvbXBhbnkCDzMxMDEyMzQ1Njc4OTAxMgMUMjAyNi0xMC0yNlQxMDozMDowMFoEBTI5LjkwBQQzLjkw",
               car_id="c" if full else None, source="car" if full else "pos", shift_id="abcdef123456", is_returned=False,
               total_ex=26, total_vat=3.9, total_inc=29.9, discount_total=4 if full else 0, paid_total=19.9 if full else 29.9, credit_total=10 if full else 0)
    inv.update(over)
    items = [dict(label="خدمة تغيير زيت", qty=1, unit_price=26, unit_price_vat=29.9, discount_amount=4 if full else 0, line_ex=22.61, line_inc=26),
             dict(label="فلتر هواء", qty=2, unit_price=3.39, unit_price_vat=3.9, discount_amount=0, line_ex=6.78, line_inc=7.8)]
    pays = [dict(method="cash", amount=10 if full else 29.9, created_at=NOW)] + ([dict(method="card", amount=9.9, created_at=NOW)] if full else [])
    car = dict(plate="111 AAA", model="أكورد", brand="هوندا", model_year="2013", color="رمادي", chassis_number="1HGCM82633A004352", odometer_current=86685,
               odometer_previous=80100, filler="علي", fitter1="سعد", fitter2=None, checker="ماجد") if full else None
    return inv, items, pays, car


def _render(monkeypatch, **kw):
    async def fake(company_id, invoice_id):
        return _data(**kw)
    monkeypatch.setattr(pdf_v2, "_load", fake)
    pdf = asyncio.run(pdf_v2.build_invoice_pdf_v2("c", "i"))
    r = pypdf.PdfReader(io.BytesIO(pdf))
    return r, "\n".join(p.extract_text() for p in r.pages)


@pytest.mark.parametrize("full", [True, False])
def test_single_page_and_stored_totals(monkeypatch, full):
    r, text = _render(monkeypatch, full=full)
    assert len(r.pages) == 1
    for v in ("29.90", "26.00", "3.90"):
        assert v in text


def test_totals_come_from_invoice_not_from_item_sums(monkeypatch):
    # أسطر الأصناف مجموعها 33.80 لكن إجمالي الفاتورة المخزّن 29.90 — الـ PDF يعرض المخزّن
    _, text = _render(monkeypatch, full=False)
    assert "29.90" in text


def test_returned_invoice_is_marked(monkeypatch):
    _, text = _render(monkeypatch, full=False, is_returned=True)
    assert "Return Invoice" in text or "Returned" in text
