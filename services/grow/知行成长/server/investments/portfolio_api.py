"""Typed private baseline and daily valuation HTTP interfaces."""
from datetime import date
from fastapi import Header, Query
from pydantic import Field
import db
from copilot.core import digest, encoded, fail, now
from .contracts import AccountInput, Contract, Identifier, Positive
from .platform_store import append
from . import portfolio


class BaselineInput(Contract):
    version:int=Field(ge=1)
    data:AccountInput
    reason:str=Field(min_length=1,max_length=2000)
    preview_hash:str|None=Field(default=None,min_length=64,max_length=64)


class ValuationInput(Contract):
    date:date
    sources:dict[Identifier,Identifier]=Field(default_factory=dict,max_length=100)
    preview_hash:str|None=Field(default=None,min_length=64,max_length=64)


class FundNAVInput(Contract):
    account_id:Identifier
    instrument_id:Identifier
    nav:Positive
    nav_date:date
    source_label:str=Field(min_length=1,max_length=200)
    confirmed:bool


def register(router,store):
    @router.post('/accounts/opening-preview')
    def opening_preview(body:AccountInput):
        data=body.model_dump(mode='json')
        with db.connect() as c:store.references(c,'accounts',data)
        return {'data':data,'balance':portfolio.reconcile(data['opening_cash'],[],[],opening_positions=data['opening_positions'])}

    @router.post('/accounts/{account_id}/baseline/preview')
    def baseline_preview(account_id:str,body:BaselineInput):
        return portfolio.baseline_preview(store,account_id,body.version,body.data.model_dump(mode='json'),body.reason)

    @router.post('/accounts/{account_id}/baseline')
    def baseline_commit(account_id:str,body:BaselineInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        if not body.preview_hash:fail('preview_required','请先预览基准核对影响。',422)
        return portfolio.correct_baseline(store,account_id,body.version,body.data.model_dump(mode='json'),body.reason,body.preview_hash,idempotency_key)

    @router.post('/accounts/{account_id}/valuations/preview')
    def valuation_preview(account_id:str,body:ValuationInput):
        return portfolio.valuation_preview(store,account_id,body.date.isoformat(),body.sources)

    @router.post('/accounts/{account_id}/valuations')
    def valuation_commit(account_id:str,body:ValuationInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        if not body.preview_hash:fail('preview_required','请先预览估值及来源。',422)
        return portfolio.save_valuation(store,account_id,body.date.isoformat(),body.sources,body.preview_hash,idempotency_key)

    @router.get('/accounts/{account_id}/valuations')
    def valuations(account_id:str,page:int|None=Query(None,ge=1),page_size:int=Query(50,ge=1,le=100),summary:bool=False):
        return portfolio.valuation_history(store,account_id,page=page,page_size=page_size,summary=summary)

    @router.get('/accounts/{account_id}/valuations/{valuation_id}')
    def valuation_detail(account_id:str,valuation_id:str):return portfolio.valuation_detail(store,account_id,valuation_id)

    @router.get('/accounts/{account_id}/performance')
    def performance(account_id:str,start:date,end:date,summary:bool=False):return portfolio.performance(store,account_id,start.isoformat(),end.isoformat(),summary=summary)

    @router.post('/fund-nav')
    def fund_nav(body:FundNAVInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        data=body.model_dump(mode='json');fingerprint=digest(encoded(data))
        if not body.confirmed or body.nav_date.isoformat()>portfolio.day(now()):fail('invalid_nav','请核对已公布净值及其日期。',422)
        with db.connect() as c:
            store.lock(c)
            replay=store.replay(c,idempotency_key,fingerprint)
            if replay is not None:return replay
            store._get(c,'accounts',body.account_id)
            if store._get(c,'instruments',body.instrument_id)['kind']!='fund':fail('invalid_nav','此处仅用于场外基金。',422)
            result=append(store,c,'fund-nav',{**data,'retrieved_at':now()})
            store.remember(c,idempotency_key,fingerprint,result)
            return result
