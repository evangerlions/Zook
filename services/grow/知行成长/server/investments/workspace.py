"""View-scoped summaries, independent module recovery and source quality disclosure."""
from datetime import date
import db
from db_read_pool import retry_read
from copilot.core import Problem, now
from .platform_store import day, ledger, records
from .portfolio import quote_candidates, _expected


# Shared identity resources never acquire a ledger filter. All other lists do.
GLOBAL_KINDS = ('accounts', 'instruments', 'strategies', 'plan-checks')
VIEWS = {
    'market': {'instruments':'instruments'},
    'screen': {'instruments':'instruments'},
    'assets': {'instruments':'instruments'},
    'research': {'instruments':'instruments','watchlist':'watches','dossiers':'dossiers','research':'research'},
    'budget': {'instruments':'instruments','strategies':'strategies','plan-checks':'checks','trade-plans':'plans','policies':'policies','period-plans':'periods'},
    'analysis': {'instruments':'instruments','research':'research','dossiers':'dossiers','trade-plans':'plans','reviews':'reviews','policies':'policies'},
}
BASE = {'instruments':'instruments','strategies':'strategies','plan-checks':'checks','trade-plans':'plans'}
VIEWS.update({
    'today': {**BASE,'policies':'policies','period-plans':'periods','watchlist':'watches','dossiers':'dossiers','research':'research'},
    'ledger': {**BASE,'fills':'fills','fund-orders':'fundOrders','ledger-notices':'notices'},
    'review': {**BASE,'reviews':'reviews','principles':'principles'},
})


def read_lists(c, kinds, account_id, limit=100):
    """One bounded batch, with exact per-kind totals even beyond the first page."""
    import json
    result = {kind:{'items':[], 'total':0} for kind in kinds}
    rows = c.execute("""WITH ranked AS (
        SELECT kind,data,id,COUNT(*) OVER (PARTITION BY kind) AS total,
            ROW_NUMBER() OVER (PARTITION BY kind ORDER BY created_at DESC,id DESC) AS position
        FROM investment_objects WHERE kind=ANY(?::text[])
        AND (kind=ANY(?::text[]) OR data::jsonb->>'account_id' IS NOT DISTINCT FROM ?)
    ) SELECT kind,CASE WHEN kind IN ('dossiers','principles')
        THEN (data::jsonb-'source_snapshots')::text ELSE data END AS data,total
        FROM ranked WHERE position<=? ORDER BY kind,position""",
        (list(kinds), list(GLOBAL_KINDS), account_id, limit))
    for row in rows:
        result[row['kind']]['items'].append(json.loads(row['data']))
        result[row['kind']]['total'] = row['total']
    return result


@retry_read
def workspace(store,account_id=None,view='today'):
    mapping = VIEWS[view]
    result={'accounts':[], 'accountId':account_id, 'errors':{}, 'totals':{}}
    with db.connect(readonly=True) as c:
        # A read never takes the write advisory lock or mixes ledger revisions.
        c.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY; SAVEPOINT workspace_batch')
        selected = store._get(c,'accounts',account_id) if account_id else None
        kinds = ['accounts', *mapping]
        try:
            lists=read_lists(c,kinds,account_id)
        except (Problem,db.psycopg2.Error):
            c.execute('ROLLBACK TO SAVEPOINT workspace_batch')
            lists={}
            for kind in kinds:
                c.execute('SAVEPOINT workspace_module')
                try: lists.update(read_lists(c,[kind],account_id))
                except (Problem,db.psycopg2.Error):
                    c.execute('ROLLBACK TO SAVEPOINT workspace_module')
                    lists[kind]={'items':[], 'total':0}
                    result['errors'][kind]='读取失败，请刷新此视图重试。'
                finally: c.execute('RELEASE SAVEPOINT workspace_module')
        # The outer savepoint ends with this read transaction. Releasing it on
        # the success path would cost another remote round trip for no effect.
        result['accounts']=lists['accounts']['items']
        if selected and not any(a['id']==selected['id'] for a in result['accounts']):result['accounts'].append(selected)
        for kind,prop in mapping.items():
            result[prop]=lists[kind]['items'];result['totals'][kind]=lists[kind]['total']
        if selected:
            calls={}
            if view in ('today','ledger','review'):calls['balance']=lambda:store._balance(c,account_id,{})
            if view in ('today','ledger','review','analysis'):calls['campaigns']=lambda:store._campaigns(c,account_id)
            if view in ('today','budget'):
                from .planning import policy_status_in
                calls['capital']=lambda:policy_status_in(store,c,account_id,day(now()),balance=result.get('balance'))
            for prop,call in calls.items():
                c.execute('SAVEPOINT workspace_summary')
                try: result[prop]=call()
                except (Problem,db.psycopg2.Error):
                    c.execute('ROLLBACK TO SAVEPOINT workspace_summary')
                    result[prop]=[] if prop=='campaigns' else None
                    result['errors'][prop]='读取失败，请刷新此视图重试。'
                finally:c.execute('RELEASE SAVEPOINT workspace_summary')
    return result


def health(store,account_id,on):
    from .readiness import requirements
    with db.connect() as c:
        if account_id:
            balance,_,_=ledger(store,c,account_id,on)
            instruments=[store._get(c,'instruments',p['instrument_id']) for p in balance['positions'] if p['quantity']!='0']
        else:
            instruments=records(c,'instruments')
        items=[]
        for instrument in instruments:
            quotes=quote_candidates(store,c,instrument,on,account_id)
            expected=_expected({**instrument,'market':'SSE' if instrument['kind']=='fund' else instrument['market']},on)
            status='missing' if not quotes else 'conflict' if len(quotes)>1 else 'calendar_unknown' if expected is None else 'stale' if quotes[0]['price_date']!=expected else 'available'
            items.append({'instrument':instrument,'status':status,'expected_session':expected,
                'sources':[{k:v for k,v in q.items() if k!='source_snapshot'} for q in quotes]})
        import json
        failed=[json.loads(r[0]) for r in c.execute("SELECT data FROM investment_objects WHERE kind='monitor-runs' AND data::jsonb->>'account_id'=? AND data::jsonb->>'state' IN ('failed','interrupted') ORDER BY created_at DESC,id DESC LIMIT 20",(account_id,))]
    available=sum(i['status']=='available' for i in items)
    return {'account_id':account_id,'date':on,'scope':'当前投资账本非零持仓；不是历史全市场股票池' if account_id else '当前已登记的研究证券；不是持仓或历史全市场股票池',
        'required':len(items),'available':available,'coverage_pct':str(available*100//len(items)) if items else None,
        'items':items,'recent_failures':failed,'capabilities':requirements(),'realtime_verified':False}


def register(router,store):
    from typing import Literal
    @router.get('/workspace')
    def summary(account_id:str|None=None,view:Literal['today','ledger','review','market','screen','research','assets','budget','analysis']='today'):
        return workspace(store,account_id,view)

    @router.get('/data-health')
    def data_health(on:date,account_id:str|None=None):return health(store,account_id,on.isoformat())
