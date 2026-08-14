# modules/accounting/api.py — طبقة الـ HTTP: مسارات + صلاحيات فقط
from fastapi import APIRouter, Depends, Query

from ...core.deps import CurrentUser, require_permission, require_role
from . import service
from .schemas import (
    AccountCreate, AccountOut, BalanceSheetOut, IncomeStatementOut,
    JournalEntryOut, TrialBalanceOut,
)

router = APIRouter()
_VIEW = "accounting.view_reports"


@router.get("/accounts", response_model=list[AccountOut])
async def list_accounts(user: CurrentUser = Depends(require_permission(_VIEW))):
    return await service.list_accounts(user.company_id)


@router.post("/accounts", response_model=AccountOut, status_code=201)
async def create_account(body: AccountCreate, user: CurrentUser = Depends(require_role("admin"))):
    """إضافة حساب فرعي مخصص — مقصور على مدير النظام"""
    return await service.create_account(user.company_id, body.code, body.name, body.type, body.parentId)


@router.delete("/accounts/{account_id}", status_code=204)
async def delete_account(account_id: str, user: CurrentUser = Depends(require_role("admin"))):
    """حذف حساب مخصص — لا يمكن حذف حسابات النظام الأساسية"""
    await service.delete_account(user.company_id, account_id)


@router.get("/journal", response_model=list[JournalEntryOut])
async def list_journal(date_from: str | None = Query(default=None, alias="from"),
                       date_to: str | None = Query(default=None, alias="to"),
                       branchId: str | None = Query(default=None),
                       sourceType: str | None = Query(default=None),
                       limit: int = Query(default=100, ge=1, le=300),
                       user: CurrentUser = Depends(require_permission(_VIEW))):
    return await service.list_journal(user.company_id, date_from, date_to, branchId, sourceType, limit)


@router.get("/trial-balance", response_model=TrialBalanceOut)
async def trial_balance(asOf: str | None = Query(default=None),
                        user: CurrentUser = Depends(require_permission(_VIEW))):
    return await service.trial_balance(user.company_id, asOf)


@router.get("/income-statement", response_model=IncomeStatementOut)
async def income_statement(date_from: str | None = Query(default=None, alias="from"),
                           date_to: str | None = Query(default=None, alias="to"),
                           branchId: str | None = Query(default=None),
                           user: CurrentUser = Depends(require_permission(_VIEW))):
    return await service.income_statement(user.company_id, date_from, date_to, branchId)


@router.get("/balance-sheet", response_model=BalanceSheetOut)
async def balance_sheet(asOf: str | None = Query(default=None),
                        user: CurrentUser = Depends(require_permission(_VIEW))):
    return await service.balance_sheet(user.company_id, asOf)
