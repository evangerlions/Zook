"""Opt-in, tenant-scoped durable monitoring; observations never create fills."""
import asyncio
import json
import os
import uuid
from datetime import datetime,time
from decimal import Decimal,localcontext
from typing import Literal
from urllib.parse import urlsplit
from fastapi import Header,Query
from pydantic import Field,StrictBool,model_validator
import db
from accounts import cipher
from copilot.core import digest,encoded,fail,now,Problem
from .contracts import Contract,Identifier
from .research_tools import validate_scope
from .platform_store import ZONE,append,day,ledger,records
from .rule_screening import finite
from .rules import calendar
from .research_sources import InterfaceInput,interface_json
from .research_tools import QuoteCheck

WORKER=uuid.uuid4().hex
TABLES='''
CREATE TABLE IF NOT EXISTS investment_monitor_secrets (
    monitor_id TEXT PRIMARY KEY REFERENCES investment_objects(id),ciphertext TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS investment_monitor_runtime (
    monitor_id TEXT PRIMARY KEY REFERENCES investment_objects(id),data TEXT NOT NULL);
'''


class MonitorInput(Contract):
    account_id:Identifier|None=None
    instrument_id:Identifier
    name:str=Field(min_length=1,max_length=100)
    field:Literal['price_above','price_below','change_above','change_below','cost_above','cost_below','ma_bullish','volume_surge']
    threshold:str=Field(default='0',max_length=100)
    source:Literal['https_quotes','saved_daily']='https_quotes'
    source_label:str=Field(min_length=1,max_length=200)
    url:str=Field(default='',max_length=2048,repr=False)
    token:str=Field(default='',max_length=4096,repr=False)
    use_confirmed:StrictBool=False
    enabled:StrictBool=False
    interval_seconds:int=Field(default=300,ge=300,le=86400)
    cooldown_seconds:int=Field(default=86400,ge=60,le=604800)
    max_age_seconds:int=Field(default=120,ge=1,le=300)

    @model_validator(mode='after')
    def compatible(self):
        finite(self.threshold)
        if self.field.startswith('cost_') and self.account_id is None:raise ValueError('成本偏离监控需要真实资产投资账本。')
        if self.field in ('ma_bullish','volume_surge'):
            if self.source!='saved_daily':raise ValueError('技术条件须使用已保存盘后日线。')
        elif self.source!='https_quotes':raise ValueError('价格条件须使用本人报价接口。')
        if self.enabled and not self.use_confirmed:raise ValueError('开启前须确认来源与用途。')
        return self


class MonitorEdit(Contract):
    version:int=Field(ge=1)
    data:MonitorInput


def initialize(store,c):
    store.lock(c);c.executescript(TABLES)


def configure(store,body,key,monitor_id=None,version=None):
    public=body.model_dump(mode='json',exclude={'url','token'})
    fingerprint=digest(encoded([public,monitor_id,version,digest(body.url+'\n'+body.token)]))
    with db.connect() as c:
        initialize(store,c);old=store.replay(c,key,fingerprint)
        if old is not None:return old
        validate_scope(store,c,body.account_id);instrument=store._get(c,'instruments',body.instrument_id)
        if instrument['market'] not in ('SSE','SZSE') or instrument['kind'] not in ('stock','etf'):fail('unsupported_monitor','首版监控仅支持沪深股票和场内ETF。',422)
        previous=store._get(c,'monitors',monitor_id) if monitor_id else None
        if previous and (previous['account_id']!=body.account_id or previous['version']!=version):fail('version_conflict','监控投资账本或版本已变化。',409)
        secret=None
        if body.source=='https_quotes':
            if body.url:
                try:
                    url=urlsplit(body.url);port=url.port
                except ValueError:fail('destination_not_allowed','报价地址格式无效。',422)
                hosts=[h.strip().lower() for h in os.getenv('INVESTMENT_MARKET_HOSTS','').split(',')]
                if url.scheme!='https' or url.hostname not in hosts or url.username or url.password or url.query or url.fragment or port not in (None,443):fail('destination_not_allowed','请使用部署者已开放的公开HTTPS报价目的地，不能包含凭证、查询参数或重定向。',422)
                secret=cipher().encrypt(encoded({'url':body.url,'token':body.token}).encode()).decode()
                public['source_host']=url.hostname
            elif body.token:fail('source_required','更新凭证时请同时填写报价地址。',422)
            elif not previous or not c.execute('SELECT 1 FROM investment_monitor_secrets WHERE monitor_id=?',(monitor_id,)).fetchone():fail('source_required','请配置本人报价接口。',422)
            else:public['source_host']=previous.get('source_host')
        if previous:
            result={**previous,**public,'version':previous['version']+1,'updated_at':now()};store.save(c,'monitors',result)
        else:result=append(store,c,'monitors',public)
        if secret:c.execute('INSERT INTO investment_monitor_secrets VALUES (?,?) ON CONFLICT(monitor_id) DO UPDATE SET ciphertext=excluded.ciphertext',(result['id'],secret))
        if body.source=='saved_daily':c.execute('DELETE FROM investment_monitor_secrets WHERE monitor_id=?',(result['id'],))
        c.execute('INSERT INTO investment_monitor_runtime VALUES (?,?) ON CONFLICT(monitor_id) DO NOTHING',(result['id'],encoded({'next_at':0,'lease_until':0,'worker':None,'state':'idle','last_triggered_at':0})))
        store.remember(c,key,fingerprint,result)
        return result


def claim(store,monitor_id):
    stamp=now();epoch=int(datetime.fromisoformat(stamp).timestamp())
    with db.connect() as c:
        initialize(store,c)
        monitor=store._get(c,'monitors',monitor_id)
        if not monitor['enabled']:return None
        row=c.execute('SELECT data FROM investment_monitor_runtime WHERE monitor_id=? FOR UPDATE',(monitor_id,)).fetchone()
        runtime=json.loads(row[0])
        if runtime.get('worker') and not runtime['worker'].startswith(WORKER) and runtime.get('lease_until',0):
            runtime.update(lease_until=0,worker=None,state='interrupted',next_at=epoch+monitor['interval_seconds'])
            append(store,c,'monitor-runs',{'account_id':monitor['account_id'],'monitor_id':monitor_id,'state':'interrupted','reason':'服务重启，原轮询中断；不重放历史通知。'})
            c.execute('UPDATE investment_monitor_runtime SET data=? WHERE monitor_id=?',(encoded(runtime),monitor_id));return None
        if runtime.get('next_at',0)>epoch or runtime.get('lease_until',0)>epoch:return None
        runtime.update(next_at=epoch+monitor['interval_seconds'],lease_until=epoch+120,worker=WORKER+':'+uuid.uuid4().hex)
        c.execute('UPDATE investment_monitor_runtime SET data=? WHERE monitor_id=?',(encoded(runtime),monitor_id))
        secret=c.execute('SELECT ciphertext FROM investment_monitor_secrets WHERE monitor_id=?',(monitor_id,)).fetchone()
        return monitor,runtime,secret[0] if secret else None,stamp


def market_gate(store,monitor,stamp):
    with db.connect() as c:instrument=store._get(c,'instruments',monitor['instrument_id'])
    instant=datetime.fromisoformat(stamp).astimezone(ZONE);on=instant.date().isoformat()
    cal=calendar(instrument['market'],on,on,stamp)
    if cal['status']!='available':return instrument,'calendar_unknown'
    if not cal['sessions'].get(on):return instrument,'closed'
    if monitor['source']=='saved_daily':return instrument,None if instant.time()>=time(15,30) else 'waiting_for_close'
    minutes=instant.hour*60+instant.minute
    return instrument,None if (570<=minutes<690 or 780<=minutes<900) else 'closed'


def daily_condition(store,monitor,instrument,stamp):
    from .portfolio import quote_candidates,_expected
    with db.connect() as c:
        candidates=quote_candidates(store,c,instrument,day(stamp),monitor['account_id'])
    if len(candidates)!=1:return {'state':'unknown','reason':'盘后来源缺失或冲突'}
    source=candidates[0]
    if source['price_date']!=_expected(instrument,day(stamp)):return {'state':'stale','reason':'盘后日线尚未就绪'}
    bars=source['source_snapshot'].get('bars',[])
    on=source['price_date'];start=min((b['date'] for b in bars),default=on)
    from datetime import date,timedelta
    start=max(start,(date.fromisoformat(on)-timedelta(days=100)).isoformat())
    cal=calendar(instrument['market'],start,on,stamp)
    days=[d for d,opened in sorted(cal['sessions'].items()) if opened]
    required=20 if monitor['field']=='ma_bullish' else 6
    by_date={b['date']:b for b in bars if b['date']<=on}
    if cal['status']!='available' or len(days)<required or any(d not in by_date for d in days[-required:]):return {'state':'unknown','reason':'连续日线窗口不足'}
    window=[by_date[d] for d in days[-required:]]
    with localcontext() as ctx:
        ctx.prec=60
        if monitor['field']=='ma_bullish':
            closes=[Decimal(b['close']) for b in window];ma=lambda n:sum(closes[-n:])/n
            triggered=ma(5)>ma(10)>ma(20)
        else:
            denominator=sum(Decimal(b['volume_shares']) for b in window[:-1])
            if not denominator:return {'state':'unknown','reason':'前期成交量为零'}
            triggered=Decimal(window[-1]['volume_shares'])*5/denominator>finite(monitor['threshold'])
    return {'state':'triggered' if triggered else 'not_met','source_time':on,'snapshot':source,'triggered':triggered}


def quote_condition(store,monitor,instrument,packet,stamp):
    from .market_data import canonical_code
    body=QuoteCheck(account_id=monitor['account_id'],source_label=monitor['source_label'],use_confirmed=True,quotes=packet.get('quotes',[]) if isinstance(packet,dict) else packet)
    expected=instrument['code']+('.SH' if instrument['market']=='SSE' else '.SZ')
    quote=next((q for q in body.quotes if canonical_code(q.code)==expected),None)
    if quote is None:return {'state':'unknown','reason':'接口缺少对应证券报价'}
    instant=datetime.fromisoformat(stamp).astimezone(ZONE);age=(instant-quote.quoted_at).total_seconds()
    if age<0 or age>monitor['max_age_seconds'] or quote.quoted_at.astimezone(ZONE).date()!=instant.date():return {'state':'stale','reason':'报价过期或来自未来'}
    with localcontext() as ctx:
        ctx.prec=60;value=finite(quote.price)
        if monitor['field'].startswith('change_'):
            if quote.previous_close is None:return {'state':'unknown','reason':'缺少昨收'}
            value=(value/finite(quote.previous_close)-1)*100
        elif monitor['field'].startswith('cost_'):
            with db.connect() as c:balance=ledger(store,c,monitor['account_id'],day(stamp))[0]
            position=next((p for p in balance['positions'] if p['instrument_id']==instrument['id']),None)
            if not position or not balance['cash_verified'] or position['cost'] is None or Decimal(position['quantity'])<=0 or Decimal(position['cost'])<=0:return {'state':'unknown','reason':'缺少已核对成本或有效持仓'}
            value=(value/(Decimal(position['cost'])/Decimal(position['quantity']))-1)*100
        threshold=finite(monitor['threshold']);triggered=value>threshold if monitor['field'].endswith('above') else value<threshold
    return {'state':'triggered' if triggered else 'not_met','triggered':triggered,'source_time':quote.quoted_at.isoformat(),'snapshot':quote.model_dump(mode='json'),'actual':str(value)}


def finish(store,monitor,runtime,result,stamp):
    epoch=int(datetime.fromisoformat(stamp).timestamp())
    with db.connect() as c:
        initialize(store,c);current=store._get(c,'monitors',monitor['id'])
        stored=json.loads(c.execute('SELECT data FROM investment_monitor_runtime WHERE monitor_id=? FOR UPDATE',(monitor['id'],)).fetchone()[0])
        if stored.get('worker')!=runtime['worker']:return {'state':'superseded'}
        if current['version']!=monitor['version'] or not current['enabled']:result={'state':'cancelled','reason':'配置已变化，本次结果不触发事件。'}
        previous_state=stored.get('state');event=None
        source_time=result.get('source_time')
        if result.get('triggered'):
            if source_time==stored.get('last_source_time'):result={**result,'state':'duplicate'}
            elif epoch-stored.get('last_triggered_at',0)<monitor['cooldown_seconds']:result={**result,'state':'cooldown'}
            else:
                event=append(store,c,'monitor-events',{'account_id':monitor['account_id'],'monitor_id':monitor['id'],'monitor_version':monitor['version'],'name':monitor['name'],'field':monitor['field'],'threshold':monitor['threshold'],'observation':result,'read':False,
                    'deduplication_key':digest(encoded([monitor['id'],source_time,monitor['version']]))})
                stored['last_triggered_at']=epoch
        stored.update(state=result['state'],last_checked_at=stamp,last_result=result,lease_until=0,worker=None)
        if source_time:stored['last_source_time']=source_time
        c.execute('UPDATE investment_monitor_runtime SET data=? WHERE monitor_id=?',(encoded(stored),monitor['id']))
        if event or previous_state!=result['state'] or result['state']=='failed':
            append(store,c,'monitor-runs',{'account_id':monitor['account_id'],'monitor_id':monitor['id'],'state':result['state'],'reason':result.get('reason'),'checked_at':stamp,'event_id':event['id'] if event else None})
        return {**result,'event_id':event['id'] if event else None}


async def execute(store,monitor_id,fetcher=None):
    claimed=await asyncio.to_thread(claim,store,monitor_id)
    if not claimed:return {'state':'not_due_or_disabled'}
    monitor,runtime,encrypted,stamp=claimed
    try:
        instrument,reason=await asyncio.to_thread(market_gate,store,monitor,stamp)
        if reason:result={'state':reason}
        elif monitor['source']=='saved_daily':result=await asyncio.to_thread(daily_condition,store,monitor,instrument,stamp)
        else:
            if not encrypted:raise ValueError('Missing encrypted source')
            secret=json.loads(cipher().decrypt(encrypted.encode()).decode())
            payload=InterfaceInput(account_id=monitor['account_id'],kind='quotes',source_label=monitor['source_label'],url=secret['url'],token=secret['token'],use_confirmed=True)
            packet=await asyncio.wait_for((fetcher or interface_json)(payload),timeout=60)
            _,reason=await asyncio.to_thread(market_gate,store,monitor,now())
            result={'state':reason} if reason else await asyncio.to_thread(quote_condition,store,monitor,instrument,packet,now())
    except asyncio.CancelledError:
        await asyncio.to_thread(finish,store,monitor,runtime,{'state':'interrupted','reason':'服务停止，本轮核对中断。'},now())
        raise
    except Exception:result={'state':'failed','reason':'来源、凭证或报价格式未通过；原资料保留，不自动换源。'}
    return await asyncio.to_thread(finish,store,monitor,runtime,result,now())


def due(store):
    with db.connect() as c:
        if not c.execute("SELECT to_regclass('investment_monitor_runtime')").fetchone()[0]:return []
        epoch=int(datetime.fromisoformat(now()).timestamp())
        return [r[0] for r in c.execute("""SELECT o.id FROM investment_objects o JOIN investment_monitor_runtime r ON r.monitor_id=o.id
            WHERE o.kind='monitors' AND o.data::jsonb->>'enabled'='true' AND (r.data::jsonb->>'next_at')::bigint<=?
            ORDER BY (r.data::jsonb->>'next_at')::bigint,o.id LIMIT 20""",(epoch,))]


async def run(accounts):
    """One application-owned sweep; trusted auth identities establish tenant context."""
    from tenancy import current_user
    from .store import InvestmentStore
    import logging
    log=logging.getLogger(__name__)
    def users():
        with accounts.conn() as c:return [dict(r) for r in c.execute('SELECT id,schema_name,is_owner,github_config FROM auth_users ORDER BY id')]
    while True:
        try:
            identities=await asyncio.to_thread(users)
            for user in identities:
                token=current_user.set(user)
                try:
                    store=InvestmentStore()
                    for iid in await asyncio.to_thread(due,store):await execute(store,iid)
                except asyncio.CancelledError:raise
                except Exception:log.warning('One private investment monitoring sweep deferred',exc_info=False)
                finally:current_user.reset(token)
        except asyncio.CancelledError:raise
        except Exception:log.warning('Investment monitoring sweep deferred',exc_info=False)
        await asyncio.sleep(30)


class VersionInput(Contract):
    version:int=Field(ge=1)


def register(router,store):
    @router.get('/monitors/source-policy')
    def source_policy():return {'allowed_hosts':[h.strip() for h in os.getenv('INVESTMENT_MARKET_HOSTS','').split(',') if h.strip()],
        'default_enabled':False,'background':'服务运行期间','browser_delivery':'须授权且页面可用，不承诺关闭页面后送达。'}
    @router.post('/monitors')
    def create(body:MonitorInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        return configure(store,body,idempotency_key)

    @router.put('/monitors/{monitor_id}')
    def edit(monitor_id:str,body:MonitorEdit,idempotency_key:str=Header(min_length=1,max_length=160)):
        return configure(store,body.data,idempotency_key,monitor_id,body.version)

    @router.get('/monitors')
    def listing(account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            if not c.execute("SELECT to_regclass('investment_monitor_runtime')").fetchone()[0]:return {'items':[]}
            items=records(c,'monitors',account_id)
            for item in items:
                item['runtime']=json.loads(c.execute('SELECT data FROM investment_monitor_runtime WHERE monitor_id=?',(item['id'],)).fetchone()[0])
                item['credential_configured']=bool(c.execute('SELECT 1 FROM investment_monitor_secrets WHERE monitor_id=?',(item['id'],)).fetchone())
            return {'items':items}

    @router.post('/monitors/{monitor_id}/stop')
    def stop(monitor_id:str,body:VersionInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        record=store.get('monitors',monitor_id)
        data={k:record[k] for k in MonitorInput.model_fields if k in record};data['enabled']=False
        return configure(store,MonitorInput(**data),idempotency_key,monitor_id,body.version)

    @router.post('/monitors/{monitor_id}/check')
    async def check(monitor_id:str):return await execute(store,monitor_id)

    @router.get('/monitor-events')
    def events(account_id:str|None=None,page:int=Query(1,ge=1),page_size:int=Query(50,ge=1,le=100),unread:bool=False):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            where="kind='monitor-events' AND data::jsonb->>'account_id' IS NOT DISTINCT FROM ?"+(" AND data::jsonb->>'read'='false'" if unread else '')
            total=c.execute('SELECT COUNT(*) FROM investment_objects WHERE '+where,(account_id,)).fetchone()[0]
            items=[json.loads(r[0]) for r in c.execute('SELECT data FROM investment_objects WHERE '+where+' ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?',(account_id,page_size,(page-1)*page_size))]
            return {'items':items,'total':total,'page':page,'page_size':page_size}

    @router.post('/monitor-events/{event_id}/read')
    def read(event_id:str,body:VersionInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        fingerprint=digest(encoded([event_id,body.version]))
        with db.connect() as c:
            store.lock(c);replay=store.replay(c,idempotency_key,fingerprint)
            if replay is not None:return replay
            item=store._get(c,'monitor-events',event_id)
            if item['version']!=body.version:fail('version_conflict','提醒已更新，请刷新。',409)
            item.update(read=True,version=item['version']+1,updated_at=now());store.save(c,'monitor-events',item)
            store.remember(c,idempotency_key,fingerprint,item);return item
