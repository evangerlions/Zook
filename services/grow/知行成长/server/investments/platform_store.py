"""Private append-only platform snapshots on the existing investment object journal."""
import json
import uuid
from datetime import datetime
from zoneinfo import ZoneInfo

from copilot.core import digest, encoded, fail, now

ZONE = ZoneInfo('Asia/Shanghai')


def day(stamp):
    return datetime.fromisoformat(stamp).astimezone(ZONE).date().isoformat()


def records(c, kind, account_id=...):
    where = 'kind=?'
    args = [kind]
    if account_id is not ...:
        where += " AND data::jsonb->>'account_id' IS NOT DISTINCT FROM ?"
        args.append(account_id)
    rows = c.execute('SELECT data FROM investment_objects WHERE '+where+' ORDER BY created_at,id LIMIT 10001', args).fetchall()
    if len(rows)>10000:
        fail('scope_too_large', '该范围超过10000条，请缩小范围或使用完整备份。', 422)
    return [json.loads(row[0]) for row in rows]


def append(store, c, kind, payload):
    stamp = now()
    record = {**payload, 'id':'inv-'+uuid.uuid4().hex, 'version':1, 'created_at':stamp, 'updated_at':stamp}
    store.save(c, kind, record, fresh=True)
    return record


def ledger_inputs(store, c, account_id, extra=(), *, summary=False):
    """Bounded immutable inputs for replaying many dates in one read snapshot."""
    account = store._get(c, 'accounts', account_id)
    kinds = ['fills', 'cash-events', 'ledger-notices', *extra]
    result = {kind: [] for kind in kinds}
    rows = c.execute('''WITH ranked AS (
        SELECT kind,data,created_at,id,
            row_number() OVER (PARTITION BY kind ORDER BY created_at,id) AS position
        FROM investment_objects WHERE kind=ANY(?::text[])
        AND data::jsonb->>'account_id'=?
    ) SELECT kind,CASE WHEN kind='valuations' AND ? THEN
        (data::jsonb-'quotes'-'ledger_versions')::text ELSE data END AS data
        FROM ranked WHERE position<=10001 ORDER BY created_at,id''', (kinds,account_id,summary))
    for row in rows:
        result[row['kind']].append(json.loads(row['data']))
    if any(len(items)>10000 for items in result.values()):
        fail('scope_too_large', '该范围超过10000条，请缩小范围或使用完整备份。', 422)
    result['account'] = account
    result['sequence'] = {r[0]:r[1] for r in c.execute('SELECT id,sequence FROM investment_fills WHERE account_id=?',(account_id,))}
    return result


def ledger(store, c, account_id, on, account=None, *, inputs=None):
    """Economic-date reconstruction using current audited facts, not historical knowledge."""
    from .accounting import reconcile
    account = account or (inputs['account'] if inputs is not None else store._get(c, 'accounts', account_id))
    if on<account['baseline_date']:
        fail('before_baseline', '日期早于投资账本核对基准日。', 422)
    source=lambda kind: inputs[kind] if inputs is not None else records(c,kind,account_id)
    fills = sorted((r for r in source('fills') if day(r['executed_at'])<=on), key=lambda r:(r['executed_at'],r['created_at'],r['id']))
    # Preserve original sequence for simultaneous fills, including corrections.
    sequence = inputs['sequence'] if inputs is not None else {r[0]:r[1] for r in c.execute('SELECT id,sequence FROM investment_fills WHERE account_id=?',(account_id,))}
    fills.sort(key=lambda r:(datetime.fromisoformat(r['executed_at']),sequence[r['id']]))
    events = [r for r in source('cash-events') if day(r['occurred_at'])<=on]
    for fill in fills:
        if day(fill['executed_at'])<account['baseline_date']:
            fail('baseline_conflict', '基准日不得晚于已有成交。', 422)
    for event in events:
        if day(event['occurred_at'])<account['baseline_date']:
            fail('baseline_conflict', '基准日不得晚于已有资金流水。', 422)
    notices = [r for r in source('ledger-notices') if day(r['observed_at'])<=on]
    try:
        balance = reconcile(account['opening_cash'], events, fills, opening_positions=account['opening_positions'])
    except ValueError:
        fail('baseline_conflict', '逐笔成交核对失败：卖出超过当时持仓，请先补齐真实事实。', 422)
    from .reconciliation import apply_notices
    apply_notices(c,account_id,balance,active=[r for r in notices if r['status']=='open'])
    facts = {'account':account,'fills':fills,'events':events,'notices':notices}
    return balance, facts, digest(encoded(facts))
