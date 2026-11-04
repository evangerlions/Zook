"""Audited opening facts and provenance-bound economic-date valuations."""
from datetime import date, datetime, timedelta
from decimal import Decimal, localcontext
import json

import db
from copilot.core import digest, encoded, fail, now
from .accounting import number, reconcile
from .platform_store import ZONE, append, day, ledger, records
from .platform_store import ledger_inputs
from db_read_pool import retry_read


def _baseline(store,c,account_id,version,data,reason):
    old=store._get(c,'accounts',account_id)
    if old['version']!=version:fail('version_conflict','投资账本基准已更新，请重新核对。',409)
    if not reason.strip():fail('reason_required','请填写核对原因。',422)
    candidate={**old,**store.validate('accounts',data)}
    store.references(c,'accounts',candidate)
    on=max([old['baseline_date'],candidate['baseline_date']]+[day(r['executed_at']) for r in records(c,'fills',account_id)]+[day(r['occurred_at']) for r in records(c,'cash-events',account_id)])
    before,_,old_hash=ledger(store,c,account_id,on)
    after,_,_=ledger(store,c,account_id,on,candidate)
    body={'account_id':account_id,'version':version,'data':data,'reason':reason,'ledger_hash':old_hash,'before':before,'after':after}
    return {**body,'preview_hash':digest(encoded(body))}


def baseline_preview(store,account_id,version,data,reason):
    with db.connect() as c:
        store.lock(c)
        return _baseline(store,c,account_id,version,data,reason)


def correct_baseline(store,account_id,version,data,reason,preview_hash,key):
    fingerprint=digest(encoded([account_id,version,data,reason,preview_hash]))
    with db.connect() as c:
        store.lock(c)
        replay=store.replay(c,key,fingerprint)
        if replay is not None:return replay
        preview=_baseline(store,c,account_id,version,data,reason)
        if preview['preview_hash']!=preview_hash:fail('preview_changed','核对后账本已变化，请重新预览。',409)
        old=store._get(c,'accounts',account_id)
        corrected={**old,**store.validate('accounts',data),'version':version+1,'updated_at':now(),'correction_reason':reason,'baseline_preview':preview}
        store.save(c,'accounts',corrected)
        c.execute('UPDATE investment_accounts SET opening_cash=?,baseline_date=? WHERE id=?',(corrected['opening_cash'],corrected['baseline_date'],account_id))
        store.remember(c,key,fingerprint,corrected)
        return corrected


def _expected(instrument,on):
    from .rules import calendar
    end=date.fromisoformat(on)
    cal=calendar(instrument['market'],(end-timedelta(days=31)).isoformat(),on,now())
    sessions=[d for d,opened in cal['sessions'].items() if opened]
    return max(sessions) if sessions else None


def quote_candidates(store,c,instrument,on,account_id,*,sources=None):
    candidates=[]
    if sources is None:
        sources=records(c,'fund-nav',account_id) if instrument['kind']=='fund' else records(c,'market-snapshots')
    for source in sources:
        if source.get('instrument_id')!=instrument['id'] or source.get('account_id') not in (None,account_id):continue
        if instrument['kind']=='fund':
            bars=[{'date':source['nav_date'],'close':source['nav']}]
        elif source.get('price_basis') in ('unadjusted','unadjusted_user_declared'):
            bars=source.get('bars',[])
        else:continue
        eligible=[bar for bar in bars if bar.get('date','9999')<=on]
        if not eligible:continue
        bar=max(eligible,key=lambda b:b['date'])
        candidates.append({'id':source['id'],'price':bar['close'],'price_date':bar['date'],
            'source':source.get('declared_source') or source.get('provider') or source.get('source_label'),
            'retrieved_at':source.get('retrieved_at',source['created_at']),'price_basis':source.get('price_basis','confirmed_nav'),
            'source_hash':digest(encoded(source)),'source_snapshot':source})
    if not candidates:return []
    latest=max(q['price_date'] for q in candidates)
    return [q for q in candidates if q['price_date']==latest]


def _valuation(store,c,account_id,on,choices,*,inputs=None):
    stamp=datetime.fromisoformat(now()).astimezone(ZONE)
    if on>stamp.date().isoformat() or (on==stamp.date().isoformat() and (stamp.hour,stamp.minute)<(15,30)):
        fail('incomplete_day','只能生成已完成日期的盘后估值。',422)
    balance,facts,ledger_hash=ledger(store,c,account_id,on,inputs=inputs)
    marks={};quotes=[]
    held={p['instrument_id'] for p in balance['positions'] if Decimal(p['quantity'])>0}
    if set(choices)-held:fail('scope_mismatch','来源选择不属于当前持仓。',422)
    instruments={}
    if held:
        instruments={r['id']:json.loads(r['data']) for r in c.execute("SELECT id,data FROM investment_objects WHERE kind='instruments' AND id=ANY(?::text[])",(list(held),))}
    prices={}
    if any(i['kind']!='fund' for i in instruments.values()):prices['market-snapshots']=records(c,'market-snapshots')
    if any(i['kind']=='fund' for i in instruments.values()):prices['fund-nav']=records(c,'fund-nav',account_id)
    for iid in sorted(held):
        instrument=instruments.get(iid) or store._get(c,'instruments',iid)
        candidates=quote_candidates(store,c,instrument,on,account_id,sources=prices.get('fund-nav' if instrument['kind']=='fund' else 'market-snapshots',[]))
        expected=_expected({**instrument,'market':'SSE' if instrument['kind']=='fund' else instrument['market']},on)
        selected=next((q for q in candidates if q['id']==choices.get(iid)),None)
        if iid in choices and selected is None:fail('source_changed','所选来源不属于此证券/日期，请重新预览。',409)
        if not selected and len(candidates)==1:selected=candidates[0]
        status='missing' if not candidates else 'conflict' if selected is None else 'calendar_unknown' if expected is None else 'stale' if selected['price_date']!=expected else 'available'
        if status=='available':marks[iid]=selected['price']
        quotes.append({'instrument_id':iid,'name':instrument['name'],'status':status,'expected_session':expected,'selected':selected,'candidates':candidates})
    calculated=reconcile(facts['account']['opening_cash'],facts['events'],facts['fills'],opening_positions=facts['account']['opening_positions'],marks=marks)
    from .reconciliation import apply_notices
    apply_notices(c,account_id,calculated,active=[n for n in facts['notices'] if n['status']=='open'])
    values=[p['market_value'] for p in calculated['positions']]
    holdings=number(sum((Decimal(v) for v in values),Decimal(0))) if all(v is not None for v in values) else None
    body={'holdings_value':holdings,'account_id':account_id,'date':on,'ledger_hash':ledger_hash,'balance':calculated,'quotes':quotes,
        'coverage':{'required':len(held),'available':len(marks),'missing':len(held)-len(marks)},
        'method':'current_audited_facts_by_economic_date','ledger_versions':{r['id']:r['version'] for r in [facts['account'],*facts['fills'],*facts['events'],*facts['notices']]}}
    return {**body,'preview_hash':digest(encoded(body))}


@retry_read
def valuation_preview(store,account_id,on,choices):
    with db.connect(readonly=True) as c:
        return _valuation(store,c,account_id,on,choices,inputs=ledger_inputs(store,c,account_id))


def save_valuation(store,account_id,on,choices,preview_hash,key):
    fingerprint=digest(encoded([account_id,on,choices,preview_hash]))
    with db.connect() as c:
        store.lock(c)
        replay=store.replay(c,key,fingerprint)
        if replay is not None:return replay
        result=_valuation(store,c,account_id,on,choices)
        if result['preview_hash']!=preview_hash:fail('preview_changed','账本或来源已变化，请重新预览。',409)
        record=append(store,c,'valuations',result)
        store.remember(c,key,fingerprint,record)
        return record


def _valuation_history(store,c,account_id,inputs):
    items=inputs['valuations']
    hashes={}
    for record in items:
        on=record['date']
        if on not in hashes:
            try:hashes[on]=ledger(store,c,account_id,on,inputs=inputs)[2]
            except Exception as error:
                from copilot.core import Problem
                if not isinstance(error,Problem):raise
                hashes[on]=None
        record['stale']=record['ledger_hash']!=hashes[on]
    return {'items':list(reversed(items))}


@retry_read
def valuation_history(store,account_id,*,page=None,page_size=50,summary=False):
    with db.connect(readonly=True) as c:
        inputs=ledger_inputs(store,c,account_id,('valuations',),summary=summary)
        total=len(inputs['valuations'])
        if page is not None:
            ordered=list(reversed(inputs['valuations']))[(page-1)*page_size:page*page_size]
            inputs['valuations']=list(reversed(ordered))
        result=_valuation_history(store,c,account_id,inputs)
        if page is not None:result.update(total=total,page=page,page_size=page_size)
        return result


@retry_read
def valuation_detail(store,account_id,valuation_id):
    with db.connect(readonly=True) as c:
        inputs=ledger_inputs(store,c,account_id)
        item=store._get(c,'valuations',valuation_id)
        if item['account_id']!=account_id:fail('not_found','投资记录不存在。',404)
        inputs['valuations']=[item]
        return _valuation_history(store,c,account_id,inputs)['items'][0]


@retry_read
def performance(store,account_id,start,end,*,summary=False):
    if start>end or (date.fromisoformat(end)-date.fromisoformat(start)).days>366:
        fail('invalid_period','请选择最多366天的有效统计区间。',422)
    with db.connect(readonly=True) as c:
        inputs=ledger_inputs(store,c,account_id,('valuations',),summary=summary)
        inputs['valuations']=[v for v in inputs['valuations'] if start<=v['date']<=end]
        history=_valuation_history(store,c,account_id,inputs)['items']
        events=[r for r in inputs['cash-events'] if start<day(r['occurred_at'])<=end]
    latest={}
    for item in history:
        if start<=item['date']<=end:latest.setdefault(item['date'],item)
    first,last=latest.get(start),latest.get(end)
    with localcontext() as ctx:
        ctx.prec=60
        sums={kind:sum((Decimal(e['amount']) for e in events if e['kind']==kind),Decimal(0)) for kind in ('deposit','withdrawal','dividend','interest','fee')}
        net=sums['deposit']-sums['withdrawal']
        valid=lambda item: item and not item['stale'] and item['balance']['equity'] is not None
        profit=Decimal(last['balance']['equity'])-Decimal(first['balance']['equity'])-net if valid(first) and valid(last) else None
        from .rules import calendar
        cal=calendar('SSE',start,end,now())
        required={start,end}|{d for d,opened in cal['sessions'].items() if opened}
        continuous=cal['status']=='available' and required.issubset(latest) and all(valid(latest[d]) for d in required)
        drawdown=None
        if continuous and not any(e['kind'] in ('deposit','withdrawal') for e in events):
            values=[Decimal(latest[d]['balance']['equity']) for d in sorted(required)]
            if min(values)>0:
                peak=values[0];drawdown=Decimal(0)
                for value in values:
                    peak=max(peak,value);drawdown=max(drawdown,(peak-value)/peak*100)
        ordered=[latest[d] for d in sorted(latest)]
        changes={current['id']:{'since':previous['date'],'amount':number(Decimal(current['balance']['equity'])-Decimal(previous['balance']['equity'])) if valid(previous) and valid(current) else None} for previous,current in zip(ordered,ordered[1:])}
        return {'asset_changes':changes,'start':start,'end':end,'net_profit':number(profit),'net_deposit':number(net),
            'cash_components':{k:number(v) for k,v in sums.items()},'maximum_drawdown_pct':number(drawdown),
            'series':[latest[d] for d in sorted(latest)],'twr':None,'xirr':None,
            'limitations':['收益金额=期末资产−期初资产−期间净入金；并非收益率。',
                '只有无外部资金流、完整连续且正资产的区间才展示回撤；缺估值、账本已更正或缺费用时保持未知。']}
