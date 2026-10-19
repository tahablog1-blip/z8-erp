# modules/treasury/api.py — سند قبض / سند صرف / مصروفات / حسابات بنكية وتسوية
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Literal

from ...core.deps import CurrentUser, require_permission
from . import service
from .schemas import (
    BankAccountCreate, BankAccountOut, BankTxnIn, BankTxnOut,
    MatchIn, StatementLineIn, StatementLineOut,
)

router = APIRouter()


class VoucherIn(BaseModel):
    type: Literal["receipt", "payment"]
    amount: float = Field(gt=0)
    method: Literal["cash", "card", "transfer"] = "cash"
    branchId: str | None = None
    # القبض: customer | other — الصرف: expense | supplier | other
    partyType: str = "other"
    customerId: str | None = None
    partyName: str | None = None
    category: str | None = None       # بند المصروف أو مصدر الإيراد
    description: str | None = None
    voucherDate: str | None = None    # ISO — الافتراضي اليوم
    employeeId: str | None = None
    reason: str | None = None         # للموظف: advance | salary
    installment: float | None = None  # القسط الشهري للسلفة
    referenceNo: str | None = None    # رقم فاتورة/إيصال مرجعي


@router.get("")
async def list_vouchers(dateFrom: str | None = None, dateTo: str | None = None,
                        type: str | None = None, includeCancelled: bool = False,
                        user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_vouchers(user.company_id, dateFrom, dateTo, type, includeCancelled)


@router.get("/summary")
async def summary(user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.today_summary(user.company_id)


@router.post("", status_code=201)
async def create_voucher(body: VoucherIn,
                         user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.create_voucher(user.company_id, user.user_id, body.model_dump())


class CancelIn(BaseModel):
    reason: str = Field(min_length=2)


@router.post("/{voucher_id}/cancel")
async def cancel_voucher(voucher_id: str, body: CancelIn,
                         user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.cancel_voucher(user.company_id, user.user_id, voucher_id, body.reason)


@router.get("/employees")
async def employees(user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_employees(user.company_id)


@router.get("/advances")
async def advances(employeeId: str | None = None,
                   user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_advances(user.company_id, employeeId)


# ══════════════════ الحسابات البنكية الحقيقية ══════════════════

@router.get("/bank-accounts", response_model=list[BankAccountOut])
async def list_bank_accounts(user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_bank_accounts(user.company_id)


@router.post("/bank-accounts", response_model=BankAccountOut, status_code=201)
async def create_bank_account(body: BankAccountCreate,
                              user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.create_bank_account(user.company_id, body.model_dump())


@router.delete("/bank-accounts/{bank_account_id}", status_code=204)
async def delete_bank_account(bank_account_id: str,
                              user: CurrentUser = Depends(require_permission("treasury.create"))):
    await service.deactivate_bank_account(user.company_id, bank_account_id)


@router.post("/bank-accounts/deposit", response_model=BankTxnOut, status_code=201)
async def deposit_to_bank(body: BankTxnIn,
                          user: CurrentUser = Depends(require_permission("treasury.create"))):
    """إيداع: تحويل نقدي من الصندوق إلى الحساب البنكي"""
    return await service.create_bank_txn(user.company_id, user.user_id, "deposit", body.model_dump())


@router.post("/bank-accounts/withdraw", response_model=BankTxnOut, status_code=201)
async def withdraw_from_bank(body: BankTxnIn,
                             user: CurrentUser = Depends(require_permission("treasury.create"))):
    """سحب: تحويل نقدي من الحساب البنكي إلى الصندوق"""
    return await service.create_bank_txn(user.company_id, user.user_id, "withdrawal", body.model_dump())


@router.get("/bank-accounts/{bank_account_id}/transactions", response_model=list[BankTxnOut])
async def list_bank_txns(bank_account_id: str, onlyUnreconciled: bool = False,
                         user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_bank_txns(user.company_id, bank_account_id, onlyUnreconciled)


@router.get("/bank-accounts/{bank_account_id}/reconciliation")
async def reconciliation_summary(bank_account_id: str,
                                 user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.reconciliation_summary(user.company_id, bank_account_id)


# ══════════════════ التسوية البنكية (كشف حساب ↔ حركات النظام) ══════════════════

@router.get("/bank-accounts/{bank_account_id}/statement-lines", response_model=list[StatementLineOut])
async def list_statement_lines(bank_account_id: str, onlyUnmatched: bool = False,
                               user: CurrentUser = Depends(require_permission("treasury.view", "treasury.create"))):
    return await service.list_statement_lines(user.company_id, bank_account_id, onlyUnmatched)


@router.post("/statement-lines", response_model=StatementLineOut, status_code=201)
async def add_statement_line(body: StatementLineIn,
                             user: CurrentUser = Depends(require_permission("treasury.create"))):
    """إضافة سطر من كشف حساب البنك يدوياً (مبلغ موجب = إيداع، سالب = سحب) لمطابقته بحركة النظام"""
    return await service.add_statement_line(user.company_id, body.model_dump())


@router.post("/statement-lines/{line_id}/match", response_model=BankTxnOut)
async def match_statement_line(line_id: str, body: MatchIn,
                               user: CurrentUser = Depends(require_permission("treasury.create"))):
    return await service.match_statement_line(user.company_id, line_id, body.txnId)


@router.post("/statement-lines/{line_id}/unmatch", status_code=204)
async def unmatch_statement_line(line_id: str,
                                 user: CurrentUser = Depends(require_permission("treasury.create"))):
    await service.unmatch_statement_line(user.company_id, line_id)
