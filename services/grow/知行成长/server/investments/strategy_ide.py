"""Strategy IDE: user-authored Python strategy code with sandboxed backtest execution.
Stores user strategies and backtest results as research evidence in the bounded screening journal."""
from datetime import date
from fastapi import Header
from pydantic import Field
import db
from copilot.core import digest,encoded,fail,now
from .contracts import Contract,Identifier
from .platform_store import append,records
from .research_tools import validate_scope
from . import param_extractor

STRATEGY_TEMPLATES=[
    {'id':'ma_cross','name':'均线交叉策略','description':'短均线上穿长均线买入，下穿卖出。经典趋势跟踪策略。',
     'tags':['趋势跟踪','均线','经典'],
     'code':'''"""均线交叉策略 — 短均线上穿/下穿长均线"""
from backtest_engine import BaseStrategy

class Strategy(BaseStrategy):
    def __init__(self, fast_period=5, long_period=20, max_positions=10):
        super().__init__("均线交叉策略")
        self.fast_period = fast_period
        self.long_period = long_period
        self.max_positions = max_positions

    def init(self):
        pass

    def handle_bar(self):
        if len(self.current_positions) >= self.max_positions:
            return
        for ts_code in self.engine.current_data:
            df = self.get_data(ts_code)
            if df is None or len(df) < self.long_period + 1:
                continue
            closes = df['close'].values
            fast_ma = closes[-self.fast_period:].mean()
            slow_ma = closes[-self.long_period:].mean()
            prev_fast = closes[-(self.fast_period+1):-1].mean()
            prev_slow = closes[-(self.long_period+1):-1].mean()
            position = self.get_position(ts_code)
            if prev_fast <= prev_slow and fast_ma > slow_ma and position is None:
                self.buy(ts_code)
            elif prev_fast >= prev_slow and fast_ma < slow_ma and position is not None:
                self.sell(ts_code)
'''},
    {'id':'rsi_oversold','name':'RSI 超买超卖策略','description':'RSI 低于超卖线买入，高于超买线卖出。适合震荡市。',
     'tags':['震荡','RSI','超买超卖'],
     'code':'''"""RSI 超买超卖策略"""
from backtest_engine import BaseStrategy
import numpy as np

class Strategy(BaseStrategy):
    def __init__(self, rsi_period=14, oversold_level=30, overbought_level=70, max_positions=10):
        super().__init__("RSI 超买超卖策略")
        self.rsi_period = rsi_period
        self.oversold_level = oversold_level
        self.overbought_level = overbought_level
        self.max_positions = max_positions

    def init(self):
        pass

    def _calc_rsi(self, closes):
        deltas = np.diff(closes)
        gains = np.where(deltas > 0, deltas, 0)
        losses = np.where(deltas < 0, -deltas, 0)
        avg_gain = gains[-self.rsi_period:].mean()
        avg_loss = losses[-self.rsi_period:].mean()
        if avg_loss == 0: return 100.0
        rs = avg_gain / avg_loss
        return 100.0 - (100.0 / (1.0 + rs))

    def handle_bar(self):
        if len(self.current_positions) >= self.max_positions:
            return
        for ts_code in self.engine.current_data:
            df = self.get_data(ts_code)
            if df is None or len(df) < self.rsi_period + 2:
                continue
            closes = df['close'].values
            rsi = self._calc_rsi(closes)
            prev_rsi = self._calc_rsi(closes[:-1])
            position = self.get_position(ts_code)
            if prev_rsi >= self.oversold_level and rsi < self.oversold_level and position is None:
                self.buy(ts_code)
            elif prev_rsi <= self.overbought_level and rsi > self.overbought_level and position is not None:
                self.sell(ts_code)
'''},
    {'id':'macd_crossover','name':'MACD 策略','description':'MACD 线上穿信号线买入，下穿卖出。捕捉中期趋势。',
     'tags':['趋势跟踪','MACD','动量'],
     'code':'''"""MACD 策略 — DIF 上穿/下穿 DEA"""
from backtest_engine import BaseStrategy
import numpy as np

class Strategy(BaseStrategy):
    def __init__(self, fast_period=12, slow_period=26, signal_period=9, max_positions=10):
        super().__init__("MACD 策略")
        self.fast_period = fast_period
        self.slow_period = slow_period
        self.signal_period = signal_period
        self.max_positions = max_positions

    def init(self):
        pass

    def _ema(self, data, period):
        ema = np.zeros_like(data, dtype=float)
        ema[0] = data[0]
        k = 2.0 / (period + 1)
        for i in range(1, len(data)):
            ema[i] = data[i] * k + ema[i-1] * (1 - k)
        return ema

    def handle_bar(self):
        if len(self.current_positions) >= self.max_positions:
            return
        for ts_code in self.engine.current_data:
            df = self.get_data(ts_code)
            if df is None or len(df) < self.slow_period + self.signal_period:
                continue
            closes = df['close'].values
            ema_fast = self._ema(closes, self.fast_period)
            ema_slow = self._ema(closes, self.slow_period)
            dif = ema_fast - ema_slow
            dea = self._ema(dif, self.signal_period)
            position = self.get_position(ts_code)
            if dif[-1] > dea[-1] and dif[-2] <= dea[-2] and position is None:
                self.buy(ts_code)
            elif dif[-1] < dea[-1] and dif[-2] >= dea[-2] and position is not None:
                self.sell(ts_code)
'''},
    {'id':'bollinger_breakout','name':'布林带突破策略','description':'价格突破上轨买入（趋势确认），跌破中轨卖出。',
     'tags':['趋势跟踪','布林带','波动率'],
     'code':'''"""布林带突破策略"""
from backtest_engine import BaseStrategy
import numpy as np

class Strategy(BaseStrategy):
    def __init__(self, boll_period=20, num_std=2.0, max_positions=10):
        super().__init__("布林带突破策略")
        self.boll_period = boll_period
        self.num_std = num_std
        self.max_positions = max_positions

    def init(self):
        pass

    def handle_bar(self):
        if len(self.current_positions) >= self.max_positions:
            return
        for ts_code in self.engine.current_data:
            df = self.get_data(ts_code)
            if df is None or len(df) < self.boll_period + 1:
                continue
            closes = df['close'].values
            window = closes[-self.boll_period:]
            middle = window.mean()
            std = window.std()
            upper = middle + self.num_std * std
            current = closes[-1]
            prev = closes[-2]
            position = self.get_position(ts_code)
            if prev <= upper and current > upper and position is None:
                self.buy(ts_code)
            elif current < middle and position is not None:
                self.sell(ts_code)
'''},
]

BACKTEST_ENGINE='''"""Minimal backtest engine for user strategies; runs in a sandboxed exec scope."""
import numpy as np
from dataclasses import dataclass

@dataclass
class Position:
    ts_code: str
    quantity: int
    avg_price: float
    current_price: float = 0.0

@dataclass
class Trade:
    date: str
    ts_code: str
    side: str
    price: float
    quantity: int
    amount: float
    commission: float = 0.0
    stamp_tax: float = 0.0

class BaseStrategy:
    def __init__(self, name="用户策略"):
        self.name = name
        self.engine = None
        self.current_positions = {}
    def init(self): pass
    def handle_bar(self): pass
    def buy(self, ts_code, quantity=None):
        if self.engine: self.engine._execute_buy(ts_code, quantity)
    def sell(self, ts_code, quantity=None):
        if self.engine: self.engine._execute_sell(ts_code, quantity)
    def get_position(self, ts_code):
        return self.current_positions.get(ts_code)
    def get_data(self, ts_code):
        if not self.engine: return None
        return self.engine._get_history(ts_code)

class BacktestEngine:
    def __init__(self, initial_cash=1000000, commission_rate=0.0003, stamp_tax=0.001):
        self.initial_cash = float(initial_cash)
        self.commission_rate = float(commission_rate)
        self.stamp_tax = float(stamp_tax)
        self.cash = self.initial_cash
        self.positions = {}
        self.trades = []
        self.equity_curve = []
        self.data = {}
        self.dates = []
        self.current_date = None
        self.current_data = []
        self.strategy = None
        self._bar_indices = {}
    def set_strategy(self, strategy):
        self.strategy = strategy
        strategy.engine = self
        strategy.current_positions = self.positions
    def load_data(self, data_dict, dates):
        self.data = data_dict
        self.dates = sorted(dates)
        for ts_code in data_dict:
            self._bar_indices[ts_code] = 0
    def run(self):
        if not self.strategy: raise ValueError("No strategy set")
        self.strategy.init()
        for d in self.dates:
            self.current_date = d
            self.current_data = []
            for ts_code, df in self.data.items():
                mask = df['date'] <= d
                if mask.any():
                    self._bar_indices[ts_code] = int(mask.sum()) - 1
                    self.current_data.append(ts_code)
                    last_row = df[mask].iloc[-1]
                    if ts_code in self.positions:
                        self.positions[ts_code].current_price = float(last_row['close'])
            self.strategy.handle_bar()
            equity = self.cash + sum(p.quantity * p.current_price for p in self.positions.values())
            self.equity_curve.append({'date': d, 'value': equity, 'cash': self.cash})
        return self._calc_stats()
    def _get_history(self, ts_code):
        if ts_code not in self.data: return None
        df = self.data[ts_code]
        idx = self._bar_indices.get(ts_code, -1)
        if idx < 0: return None
        return df.iloc[:idx+1].copy()
    def _execute_buy(self, ts_code, quantity=None):
        if ts_code in self.positions: return
        df = self.data.get(ts_code)
        if df is None: return
        idx = self._bar_indices.get(ts_code, -1)
        if idx < 0 or idx >= len(df): return
        row = df.iloc[idx]
        price = float(row['close'])
        if quantity is None:
            max_amount = self.cash * 0.95
            quantity = int(max_amount / price / 100) * 100
        if quantity <= 0: return
        amount = price * quantity
        commission = max(5, amount * self.commission_rate)
        total_cost = amount + commission
        if total_cost > self.cash: return
        self.cash -= total_cost
        self.positions[ts_code] = Position(ts_code=ts_code, quantity=quantity, avg_price=price, current_price=price)
        self.trades.append(Trade(date=str(self.current_date), ts_code=ts_code, side='buy', price=price, quantity=quantity, amount=amount, commission=commission))
        self.strategy.current_positions = self.positions
    def _execute_sell(self, ts_code, quantity=None):
        pos = self.positions.get(ts_code)
        if pos is None: return
        df = self.data.get(ts_code)
        if df is None: return
        idx = self._bar_indices.get(ts_code, -1)
        if idx < 0 or idx >= len(df): return
        row = df.iloc[idx]
        price = float(row['close'])
        if quantity is None: quantity = pos.quantity
        quantity = min(quantity, pos.quantity)
        if quantity <= 0: return
        amount = price * quantity
        commission = max(5, amount * self.commission_rate)
        stamp_tax = amount * self.stamp_tax
        net_proceeds = amount - commission - stamp_tax
        self.cash += net_proceeds
        self.trades.append(Trade(date=str(self.current_date), ts_code=ts_code, side='sell', price=price, quantity=quantity, amount=amount, commission=commission, stamp_tax=stamp_tax))
        if quantity >= pos.quantity:
            del self.positions[ts_code]
        else:
            pos.quantity -= quantity
        self.strategy.current_positions = self.positions
    def _calc_stats(self):
        if not self.equity_curve: return None
        final = self.equity_curve[-1]['value']
        total_return = (final / self.initial_cash - 1) * 100
        n_days = len(self.equity_curve)
        annual_return = ((final / self.initial_cash) ** (252 / max(n_days, 1)) - 1) * 100 if n_days > 0 else 0
        values = [e['value'] for e in self.equity_curve]
        peak = values[0]
        max_dd = 0
        for v in values:
            if v > peak: peak = v
            dd = (peak - v) / peak * 100
            if dd > max_dd: max_dd = dd
        returns = [(values[i] / values[i-1] - 1) for i in range(1, len(values)) if values[i-1] > 0]
        sharpe = 0
        if returns:
            mean_r = sum(returns) / len(returns)
            std_r = (sum((r - mean_r)**2 for r in returns) / max(len(returns)-1, 1)) ** 0.5
            if std_r > 0: sharpe = (mean_r * 252) / (std_r * (252 ** 0.5))
        sells = [t for t in self.trades if t.side == 'sell']
        wins = sum(1 for t in sells if t.price > 0)
        win_rate = wins / max(len(sells), 1) * 100
        return {
            'initial_capital': self.initial_cash, 'final_capital': final,
            'total_return': round(total_return, 4), 'annual_return': round(annual_return, 4),
            'max_drawdown': round(max_dd, 4), 'sharpe_ratio': round(sharpe, 4),
            'win_rate': round(win_rate, 2), 'total_trades': len(self.trades), 'n_days': n_days,
        }
    def get_results(self):
        stats = self._calc_stats()
        return {
            **(stats or {}),
            'trades': [{'date':t.date,'ts_code':t.ts_code,'side':t.side,'price':t.price,'quantity':t.quantity,'amount':t.amount,'commission':t.commission,'stamp_tax':t.stamp_tax} for t in self.trades],
            'equity_curve': self.equity_curve,
            'current_positions': [{'ts_code':p.ts_code,'quantity':p.quantity,'avg_price':p.avg_price,'current_price':p.current_price,'market_value':p.quantity*p.current_price,'profit':(p.current_price-p.avg_price)*p.quantity,'profit_pct':(p.current_price/p.avg_price-1)*100 if p.avg_price else 0} for p in self.positions.values()],
        }
'''

class StrategyCodeInput(Contract):
    name:str=Field(min_length=1,max_length=200)
    code:str=Field(min_length=10,max_length=50000)
    tags:list[str]=Field(default_factory=list,max_length=20)
    description:str=Field(default='',max_length=2000)

class StrategyRunInput(Contract):
    strategy_code:str=Field(min_length=10,max_length=50000)
    strategy_name:str=Field(min_length=1,max_length=200)
    params:dict[str,float]=Field(default_factory=dict,max_length=50)
    series_ids:list[str]=Field(default_factory=list,max_length=20)
    initial_cash:str='1000000'
    commission_rate:str='0.0003'
    stamp_tax:str='0.001'

class GridSearchInput(Contract):
    strategy_code:str=Field(min_length=10,max_length=50000)
    strategy_name:str=Field(min_length=1,max_length=200)
    param_ranges:dict[str,list[float]]=Field(default_factory=dict,description='Each key maps to a list of values to try')
    series_ids:list[str]=Field(default_factory=list,max_length=20)
    initial_cash:str='1000000'
    commission_rate:str='0.0003'
    stamp_tax:str='0.001'
    max_combinations:int=Field(default=100,ge=1,le=500,description='Max parameter combinations to test')

def extract_params(code:str)->dict:
    return param_extractor.extract(code)

def list_templates():
    return [{'id':t['id'],'name':t['name'],'description':t['description'],'tags':t['tags'],'code':t['code']} for t in STRATEGY_TEMPLATES]

def save_strategy(store,body,key,account_id):
    data={'account_id':account_id,'name':body.name,'code':body.code,'tags':body.tags,
        'description':body.description,'code_hash':digest(body.code)}
    fingerprint=digest(encoded(data))
    with db.connect() as c:
        store.lock(c)
        replay=store.replay(c,key,fingerprint)
        if replay is not None:return replay
        result=append(store,c,'user-strategies',data)
        store.remember(c,key,fingerprint,result)
        return result

def list_strategies(store,account_id):
    with db.connect() as c:
        return list(records(c,'user-strategies',account_id))

def _collect_series_bars(store,account_id,series_ids):
    bars_by_code={}
    with db.connect() as c:
        for sid in series_ids:
            try:
                series=store._get(c,'series',sid)
            except Exception:continue
            if series.get('account_id')!=account_id:continue
            data=series.get('data',{})
            code=data.get('code') or sid
            raw_bars=data.get('bars',[])
            if not raw_bars:continue
            bars_by_code[code]=[{'date':str(b.get('time',''))[:10],'open':str(b.get('open','0')),
                'high':str(b.get('high','0')),'low':str(b.get('low','0')),
                'close':str(b.get('close','0')),'volume':str(b.get('volume_shares','0'))}
                for b in raw_bars]
    return bars_by_code

def run_strategy_backtest(store,body,key,account_id):
    import re as _re
    code=body.strategy_code
    params=body.params
    for name,value in params.items():
        pattern=_re.compile(rf'(self\.{name}\s*=\s*)([^,\n]+)')
        code=pattern.sub(lambda m:f'{m.group(1)}{value!r}',code, count=1)
    sandbox={'__builtins__':{
        'range':range,'len':len,'float':float,'int':int,'str':str,'bool':bool,
        'min':min,'max':max,'abs':abs,'sum':sum,'round':round,'enumerate':enumerate,
        'zip':zip,'map':map,'filter':filter,'sorted':sorted,'list':list,'dict':dict,
        'tuple':tuple,'set':set,'True':True,'False':False,'None':None,
        'isinstance':isinstance,'type':type,'print':lambda *a,**k:None,
    }}
    try:
        import importlib
        np_spec=importlib.util.find_spec('numpy')
        pd_spec=importlib.util.find_spec('pandas')
        if np_spec:sandbox['np']=importlib.import_module('numpy')
        if pd_spec:sandbox['pd']=importlib.import_module('pandas')
    except Exception:pass
    try:
        exec(BACKTEST_ENGINE,sandbox)
        exec(code,sandbox)
        StrategyClass=sandbox.get('Strategy')
        if StrategyClass is None:fail('strategy_missing','策略代码须定义 Strategy 类。',422)
        strategy=StrategyClass()
        engine=sandbox['BacktestEngine'](
            initial_cash=float(body.initial_cash),
            commission_rate=float(body.commission_rate),
            stamp_tax=float(body.stamp_tax))
        engine.set_strategy(strategy)
        bars_by_code=_collect_series_bars(store,account_id,body.series_ids)
        if not bars_by_code:fail('no_market_data','请先添加盘后行情（研究→资料→添加盘后行情）。',422)
        data_dict={}
        all_dates=set()
        for ts_code,bars in bars_by_code.items():
            rows=[{'date':b['date'],'open':float(b['open']),'high':float(b['high']),
                'low':float(b['low']),'close':float(b['close']),'volume':float(b.get('volume',0))}
                for b in bars if b['date']]
            if rows:
                data_dict[ts_code]=__import__('pandas').DataFrame(rows)
                all_dates.update(b['date'] for b in bars if b['date'])
        engine.load_data(data_dict,sorted(all_dates))
        stats=engine.run()
        results=engine.get_results()
        with db.connect() as c:
            store.lock(c)
            record=append(store,c,'strategy-backtests',{
                'account_id':account_id,'strategy_name':body.strategy_name,'strategy_code_hash':digest(code),
                'params':body.params,'series_ids':body.series_ids,
                'config':{'initial_cash':body.initial_cash,'commission_rate':body.commission_rate,'stamp_tax':body.stamp_tax},
                'result':results,'metrics':stats})
            return record
    except Exception as error:
        fail('strategy_execution_failed',f'策略执行失败：{error}',422)

def register(router,store):
    @router.get('/strategy-templates')
    def templates():return {'items':list_templates()}

    @router.post('/strategy/extract-params')
    def extract(body:StrategyCodeInput):return extract_params(body.code)

    @router.get('/user-strategies')
    def strategies(account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            return {'items':list(reversed(list_strategies(store,account_id)))}

    @router.post('/user-strategies')
    def save(body:StrategyCodeInput,idempotency_key:str=Header(min_length=1,max_length=160),account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
        return save_strategy(store,body,idempotency_key,account_id)

    @router.post('/strategy/run')
    def run(body:StrategyRunInput,idempotency_key:str=Header(min_length=1,max_length=160),account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
        return run_strategy_backtest(store,body,idempotency_key,account_id)

    @router.get('/strategy/series')
    def available_series(account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
            items=[]
            for kind in ('series',):
                for record in records(c,kind,account_id):
                    data=record.get('data',{})
                    items.append({'id':record['id'],'code':data.get('code',''),'name':data.get('name',''),
                        'source':data.get('source_label',''),'bars':len(data.get('bars',[]))})
            return {'items':items}

    @router.post('/strategy/grid-search')
    def grid_search(body:GridSearchInput,idempotency_key:str=Header(min_length=1,max_length=160),account_id:str|None=None):
        with db.connect() as c:
            validate_scope(store,c,account_id)
        from itertools import product as iter_product
        param_ranges=body.param_ranges
        keys=sorted(param_ranges.keys())
        value_lists=[param_ranges[k] for k in keys]
        combinations=list(iter_product(*value_lists))[:body.max_combinations]
        results=[]
        for combo in combinations:
            params={keys[i]:combo[i] for i in range(len(keys))}
            try:
                result=run_strategy_backtest(store,StrategyRunInput(
                    strategy_code=body.strategy_code,strategy_name=body.strategy_name,
                    params=params,series_ids=body.series_ids,
                    initial_cash=body.initial_cash,commission_rate=body.commission_rate,stamp_tax=body.stamp_tax
                ),idempotency_key+'_'+str(len(results)),account_id)
                results.append({'params':params,'metrics':result.get('metrics',{})})
            except Exception:pass
        return {'items':results,'total':len(combinations),'tested':len(results)}

    # ── Investment Knowledge Learning ──────────────────────────────────────
    from . import investment_knowledge

    @router.post('/knowledge/seed')
    def seed_knowledge():
        """Seed investment knowledge nodes into the knowledge graph."""
        count = investment_knowledge.seed_knowledge(db.connect)
        return {'seeded': count, 'total': len(investment_knowledge.KNOWLEDGE_NODES)}

    @router.get('/knowledge')
    def knowledge_nodes(category: str | None = None, limit: int = 50):
        """Get investment knowledge nodes."""
        return {'items': investment_knowledge.get_investment_knowledge(db.connect, category, limit)}

    @router.get('/knowledge/tip')
    def knowledge_tip():
        """Get a random knowledge tip for learning reminders."""
        tip = investment_knowledge.get_random_knowledge_tip(db.connect)
        return {'tip': tip}
