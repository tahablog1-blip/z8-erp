# المبيعات والخزينة على قاعدة اختبار حقيقية: الفاتورة (مخزون + قيد + ذمم)، المرتجع الكامل/الجزئي، التزامن، وسندات القبض/الصرف/الإلغاء/السلف.
# القاعدة الذهبية المفحوصة في كل اختبار: القيد متوازن (مدين = دائن) ولا يبقى أثر جزئي عند الفشل.
import asyncio
import uuid
from decimal import Decimal

import pytest
from fastapi import HTTPException

from conftest import CO, run

pytestmark = pytest.mark.db
CID = uuid.UUID(CO)
D = Decimal


@pytest.fixture
def w(db_ready):
    """شركة + فرع + كاشير بجلسة مفتوحة + شجرة حسابات + صنف زيت (تكلفة 40، شامل 115) بمخزون 10 + صنف خدمة + عميل"""
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            await c.execute("""TRUNCATE invoices, invoice_items, invoice_payments, invoice_returns, invoice_return_items, inventory, products, customers, customer_ledger,
                journal_entries, journal_lines, accounts, shifts, treasury_vouchers, employee_advances, advance_repayments, hr_employees, audit_log, cars,
                document_counters, invoice_counters, branch_invoice_counters, branches, users, companies, company_settings RESTART IDENTITY CASCADE""")
            br, u, oil, svc, cu = (uuid.uuid4() for _ in range(5))
            await c.execute("INSERT INTO companies (id, name, vat_number) VALUES ($1,'شركة','300000000000003')", CID)
            await c.execute("INSERT INTO branches (id, company_id, name) VALUES ($1,$2,'الرئيسي')", br, CID)
            await c.execute("INSERT INTO users (id, company_id, full_name, email) VALUES ($1,$2,'كاشير','c@x')", u, CID)
            await c.execute("INSERT INTO shifts (company_id, branch_id, user_id, opening_cash) VALUES ($1,$2,$3,100)", CID, br, u)
            for code, name, t in [("1010", "النقدية", "asset"), ("1011", "الصندوق", "asset"), ("1012", "الشبكة", "asset"), ("1013", "التحويلات", "asset"),
                                  ("1020", "الذمم المدينة", "asset"), ("1030", "المخزون", "asset"), ("2010", "ضريبة مستحقة", "liability"),
                                  ("2020", "الموردون", "liability"), ("4010", "المبيعات", "revenue"), ("5010", "تكلفة المبيعات", "expense")]:
                await c.execute("INSERT INTO accounts (company_id, code, name, type) VALUES ($1,$2,$3,$4)", CID, code, name, t)
            await c.execute("INSERT INTO products (id, company_id, name, price, price_vat, cost_price, min_qty) VALUES ($1,$2,'زيت',100,115,40,0)", oil, CID)
            await c.execute("INSERT INTO products (id, company_id, name, price, price_vat, cost_price, is_service) VALUES ($1,$2,'غيار زيت',100,115,0,true)", svc, CID)
            await c.execute("INSERT INTO inventory (company_id, loc_type, loc_id, product_id, qty) VALUES ($1,'branch',$2,$3,10)", CID, str(br), oil)
            await c.execute("INSERT INTO customers (id, company_id, name, vat_number) VALUES ($1,$2,'عميل آجل','311111111111113')", cu, CID)
            return {"br": str(br), "u": str(u), "oil": str(oil), "svc": str(svc), "cu": str(cu)}
    return run(go)


def item(pid, qty=1, disc=0, label="زيت"):
    return {"productId": pid, "label": label, "qty": qty, "unitPrice": 100, "unitPriceVat": 115, "discountAmount": disc}


def inv_body(w, items, payments, **kw):
    return {"branchId": w["br"], "source": "pos", "invoiceType": "simplified", "items": items, "payments": payments, **kw}


def sell(w, items=None, payments=None, **kw):
    from app.modules.invoices import service
    items = items or [item(w["oil"], 2)]
    payments = payments or [{"method": "cash", "amount": 230}]
    return run(lambda: service.create_invoice(CO, w["u"], "c@x", inv_body(w, items, payments, **kw)))


def q(sql, *a):
    from app.core import db

    async def go():
        async with db.pool().acquire() as c:
            return await c.fetch(sql, *a)
    return run(go)


def stock(w, pid=None):
    r = q("SELECT qty FROM inventory WHERE loc_type='branch' AND loc_id=$1 AND product_id=$2", w["br"], uuid.UUID(pid or w["oil"]))
    return r[0]["qty"] if r else None


def journal(source_type=None):
    """مجموع المدين/الدائن لكل كود حساب (اختياري: لنوع مصدر)"""
    rows = q("""SELECT a.code, SUM(l.debit) AS d, SUM(l.credit) AS c FROM journal_lines l
                JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
                WHERE ($1::text IS NULL OR e.source_type=$1) GROUP BY a.code""", source_type)
    return {r["code"]: (r["d"], r["c"]) for r in rows}


def assert_balanced():
    rows = q("""SELECT e.id, SUM(l.debit) - SUM(l.credit) AS diff FROM journal_entries e JOIN journal_lines l ON l.entry_id=e.id GROUP BY e.id""")
    assert rows and all(r["diff"] == 0 for r in rows), [dict(r) for r in rows]


# ══════════════════ الفاتورة ══════════════════

def test_cash_sale_totals_stock_and_journal(w):
    inv = sell(w)
    assert (inv["total_inc"], inv["total_ex"], inv["total_vat"]) == (230, 200, 30)
    assert inv["invoice_no"] == "INV-000001" and inv["paid_total"] == 230 and inv["credit_total"] == 0
    assert stock(w) == 8
    j = journal("invoice_sale")
    assert j["1011"][0] == D("230") and j["4010"][1] == D("200") and j["2010"][1] == D("30")
    cg = journal("invoice_cogs")
    assert cg["5010"][0] == D("80") and cg["1030"][1] == D("80")
    assert_balanced()
    assert len(q("SELECT 1 FROM invoice_payments")) == 1 and len(q("SELECT 1 FROM audit_log WHERE action='invoice_create'")) == 1
    assert sell(w, [item(w["oil"], 1)], [{"method": "cash", "amount": 115}])["invoice_no"] == "INV-000002"   # الترقيم متسلسل


def test_payment_methods_hit_matching_accounts(w):
    sell(w, [item(w["oil"], 2)], [{"method": "cash", "amount": 100}, {"method": "card", "amount": 80}, {"method": "transfer", "amount": 50}])
    j = journal("invoice_sale")
    assert (j["1011"][0], j["1012"][0], j["1013"][0]) == (D("100"), D("80"), D("50"))
    assert_balanced()


def test_discounts_reduce_total_and_keep_vat_exact(w):
    inv = sell(w, [item(w["oil"], 2, disc=23)], [{"method": "cash", "amount": 207}])     # 230 - 23
    assert inv["total_inc"] == 207 and inv["discount_total"] == 23
    assert round(inv["total_ex"] + inv["total_vat"], 2) == 207
    inv2 = sell(w, [item(w["oil"], 1)], [{"method": "cash", "amount": 100}], discountAmount=15)   # خصم الفاتورة
    assert inv2["total_inc"] == 100


def test_discount_larger_than_total_rejected(w):
    with pytest.raises(HTTPException) as e:
        sell(w, [item(w["oil"], 1)], [{"method": "cash", "amount": 1}], discountAmount=500)
    assert e.value.status_code == 400 and stock(w) == 10 and not q("SELECT 1 FROM invoices")


def test_payment_mismatch_rejected_without_side_effects(w):
    with pytest.raises(HTTPException) as e:
        sell(w, [item(w["oil"], 2)], [{"method": "cash", "amount": 200}])
    assert e.value.status_code == 400
    assert stock(w) == 10 and not q("SELECT 1 FROM invoices") and not q("SELECT 1 FROM journal_entries")


def test_credit_sale_requires_customer_and_posts_ledger(w):
    with pytest.raises(HTTPException) as e:
        sell(w, payments=[{"method": "credit", "amount": 230}])
    assert e.value.status_code == 400 and stock(w) == 10
    inv = sell(w, payments=[{"method": "cash", "amount": 30}, {"method": "credit", "amount": 200}], customerId=w["cu"])
    assert inv["credit_total"] == 200 and inv["customer_name"] == "عميل آجل"
    led = q("SELECT entry_type, amount FROM customer_ledger")
    assert [(r["entry_type"], r["amount"]) for r in led] == [("invoice", D("200"))]
    assert journal("invoice_sale")["1020"][0] == D("200")
    assert_balanced()


def test_insufficient_stock_rolls_back_everything(w):
    with pytest.raises(HTTPException) as e:
        sell(w, [item(w["oil"], 11)], [{"method": "cash", "amount": 1265}])
    assert e.value.status_code == 409
    assert stock(w) == 10 and not q("SELECT 1 FROM invoices") and not q("SELECT 1 FROM invoice_items") and not q("SELECT 1 FROM journal_entries")


def test_no_open_shift_blocks_sale(w):
    q("UPDATE shifts SET status='closed'")
    with pytest.raises(HTTPException) as e:
        sell(w)
    assert e.value.status_code == 409 and stock(w) == 10


def test_service_item_does_not_touch_stock_or_cogs(w):
    sell(w, [item(w["svc"], 1, label="غيار زيت")], [{"method": "cash", "amount": 115}])
    assert stock(w) == 10 and stock(w, w["svc"]) is None
    assert "invoice_cogs" not in [r["source_type"] for r in q("SELECT source_type FROM journal_entries")]


def test_idempotency_key_returns_same_invoice_once(w):
    a = sell(w, idempotencyKey="k-1")
    b = sell(w, idempotencyKey="k-1")
    assert a["id"] == b["id"] and len(q("SELECT 1 FROM invoices")) == 1 and stock(w) == 8


def test_standard_invoice_requires_customer_vat():
    from pydantic import ValidationError
    from app.modules.invoices.schemas import InvoiceCreate
    with pytest.raises(ValidationError):
        InvoiceCreate(branchId="b", invoiceType="standard", items=[item("p")], payments=[{"method": "cash", "amount": 1}])


def test_concurrent_sales_of_last_unit_only_one_wins(w):
    q("UPDATE inventory SET qty=1")
    from app.modules.invoices import service

    async def go():
        body = lambda: inv_body(w, [item(w["oil"], 1)], [{"method": "cash", "amount": 115}])
        return await asyncio.gather(*[service.create_invoice(CO, w["u"], "c@x", body()) for _ in range(4)], return_exceptions=True)
    res = run(go)
    ok = [r for r in res if isinstance(r, dict)]
    bad = [r for r in res if isinstance(r, HTTPException)]
    assert len(ok) == 1 and len(bad) == 3 and all(b.status_code == 409 for b in bad)
    assert stock(w) == 0 and len(q("SELECT 1 FROM invoices")) == 1       # لا بيع بالسالب ولا فاتورة زائدة
    assert len({r["invoice_no"] for r in ok}) == 1


def test_closed_accounting_period_blocks_sale_atomically(w):
    q("INSERT INTO company_settings (company_id, key, value) VALUES ($1,'accounting.closed_until','2999-12-31')", CID)
    with pytest.raises(RuntimeError):
        sell(w)
    assert stock(w) == 10 and not q("SELECT 1 FROM invoices") and not q("SELECT 1 FROM invoice_payments")


def test_car_invoice_guards(w):
    car = uuid.uuid4()
    q("INSERT INTO cars (id, company_id, name) VALUES ($1,$2,'سيارة')", car, CID)
    with pytest.raises(HTTPException) as e:                       # أمر العمل لم يُعتمد
        sell(w, source="car", carId=str(car))
    assert e.value.status_code == 409
    q("UPDATE cars SET work_status='ready'")
    inv = sell(w, source="car", carId=str(car))
    assert q("SELECT work_status FROM cars")[0]["work_status"] == "invoiced" and inv["car_id"] == str(car)
    with pytest.raises(HTTPException) as e:                       # فاتورة ثانية لنفس الزيارة
        sell(w, source="car", carId=str(car))
    assert e.value.status_code == 409 and len(q("SELECT 1 FROM invoices")) == 1


# ══════════════════ المرتجع الكامل ══════════════════

def full_return(w, inv_id):
    from app.modules.invoices import service
    return run(lambda: service.return_invoice(CO, w["u"], "c@x", inv_id))


def test_full_return_restores_stock_and_reverses_journal(w):
    inv = sell(w)
    assert stock(w) == 8
    full_return(w, inv["id"])
    assert stock(w) == 10 and q("SELECT is_returned FROM invoices")[0]["is_returned"] is True
    assert not q("SELECT 1 FROM journal_entries WHERE source_type IN ('invoice_sale','invoice_cogs')")
    with pytest.raises(HTTPException) as e:
        full_return(w, inv["id"])
    assert e.value.status_code == 409 and stock(w) == 10          # لا إرجاع مزدوج للمخزون


def test_full_return_of_credit_sale_clears_customer_balance(w):
    inv = sell(w, payments=[{"method": "credit", "amount": 230}], customerId=w["cu"])
    full_return(w, inv["id"])
    assert sum(r["amount"] for r in q("SELECT amount FROM customer_ledger")) == 0


# ══════════════════ المرتجع الجزئي ══════════════════

def partial(w, inv_id, lines, pin=None):
    from app.modules.invoices import service
    return run(lambda: service.partial_return_invoice(CO, w["u"], "c@x", inv_id, lines, "عيب", pin))


def test_partial_return_proportional_and_balanced(w):
    inv = sell(w, [item(w["oil"], 4)], [{"method": "cash", "amount": 460}])
    iid = q("SELECT id FROM invoice_items")[0]["id"]
    r = partial(w, inv["id"], [{"invoiceItemId": str(iid), "qty": 1}])
    assert (r["total_inc"], r["total_ex"], r["total_vat"]) == (115, 100, 15) and r["return_no"] == "RET-000001"
    assert stock(w) == 7 and q("SELECT returned_qty FROM invoice_items")[0]["returned_qty"] == 1
    assert journal("invoice_partial_return")["4010"][0] == D("100") and journal("invoice_partial_return")["1011"][1] == D("115")
    assert journal("invoice_partial_return_cogs")["1030"][0] == D("40")
    assert_balanced()


def test_partial_return_cannot_exceed_available_or_repeat(w):
    inv = sell(w, [item(w["oil"], 2)], [{"method": "cash", "amount": 230}])
    iid = str(q("SELECT id FROM invoice_items")[0]["id"])
    partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}])
    with pytest.raises(HTTPException) as e:
        partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 2}])
    assert e.value.status_code == 409
    partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}])
    with pytest.raises(HTTPException):
        partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}])
    assert stock(w) == 10 and q("SELECT returned_qty FROM invoice_items")[0]["returned_qty"] == 2


def test_partial_return_duplicate_lines_are_merged_not_double_counted(w):
    inv = sell(w, [item(w["oil"], 2)], [{"method": "cash", "amount": 230}])
    iid = str(q("SELECT id FROM invoice_items")[0]["id"])
    with pytest.raises(HTTPException) as e:                       # 1+2 على بند كميته 2
        partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}, {"invoiceItemId": iid, "qty": 2}])
    assert e.value.status_code == 409 and stock(w) == 8


def test_partial_return_foreign_item_rejected(w):
    inv = sell(w)
    with pytest.raises(HTTPException) as e:
        partial(w, inv["id"], [{"invoiceItemId": str(uuid.uuid4()), "qty": 1}])
    assert e.value.status_code == 400


def test_partial_return_requires_valid_pin_when_pins_exist(w):
    q("INSERT INTO hr_employees (company_id, full_name, approval_pin) VALUES ($1,'مشرف','4321')", CID)
    inv = sell(w)
    iid = str(q("SELECT id FROM invoice_items")[0]["id"])
    for pin in (None, "0000"):
        with pytest.raises(HTTPException) as e:
            partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}], pin=pin)
        assert e.value.status_code == 403
    assert stock(w) == 8 and not q("SELECT 1 FROM invoice_returns")
    r = partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}], pin="4321")
    assert r["approved_name"] == "مشرف"


def test_partial_return_of_credit_sale_reduces_customer_balance(w):
    inv = sell(w, [item(w["oil"], 2)], [{"method": "credit", "amount": 230}], customerId=w["cu"])
    iid = str(q("SELECT id FROM invoice_items")[0]["id"])
    partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}])
    assert sum(r["amount"] for r in q("SELECT amount FROM customer_ledger")) == D("115")
    assert_balanced()


def test_full_return_blocks_later_partial_return(w):
    inv = sell(w)
    iid = str(q("SELECT id FROM invoice_items")[0]["id"])
    full_return(w, inv["id"])
    with pytest.raises(HTTPException) as e:
        partial(w, inv["id"], [{"invoiceItemId": iid, "qty": 1}])
    assert e.value.status_code == 409


# ══════════════════ الخزينة ══════════════════

def voucher(d):
    from app.modules.treasury import service
    return run(lambda: service.create_voucher(CO, str(uuid.uuid4()), d))


def test_customer_receipt_reduces_receivable_and_posts_journal(w):
    sell(w, payments=[{"method": "credit", "amount": 230}], customerId=w["cu"])
    v = voucher({"type": "receipt", "partyType": "customer", "customerId": w["cu"], "amount": 100, "method": "cash"})
    assert v["voucher_no"] == "TRV-000001" and v["amount"] == 100 and v["customer_name"] == "عميل آجل"
    assert sum(r["amount"] for r in q("SELECT amount FROM customer_ledger")) == D("130")
    j = journal("treasury_voucher")
    assert j["1011"][0] == D("100") and j["1020"][1] == D("100")
    assert_balanced()
    assert voucher({"type": "receipt", "partyType": "customer", "customerId": w["cu"], "amount": 30, "method": "card"})["voucher_no"] == "TRV-000002"
    assert journal("treasury_voucher")["1012"][0] == D("30")        # البطاقة → حساب الشبكة


def test_expense_payment_uses_category_account(w):
    voucher({"type": "payment", "partyType": "expense", "category": "إيجار", "amount": 500, "method": "transfer"})
    j = journal("treasury_voucher")
    assert j["5210"][0] == D("500") and j["1013"][1] == D("500")
    assert_balanced()


def test_supplier_payment_debits_payables(w):
    voucher({"type": "payment", "partyType": "supplier", "partyName": "مورد", "amount": 200, "method": "cash"})
    assert journal("treasury_voucher")["2020"][0] == D("200")


def test_voucher_validation(w):
    cases = [({"type": "payment", "partyType": "other", "amount": 10, "method": "cash"}, 422),                        # البيان إجباري
             ({"type": "payment", "partyType": "expense", "category": "مصروفات أخرى", "amount": 10, "method": "cash"}, 422),
             ({"type": "receipt", "partyType": "customer", "amount": 10, "method": "cash"}, 400),                      # بلا عميل
             ({"type": "receipt", "partyType": "customer", "customerId": str(uuid.uuid4()), "amount": 10, "method": "cash"}, 404)]
    for d, code in cases:
        with pytest.raises(HTTPException) as e:
            voucher(d)
        assert e.value.status_code == code, d
    assert not q("SELECT 1 FROM treasury_vouchers") and not q("SELECT 1 FROM journal_entries")


def test_cancel_voucher_reverses_everything_once(w):
    from app.modules.treasury import service
    sell(w, payments=[{"method": "credit", "amount": 230}], customerId=w["cu"])
    v = voucher({"type": "receipt", "partyType": "customer", "customerId": w["cu"], "amount": 100, "method": "cash"})
    with pytest.raises(HTTPException) as e:
        run(lambda: service.cancel_voucher(CO, w["u"], v["id"], "  "))
    assert e.value.status_code == 422
    out = run(lambda: service.cancel_voucher(CO, w["u"], v["id"], "خطأ إدخال"))
    assert out["status"] == "cancelled"
    assert sum(r["amount"] for r in q("SELECT amount FROM customer_ledger")) == D("230")     # الذمة رجعت كما كانت
    j = journal("treasury_voucher_cancel")
    assert j["1011"][1] == D("100") and j["1020"][0] == D("100")
    assert_balanced()
    with pytest.raises(HTTPException) as e:
        run(lambda: service.cancel_voucher(CO, w["u"], v["id"], "مرة ثانية"))
    assert e.value.status_code == 409
    assert len(q("SELECT 1 FROM journal_entries WHERE source_type='treasury_voucher_cancel'")) == 1


def test_today_summary_ignores_cancelled(w):
    from app.modules.treasury import service
    a = voucher({"type": "receipt", "partyType": "other", "description": "إيراد", "amount": 100, "method": "cash"})
    voucher({"type": "payment", "partyType": "expense", "category": "إيجار", "amount": 40, "method": "cash"})
    run(lambda: service.cancel_voucher(CO, w["u"], a["id"], "تجربة"))
    s = run(lambda: service.today_summary(CO))
    assert (s["receipts"], s["payments"], s["net"]) == (0, 40, -40)


def test_employee_advance_flow_and_limits(w):
    from app.modules.treasury import service
    emp = uuid.uuid4()
    q("INSERT INTO hr_employees (id, company_id, full_name, basic_salary) VALUES ($1,$2,'موظف',3000)", emp, CID)
    base = {"partyType": "employee", "employeeId": str(emp), "method": "cash"}
    with pytest.raises(HTTPException) as e:
        voucher({**base, "type": "payment", "reason": "advance", "amount": 4000, "installment": 500})     # أكبر من الراتب
    assert e.value.status_code == 422
    with pytest.raises(HTTPException) as e:
        voucher({**base, "type": "payment", "reason": "advance", "amount": 1000})                          # بلا قسط
    assert e.value.status_code == 422
    adv = voucher({**base, "type": "payment", "reason": "advance", "amount": 1000, "installment": 250})
    assert q("SELECT amount FROM employee_advances")[0]["amount"] == D("1000")
    with pytest.raises(HTTPException) as e:
        voucher({**base, "type": "receipt", "amount": 1500})                                               # سداد أكبر من الرصيد
    assert e.value.status_code == 422
    voucher({**base, "type": "receipt", "amount": 400})
    assert q("SELECT SUM(amount) AS s FROM advance_repayments")[0]["s"] == D("400")
    with pytest.raises(HTTPException) as e:                                                                # لا إلغاء لسلفة سُدّد جزء منها
        run(lambda: service.cancel_voucher(CO, w["u"], adv["id"], "إلغاء"))
    assert e.value.status_code == 409
    assert_balanced()


# ══════════════════ إغلاق أعمى: صاحب الجلسة لا يرى أي مبلغ ══════════════════

def test_shift_report_redaction_hides_every_amount(w):
    from app.modules.shifts import service as shifts
    sell(w, [item(w["oil"], 2)], [{"method": "cash", "amount": 230}])
    full = run(lambda: shifts.get_current(CO, w["u"]))
    assert full["sales"]["totalInc"] == 230 and full["cash"]["expected"] == 330        # 100 عهدة + 230 تحصيل نقدي
    red = shifts.redact_amounts(full)
    assert red["sales"] == {"invoiceCount": 1, "totalEx": 0.0, "totalVat": 0.0, "totalInc": 0.0}
    assert red["cash"] == {"opening": 0.0, "expected": 0.0, "counted": None, "difference": None}
    assert all(v == 0 for v in red["byMethod"].values()) and red["returns"]["totalInc"] == 0
    assert all(t["total"] == 0 for t in red["topItems"]) and red["shift"]["opening_cash"] == 0
    assert red["shift"]["id"] == full["shift"]["id"] and red["shift"]["branch_name"] == full["shift"]["branch_name"]   # الهوية تبقى للواجهة
    assert shifts.redact_amounts(None) is None


def test_shift_endpoints_redact_unless_branch_permission(w):
    import json
    from app.core.deps import CurrentUser
    from app.modules.shifts import api as shifts_api

    def user(perms, role="employee"):
        return CurrentUser(user_id=w["u"], company_id=CO, branch_id=None, email="c@x", full_name="كاشير", role=role, permissions=perms)
    sell(w, [item(w["oil"], 1)], [{"method": "cash", "amount": 115}])
    cashier = run(lambda: shifts_api.get_current(user(["shifts.manage_own"])))
    assert cashier["sales"]["totalInc"] == 0 and cashier["cash"]["expected"] == 0
    manager = run(lambda: shifts_api.get_current(user(["shifts.manage_own", "shifts.view_branch"])))
    assert manager["sales"]["totalInc"] == 115 and manager["cash"]["expected"] == 215
    sid = cashier["shift"]["id"]
    rep = run(lambda: shifts_api.get_report(sid, user(["shifts.manage_own"])))
    assert rep["sales"]["totalInc"] == 0
    closed = run(lambda: shifts_api.close_shift(sid, type("B", (), {"countedCash": 215, "notes": None})(), user(["shifts.manage_own"])))
    assert closed["cash"]["expected"] == 0 and closed["cash"]["difference"] is None            # لا يعرف إن كان عدّه مطابقاً
    assert q("SELECT closing_cash_counted FROM shifts")[0]["closing_cash_counted"] == D("215")  # لكن العدّ سُجّل فعلاً للمدير
