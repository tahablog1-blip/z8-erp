# modules/accounting/schemas.py — عقود الإدخال والإخراج (Pydantic)
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

AccountType = Literal["asset", "liability", "equity", "revenue", "expense"]


class AccountCreate(BaseModel):
    code: str = Field(min_length=1, max_length=20)
    name: str = Field(min_length=1, max_length=150)
    type: AccountType
    parentId: str | None = None


class AccountOut(BaseModel):
    id: str
    code: str
    name: str
    type: str
    parent_id: str | None = None
    is_system: bool
    is_active: bool


class JournalLineOut(BaseModel):
    id: str
    account_id: str
    account_code: str
    account_name: str
    debit: float
    credit: float
    description: str | None = None


class JournalEntryOut(BaseModel):
    id: str
    branch_id: str | None = None
    branch_name: str | None = None
    entry_date: date
    source_type: str
    source_id: str | None = None
    description: str | None = None
    created_at: datetime
    lines: list[JournalLineOut]


class TrialBalanceRow(BaseModel):
    code: str
    name: str
    type: str
    total_debit: float
    total_credit: float
    balance: float


class TrialBalanceOut(BaseModel):
    asOf: str
    rows: list[TrialBalanceRow]
    totalDebit: float
    totalCredit: float
    balanced: bool


class IncomeRow(BaseModel):
    code: str
    name: str
    type: str
    amount: float


class IncomeStatementOut(BaseModel):
    from_: str = Field(alias="from")
    to: str
    branchId: str | None = None
    revenue: list[IncomeRow]
    expense: list[IncomeRow]
    totalRevenue: float
    totalExpense: float
    netIncome: float

    model_config = {"populate_by_name": True}


class BalanceRow(BaseModel):
    code: str
    name: str
    type: str
    balance: float


class BalanceSheetOut(BaseModel):
    asOf: str
    assets: list[BalanceRow]
    liabilities: list[BalanceRow]
    equity: list[BalanceRow]
    totalAssets: float
    totalLiabilities: float
    totalEquity: float
    currentEarnings: float
    balanced: bool
