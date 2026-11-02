"""Investment knowledge base — seeds financial education content into the knowledge graph.

Categories:
  investing_basics     — 投资基础概念
  technical_analysis   — 技术分析
  strategy_theory      — 策略理论
  risk_management      — 风险管理
  behavioral_finance   — 行为金融学
  fundamental_analysis — 基本面分析
  macro_economics      — 宏观经济
"""
from __future__ import annotations

import db
from copilot.core import digest
from .platform_store import append, records

# ── Knowledge seed data ──────────────────────────────────────────────────────

KNOWLEDGE_NODES = [
    # investing_basics
    {'name': '什么是股票', 'category': 'investing_basics',
     'summary': '股票是股份公司所有权的一部分，也是发行的所有权凭证。持有股票的股东享有公司利润分配和重大决策参与权。股票价格由市场供需决定，受公司基本面、行业前景和宏观经济影响。',
     'source': '投资知识体系', 'kind': 'concept'},
    {'name': '什么是ETF', 'category': 'investing_basics',
     'summary': 'ETF（交易型开放式指数基金）是一种在交易所上市交易的基金，跟踪特定指数表现。相比主动管理基金，ETF费率低、透明度高、流动性好。适合长期定投和资产配置。',
     'source': '投资知识体系', 'kind': 'concept'},
    {'name': '复利的力量', 'category': 'investing_basics',
     'summary': '复利是指利息再生利息的过程。公式：FV = PV × (1+r)^n。年化7%收益，10年翻倍；年化10%，7.2年翻倍（72法则）。长期投资的核心优势来自复利，而非短期暴利。',
     'source': '投资知识体系', 'kind': 'concept'},
    {'name': '资产配置原则', 'category': 'investing_basics',
     'summary': '资产配置是决定投资组合长期收益的最重要因素（Brinson研究：约90%的收益差异来自资产配置）。核心原则：分散化（不同资产类别低相关）、再平衡（定期恢复目标权重）、匹配风险承受能力。',
     'source': '投资知识体系', 'kind': 'principle'},

    # technical_analysis
    {'name': '移动平均线（MA）', 'category': 'technical_analysis',
     'summary': 'MA是过去N日收盘价的算术平均。MA5反映短期趋势，MA20反映中期趋势，MA60反映长期趋势。金叉（短MA上穿长MA）看多，死叉（短MA下穿长MA）看空。注意：MA是滞后指标，适合趋势市，震荡市会产生大量假信号。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': 'RSI 相对强弱指标', 'category': 'technical_analysis',
     'summary': 'RSI = 100 - 100/(1+RS)，RS = 平均涨幅/平均跌幅。RSI>70 超买区域，RSI<30 超卖区域。RSI背离（价格创新高但RSI未创新高）是重要的反转信号。默认参数14日。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': 'MACD 指标', 'category': 'technical_analysis',
     'summary': 'MACD = EMA(12) - EMA(26)，信号线 = EMA(9) of MACD。DIF上穿DEA为金叉买入信号，下穿为死叉卖出信号。MACD柱状图（MACD - Signal）反映动能强弱。零轴以上为多头市场，零轴以下为空头市场。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': '布林带（Bollinger Bands）', 'category': 'technical_analysis',
     'summary': '中轨 = MA(N)，上轨 = MA(N) + K×StdDev，下轨 = MA(N) - K×StdDev。默认N=20, K=2。价格触及上轨可能超买，触及下轨可能超卖。带宽收窄（squeeze）预示即将出现大波动。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': '成交量分析', 'category': 'technical_analysis',
     'summary': '量价关系是技术分析的基础。放量上涨确认趋势，缩量上涨警惕反转；放量下跌确认恐慌，缩量下跌可能见底。OBV（能量潮）累计成交量方向，与价格背离时发出预警信号。',
     'source': '投资知识体系', 'kind': 'indicator'},

    # strategy_theory
    {'name': '趋势跟踪策略', 'category': 'strategy_theory',
     'summary': '趋势跟踪的核心假设是"趋势会延续"。方法：均线系统、通道突破、动量因子。优点：抓住大行情时收益可观；缺点：震荡市频繁止损，胜率通常低于50%。关键：严格止损，让利润奔跑。',
     'source': '投资知识体系', 'kind': 'strategy'},
    {'name': '均值回归策略', 'category': 'strategy_theory',
     'summary': '均值回归假设价格会围绕内在价值波动。方法：RSI超卖买入/超买卖出、布林带下轨买入上轨卖出、配对交易。适合震荡市，趋势市中会持续亏损。关键：设置合理的回归区间和止损。',
     'source': '投资知识体系', 'kind': 'strategy'},
    {'name': '动量策略', 'category': 'strategy_theory',
     'summary': '动量效应：过去表现好的资产未来继续表现好（Jegadeesh & Titman, 1993）。方法：买入过去N个月涨幅最大的资产组合，定期调仓。A股市场动量效应在短期（1-3个月）较显著，中长期存在反转效应。',
     'source': '投资知识体系', 'kind': 'strategy'},
    {'name': '因子投资', 'category': 'strategy_theory',
     'summary': '因子投资基于学术研究发现的风险溢价因子：价值（低PE/PB）、规模（小盘溢价）、动量、质量（高ROE）、低波动。Fama-French三因子/五因子模型是理论基础。A股有效的因子：小盘、反转、低波动、盈利质量。',
     'source': '投资知识体系', 'kind': 'strategy'},

    # risk_management
    {'name': '仓位管理', 'category': 'risk_management',
     'summary': '单笔交易风险不超过总资金的1-2%。仓位公式：仓位 = (账户风险比例 × 总资金) / (买入价 - 止损价)。例如：100万账户，单笔风险1%即1万，买入价10元止损价9元，则仓位 = 10000/(10-9) = 10000股 = 10万元。',
     'source': '投资知识体系', 'kind': 'principle'},
    {'name': '止损策略', 'category': 'risk_management',
     'summary': '固定比例止损（如-8%）、ATR止损（买入价 - 2×ATR）、移动止损（跟踪最高价回落N%）。核心原则：止损是交易计划的一部分，不是事后补救。执行止损不需要理由，不执行止损需要理由。',
     'source': '投资知识体系', 'kind': 'principle'},
    {'name': '最大回撤控制', 'category': 'risk_management',
     'summary': '最大回撤（Max Drawdown）是峰值到谷底的最大跌幅。回撤20%需要涨25%才能回本，回撤50%需要涨100%。控制回撤比追求收益更重要。方法：分散持仓、降低仓位、动态调整风险敞口。',
     'source': '投资知识体系', 'kind': 'principle'},
    {'name': 'Kelly 公式', 'category': 'risk_management',
     'summary': 'Kelly公式：f = (bp - q) / b，其中b=盈亏比，p=胜率，q=1-p。例如胜率55%，盈亏比1:1，则f = (1×0.55-0.45)/1 = 10%。实际使用中通常取半Kelly（f/2）以降低波动。Kelly公式假设参数已知，实际中参数是估计值。',
     'source': '投资知识体系', 'kind': 'formula'},

    # behavioral_finance
    {'name': '损失厌恶', 'category': 'behavioral_finance',
     'summary': 'Kahneman & Tversky (1979)：人们对损失的痛苦约是同等收益快乐的2-2.5倍。导致行为：过早卖出盈利股票（处置效应）、持有亏损股票不愿止损、过度规避风险。对策：制定交易计划并严格执行，用规则代替情绪。',
     'source': '投资知识体系', 'kind': 'bias'},
    {'name': '过度自信偏差', 'category': 'behavioral_finance',
     'summary': '投资者倾向于高估自己的判断能力。表现：过度交易（交易频率与收益负相关）、集中持仓、忽略反面证据。研究显示：个人投资者交易越频繁，收益越差（Barber & Odean, 2000）。对策：记录每笔交易的理由和结果，定期复盘。',
     'source': '投资知识体系', 'kind': 'bias'},
    {'name': '锚定效应', 'category': 'behavioral_finance',
     'summary': '人们倾向于过度依赖初始信息（锚）做决策。在投资中：以买入价为锚判断盈亏（应该关注未来预期而非成本）、以历史高价为锚判断贵贱（应该关注当前估值）。对策：用估值模型和基本面分析替代直觉判断。',
     'source': '投资知识体系', 'kind': 'bias'},
    {'name': '从众心理', 'category': 'behavioral_finance',
     'summary': '人们倾向于跟随大众行为。在投资中：追涨杀跌、恐慌性抛售、FOMO（害怕错过）。巴菲特名言："别人贪婪时恐惧，别人恐惧时贪婪。" 对策：独立思考，逆向投资需要勇气和纪律。',
     'source': '投资知识体系', 'kind': 'bias'},

    # fundamental_analysis
    {'name': '市盈率（PE）', 'category': 'fundamental_analysis',
     'summary': 'PE = 股价/每股收益。静态PE用上年EPS，动态PE用预测EPS，TTM PE用最近12个月EPS。PE越低通常越便宜，但要考虑行业特点和增长预期。高增长公司可以接受更高PE（PEG = PE/增长率，PEG<1可能被低估）。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': '市净率（PB）', 'category': 'fundamental_analysis',
     'summary': 'PB = 股价/每股净资产。适用于重资产行业（银行、保险、地产）。PB<1意味着股价低于净资产（破净），可能低估也可能资产质量差。ROE高的公司可以享受更高PB。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': 'ROE 净资产收益率', 'category': 'fundamental_analysis',
     'summary': 'ROE = 净利润/净资产。衡量公司用股东资金赚钱的能力。巴菲特最看重的指标。持续ROE>15%的公司通常是优质企业。杜邦分析：ROE = 净利率 × 周转率 × 杠杆率，分解利润来源。',
     'source': '投资知识体系', 'kind': 'indicator'},
    {'name': 'DCF 估值模型', 'category': 'fundamental_analysis',
     'summary': 'DCF（现金流折现）：内在价值 = Σ(FCF_t / (1+r)^t) + 终值/(1+r)^n。核心假设：未来自由现金流和折现率。DCF对假设非常敏感，适合稳定现金流的公司（消费、公用事业），不适合高增长或周期性公司。',
     'source': '投资知识体系', 'kind': 'method'},

    # macro_economics
    {'name': '经济周期与投资', 'category': 'macro_economics',
     'summary': '美林时钟：复苏期（股票>债券>商品>现金）、过热期（商品>股票>现金>债券）、滞胀期（现金>商品>债券>股票）、衰退期（债券>现金>股票>商品）。A股受政策影响大，周期节奏可能不同。',
     'source': '投资知识体系', 'kind': 'framework'},
    {'name': '利率与股市', 'category': 'macro_economics',
     'summary': '利率上升：债券价格下跌，股市估值承压（折现率上升），银行股可能受益（净息差扩大）。利率下降：债券价格上涨，股市估值支撑，成长股受益更多。关注央行政策信号（MLF、LPR、降准降息）。',
     'source': '投资知识体系', 'kind': 'concept'},
    {'name': '通货膨胀与投资', 'category': 'macro_economics',
     'summary': '温和通胀（2-3%）对股市中性偏正，恶性通胀侵蚀实际收益。抗通胀资产：实物资产（房产、黄金）、大宗商品、通胀挂钩债券、定价权强的消费股。现金在通胀环境中实际购买力下降。',
     'source': '投资知识体系', 'kind': 'concept'},
]


def seed_knowledge(get_conn):
    """Seed investment knowledge nodes into the knowledge graph. Idempotent."""
    seeded = 0
    today = '2026-11-01'
    source_path = 'investment-knowledge-v1'
    for node in KNOWLEDGE_NODES:
        source_hash = digest(node['name'] + node['category'] + node['summary'])
        try:
            with get_conn() as conn:
                existing = conn.execute(
                    'SELECT id FROM knowledge WHERE source_path=? AND name=? AND kind=?',
                    (source_path, node['name'], node['kind'])
                ).fetchone()
                if existing:
                    continue
                conn.execute(
                    'INSERT INTO knowledge(name,category,summary,source,kind,date,source_path,source_hash) '
                    'VALUES(?,?,?,?,?,?,?,?)',
                    (node['name'], node['category'], node['summary'], node['source'],
                     node['kind'], today, source_path, source_hash)
                )
                seeded += 1
        except Exception:
            continue
    return seeded


def get_investment_knowledge(get_conn, category=None, limit=50):
    """Query investment knowledge nodes."""
    with get_conn() as conn:
        if category:
            rows = conn.execute(
                'SELECT * FROM knowledge WHERE category=? ORDER BY id LIMIT ?',
                (category, limit)
            ).fetchall()
        else:
            rows = conn.execute(
                'SELECT * FROM knowledge WHERE source_path=? ORDER BY category, id LIMIT ?',
                ('investment-knowledge-v1', limit)
            ).fetchall()
        return [dict(r) for r in rows]


def get_random_knowledge_tip(get_conn):
    """Get a random knowledge node for learning tips."""
    import random
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT * FROM knowledge WHERE source_path=?',
            ('investment-knowledge-v1',)
        ).fetchall()
        if not rows:
            return None
        row = random.choice([dict(r) for r in rows])
        row['category_label'] = {
            'investing_basics': '投资基础',
            'technical_analysis': '技术分析',
            'strategy_theory': '策略理论',
            'risk_management': '风险管理',
            'behavioral_finance': '行为金融',
            'fundamental_analysis': '基本面分析',
            'macro_economics': '宏观经济',
        }.get(row['category'], row['category'])
        return row
