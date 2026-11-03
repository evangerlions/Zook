"""Versioned recipes over the existing private bounded screening journal."""
from datetime import date,timedelta
from fastapi import Header
from pydantic import Field, StrictBool
import db
from copilot.core import digest,encoded,fail,now
from .contracts import Contract,Identifier
from .platform_store import append,records
from .portfolio import quote_candidates
from .rule_screening import RuleRecipe,evaluate_recipe
from .rules import calendar
from .research_history import BacktestInput,run_backtest
from .research_tools import ResearchTools,validate_scope

CATALOG=[{'kind':kind,'name':name,'purpose':purpose,'required_window':window,'version':1,
    'defaults':RuleRecipe(kind=kind).model_dump(),'limits':['示例阈值可修改，不证明策略有效。','缺目标日状态或连续交易日资料时保持未知。','仅生成研究结果，不新增真实持仓。']}
    for kind,name,purpose,window in [('ma_bullish','均线多头','MA5/10/20排列且向上',21),('pullback','缩量回调','趋势内回调与量能缩减',21),('volume_breakout','放量突破','相对前5日放量并接近窗口高点',21),('return_window','N交易日涨幅','指定完整交易日价格变化',21)]]


class EvaluateInput(Contract):
    version:int=Field(ge=1)
    as_of:date
    sources:dict[Identifier,Identifier]=Field(default_factory=dict,max_length=20)


class StatusInput(Contract):
    account_id:Identifier|None=None
    instrument_id:Identifier
    as_of:date
    is_st:StrictBool|None=None
    suspended:StrictBool|None=None
    source_label:str=Field(min_length=1,max_length=500)
    confirmed:StrictBool


class ExperimentInput(Contract):
    request:BacktestInput
    stopped:StrictBool=False


def experiment(store,body,key):
    from copilot.core import Problem
    data=body.model_dump(mode='json');fingerprint=digest(encoded(data))
    request=body.request
    if not request.template_id or request.template_version is None:fail('template_required','请选择模板及版本。',422)
    with db.connect() as c:
        store.lock(c);replay=store.replay(c,key,fingerprint)
        if replay is not None:return store._get(c,'template-experiments',replay['id'])
        template=store._get(c,'screening-templates',request.template_id)
        if template['account_id']!=request.account_id or template['version']!=request.template_version:fail('template_changed','模板版本或投资账本不一致。',409)
        record=append(store,c,'template-experiments',{'account_id':request.account_id,'template_snapshot':template,'request':data,'state':'stopped' if body.stopped else 'running','worker':WORKER,'result_id':None})
        store.remember(c,key,fingerprint,{'id':record['id']})
    if body.stopped:return record
    try:
        result=run_backtest(ResearchTools(store),request,'template-backtest-'+record['id'])
        update={'state':'ready' if result['data']['result']['metrics'] is not None else 'incomplete','result_id':result['id'],'result_snapshot':result}
    except Problem as error:update={'state':'failed','reason':error.message,'error':error.code}
    except Exception:update={'state':'failed','reason':'实验执行失败，原始请求保留；不会自动重跑。'}
    with db.connect() as c:
        store.lock(c);record={**record,**update,'version':record['version']+1,'updated_at':now()}
        store.save(c,'template-experiments',record)
    return record


WORKER=__import__('uuid').uuid4().hex


def evaluate(store,template_id,payload,key):
    fingerprint=digest(encoded([template_id,payload.model_dump(mode='json')]))
    with db.connect() as c:
        store.lock(c)
        replay=store.replay(c,key,fingerprint)
        if replay is not None:return replay
        template=store._get(c,'screening-templates',template_id)
        if template['version']!=payload.version:fail('version_conflict','模板已变更，请重新载入。',409)
        if not template.get('recipe') or not template['enabled']:fail('recipe_unavailable','请选择已启用的规则模板。',422)
        on=payload.as_of.isoformat();evaluations=[];inputs=[]
        statuses=records(c,'security-status',template['account_id'])
        if set(payload.sources)-set(template['instrument_ids']):fail('scope_mismatch','来源选择超出模板股票池。',422)
        for iid in template['instrument_ids']:
            instrument=store._get(c,'instruments',iid)
            candidates=quote_candidates(store,c,instrument,on,template['account_id'])
            selected=next((s for s in candidates if s['id']==payload.sources.get(iid)),None)
            if iid in payload.sources and not selected:fail('source_changed','所选行情来源不匹配。',409)
            if not selected and len(candidates)==1:selected=candidates[0]
            if not selected:
                evaluations.append({'instrument_id':iid,'name':instrument['name'],'code':instrument['code'],'status':'unknown','details':[{'field':'source','result':None,'reason':'缺少来源或多来源冲突，请选择来源'}],'candidates':[{k:v for k,v in q.items() if k!='source_snapshot'} for q in candidates]});continue
            snapshot=selected['source_snapshot']
            bars=[b for b in snapshot.get('bars',[]) if b['date']<=on]
            start=min((b['date'] for b in bars),default=on)
            if (payload.as_of-date.fromisoformat(start)).days>369:start=(payload.as_of-timedelta(days=369)).isoformat()
            cal=calendar(instrument['market'],start,on,now())
            status=next((s for s in reversed(statuses) if s['instrument_id']==iid and s['as_of']==on),{})
            item={**instrument,'instrument_id':iid,'price_basis':snapshot.get('price_basis'),'bars':bars,'calendar':cal,'security_status':status}
            evaluations.append(evaluate_recipe(item,{**template['screen'],'as_of':on},template['recipe']))
            inputs.append({'instrument':instrument,'snapshot':snapshot,'security_status':status,'calendar':cal})
        result=append(store,c,'template-evaluations',{'account_id':template['account_id'],'template_snapshot':template,
            'as_of':on,'inputs':inputs,'evaluations':evaluations,'matched':sum(e['status']=='matched' for e in evaluations),
            'unknown':sum(e['status']=='unknown' for e in evaluations),'algorithm':'bounded-recipes-v1','historical_knowledge_verified':False})
        store.remember(c,key,fingerprint,result)
        return result


def register(router,store):
    @router.get('/rule-recipes')
    def catalog():return {'items':CATALOG}

    @router.post('/template-experiments')
    def run_experiment(body:ExperimentInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        return experiment(store,body,idempotency_key)

    @router.get('/template-experiments')
    def experiments(account_id:str|None=None):
        with db.connect() as c:
            store.lock(c);validate_scope(store,c,account_id)
            items=records(c,'template-experiments',account_id)
            for item in items:
                if item['state']=='running' and item['worker']!=WORKER:
                    item.update(state='interrupted',version=item['version']+1,updated_at=now(),reason='服务已重启，实验不会自动重跑。')
                    store.save(c,'template-experiments',item)
            return {'items':list(reversed(items))}

    @router.post('/screening-templates/{template_id}/evaluate')
    def run(template_id:str,body:EvaluateInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        return evaluate(store,template_id,body,idempotency_key)

    @router.get('/template-evaluations')
    def history(account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            return {'items':list(reversed(records(c,'template-evaluations',account_id)))}

    @router.post('/security-status')
    def status(body:StatusInput,idempotency_key:str=Header(min_length=1,max_length=160)):
        data=body.model_dump(mode='json');fingerprint=digest(encoded(data))
        if not body.confirmed:fail('confirmation_required','请本人核对资料。',422)
        with db.connect() as c:
            store.lock(c);replay=store.replay(c,idempotency_key,fingerprint)
            if replay is not None:return replay
            validate_scope(store,c,body.account_id);store._get(c,'instruments',body.instrument_id)
            result=append(store,c,'security-status',data);store.remember(c,idempotency_key,fingerprint,result)
            return result
