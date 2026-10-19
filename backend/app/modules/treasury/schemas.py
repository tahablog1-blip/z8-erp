# modules/treasury/schemas.py — عقود الخزينة
from typing import Literal
from pydantic import BaseModel, Field

VoucherType = Literal["receipt", "payment"]                      # قبض / صرف
PartyType = Literal["customer", "supplier", "expense", "other"]  # الطرف
PayMethod = Literal["cash", "card", "transfer"]                  # طريقة الحركة النقدية


class VoucherCreate(BaseModel):
    vtype: VoucherType
    partyType: PartyType
    method: PayMethod = "cash"
    amount: float = Field(gt=0)
    branchId: str | None = None
    customerId: str | None = None
    supplierId: str | None = None
    partyName: str | None = None       # اسم الطرف الحر (لغير العملاء/الموردين)
    category: str | None = None        # تصنيف المصروف (إيجار/كهرباء/رواتب...)
    description: str | None = None
    voucherDate: str | None = None     # ISO — الافتراضي اليوم


class BankAccountCreate(BaseModel):
    name: str = Field(min_length=2, max_length=150)
    bankName: str | None = None
    accountNumber: str | None = None
    iban: str | None = None
    openingBalance: float = 0


class BankAccountOut(BaseModel):
    id: str
    name: str
    bank_name: str | None = None
    account_number: str | None = None
    iban: str | None = None
    account_code: str
    opening_balance: float
    balance: float          # الرصيد الحالي = الافتتاحي + الإيداعات − السحوبات
    is_active: bool
    created_at: object


class BankTxnIn(BaseModel):
    bankAccountId: str
    amount: float = Field(gt=0)
    method: PayMethod = "cash"   # من/إلى أي حساب نقدية (الصندوق عادة)
    description: str | None = None
    txnDate: str | None = None


class BankTxnOut(BaseModel):
    id: str
    bank_account_id: str
    txn_type: Literal["deposit", "withdrawal"]
    amount: float
    description: str | None = None
    reconciled: bool
    created_at: object


class StatementLineIn(BaseModel):
    bankAccountId: str
    stmtDate: str
    amount: float          # موجب = إيداع في كشف البنك، سالب = سحب
    description: str | None = None


class StatementLineOut(BaseModel):
    id: str
    bank_account_id: str
    stmt_date: object
    amount: float
    description: str | None = None
    matched_txn_id: str | None = None
    created_at: object


class MatchIn(BaseModel):
    txnId: str


class VoucherOut(BaseModel):
    id: str
    voucher_no: str
    vtype: VoucherType
    party_type: PartyType
    method: PayMethod
    amount: float
    branch_id: str | None = None
    branch_name: str | None = None
    customer_id: str | None = None
    supplier_id: str | None = None
    party_name: str | None = None
    category: str | None = None
    description: str | None = None
    voucher_date: object
    created_at: object
    created_by_name: str | None = None
    is_cancelled: bool
