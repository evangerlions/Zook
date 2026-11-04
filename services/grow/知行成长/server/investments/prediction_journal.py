"""Frozen investment forecasts, explicit future-session outcomes and local briefings."""
from datetime import date,datetime,time,timedelta
from decimal import Decimal,localcontext
from typing import Literal
from fastapi import Header
from pydantic import Field
import db
from copilot.core import digest,encoded,fail,now
from .contracts import Contract,Identifier
from .research_tools import validate_scope
from .platform_store import ZONE,append,day,records
from .portfolio import quote_candidates,_expected
from .rules import calendar


class ForecastInput(Contract):
    account_id:Identifier|None=None
    instrument_id:Identifier
    direction:Literal['up','down']
    probability:int|None=Field(default=None,ge=0,le=100)
    reason:str=Field(min_length=1,max_length=4000)
    counterevidence:str=Field(min_length=1,max_length=4000)
    source_id:Identifier|None=None
    references:list[Identifier]=Field(default_factory=list,max_length=20)


def register_forecast(store,body,key):
    data=body.model_dump(mode='json');fingerprint=digest(encoded(data));stamp=now();local=datetime.fromisoformat(stamp).astimezone(ZONE)
    cutoff=(local.date()-timedelta(days=1)).isoformat() if local.time()<time(15,30) else local.date().isoformat()
    with db.connect() as c:
        store.lock(c);replay=store.replay(c,key,fingerprint)
        if replay is not None:return replay
        validate_scope(store,c,body.account_id);instrument=store._get(c,'instruments',body.instrument_id)
        if instrument['kind'] not in ('stock','etf') or instrument['market'] not in ('SSE','SZSE'):fail('unsupported_forecast','首版仅支持沪深股票与场内ETF。',422)
        candidates=[q for q in quote_candidates(store,c,instrument,cutoff,body.account_id) if datetime.fromisoformat(q['retrieved_at'])<=local]
        selected=next((q for q in candidates if q['id']==body.source_id),None) if body.source_id else candidates[0] if len(candidates)==1 else None
        if not selected or selected['price_date']!=_expected(instrument,cutoff):fail('baseline_quote_required','缺少登记前已完成收盘价，或存在来源冲突；请先保存/选择对应行情。',422)
        source=selected['source_snapshot']
        selected={**selected,'source_snapshot':{k:v for k,v in source.items() if k in ('id','instrument_id','provider','retrieved_at','price_basis')},
            'baseline_bars':[b for b in source.get('bars',[]) if b['date']<=cutoff]}
        refs=[]
        for iid in body.references:
            row=c.execute('SELECT kind,data FROM investment_objects WHERE id=?',(iid,)).fetchone()
            if not row:fail('reference_missing','关联记录不存在。',404)
            import json
            record=json.loads(row[1])
            if row[0] not in ('watchlist','strategies','trade-plans','fills','reviews','research','screening-templates') or record.get('account_id') not in (None,body.account_id):fail('scope_mismatch','引用不属于当前投资账本。',422)
            refs.append({'id':iid,'kind':row[0],'version':record['version']})
        result=append(store,c,'investment-forecasts',{**data,'registered_at':stamp,'baseline':selected,'instrument_snapshot':instrument,'reference_versions':refs,'horizons':[1,3,5,10]})
        store.remember(c,key,fingerprint,result)
        return result


def evaluate_forecast(store,c,forecast,as_of):
    instrument=forecast['instrument_snapshot'];registered=datetime.fromisoformat(forecast['registered_at']).astimezone(ZONE)
    end=min(date.fromisoformat(as_of),(registered.date()+timedelta(days=100)))
    if end<registered.date():return [{'horizon':n,'state':'pending','reason':'尚未登记'} for n in forecast['horizons']]
    cal=calendar(instrument['market'],registered.date().isoformat(),end.isoformat(),now())
    stamp=datetime.fromisoformat(now()).astimezone(ZONE)
    sessions=[d for d,opened in sorted(cal['sessions'].items()) if opened and datetime.fromisoformat(d+'T09:30:00+08:00')>registered and (d<stamp.date().isoformat() or (d==stamp.date().isoformat() and stamp.time()>=time(15,30)))]
    snapshots=[s for s in records(c,'market-snapshots') if s.get('instrument_id')==instrument['id'] and s.get('account_id') in (None,forecast['account_id']) and s.get('price_basis') in ('unadjusted','unadjusted_user_declared')]
    if c.execute("SELECT to_regclass('investment_research_objects')").fetchone()[0]:
        import json
        for row in c.execute("SELECT data FROM investment_research_objects WHERE kind='series' AND account_id=?",(forecast['account_id'],)):
            source=json.loads(row[0]);data=source['data']
            if data['code'].split('.')[0]!=instrument['code'] or data['interval']!='day' or data['price_basis']!='unadjusted':continue
            snapshots.append({'id':source['id'],'bars':[{**b,'date':day(b['time'])} for b in data['bars']]})
    outcomes=[]
    for n in forecast['horizons']:
        result={'horizon':n,'state':'pending','correct':None}
        if cal['status']!='available':result.update(state='unknown',reason='日历未覆盖')
        elif len(sessions)>=n:
            target=sessions[n-1];matches=[]
            for source in snapshots:
                for bar in source.get('bars',[]):
                    if bar['date']==target:matches.append((source,bar))
            prices={Decimal(b['close']) for _,b in matches}
            interval=[d for d,opened in cal['sessions'].items() if opened and forecast['baseline']['price_date']<d<=target]
            interval_bars={d:[b for s in snapshots for b in s['bars'] if b['date']==d] for d in interval}
            actions_known=all(bs and any(b.get('corporate_actions_known') is True for b in bs) and
                all(Decimal(str(b.get('split_ratio','1')))==1 and Decimal(str(b.get('cash_dividend','0')))==0 for b in bs) for bs in interval_bars.values())
            if len(prices)!=1:result.update(state='unknown',reason='到期日行情缺失或来源冲突',target_date=target)
            elif not actions_known:result.update(state='unknown',reason='公司行动口径未核对',target_date=target)
            else:
                price=next(iter(prices));base=Decimal(forecast['baseline']['price'])
                correct=price>base if forecast['direction']=='up' else price<base
                result.update(state='resolved',target_date=target,price=str(price),correct=correct,source_ids=[s['id'] for s,_ in matches])
        outcomes.append(result)
    return outcomes


def evaluate_account(store,account_id,as_of,key):
    if as_of>day(now()):fail('future_evaluation','检查截止日不能晚于今天。',422)
    fingerprint=digest(encoded([account_id,as_of]))
    with db.connect() as c:
        store.lock(c);validate_scope(store,c,account_id)
        replay=store.replay(c,key,fingerprint)
        if replay is not None:return replay
        items=[{'forecast':f,'outcomes':evaluate_forecast(store,c,f,as_of)} for f in records(c,'investment-forecasts',account_id)]
        result=append(store,c,'forecast-evaluations',{'account_id':account_id,'as_of':as_of,'items':items})
        store.remember(c,key,fingerprint,result)
        return result


def calibration(store,account_id=...):
    with db.connect() as c:
        if account_id is not ...:validate_scope(store,c,account_id)
        evaluations=records(c,'forecast-evaluations',account_id) if c.execute("SELECT to_regclass('investment_objects')").fetchone()[0] else []
    latest={}
    for record in sorted(evaluations,key=lambda r:(r['as_of'],r['created_at'],r['id'])):
        for item in record['items']:
            for outcome in item['outcomes']:latest[(item['forecast']['id'],outcome['horizon'])]=(item['forecast'],outcome)
    scores=[];correct=0;resolved=0;pending=0
    for forecast,outcome in latest.values():
        if outcome['state']!='resolved':pending+=1;continue
        resolved+=1;correct+=int(outcome['correct'])
        if forecast['probability'] is not None:
            p=Decimal(forecast['probability'])/100;scores.append((p-int(outcome['correct']))**2)
    return {'resolved':resolved,'unresolved':pending,'correct':correct,'accuracy':str(Decimal(correct)/resolved) if resolved else None,
        'probability_samples':len(scores),'brier_score':str(sum(scores)/len(scores)) if scores else None,'scope':'投资预测×交易日周期；不代表实盘胜率','read_only':True}


def briefing(store,account_id,on,period):
    with db.connect() as c:
        validate_scope(store,c,account_id)
        refs=[];counts={'reconciliation':0,'expired_plans':0,'forecast_due':0,'reviews':0}
        for kind in ('ledger-notices','trade-plans','period-plans','investment-forecasts','reviews'):
            for record in records(c,kind,account_id):
                if kind=='ledger-notices' and record['status']!='open':continue
                if kind=='reviews' and record['date']!=on:continue
                if kind=='ledger-notices':counts['reconciliation']+=1
                if kind=='trade-plans' and day(record['valid_until'])<=on:counts['expired_plans']+=1
                if kind=='investment-forecasts':counts['forecast_due']+=sum(o['state']!='pending' for o in evaluate_forecast(store,c,record,on))
                if kind=='reviews':counts['reviews']+=1
                refs.append({'kind':kind,'id':record['id'],'version':record['version'],'title':record.get('title') or record.get('reason') or record.get('text','')[:100],
                    'status':record.get('state',record.get('status','registered')),'valid_until':record.get('valid_until')})
    from .workspace import health
    quality=health(store,account_id,on)
    return {'account_id':account_id,'date':on,'period':period,'generated_at':now(),'references':refs,'quality':quality,
        'counts':counts,'forecast_calibration':calibration(store,account_id),'model_called':False,'summary':f'{"持仓" if account_id else "研究证券"}价格可用 {quality["available"]}/{quality["required"]}；账实待核对 {counts["reconciliation"]}；到期计划 {counts["expired_plans"]}；预测到期周期 {counts["forecast_due"]}；当日复盘 {counts["reviews"]}。'}


class EvaluationInput(Contract):
    as_of:date


def register(router,store):
    @router.get('/forecast-baseline')
    def baseline(instrument_id:str,account_id:str|None=None):
        stamp=datetime.fromisoformat(now()).astimezone(ZONE)
        cutoff=(stamp.date()-timedelta(days=1)).isoformat() if stamp.time()<time(15,30) else stamp.date().isoformat()
        with db.connect() as c:
            validate_scope(store,c,account_id);instrument=store._get(c,'instruments',instrument_id)
            return {'cutoff':cutoff,'items':[{k:v for k,v in q.items() if k!='source_snapshot'} for q in quote_candidates(store,c,instrument,cutoff,account_id)]}
    @router.get('/forecast-evaluations')
    def evaluations(account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            return {'items':list(reversed(records(c,'forecast-evaluations',account_id)))}
    @router.post('/forecasts')
    def create(body:ForecastInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        return register_forecast(store,body,idempotency_key)
    @router.get('/forecasts')
    def listing(account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            return {'items':list(reversed(records(c,'investment-forecasts',account_id)))}
    @router.get('/briefing')
    def research_briefing(on:date,period:Literal['pre','post']='post',account_id:str|None=None):return briefing(store,account_id,on.isoformat(),period)
    @router.post('/forecasts/evaluate')
    def evaluate_research(body:EvaluationInput,account_id:str|None=None,idempotency_key:str=Header(min_length=1,max_length=160)):
        return evaluate_account(store,account_id,body.as_of.isoformat(),idempotency_key)
    @router.get('/forecast-calibration')
    def research_stats(account_id:str|None=None):return calibration(store,account_id)
    @router.post('/accounts/{account_id}/forecasts/evaluate')
    def evaluate(account_id:str,body:EvaluationInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        return evaluate_account(store,account_id,body.as_of.isoformat(),idempotency_key)
    @router.get('/accounts/{account_id}/forecast-calibration')
    def stats(account_id:str):return calibration(store,account_id)
    @router.get('/accounts/{account_id}/briefing')
    def daily_briefing(account_id:str,on:date,period:Literal['pre','post']='post'):return briefing(store,account_id,on.isoformat(),period)
