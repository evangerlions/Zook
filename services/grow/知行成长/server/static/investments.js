/* Private investment workspace. Money stays decimal text across the HTTP boundary. */
(() => {
  'use strict';
  const root = () => document.getElementById('investment-workspace');
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const dateTime = () => new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 16);
  const today = () => dateTime().slice(0, 10);
  const label = {untriggered:'未触发',skipped:'主动跳过',draft:'草稿', confirmed:'已确认', declined:'主动放弃', expired:'已到期', cancelled:'已取消', paused:'已暂停',open:'持有中',closed:'已平仓'};
  const money = value => value == null ? '待核对' : value;
  const sections=[['screen','选股'],['market','行情'],['research','研究'],['assets','真实资产']];
  const initial=new URLSearchParams(window.location.search);
  const initialSection=sections.some(([key])=>key===initial.get('investment'))?initial.get('investment'):'screen';
  const s = {section:initialSection,assetView:['today','ledger','review'].includes(initial.get('investment_view'))?initial.get('investment_view'):'ledger',assetAccountId:null,researchAccountId:null,view:initialSection==='assets'&&['today','ledger','review'].includes(initial.get('investment_view'))?initial.get('investment_view'):initialSection==='assets'?'ledger':'today', accountId:null, accounts:[], instruments:[], policies:[], strategies:[], plans:[], fills:[], reviews:[], research:[], fundOrders:[], campaigns:[], notices:[],watches:[],dossiers:[],principles:[],periods:[],checks:[],capital:null,balance:null, generation:0, loading:false};
  let dialog = null;
  const workspaceCache=new Map(),workspaceFlights=new Map();
  let readEpoch=0,networkRequests=0,cacheOwner=null,overviewDirty=true;
  function invalidateReads(){readEpoch++;workspaceCache.clear();overviewDirty=true;}
  function dataView(){return s.section==='assets'?(s.accountId?(s.view==='today'?'budget':s.view):'assets'):s.section==='research'?'research':'market';}
  function ownerId(){return window.Account?.user?.id||null;}
  const independentActions=new Set(['market-data','market-screen','backtests','research-archive','research-tools','sources']);
  function loadingControls(loading){
    root()?.querySelectorAll('[data-inv-action]').forEach(c=>c.disabled=loading&&!independentActions.has(c.dataset.invAction));
    root()?.querySelectorAll('[data-inv-account],[data-inv-research-scope]').forEach(c=>c.disabled=loading);
  }


  async function api(path, options = {}) {
    const requestOwner=ownerId();
    const response = await fetch('/api/investments/' + path.replace(/account_id=(?:null|undefined)&?/g,'unscoped=true&'), {
      credentials:'same-origin', ...options,
      headers:{'Content-Type':'application/json','X-Copilot-Request':'1', ...(options.headers || {})}
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if ([401,403].includes(response.status) && requestOwner===ownerId()) {
        s.accounts=[];s.accountId=null;s.fills=[];s.reviews=[];s.balance=null;
      }
      throw new Error(typeof body.message === 'string' ? body.message : '读取或保存失败，请核对连接和输入后重试。');
    }
    if(options.method && options.method!=='GET')invalidateReads();
    return body;
  }
  const button = (text, action, extra = '') => `<button type="button" class="btn" data-inv-action="${action}" ${extra}>${esc(text)}</button>`;
  const options = (items, display) => items.map(item => [item.id, display(item)]);
  const instrumentName = id => s.instruments.find(i => i.id === id)?.name || '未载入标的';
  function status(text, error = false) {
    const target = root()?.querySelector('[data-inv-status]');
    if (target) {target.textContent = text;target.setAttribute('role',error ? 'alert' : 'status');}
  }

  async function load({force=true}={}) {
    if (!root()) return;
    const owner=ownerId();if(cacheOwner!==owner){invalidateReads();cacheOwner=owner;}
    if(force)invalidateReads();
    const view=dataView(),accountId=s.accountId,key=JSON.stringify([owner,accountId,view]),flightKey=key+':'+readEpoch;
    const generation=++s.generation,started=Date.now(),epoch=readEpoch;
    s.loading=true;root().setAttribute('aria-busy','true');
    loadingControls(true);
    root().removeAttribute('data-inv-load-error');status('正在读取投资记录…');
    let source='network';
    try {
      const cached=workspaceCache.get(key);let data;
      if(!force && cached && Date.now()-cached.at<15000){data=cached.data;source='memory';}
      else{
        let flight=workspaceFlights.get(flightKey);
        if(flight)source='shared';
        else{
          networkRequests++;
          flight=api('workspace?'+new URLSearchParams({view,...(accountId?{account_id:accountId}:{})})).then(value=>{
            if(epoch===readEpoch && owner===ownerId() && !Object.keys(value.errors||{}).length){
              workspaceCache.delete(key);workspaceCache.set(key,{at:Date.now(),data:value});
              if(workspaceCache.size>8)workspaceCache.delete(workspaceCache.keys().next().value);
            }
            return value;
          }).finally(()=>workspaceFlights.delete(flightKey));
          workspaceFlights.set(flightKey,flight);
        }
        data=await flight;
      }
      if(generation!==s.generation || owner!==ownerId())return;
      const empty={instruments:[],strategies:[],checks:[],plans:[],policies:[],periods:[],watches:[],dossiers:[],research:[],fills:[],fundOrders:[],notices:[],reviews:[],principles:[],campaigns:[],capital:null,balance:null};
      Object.assign(s,empty,data);
      const focused=root().querySelector('[data-inv-section]:focus,[data-inv-view]:focus');const focusedSelector=focused?.dataset.invSection?'[data-inv-section="'+focused.dataset.invSection+'"]':focused?.dataset.invView?'[data-inv-view="'+focused.dataset.invView+'"]':null;
      s.loading=false;render();if(focusedSelector)root().querySelector(focusedSelector)?.focus();
      if(!Object.keys(data.errors||{}).length && !root().hasAttribute('data-inv-page-ready-ms') && window.performance?.now){
        root().setAttribute('data-inv-page-ready-ms',String(Math.round(window.performance.now())));
        const entries=window.performance.getEntriesByType?.('resource')||[];
        const initialReads=entries.filter(entry=>{const path=new URL(entry.name,location.href).pathname;return ['/api/auth/me','/api/investments/workspace'].includes(path);}).map(entry=>({path:new URL(entry.name,location.href).pathname,start_ms:Math.round(entry.startTime),duration_ms:Math.round(entry.duration),queue_ms:entry.serverTiming?.find(t=>t.name==='request_queue')?.duration??null}));
        root().setAttribute('data-inv-first-requests',JSON.stringify(initialReads));
      }
      if(Object.keys(data.errors||{}).length)status('部分模块读取失败：'+Object.keys(data.errors).join('、')+'。其他记录仍可查看，请刷新重试。',true);
    } catch (error) {if(generation===s.generation)root()?.setAttribute('data-inv-load-error',error.name+': '+error.message);if (generation === s.generation) status(error instanceof TypeError?'连接暂时中断，已保存记录未清除。请恢复连接后点击刷新重试。':error.message,true);}
    finally {if(generation===s.generation){s.loading=false;root()?.setAttribute('aria-busy','false');root()?.setAttribute('data-inv-load-ms',String(Date.now()-started));root()?.setAttribute('data-inv-load-source',source);root()?.setAttribute('data-inv-network-requests',String(networkRequests));loadingControls(false);if(!window.investmentInitialReady){window.investmentInitialReady=true;window.dispatchEvent(new Event('grow-investment-ready'));}}}
  }

  function cards(items, renderItem, empty) {
    return items.length ? items.map(item => `<article class="inv-record">${renderItem(item)}</article>`).join('') : `<p class="inv-empty">${esc(empty)}</p>`;
  }
  function versions(kind, item) {
    return `<div class="inv-actions"><small>版本 ${item.version} · ${esc(label[item.state] || '')}</small>` +
      button('查看历史', 'history', `data-kind="${kind}" data-id="${item.id}"`) +
      button('修改版本', 'edit', `data-kind="${kind}" data-id="${item.id}"`) +
      (['trade-plans','period-plans'].includes(kind)?button('记录未交易决定','non-trade',`data-kind="${kind}" data-id="${item.id}" data-version="${item.version}"`):'') +
      (kind==='principles' && item.state==='confirmed'?button('暂停试验','pause-principle',`data-id="${item.id}" data-version="${item.version}"`):'') +
      (item.state === 'draft' ? button('确认','confirm',`data-kind="${kind}" data-id="${item.id}" data-version="${item.version}"`) : '') + '</div>';
  }
  function saveLocation(){try{const url=new URL(window.location.href);url.searchParams.set('investment',s.section);if(s.section==='assets')url.searchParams.set('investment_view',s.assetView);else url.searchParams.delete('investment_view');window.history.replaceState(null,'',url);}catch{}}
  function clearFacts(){Object.assign(s,{research:[],dossiers:[],watches:[],plans:[],fills:[],reviews:[],principles:[],notices:[],fundOrders:[],periods:[],policies:[],campaigns:[],balance:null,capital:null});}
  async function selectSection(section,{refresh=false}={}){
    if(!sections.some(([key])=>key===section))return;
    const previousScope=s.accountId;if(s.section==='assets')s.assetAccountId=s.accountId;else s.researchAccountId=s.accountId;
    s.section=section;s.accountId=section==='assets'?s.assetAccountId:s.researchAccountId;s.view=section==='assets'?s.assetView:'today';if(previousScope!==s.accountId)clearFacts();saveLocation();render();root()?.querySelector('[data-inv-section="'+section+'"]').focus();await load({force:refresh});
  }
  const tools=(title,content)=>`<details class="inv-tools"><summary>${esc(title)}</summary><div class="inv-actions">${content}</div></details>`;
  function screenView(){return `<section><h3>用条件找到值得研究的候选</h3><p class="inv-muted">先在行情中准备数据，再选择筛选范围；筛选结果用于观察和研究，不会新增真实持仓。</p>
    <article class="inv-route"><div><h4>指定股票池</h4><p>从你登记的沪深股票中按规则筛选，可保存模板和逐项核对结果。</p></div>${button('开始规则选股','browser-screen')}</article>
    <article class="inv-route"><div><h4>全市场资料</h4><p>对已保存的市场快照设置条件，查看命中、排除和资料缺项。</p></div>${button('全市场筛选','market-screen')}</article>
    ${tools('模板、实验与兼容工具',button('规则模板与实验','recipes')+button('策略回测','backtests')+button('策略 IDE','ide')+button('账号缓存筛选（旧版）','screen'))}
    <p class="inv-next">有了候选后，到「研究」保存理由、资料和反证。</p></section>`;}
  function marketView(){return `<section><h3>准备有来源、有日期的行情</h3><p class="inv-muted">证券日线用于指定股票池和资产估值；市场快照与历史资料用于筛选、回放和回测。</p>
    <div class="inv-actions">${button('证券日线','market')}${button('市场与历史资料','market-data')}${button('添加标的','instrument')}</div>
    <h4>已登记证券</h4>${s.instruments.length?`<div class="inv-security-list">${s.instruments.map(i=>`<div><strong>${esc(i.name)}</strong><span>${esc(i.code)} · ${esc(({stock:'股票',etf:'ETF',fund:'场外基金'})[i.kind]||i.kind)}</span></div>`).join('')}</div>`:'<p class="inv-empty">先添加证券身份，再导入或读取对应行情。这里只准备数据，不录入真实持仓。</p>'}
    ${tools('来源、数据核对与提醒',button('数据健康','data-health')+button('行情与查询来源','sources')+button('核对日历与交易规则','check')+button('后台监控与提醒','monitors'))}
    <p class="inv-next">数据准备完成后，到「选股」设置条件，或到「研究」记录判断。</p></section>`;}
  function researchBody(record){
    try{
      const source=JSON.parse(record.content);let summary='';
      if(source.dataset_id&&source.selected&&source.market_date){const values=source.selected.values||{};summary=`<p>来源：${esc(source.source_label)} · 数据日 ${esc(source.market_date)}</p><p>候选：${esc(source.selected.name)} · ${esc(source.selected.code)} · 价格 ${esc(values.close??'未知')} · 成交额 ${esc(values.turnover_cny??'未知')}</p>`;}
      else if(source.algorithm==='browser-screen-rational-v2'&&source.instrument&&source.rule_request){const values=source.screen_values||{};summary=`<p>指定股票池规则筛选 · 截至 ${esc(source.rule_request.as_of)} · 本浏览器计算</p><p>${esc(source.instrument.name)} · ${esc(source.instrument.code)} · 收盘 ${esc(values.close??'未知')} · 成交额 ${esc(values.turnover_cny??'未知')}</p>${(source.details||[]).map(item=>`<p>${esc(({close:'收盘价',turnover_cny:'成交额',turnover_rate_pct:'换手率',volume_ratio_5:'量比',price_above_ma20:'收盘高于MA20'})[item.field]||item.field)}：${esc(item.actual??'未知')} ${esc(item.unit||'')} · ${item.result===true?'满足':item.result===false?'不满足':'无法判定'}${item.reason?' · '+esc(item.reason):''}</p>`).join('')}`;}
      else if(Array.isArray(source.bars)&&source.declared_source){const first=source.bars[0],last=source.bars[source.bars.length-1];summary=`<p>来源：${esc(source.declared_source)} · 数据日 ${esc(last?.date??'未知')} · 摘要展示 ${source.bars.length} 条</p><p>日期范围 ${esc(first?.date??'未知')} 至 ${esc(last?.date??'未知')} · 最近收盘 ${esc(last?.close??'未知')} · 未复权口径由本人声明</p><p>保存条数和摘要不证明交易日完整；缺窗口指标保持未知。</p>`;}
      if(summary)return summary+(Array.isArray(source.limitations)?source.limitations:[]).map(text=>`<p class="inv-muted">${esc(text)}</p>`).join('')+`<details><summary>查看冻结的原始依据</summary><pre class="inv-preserve">${esc(record.content)}</pre></details>`;
    }catch{}
    return `<p class="inv-preserve">${esc(record.content)}</p>`;
  }
  function researchView(){return `<section><h3>把候选变成有依据的判断</h3><p class="inv-muted">保存资料和假设，对照反证；研究记录不会改变真实资产。</p><div class="inv-actions">${button('保存资料或观察','research')}${button('AI研究与建议','analysis')}</div>
    <div class="inv-section-heading"><h4>自选跟踪</h4>${button('添加自选','watch')}</div>${cards(s.watches,w=>`<h4>${esc(instrumentName(w.instrument_id))}</h4><p>${esc(w.reason)}</p>${versions('watchlist',w)}`,'从选股候选中选少量标的持续观察，不会增加真实持仓。')}
    <div class="inv-section-heading"><h4>研究档案</h4>${button('新建研究档案','dossier')}</div>${cards(s.dossiers,d=>`<h4>${esc(d.title)}</h4><p>${esc(d.technical_case||d.market_context||'待补充研究')}</p>${versions('dossiers',d)}`,'整理量价假设、事件、风险与反证。')}
    <h4>资料与观察</h4>${cards(s.research,r=>`<h4>${esc(r.title)}</h4>${researchBody(r)}<p>可获知时间 ${esc(r.available_at)}</p><p>反证：${esc(r.contrary_evidence||'待补充')}</p>`,'可以先留一句观察，之后补来源和反证。')}
    ${tools('预测、报告与历史',button('预测与校准','forecasts')+button('盘前／盘后简报','briefing')+button('AI分析报告','reports')+button('研究历史与查询','full-history')+button('研究归档与对比','research-archive'))}
    ${s.accounts.length?`<details class="inv-tools"><summary>查看已有账本关联的研究资料</summary><label>资料范围<select data-inv-research-scope aria-label="研究资料范围"><option value="">独立研究资料</option>${s.accounts.map(a=>`<option value="${a.id}" ${a.id===s.accountId?'selected':''}>${esc(a.name)}的研究资料</option>`).join('')}</select></label></details>`:''}
    <p class="inv-next">只有开始管理实际现金、持仓和成交时，才需要进入「真实资产」。</p></section>`;}
  function ledgerIntro(){return `<section class="inv-empty"><h3>开始管理真实资产时，再建立投资账本</h3><p>账本记录核对日期的现金、已有持仓，以及之后的成交和资金流水，用于计算实际资产与收益。它不会开通券商账户。</p><div class="inv-actions">${button('创建投资账本','account')}${button('返回研究','research-home')}</div></section>`;}
  function guideLedger(){const d=window.InvestmentPlatformUI.dialog('管理真实资产',ledgerIntro());d.querySelector('[data-inv-action="account"]').onclick=()=>{d.close();act('account');};d.querySelector('[data-inv-action="research-home"]').onclick=()=>{d.close();selectSection('research');};}
  function assetsView(){return `<div class="inv-asset-scope"><label>投资账本<select data-inv-account aria-label="当前投资账本"><option value="">请选择投资账本</option>${s.accounts.map(a=>`<option value="${a.id}" ${a.id===s.accountId?'selected':''}>${esc(a.name)}</option>`).join('')}</select></label>${s.accountId?button('新建账本','account'):''}</div>${!s.accountId?ledgerIntro():`<nav class="inv-tabs inv-subtabs" role="tablist" aria-label="资产管理视图">${[['ledger','交易与持仓'],['today','计划与预算'],['review','资产复盘']].map(([key,title])=>`<button role="tab" aria-selected="${s.view===key}" tabindex="${s.view===key?0:-1}" aria-controls="investment-asset-panel" data-inv-view="${key}">${title}</button>`).join('')}</nav><div id="investment-asset-panel" role="tabpanel" aria-label="${s.view==='ledger'?'交易与持仓':s.view==='today'?'计划与预算':'资产复盘'}">${s.view==='ledger'?ledgerView():s.view==='today'?todayView():reviewView()}</div>`}`;}
  function todayView() {
    const account = s.accounts.find(a => a.id === s.accountId);
    return `<section><h3>先确定资金边界，再写交易计划</h3><p>月度管资金，周度管策略，每日核对执行。条件未到，可以不交易。</p>
      <div class="inv-actions">${button('资金预算','policy')}${button('周／日计划','period')}${button('交易计划','plan')}</div>
      ${account ? `<p class="inv-muted">当前投资账本：${esc(account.name)} · 核对起点 ${esc(account.baseline_date)}</p>` : ''}
      ${s.capital?.policy ? `<article class="inv-record"><h4>当前生效预算 · 版本 ${s.capital.policy.version}</h4><p>实际入金 ${esc(s.capital.actual_deposit)} · 对比拟入金差额 ${esc(s.capital.deposit_gap)}</p><p>实际出金 ${esc(s.capital.actual_withdrawal)} · 对比拟取出差额 ${esc(s.capital.withdrawal_gap)}</p><p>当前账本扣除现金缓冲后 ${esc(money(s.capital.available_after_buffer))}</p>${s.capital.conflicts.includes('new_risk_paused')?'<p class="inv-notice">资金政策已暂停新增风险；实际成交仍可记录。</p>':''}<small>草稿不替换生效版本；估值、总风险与亏损复核线缺行情时仍待核对。</small></article>`:'<p class="inv-notice">当前日期没有已确认资金政策。先核对用途与风险预算，拟入金不会增加账本现金。</p>'}
      <h3>资金政策</h3>${cards(s.policies, p => `<h4>${esc(p.period_start)} 至 ${esc(p.period_end)}</h4><p>${esc(p.purpose || '待补充资金用途')}</p><p>拟入金 ${esc(p.planned_deposit)} · 拟取出 ${esc(p.planned_withdrawal)} · 单笔风险预算 ${esc(money(p.trade_risk_budget))}</p>${p.pause_new_risk ? '<p>已设置暂停新增风险</p>' : ''}${versions('policies',p)}`, '先记录资金用途、用钱需求和能承受的损失。')}
      <h3>周日准备计划</h3>${cards(s.periods,p=>`<h4>${esc(p.title)} · ${p.period==='week'?'周计划':'日计划'}</h4><p>${esc(p.period_start)} 至 ${esc(p.period_end)} · ${esc(p.focus)}</p><p>${p.no_trade?'本期可选择不交易':'按条件准备，不要求交易'}</p>${p.session_dates?`<p>已核对开市日 ${esc(p.session_dates.join('、'))}</p>`:''}${p.state_reason?`<p>状态原因：${esc(p.state_reason)}</p>`:''}${versions('period-plans',p)}`,'周计划关注策略与情景，日计划核对执行；不自动新开仓。')}
      <h3>交易计划</h3>${cards(s.plans, p => `<h4>${esc(p.title)} · ${esc(instrumentName(p.instrument_id))}</h4><p>用途：${esc(({entry:'做多入场',exit:'退出核对，仅研究草稿',observe:'继续观察，仅研究草稿'})[p.intent || 'entry'])}</p><p>${esc(p.rationale)}</p><p>触发：${esc(p.entry_conditions || '待补充')}<br>失效：${esc(p.invalidation || '待补充')}</p><p>有效截至 ${esc(p.valid_until)} · 风险预算 ${esc(money(p.risk_budget))}</p>${button('估算数量与核对','assess',`data-id="${p.id}"`)}${p.assessment_snapshot?`<p>本人核对的条件计划 · 数量 ${esc(p.assessment_snapshot.quantity)} · 最晚复核 ${esc(p.assessment_snapshot.review_on)}</p>`:''}${versions('trade-plans',p)}`, '从少量自选标的开始，先写触发和放弃条件。')}
      </section>`;
  }
  function ledgerView() {
    const balance = s.balance;
    return `<section><h3>实际成交与持仓</h3><div class="inv-actions">${button('记录成交','fill')}${button('资金流水','cash')}${button('资产与估值','portfolio')}</div>${tools('基金、历史与账本维护',button('基金申请与确认','fund')+button('导入成交CSV','csv')+button('完整账本历史','full-history')+button('新增核对事项','notice')+button('导出投资记录','export')+button('关联旧记录','legacy-link')+button('导入分时路径','path-import'))}
      ${balance ? `<dl class="inv-metrics"><div><dt>现金${balance.cash_verified ? '' : '（暂估）'}</dt><dd>${esc(balance.cash)}</dd></div><div><dt>已实现净盈亏</dt><dd>${esc(money(balance.net_realized))}</dd></div><div><dt>总资产</dt><dd>${esc(money(balance.equity))}</dd></div></dl>${balance.warnings.map(w => `<p class="inv-notice">${esc(w)}</p>`).join('')}` : ''}
      <p class="inv-muted">未录入行情时不推算浮动盈亏；费用留空表示尚未核对。这里只记录实际成交。</p>
      <h3>持仓</h3>${cards(balance?.positions || [], p => `<h4>${esc(instrumentName(p.instrument_id))}</h4><p>${p.quantity_verified===false?'所录数量（待核对）':'数量'} ${esc(p.quantity)} · 成本${p.fees_complete && p.settlements_complete!==false ? '' : '（暂估）'} ${esc(money(p.cost))}</p>`, '尚无持仓。')}
      <h3>账实核对事项</h3>${cards(s.notices,n=>`<h4>${esc(instrumentName(n.instrument_id))} · ${n.status==='open'?'待核对':'本人已核对'}</h4><p>${esc(n.reason)}</p><p>${esc(n.resolution || '尚未记录处理结果')}</p><small>系统不自动处理拆分、份额折算等公司行动。先核对并补齐真实事实，再填写处理说明；解除标记不会修改账本。</small>${versions('ledger-notices',n)}`,'如发现公司行动、份额折算或账实差异，先标记核对；不继续把旧数量与收益当作已验证。')}
      <h3>最近成交</h3>${cards(s.fills, f => `<h4>${esc(instrumentName(f.instrument_id))} · ${f.side === 'buy' ? '买入' : '卖出'}</h4><dl class="inv-fill"><div><dt>成交价格</dt><dd>${esc(f.price)}</dd></div><div><dt>数量</dt><dd>${esc(f.quantity)}</dd></div></dl><p>手续费 ${esc(money(f.fee))} · 税费 ${esc(money(f.tax))}</p><small>${esc(f.executed_at)} · ID ${esc(f.id)}</small>${button('核对更正','correction',`data-id="${f.id}"`)}`, '记录第一笔实际成交，刷新后可继续查看。')}
      <h3>基金申请与到账</h3>${cards(s.fundOrders, o => `<h4>${esc(instrumentName(o.instrument_id))} · ${o.side==='subscription'?'申购':'赎回'}</h4><p>${esc(({pending:'待确认',partially_confirmed:'部分确认，待继续核对',confirmed:'已确认，待到账',settled:'已完成'})[o.state] || o.state)} · 待到账 ${esc(o.receivable || '0')}</p>${o.confirmations?.map(b=>`<p>批次净值 ${esc(b.price)} · 份额 ${esc(b.quantity)} · 费用 ${esc(b.fee)} · 净值日 ${esc(b.nav_date)}</p>`).join('') || ''}${['pending','partially_confirmed'].includes(o.state)?button('确认净值与份额','fund-confirm',`data-id="${o.id}"`):o.state==='confirmed'?button('登记赎回到账','fund-settle',`data-id="${o.id}"`):''}`, '申请、确认和到账分别记录，尚未到账的赎回不增加现金。')}
      <h3>完整交易链</h3>${cards(s.campaigns, c => `<h4>${esc(instrumentName(c.instrument_id))} · ${esc(label[c.state])}</h4><p>剩余 ${esc(c.quantity)} · 已实现净盈亏 ${esc(money(c.net_realized))} · R ${esc(money(c.realized_r))}</p><small>R按冻结的实际入场价格差风险和费用预算计算，非最大损失保证；无事前预算不计算。同投资账本同标的一条进行中交易链。</small>${button('对照复盘','campaign-review',`data-id="${c.id}"`)}${button('路径复盘','path-replay',`data-id="${c.id}" data-instrument="${c.instrument_id}"`)}`, '成交后自动整理分批进出，周末不重置。')}</section>`;
  }
  function reviewView() {
    return `<section><h3>先记录事实，再形成下一项试验</h3><div class="inv-actions">${button('写复盘','review')}${button('周期统计与建议跟踪','summary')}</div>${tools('策略与验证',button('新增策略','strategy')+button('形成试验原则','principle')+button('新建前向试验','experiment')+button('前向试验列表','experiments')+button('撮合情景验证','execution-studies'))}
      <h3>复盘与思考</h3>${cards(s.reviews, r => `<h4>${esc(r.date)} · ${esc(({day:'盘后',campaign:'完整交易',week:'周复盘',month:'月复盘',quarter:'季度',event:'事件',thought:'思考'})[r.period])}</h4><p class="inv-preserve">${esc(r.text)}</p>${r.execution ? `<p>执行：${esc(r.execution)}</p>` : ''}${r.next_experiment ? `<p>下一项试验：${esc(r.next_experiment)}</p>` : ''}<p>执行评价：${esc(({followed:'遵守规则',deviated:'偏离规则',unknown:'尚未评价'})[r.adherence || 'unknown'])} · 逻辑验证：${esc(({supported:'获得支持',refuted:'出现反证',unknown:'尚未判定'})[r.thesis || 'unknown'])}</p>${r.no_trade ? '<p>本次未交易</p>' : ''}${button('生成改进行动','review-action',`data-id="${r.id}" data-version="${r.version}"`)}${button('查看行动引用','action-refs',`data-id="${r.id}"`)}${versions('reviews',r)}`, '一句话也可以保存。盈利、亏损与是否遵守计划分别评价。')}
      <h3>原则与规则试验</h3>${cards(s.principles,p=>`<h4>${esc(p.title)}</h4><p>${esc(p.rule)}</p><p>支持：${esc(p.supporting_case || '待补充')}<br>反例：${esc(p.contrary_case || '待补充')}</p><p>验证范围：${esc(p.validation_scope || '待定义')}</p><small>确认仅表示本人开始试验，不证明有效，不自动修改策略或扩大风险。</small>${versions('principles',p)}`,'先保留原始复盘，再形成有反例和试验范围的候选规则。')}
      <h3>策略</h3>${cards(s.strategies, p => `<h4>${esc(p.title)}</h4><p>入场：${esc(p.entry_conditions || '待补充')}<br>退出：${esc(p.exit_conditions || '待补充')}</p><p>验证：${esc(p.validation_scope || '待定义')}</p>${versions('strategies',p)}`, '先形成一套可验证的方法，不要求每天交易。')}</section>`;
  }
  function workspaceHTML(){return `<div class="inv-workspace"><header class="inv-platform-heading"><div><h2>投资平台</h2><p class="inv-muted">找候选、看数据、做研究；真实资产单独记账。</p></div>${button('刷新','refresh')}</header>
    <nav class="inv-tabs inv-primary-tabs" role="tablist" aria-label="投资功能">${sections.map(([key,title])=>`<button type="button" role="tab" aria-selected="${s.section===key}" tabindex="${s.section===key?0:-1}" aria-controls="investment-panel" data-inv-section="${key}">${title}</button>`).join('')}</nav>
    <p data-inv-status role="status" aria-live="polite"></p>
    <div id="investment-panel" role="tabpanel" aria-label="${esc(sections.find(([key])=>key===s.section)?.[1]||'选股')}">${s.section==='screen'?screenView():s.section==='market'?marketView():s.section==='research'?researchView():assetsView()}</div>
    <footer class="inv-platform-footnote">${s.section==='assets'?'实际资产按所选投资账本核对。':`资料范围：${esc(s.accounts.find(a=>a.id===s.accountId)?.name||'独立研究')}。研究不增加持仓。`} 私人资料保存于当前登录账号。</footer></div>`;}
  function bindTabs(selector,select){const tabs=[...root().querySelectorAll(selector)];tabs.forEach((tab,index)=>{tab.onclick=()=>select(tab);tab.onkeydown=e=>{const target=e.key==='ArrowRight'?(index+1)%tabs.length:e.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:e.key==='Home'?0:e.key==='End'?tabs.length-1:null;if(target===null)return;e.preventDefault();select(tabs[target]);};});}
  function render(){
    if(!root())return;root().innerHTML=workspaceHTML();
    const ledgerSelect=root().querySelector('[data-inv-account]');if(ledgerSelect)ledgerSelect.onchange=e=>{s.accountId=e.target.value||null;s.assetAccountId=s.accountId;clearFacts();render();load();};
    const researchSelect=root().querySelector('[data-inv-research-scope]');if(researchSelect)researchSelect.onchange=e=>{s.accountId=e.target.value||null;s.researchAccountId=s.accountId;clearFacts();render();load();};
    bindTabs('[data-inv-section]',tab=>selectSection(tab.dataset.invSection));
    bindTabs('[data-inv-view]',tab=>{s.view=tab.dataset.invView;s.assetView=s.view;saveLocation();render();root().querySelector('[data-inv-view="'+s.view+'"]').focus();load({force:false});});
    root().querySelectorAll('[data-inv-action]').forEach(control=>control.onclick=()=>act(control.dataset.invAction,control.dataset));
    if(s.loading){loadingControls(true);status('正在读取投资记录…');}
  }

  const field = (key,text,type='text',value='', extra={}) => ({key,text,type,value,...extra});
  const select = (key,text,items,value='') => field(key,text,'select',value,{items});
  const multi = (key,text,items) => field(key,text,'multi',[],{items,optional:true});
  function formFor(action) {
    const aid = s.accountId;
    const securities = options(s.instruments,i => `${i.name} · ${i.code}`);
    const strategyOptions = [['','暂不关联'], ...options(s.strategies,i => `${i.title} · ${label[i.state] || ''}`)];
    if (action === 'account') return {kind:'accounts',title:'新建投资账本',fields:[field('name','投资账本名称'),field('baseline_date','核对基准日','date',today()),field('opening_cash','期初现金','decimal')]};
    if (action === 'instrument') return {kind:'instruments',title:'添加标的',fields:[field('code','证券代码'),field('name','证券名称'),select('market','市场',[['SSE','上海'],['SZSE','深圳'],['BSE','北京'],['FUND','场外基金']],'SSE'),select('kind','品种',[['etf','ETF'],['stock','股票'],['fund','场外基金']],'etf')]};
    if (!aid && !['research','watch','dossier','strategy','check'].includes(action)) throw new Error('管理真实资产前，请创建或选择投资账本。');
    if (action === 'fill') {
      if (!securities.length) throw new Error('请先添加标的。');
      return {kind:'fills',title:'记录实际成交',base:{account_id:aid},fields:[select('instrument_id','成交标的',securities),select('side','操作',[['buy','买入'],['sell','卖出']],'buy'),field('price','成交价格','decimal'),field('quantity','成交数量','decimal'),field('fee','手续费','decimal','',{optional:true}),field('tax','税费','decimal','',{optional:true}),field('executed_at','成交时间','datetime-local',dateTime()),{...select('plan_id','关联事前计划',[['','无关联计划'],...options(s.plans,p=>`${p.title} · ${label[p.state] || p.state}`)]),optional:true},field('plan_version','历史计划版本（不填自动匹配）','integer','',{optional:true}),field('external_id','外部成交编号','text','',{optional:true}),field('note','备注','textarea','',{optional:true})]};
    }
    if (action === 'research') return {kind:'research',title:'保存研究资料',base:{account_id:aid},fields:[field('title','资料标题'),field('content','资料原文或观察','textarea'),{...select('instrument_id','关联标的',[['','不关联'],...securities]),optional:true},field('source_url','原始链接','text','',{optional:true}),field('locator','原文位置','text','',{optional:true}),field('available_at','资料可获知时间','datetime-local',dateTime()),field('period_end','资料统计期末','date','',{optional:true}),field('contrary_evidence','反对证据','textarea','',{optional:true})]};
    if (action === 'fund') {
      const funds=options(s.instruments.filter(i=>i.kind==='fund'),i=>`${i.name} · ${i.code}`);
      if(!funds.length) throw new Error('请先添加场外基金标的。');
      return {kind:'fund-orders',title:'基金申请',base:{account_id:aid},fields:[select('instrument_id','基金标的',funds),select('side','申请类型',[['subscription','申购'],['redemption','赎回']]),field('applied_at','申请时间','datetime-local',dateTime()),field('amount','申购金额','decimal','',{optional:true}),field('quantity','赎回份额','decimal','',{optional:true}),field('note','备注','textarea','',{optional:true})]};
    }
    if (action === 'cash') return {kind:'cash-events',title:'资金流水',base:{account_id:aid},fields:[select('kind','流水类型',[['deposit','入金'],['withdrawal','出金'],['dividend','分红'],['interest','利息'],['fee','其他费用']]),field('amount','金额','decimal'),field('occurred_at','发生时间','datetime-local',dateTime()),field('note','备注','textarea','',{optional:true})]};
    if (action === 'check') return {kind:'plan-checks',title:'本人核对日历与交易规则',message:'按券商与交易所原文核对具体证券，不自动推断ETF制度。日历必须逐日连续覆盖收盘资料日、当前日及持有期，休市日也要填写。核对记录保留，不会独立证明资料真实或保证成交。',fields:[select('instrument_id','核对标的',securities),field('quote_price','最近完成开市日的收盘价','decimal'),field('quote_as_of','收盘资料时点','datetime-local'),field('sessions','逐日日历（每行：日期,开市 或 日期,休市）','textarea'),field('rules_valid_from','规则适用开始','date',today()),field('rules_valid_until','规则适用截至','date',today()),field('price_tick','最小价格变动单位','decimal'),field('quantity_step','买入数量递增单位','decimal'),field('minimum_quantity','最低买入数量','decimal'),field('sell_delay_sessions','买入后至少间隔的开市日数','integer'),select('trading_status','已核对交易状态',[['unknown','尚未核对'],['normal','正常'],['halted','停牌或受限']]),field('source_url','核对原始链接'),field('source_note','资料位置与核对说明','textarea'),field('acknowledged','本人已核对资料和适用证券','checkbox',false)]};
    if (action === 'period') return {kind:'period-plans',title:'周日准备计划',base:{account_id:aid},fields:[field('title','准备计划标题'),select('period','准备周期',[['day','日计划'],['week','周计划（周一至周日）']]),field('period_start','准备开始日期','date',today()),field('period_end','准备结束日期','date',today()),field('focus','本期关注与检查事项','textarea'),field('contrary_evidence','本期反对理由','textarea','',{optional:true}),select('strategy_id','关联策略',strategyOptions),{...select('check_id','本人核对资料',[['','尚未核对'],...options(s.checks,c=>`${instrumentName(c.instrument_id)} · ${c.quote_as_of}`)]),optional:true},field('no_trade','本期选择不交易','checkbox',false)]};
    if (action === 'watch') return {kind:'watchlist',title:'自选跟踪',base:{account_id:aid},fields:[select('instrument_id','跟踪标的',securities),select('stage','跟踪阶段',[['observing','观察'],['researching','研究中'],['ready','条件准备'],['held','持有关注'],['archived','已归档']]),field('reason','关注理由','textarea','',{optional:true}),field('next_check','下次核对日期','date','',{optional:true})]};
    if (action === 'dossier') return {kind:'dossiers',title:'股票与ETF结构化研究',base:{account_id:aid},fields:[field('title','研究标题'),select('instrument_id','研究标的',securities),select('horizon','研究持有视角',[['short','短线'],['swing','波段']]),...([['market_context','市场与板块'],['technical_case','量价假设'],['catalyst','催化事件'],['company_risk','公司风险'],['valuation_assumptions','估值假设'],['liquidity','流动性'],['nav_context','ETF净值与时差'],['portfolio_impact','组合影响'],['contrary_case','反对理由'],['missing_inputs','缺少输入']].map(([k,t])=>field(k,t,'textarea','',{optional:true}))),multi('evidence_ids','选择相关原始资料',options(s.research,r=>r.title))]};
    if(action==='experiment') {
      const approved=s.strategies.filter(x=>x.state==='confirmed').map(x=>({...x}));
      if(!approved.length)throw new Error('请先保存并确认一套策略，再登记前向试验。');
      const start=new Date(Date.now()+8*3600000+3600000).toISOString().slice(0,16),end=new Date(Date.now()+8*3600000+7*86400000).toISOString().slice(0,16);
      return {kind:'experiments',title:'新建前向观察试验',message:'先保存草稿，再在开始前显式登记。登记后冻结策略版本、参数、成本假设和期间；全部相符策略版本的盈亏都会列入，不自动增加风险，也不是样本外回测。',base:{account_id:aid},fields:[field('title','试验标题'),select('strategy_id','试验策略',options(approved,x=>`${x.title} · 版本 ${x.version}`)),field('hypothesis','待验证假设','textarea'),field('counter_case','试验反例','textarea'),field('stop_condition','停止观察条件','textarea'),field('parameters','参数记录（每行 名称=值）','textarea'),field('cost_assumptions','成本与样本核对约定','textarea'),field('start_at','试验开始时间','datetime-local',start),field('end_at','试验结束时间','datetime-local',end),field('sample_target','复核样本目标','integer'),field('additional_roundtrip_costs','额外每条完整交易成本压力（元，逗号分隔）','text','0')],transform:values=>{
        const parameters={};for(const line of values.parameters.trim().split('\n')){const split=line.indexOf('=');if(split<1)throw new Error('参数请逐行填写名称=值。');const key=line.slice(0,split).trim();if(Object.hasOwn(parameters,key))throw new Error('参数名不可重复。');Object.defineProperty(parameters,key,{value:line.slice(split+1).trim(),enumerable:true});}
        const strategy=approved.find(x=>x.id===values.strategy_id);if(!strategy)throw new Error('请重新选择已确认策略版本。');
        return {...values,parameters,strategy_version:strategy.version,additional_roundtrip_costs:values.additional_roundtrip_costs.replaceAll('，',',').split(',').map(x=>x.trim())};
      }};
    }
    if (action === 'principle') return {kind:'principles',title:'形成可验证的试验原则',message:'从本人确认的事实出发，保留支持与反例。开始试验不会自动改变策略或交易风险。',base:{account_id:aid},fields:[field('title','原则标题'),field('rule','候选规则','textarea'),field('supporting_case','支持案例','textarea','',{optional:true}),field('contrary_case','反例与失效情形','textarea','',{optional:true}),field('validation_scope','前向试验范围','textarea','',{optional:true}),multi('source_review_ids','选择原始复盘',options(s.reviews,r=>`${r.date} · ${r.text.slice(0,60)}`))]};
    if (action === 'notice') return {kind:'ledger-notices',title:'记录账实核对事项',base:{account_id:aid},fields:[select('instrument_id','核对证券',securities),select('kind','差异类型',[['corporate_action','公司行动或份额折算'],['missing_fact','遗漏事实'],['cost_or_fee','成本或费用'],['other','其他']]),field('observed_at','发现时间','datetime-local',dateTime()),field('reason','待核对原因','textarea'),field('source_url','核对资料链接','text','',{optional:true}),select('status','核对状态',[['open','待核对'],['resolved','本人核对完成']]),field('resolution','处理与核对说明','textarea','',{optional:true})]};
    if (action === 'policy') return {kind:'policies',title:'资金预算',base:{account_id:aid},fields:[field('period_start','开始日期','date',today()),field('period_end','结束日期','date',today()),field('purpose','资金用途','textarea'),field('liquidity_needs','近期用钱需求','textarea'),field('loss_capacity','能承受的损失','textarea'),field('planned_deposit','拟入金','decimal','0'),field('planned_withdrawal','拟取出','decimal','0'),field('cash_buffer','现金缓冲','decimal','',{optional:true}),field('trade_risk_budget','单笔风险预算','decimal','',{optional:true}),field('max_exposure','最大持仓金额','decimal','',{optional:true}),field('loss_review_line','亏损复核线','decimal','',{optional:true}),field('pause_new_risk','暂停新增风险','checkbox',false)]};
    if (action === 'strategy') return {kind:'strategies',title:'新增策略',fields:[field('title','策略名称'),field('environment','适用环境','textarea','',{optional:true}),field('entry_conditions','入场条件','textarea'),field('exclusions','排除条件','textarea','',{optional:true}),field('exit_conditions','退出条件','textarea'),field('validation_scope','验证范围','textarea')]};
    if (action === 'plan') {
      if (!securities.length) throw new Error('请先添加标的。');
      return {kind:'trade-plans',title:'交易计划草稿',base:{account_id:aid},fields:[field('title','计划标题'),select('intent','计划用途',[['entry','做多入场'],['exit','退出核对（研究草稿）'],['observe','继续观察（研究草稿）']]),select('instrument_id','计划标的',securities),select('strategy_id','关联策略',strategyOptions),field('rationale','交易理由','textarea','',{optional:true}),field('entry_conditions','触发条件','textarea','',{optional:true}),field('invalidation','失效条件','textarea','',{optional:true}),field('contrary_evidence','反对理由','textarea','',{optional:true}),field('risk_budget','风险预算','decimal','',{optional:true}),field('holding_sessions','预计持有交易日','integer','',{optional:true}),field('entry_price','计划入场价格','decimal','',{optional:true}),field('invalidation_price','计划失效价格','decimal','',{optional:true}),field('fee_budget','预计本次进出总费用','decimal','',{optional:true}),field('planned_for','计划开市日','date',today(),{optional:true}),{...select('check_id','本人核对资料',[['','尚未核对'],...options(s.checks,c=>`${instrumentName(c.instrument_id)} · ${c.quote_as_of}`)]),optional:true},field('valid_until','有效截至','datetime-local',dateTime())]};
    }
    if (action === 'review') return {kind:'reviews',title:'写复盘',base:{account_id:aid},fields:[select('campaign_id','关联交易链',[['','不关联'],...options(s.campaigns,c=>`${instrumentName(c.instrument_id)} · ${label[c.state]}`)]),field('date','记录日期','date',today()),select('period','复盘周期',[['day','盘后'],['campaign','完整交易'],['week','每周'],['month','每月'],['quarter','季度'],['event','事件'],['thought','投资思考']]),field('text','复盘原文','textarea'),field('judgment','判断依据','textarea','',{optional:true}),field('execution','执行情况','textarea','',{optional:true}),field('next_experiment','下一项试验','textarea','',{optional:true}),select('adherence','执行评价',[['unknown','尚未评价'],['followed','遵守规则'],['deviated','偏离规则']]),select('thesis','逻辑验证',[['unknown','尚未判定'],['supported','获得支持'],['refuted','出现反证']]),field('no_trade','本次未交易','checkbox',false)]};
    throw new Error('此操作尚未开放。');
  }

  function closeDialog() {if (dialog) {dialog.close();dialog.remove();dialog=null;}}
  function openForm(spec) {
    closeDialog();
    dialog=document.createElement('dialog');dialog.className='inv-dialog';
    dialog.setAttribute('aria-labelledby','inv-dialog-title');
    dialog.innerHTML=`<form><h3 id="inv-dialog-title">${esc(spec.title)}</h3>${spec.message?`<p>${esc(spec.message)}</p>`:''}<div class="inv-form">${spec.fields.map(f => {
      const value=esc(f.value),id='inv-field-'+f.key;
      const optional=f.optional || ['strategy_id','campaign_id'].includes(f.key) ? '' : 'required';
      const input=f.type==='multi' ? `<select multiple id="${id}" name="${f.key}" aria-label="${esc(f.text)}">${f.items.map(([v,t])=>`<option value="${esc(v)}" ${(f.value || []).includes(v)?'selected':''}>${esc(t)}</option>`).join('')}</select>` : f.type==='select' ? `<select id="${id}" name="${f.key}" aria-label="${esc(f.text)}" ${optional}>${f.items.map(([v,t]) => `<option value="${esc(v)}" ${v===f.value?'selected':''}>${esc(t)}</option>`).join('')}</select>` : f.type==='textarea' ? `<textarea id="${id}" name="${f.key}" rows="3" ${optional}>${value}</textarea>` : f.type==='checkbox' ? `<input id="${id}" name="${f.key}" type="checkbox" ${f.value?'checked':''}>` : `<input id="${id}" name="${f.key}" type="${['decimal','integer'].includes(f.type)?'text':f.type}" ${['decimal','integer'].includes(f.type)?'inputmode="decimal"':''} value="${value}" ${optional}>`;
      return `<label for="${id}">${esc(f.text)}${f.optional?'（可留空）':''}${input}</label>`;
    }).join('')}</div><p role="alert" data-inv-form-error></p><div class="inv-actions"><button class="btn" type="button" data-inv-cancel>取消</button><button class="btn primary" type="submit">保存</button></div></form>`;
    document.body.append(dialog);dialog.showModal();
    const currentDialog=dialog;currentDialog.dataset.accountId=s.accountId||'';
    currentDialog.querySelector('[data-inv-cancel]').onclick=closeDialog;
    currentDialog.addEventListener('close',()=> {currentDialog.remove();if(dialog===currentDialog)dialog=null;});
    if(spec.kind==='plan-checks')attachRulePrefill(currentDialog,spec);
    const referenceKinds={instrument_id:'instruments',strategy_id:'strategies',plan_id:'trade-plans',check_id:'plan-checks'};
    for(const [key,kind] of Object.entries(referenceKinds)){const select=currentDialog.querySelector(`select[name="${key}"]`);if(select)window.InvestmentPortfolio?.referenceSearch(currentDialog,select,kind);}
    let requestKey=crypto.randomUUID(), priorBody=null, saving=false;
    currentDialog.querySelector('form').onsubmit=async event => {
      event.preventDefault();if(saving)return;
      const data={...(spec.base || {})};
      for (const f of spec.fields) {
        const input=currentDialog.querySelector(`[name="${f.key}"]`);
        const value=input.value.trim();
        data[f.key]=f.type==='multi' ? [...input.selectedOptions].map(o=>o.value) : f.type==='checkbox' ? input.checked : f.type==='integer' ? (value===''?null:Number(value)) : f.type==='datetime-local' ? (value.length===16?value+':00':value)+'+08:00' : value;
        if (value==='' && f.optional && (['decimal','integer','date','select'].includes(f.type) || ['external_id','source_url','check_id'].includes(f.key))) data[f.key]=null;
        if (['strategy_id','campaign_id','instrument_id','check_id','plan_id'].includes(f.key) && value==='') data[f.key]=null;
      }
      const outgoing=spec.transform ? spec.transform(data) : data;
      const body=JSON.stringify(outgoing);
      if (priorBody!==null && priorBody!==body) requestKey=crypto.randomUUID();
      priorBody=body;saving=true;
      const controls=currentDialog.querySelectorAll('input,select,textarea,button');controls.forEach(c=>c.disabled=true);
      currentDialog.oncancel=event=>event.preventDefault();
      try {
        const path=spec.edit ? `${spec.kind}/${spec.edit.id}` : spec.kind;
        const payload=spec.edit ? JSON.stringify({version:spec.edit.version,data:outgoing}) : body;
        const result=await api(path,{method:spec.edit ? 'PUT':'POST',headers:{'Idempotency-Key':requestKey},body:payload});
        if(spec.kind==='accounts')s.accountId=result.id;
        closeDialog();await load();
        if(spec.kind.endsWith('/actions'))status('已安排改进行动，未复制私人复盘正文或金额。');
        if(spec.kind==='experiments')status('已保存试验草稿，请打开前向试验列表，在开始前登记。');
        if(spec.kind==='legacy-links')status('已保存旧记录关联；旧估算未计入新账盈亏。');
      } catch(error) {currentDialog.querySelector('[data-inv-form-error]').textContent=error.message;}
      finally {saving=false;controls.forEach(c=>c.disabled=false);currentDialog.oncancel=null;}
    };
    currentDialog.querySelector('input,select,textarea')?.focus();
  }

  function attachRulePrefill(d,spec) {
    const panel=document.createElement('div');panel.className='inv-notice';
    panel.innerHTML='<button type="button" class="btn" data-reference>自动填入公开规则与日历</button><p role="status" data-reference-status>无需行情凭证。自动核对公开规则的已覆盖部分；价格、停牌状态及投资账本权限仍需本人核对。</p>';
    d.querySelector('h3').after(panel);
    const controls=d.querySelector('form').elements,button=panel.querySelector('button'),message=panel.querySelector('p');
    const generated=['sessions','rules_valid_from','rules_valid_until','price_tick','quantity_step','minimum_quantity','sell_delay_sessions'];
    controls.instrument_id.addEventListener('change',()=>{
      if(spec.base?.rulebook_id){for(const key of generated)controls[key].value='';controls.quote_price.value='';controls.quote_as_of.value='';delete spec.base.rulebook_id;}
      message.textContent='标的已变更，请重新核对；不会沿用前一标的的自动依据。';
    });
    button.onclick=async()=>{
      const id=controls.instrument_id.value,instrument=s.instruments.find(i=>i.id===id);if(!instrument)return;
      button.disabled=true;
      try {
        const start=new Date(Date.now()+8*3600000-7*86400000).toISOString().slice(0,10);
        const end=new Date(Date.now()+8*3600000+30*86400000).toISOString().slice(0,10);
        const [rules,cal,data]=await Promise.all([api(`instruments/${encodeURIComponent(id)}/rules?on=${today()}`),api('calendar?'+new URLSearchParams({market:instrument.market,start,end})),api(`instruments/${encodeURIComponent(id)}/data-status`)]);
        if(!d.isConnected || controls.instrument_id.value!==id)return;
        if(rules.status!=='available' || cal.status!=='available')throw new Error('该标的、日期或规则复核期限不在自动覆盖内，请使用原始资料人工核对。');
        for(const key of ['price_tick','quantity_step','minimum_quantity','sell_delay_sessions'])controls[key].value=rules.rules[key]??'';
        controls.sessions.value=Object.entries(cal.sessions).map(([day,open])=>day+','+(open?'开市':'休市')).join('\n');
        controls.rules_valid_from.value=today();controls.rules_valid_until.value=end<rules.review_until?end:rules.review_until;
        controls.source_url.value=rules.source_url;
        controls.source_note.value='公开规则参考 '+rules.rulebook_id+'；仅竞价限价买入。价格、当前交易状态、投资账本权限及ETF具体机制另核对。';
        spec.base={...(spec.base || {}),rulebook_id:rules.rulebook_id};
        controls.trading_status.value='unknown';controls.acknowledged.checked=false;
        message.textContent='已填入公开参考。当前资料：'+({missing:'尚无行情记录',stale:'数据过期',latest_completed_session:'最近完成开市日的日线',incomplete_or_future:'日线未完成或超前',coverage_unknown:'日历覆盖未知'})[data.status]+'；未核验实时状态。'+(rules.rules.sell_delay_sessions===null?'ETF可卖机制未知，请查具体基金文件后填写。':'请补收盘价与时点，并本人核对状态后保存。');
      }catch(error){if(d.isConnected)message.textContent=error.message;}
      finally{button.disabled=false;}
    };
  }

  async function act(action, data={}) {
    try {
      if(action==='research-home')return await selectSection('research');
      if(action==='go-market')return await selectSection('market');
      if(!s.accountId && ['portfolio','policy','period','plan','fill','cash','fund','csv','legacy-link','path-import','path-replay','execution-studies','condition-drills','experiments','summary'].includes(action)){guideLedger();return;}
      if(action==='refresh') return await load();
      if(action==='account' && window.InvestmentPortfolio)return await window.InvestmentPortfolio.account({instruments:s.instruments,onSaved:async account=>{s.section='assets';s.accountId=s.assetAccountId=account.id;s.view=s.assetView='ledger';saveLocation();render();await load();}});
      if(action==='full-history')return await window.InvestmentPortfolio.history({accountId:s.accountId});
      if(action==='data-health')return await window.InvestmentPortfolio.health({accountId:s.accountId});
      if(action==='portfolio')return await window.InvestmentPortfolio.open({accountId:s.accountId,account:s.accounts.find(a=>a.id===s.accountId),instruments:s.instruments,refresh:load});
      if(action==='private-search')return await searchDialog();
      if(action==='execution-studies')return await window.InvestmentMarket.executionStudies({accountId:s.accountId});
      if(action==='condition-drills')return await window.InvestmentMarket.conditionDrills({accountId:s.accountId});
      if(action==='experiments') {
        if(!s.accountId)throw new Error('请先选择投资账本。');
        if(!window.InvestmentMarket)throw new Error('试验入口尚未载入，请刷新。');
        return await window.InvestmentMarket.experiments({accountId:s.accountId,onEdit:id=>act('edit',{kind:'experiments',id})});
      }
      if(action==='path-import' || action==='path-replay') {
        if(!window.InvestmentMarket)throw new Error('路径入口尚未载入，请刷新。');
        if(!s.accountId)throw new Error('请先选择投资账本。');
        return await (action==='path-import'?window.InvestmentMarket.pathImport({accountId:s.accountId,instruments:s.instruments,refresh:load}):window.InvestmentMarket.replay({accountId:s.accountId,campaignId:data.id,instrumentId:data.instrument}));
      }
      if(action==='readiness') {
        const result=await api('readiness');closeDialog();const d=document.createElement('dialog');dialog=d;d.className='inv-dialog';
        d.innerHTML=`<h3>配置与验收要求</h3><p>手工记账、CSV和公开规则参考不需要付费行情或AI凭证。</p><h4>AI配置</h4><p>在设置中填写自己的HTTPS Base URL、API Key和准确模型ID；须支持OpenAI兼容流式聊天及要求的JSON输出。</p><p>${esc(result.ai.cost)}</p><h4>盘后行情</h4><p>AKShare / 东方财富无需Token，支持沪深股票和ETF未复权日线；请先核对使用范围，公开接口可能延迟或限流。</p><p>Tushare Token和daily权限；公开日历覆盖内不需要trade_cal权限。选择供应商日历时另核对trade_cal，ETF另核对fund_daily权限/配额和本人用途许可。Token仅请求时填写，不写入投资记录。</p><h4>未开放</h4><p>分钟/实时权限另行验收，填入Token不会自动开放。真实模型效果和供应商账号权限目前未验证。</p><p>不需要券商登录密码、交易密码或短信验证码。请勿在聊天或文档中粘贴密钥。</p><p>公开规则复核截至 ${esc(result.automatic_reference.review_until)}，超过期限将停止自动填入。</p><button type="button" class="btn">关闭</button>`;
        document.body.append(d);d.showModal();d.querySelector('button').onclick=closeDialog;return;
      }
      if(action==='pause-principle'){await api(`principles/${data.id}/state`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:Number(data.version),state:'paused',reason:'本人暂停试验'})});return await load();}
      if(action==='review-action')return openForm({kind:`reviews/${data.id}/actions`,title:'把改进安排为行动',message:'仅把下列本人填写的标题和日期保存到行动，不自动复制复盘正文、证券或金额；不会标记课程完成。',base:{source_version:Number(data.version)},fields:[field('title','改进行动标题','text','核对原始资料'),field('date','行动日期','date',today())]});
      if(action==='action-refs') {
        const result=await api(`reviews/${encodeURIComponent(data.id)}/actions`);
        closeDialog();dialog=document.createElement('dialog');dialog.className='inv-dialog';
        dialog.innerHTML=`<h3>已关联的改进行动</h3>${result.items.map(r=>`<article class="inv-record"><p>${r.availability==='available'?'行动仍可查看':'行动已不可用，原复盘与引用保留'}</p><p>来源复盘版本 ${r.source_version}</p>${r.availability==='available'?`<button type="button" class="btn" data-action-open="${esc(r.action_id)}">打开行动</button>`:''}</article>`).join('') || '<p>尚未安排改进行动。</p>'}<button class="btn" data-close>关闭</button>`;
        document.body.append(dialog);dialog.showModal();dialog.querySelector('[data-close]').onclick=closeDialog;
        dialog.querySelectorAll('[data-action-open]').forEach(b=>b.onclick=async()=>{try{if(!window.ActionPlans)throw new Error('行动入口未载入。');const id=b.dataset.actionOpen;closeDialog();if(window.goTab?.('action-plans')===false)return;await window.ActionPlans.openRecord(id);}catch(error){status(error instanceof TypeError?'连接暂时中断，已保存记录未清除。请恢复连接后点击刷新重试。':error.message,true);}});return;
      }
      if(action==='legacy-link') {
        const result=await api('legacy-records');
        if(!result.items.length)throw new Error('当前账号没有旧投资记录。');
        return openForm({kind:'legacy-links',title:'本人核对后关联旧记录',message:'旧结果是历史估算，不会复制成成交或计入新账净盈亏。先在交易簿补齐真实事实，再关联；缺成本的旧卖出不能据此补造收益。',fields:[select('legacy_id','旧记录',result.items.map(v=>[v.original.id,`${v.original.date} · ${v.original.stock_name} · ${v.original.action}（历史估算）`])),select('target_id','关联成交或复盘',[...s.fills.map(f=>['fills:'+f.id,`成交 · ${instrumentName(f.instrument_id)} · ${f.side==='buy'?'买入':'卖出'} ${f.quantity} · ${f.executed_at}`]),...s.reviews.map(r=>['reviews:'+r.id,`复盘 · ${r.date} · ${r.text.slice(0,60)}`])]),field('note','本人核对说明','textarea'),field('reconciled','本人已核对原始资料和关联事实','checkbox',false)],transform:values=>{const separator=values.target_id.indexOf(':');return {...values,target_kind:values.target_id.slice(0,separator),target_id:values.target_id.slice(separator+1)};}});
      }
      if(action==='summary')return await periodDialog();
      if(action==='non-trade')return openForm({kind:`${data.kind}/${data.id}/state`,title:'记录未交易决定',base:{version:Number(data.version)},fields:[select('state','处理结果',[['untriggered','条件未触发'],['skipped','主动跳过'],['declined','主动放弃'],['expired','计划已到期']]),field('reason','决定原因','textarea')]});
      if(action==='assess') {
        const result=await api(`trade-plans/${encodeURIComponent(data.id)}/assessment`);
        closeDialog();dialog=document.createElement('dialog');dialog.className='inv-dialog';
        dialog.innerHTML=`<h3>条件计划数量估算</h3><p>估算数量 ${esc(result.quantity)} · 计划价格差损失含费用 ${esc(result.planned_loss)}</p><p>预计占用 ${esc(result.estimated_commitment)} · 复核日期 ${esc(result.review_on)} · 最早可卖日期 ${esc(result.earliest_sell_on)}</p>${result.limitations.map(t=>`<p>${esc(t)}</p>`).join('')}<button class="btn">关闭</button>`;
        document.body.append(dialog);dialog.showModal();dialog.querySelector('button').onclick=closeDialog;return;
      }
      if(action==='campaign-review')return await campaignDialog(data.id);
      if(action==='monitors')return await window.InvestmentMonitoring.open({accountId:s.accountId,instruments:s.instruments});
      if(action==='forecasts')return await window.InvestmentGrowth.forecasts({accountId:s.accountId,instruments:s.instruments});
      if(action==='briefing')return await window.InvestmentGrowth.briefing({accountId:s.accountId});
      if(action==='recipes')return await window.InvestmentGrowth.recipes({accountId:s.accountId,instruments:s.instruments});
      if(action==='ide')return await window.InvestmentIDE?.open({accountId:s.accountId,instruments:s.instruments});
      if(action==='browser-screen')return await window.InvestmentRuleScreen.open({accountId:s.accountId,instruments:s.instruments});
      if(['research-tools','market-data','market-screen','backtests','research-archive'].includes(action)){
        const task=action==='market-data'?{mode:'data',initialTab:'market',title:'行情资料'}:action==='market-screen'?{mode:'screen',initialTab:'market',title:'全市场筛选'}:action==='backtests'?{mode:'backtest',initialTab:'backtest',title:'策略回测'}:action==='research-archive'?{mode:'archive',initialTab:'archive',title:'研究归档与对比'}:{};
        return await window.InvestmentResearch.open({accountId:s.accountId,...task,onNavigate:section=>selectSection(section,{refresh:true})});
      }
      if(['sources','market','screen'].includes(action)) {
        if(!window.InvestmentMarket)throw new Error('行情入口尚未载入，请刷新。');
        if(action==='sources')return await window.InvestmentMarket.sources();
        if(action==='screen')return await window.InvestmentMarket.screen();
        return await window.InvestmentMarket.data({accountId:s.accountId,instruments:s.instruments,refresh:load});
      }
      if(action==='analysis') {
        if(!window.InvestmentAI)throw new Error('分析入口尚未载入，请刷新。');
        const data=await api('workspace?'+new URLSearchParams({view:'analysis',...(s.accountId?{account_id:s.accountId}:{})}));
        if(Object.keys(data.errors||{}).length)throw Error('部分分析资料读取失败，请刷新后重新打开。');
        return await window.InvestmentAI.open({accountId:s.accountId,instruments:data.instruments,evidence:data.research,plans:data.plans,reviews:data.reviews,policies:data.policies,dossiers:data.dossiers,campaigns:data.campaigns||[]});
      }
      if(action==='reports')return await window.InvestmentAI?.reports();
      if(action==='export') return download('grow-investments.json',JSON.stringify(await api('export'),null,2),'application/json');
      if(action==='csv') return await importDialog();
      if(action==='correction') {
        const item=await api(`fills/${data.id}`);
        return openForm({kind:`fills/${item.id}/corrections`,title:'核对更正',message:'保留原记录；此处更正价格、数量和费用，时间/方向错误需另行核对。',fields:[field('price','成交价格','decimal',item.price),field('quantity','成交数量','decimal',item.quantity),field('fee','手续费','decimal',item.fee ?? '',{optional:true}),field('tax','税费','decimal',item.tax ?? '',{optional:true}),field('note','备注','textarea',item.note,{optional:true}),field('reason','更正原因','textarea')],transform:values=>{const {reason,...changes}=values;return {version:item.version,reason,data:changes};}});
      }
      if(action==='fund-confirm') {
        const item=await api(`fund-orders/${data.id}`);
        return openForm({kind:`fund-orders/${item.id}/confirm`,title:'确认净值与份额',base:{version:item.version},message:'请按每批实际确认记录填写。申购净额为实际扣款（含费用），赎回净额为实际待到账金额；不把净值乘份额直接当作实际净额。赎回确认只形成待到账金额。',fields:[field('price','确认净值','decimal'),field('quantity','确认份额','decimal',''),field('fee','实际手续费','decimal'),field('tax','实际税费','decimal'),field('settlement_amount','本批实际收支净额（含费用）','decimal'),field('nav_date','净值日期','date',today()),field('confirmed_at','确认时间','datetime-local',dateTime()),field('final_confirmation','本申请全部确认完毕','checkbox',true)]});
      }
      if(action==='fund-settle') {
        const item=await api(`fund-orders/${data.id}`);
        return openForm({kind:`fund-orders/${item.id}/settle`,title:'登记赎回到账',base:{version:item.version},message:`请先核对实际到账与确认净额 ${item.receivable} 一致。不一致时先核对确认记录。`,fields:[field('received_at','实际到账时间','datetime-local',dateTime())]});
      }
      if(action==='edit') {
        const item=await api(`${data.kind}/${data.id}`);
        const actionFor={'policies':'policy','strategies':'strategy','trade-plans':'plan','reviews':'review','period-plans':'period','watchlist':'watch','dossiers':'dossier','principles':'principle','ledger-notices':'notice','experiments':'experiment'};
        const spec=formFor(actionFor[data.kind]);
        spec.edit={id:item.id,version:item.version};spec.title='修改 · '+spec.title;
        for(const f of spec.fields) {
          f.value=item[f.key] ?? '';
          if(data.kind==='experiments' && f.key==='parameters')f.value=Object.entries(f.value).map(([k,v])=>k+'='+v).join('\n');
          if(data.kind==='experiments' && f.key==='additional_roundtrip_costs')f.value=f.value.join(',');
          if(f.type==='select' && f.value!=='' && !f.items.some(([id])=>id===f.value))f.items.push([f.value,'当前引用未载入，保存时保留']);
          if(f.type==='multi')for(const id of f.value || [])if(!f.items.some(([value])=>value===id))f.items.push([id,'原引用未载入，保存时保留']);
          if(f.type==='datetime-local' && f.value)f.value=new Date(new Date(f.value).getTime()+8*3600000).toISOString().slice(0,16);
        }
        return openForm(spec);
      }
      if(action==='confirm') {
        await api(`${data.kind}/${data.id}/state`,{method:'POST',headers:{'Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:Number(data.version),state:'confirmed'})});
        return await load();
      }
      if(action==='history') {
        const started=Date.now(),history=await api(`${data.kind}/${data.id}/history`,{headers:{'X-Investment-Interactive':'1'}});
        closeDialog();dialog=document.createElement('dialog');dialog.className='inv-dialog';
        dialog.innerHTML=`<h3>保留的历史版本</h3>${history.items.map(item=>`<article class="inv-record"><h4>版本 ${item.version} · ${esc(label[item.state] || '')}</h4><p class="inv-preserve">${esc(item.text || item.rationale || item.purpose || item.entry_conditions || item.rule || item.focus || item.reason || item.technical_case || item.title)}</p><small>${esc(item.updated_at)}</small><details><summary>查看完整版本</summary><pre>${esc(JSON.stringify(item,null,2))}</pre></details></article>`).join('')}<button class="btn" type="button">关闭</button>`;
        document.body.append(dialog);dialog.setAttribute('data-inv-ready','true');dialog.setAttribute('data-inv-load-ms',String(Date.now()-started));dialog.showModal();dialog.querySelector('button').onclick=closeDialog;return;
      }
      openForm(formFor(action));
    } catch(error) {status(error instanceof TypeError?'连接暂时中断，已保存记录未清除。请恢复连接后点击刷新重试。':error.message,true);}
  }

  async function campaignDialog(id) {
    const result=await api(`accounts/${encodeURIComponent(s.accountId)}/campaigns/${encodeURIComponent(id)}/review`);
    closeDialog();const d=document.createElement('dialog');dialog=d;d.className='inv-dialog';
    d.innerHTML=`<h3>事前依据与实际结果对照</h3><p>净盈亏 ${esc(money(result.campaign.net_realized))} · R ${esc(money(result.campaign.realized_r))}</p>${result.fills.map(row=>`<article class="inv-record"><h4>${row.fill.side==='buy'?'买入':'卖出'} ${esc(row.fill.quantity)} × ${esc(row.fill.price)}</h4><p>${esc(row.fill.executed_at)}</p><p>计划有效期核对：${row.fill.plan_valid_at_execution?'成交时仍在期限内':'无计划、未确认或已过期；不推定遵守规则'}</p><p>计划：${esc(({before_execution:'事前已确认',retrospective:'事后补记或未确认',absent:'无关联计划'})[row.plan_status])}</p>${row.original_plan?`<p>原计划版本 ${row.original_plan.version}：${esc(row.original_plan.title)}</p><p>触发：${esc(row.original_plan.entry_conditions)}<br>失效：${esc(row.original_plan.invalidation)}</p>`:''}${row.original_strategy?`<p>原策略版本 ${row.original_strategy.version}：${esc(row.original_strategy.title)}</p>`:''}<p>备注：${esc(row.fill.note)}</p></article>`).join('')}${result.reviews.map(r=>`<p class="inv-preserve">${esc(r.text)}</p>`).join('')}${result.limitations.map(t=>`<p>${esc(t)}</p>`).join('')}<button class="btn" data-write>写这笔复盘</button><button class="btn" data-close>关闭</button>`;
    document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=closeDialog;
    d.querySelector('[data-write]').onclick=()=>{const spec=formFor('review');spec.fields.find(f=>f.key==='campaign_id').value=id;spec.fields.find(f=>f.key==='period').value='campaign';openForm(spec);};
  }

  function periodDialog() {
    const account=s.accounts.find(a=>a.id===s.accountId);if(!account)throw new Error('请先选择投资账本。');
    const aid=account.id;
    closeDialog();const d=document.createElement('dialog');dialog=d;d.className='inv-dialog';
    const start=[today().slice(0,8)+'01',account.baseline_date].sort().at(-1);
    d.innerHTML=`<h3>周期统计与建议跟踪</h3><form class="inv-form"><label>统计开始<input type="date" name="start" value="${start}" required></label><label>统计结束<input type="date" name="end" value="${today()}" required></label><button class="btn" type="submit">查看期间统计</button></form><p role="alert" data-error></p><div data-results aria-live="polite"></div><button class="btn" data-close>关闭</button>`;
    document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=closeDialog;
    d.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const form=event.target,submit=form.querySelector('button');submit.disabled=true;
      try {
        const values=new URLSearchParams(new FormData(form));const result=await api(`accounts/${encodeURIComponent(aid)}/summary?${values}`);
        if(!d.isConnected)return;
        d.querySelector('[data-results]').innerHTML=`<h4>期间成交已实现净盈亏 ${esc(money(result.net_realized))}</h4><p>入金 ${esc(result.deposit)} · 出金 ${esc(result.withdrawal)} · 分红 ${esc(result.dividend)} · 利息 ${esc(result.interest)} · 独立投资账本费用 ${esc(result.fee)}</p><p>实际成交 ${result.fill_count} 笔 · 期间平仓 ${result.closed_count} 链 · 期末未平仓 ${result.open_count} 链</p><p>胜率比例 ${esc(money(result.win_rate))}（已知净结果样本 ${result.win_rate_denominator}） · 平均R ${esc(money(result.average_r))}（样本 ${result.r_sample_count}）</p>${result.reconciliation_required?'<p class="inv-notice">账实差异尚未核对，本期净结果无法确认。</p>':''}<p>费用${result.fees_complete?'完整':'不完整，结果待核对'} · 期末现金${result.cash_verified?'':'（暂估）'} ${esc(result.cash_at_end)}</p><h4>策略归组</h4>${result.strategy_groups.map(g=>`<p>${esc(g.strategy_id==='mixed_or_unplanned'?'混合策略或无事前计划':(g.strategy_title+' · 版本 '+g.strategy_version))} · 平仓 ${g.closed_count} · 已知结果 ${g.known_net_count} · 净结果 ${esc(money(g.net_realized))}</p>`).join('') || '<p>尚无期间平仓样本。</p>'}<h4>AI建议处理（含未处理、未采用）</h4>${result.suggestions.map(v=>`<article class="inv-record"><h4>${esc(v.title)}</h4><p>${esc(({pending:'未处理',adopted:'已采用',rejected:'已拒绝',retained:'保留观察',untriggered:'未触发',unfilled:'未成交',modified:'已修改'})[v.state] || v.state)} · 结果尚未核验</p><p>有效截至 ${esc(v.valid_until)}</p></article>`).join('') || '<p>此期间尚无已完成分析产生的建议。</p>'}<details><summary>公式与限制</summary>${[...Object.values(result.formulas),...result.limitations].map(t=>`<p>${esc(t)}</p>`).join('')}</details>`;
        d.querySelector('[data-error]').textContent='';
      }catch(error){d.querySelector('[data-error]').textContent=error.message;}
      finally{submit.disabled=false;}
    };
  }

  function download(name,content,type) {
    const url=URL.createObjectURL(new Blob([content],{type}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function importDialog() {
    if(!s.accountId)throw new Error('请先选择投资账本。');
    const accountId=s.accountId;
    closeDialog();dialog=document.createElement('dialog');dialog.className='inv-dialog';
    dialog.innerHTML=`<h3>预览并导入实际成交</h3><p>使用模板列，先添加相应标的。外部成交编号用于重复核对；每批最多200行。</p><label>CSV文件<input type="file" accept=".csv,text/csv" data-inv-file></label><label>粘贴成交CSV<textarea rows="8" data-inv-csv></textarea></label><p role="alert" data-inv-import-error></p><div data-inv-preview></div><div class="inv-actions"><button type="button" class="btn" data-inv-template>下载模板</button><button type="button" class="btn" data-inv-preview-button>预览</button><button type="button" class="btn" data-inv-commit disabled>确认导入</button><button type="button" class="btn" data-inv-cancel>取消</button></div>`;
    document.body.append(dialog);dialog.showModal();const d=dialog, input=d.querySelector('[data-inv-csv]'), commit=d.querySelector('[data-inv-commit]');
    let preview=null,requestKey=crypto.randomUUID();
    const invalidate=()=>{preview=null;commit.disabled=true;d.querySelector('[data-inv-preview]').replaceChildren();};
    input.oninput=invalidate;
    d.querySelector('[data-inv-file]').onchange=async event=>{
      try {const file=event.target.files[0];if(!file)return;if(file.size>250000)throw new Error('文件超过250KB。');input.value=await file.text();invalidate();}
      catch(error){d.querySelector('[data-inv-import-error]').textContent=error.message;}
    };
    d.querySelector('[data-inv-cancel]').onclick=closeDialog;
    d.querySelector('[data-inv-template]').onclick=()=>download('investment-fills-template.csv','code,market,side,price,quantity,fee,tax,executed_at,external_id,note\n','text/csv');
    d.querySelector('[data-inv-preview-button]').onclick=async event=>{
      event.target.disabled=true;
      try {
        const text=input.value;
        const result=await api('imports/preview',{method:'POST',body:JSON.stringify({account_id:accountId,text})});
        if(text!==input.value)return;
        preview={...result,text};requestKey=crypto.randomUUID();
        d.querySelector('[data-inv-preview]').innerHTML=`<p>${result.rows.length}条可导入，${result.errors.length}条需修正。</p>${result.errors.map(e=>`<p>第${e.line}行：${esc(e.message)}</p>`).join('')}${result.rows.map(r=>`<p>第${r.line}行 · ${r.data.side==='buy'?'买入':'卖出'} · ${esc(r.data.price)} × ${esc(r.data.quantity)}</p>`).join('')}`;
        commit.disabled=!!result.errors.length || !result.rows.length;
      } catch(error){d.querySelector('[data-inv-import-error]').textContent=error.message;}
      finally{event.target.disabled=false;}
    };
    commit.onclick=async()=>{
      if(!preview || preview.text!==input.value)return;
      commit.disabled=true;
      try {await api('imports/commit',{method:'POST',headers:{'Idempotency-Key':requestKey},body:JSON.stringify({account_id:accountId,text:preview.text,token:preview.token})});closeDialog();await load();}
      catch(error){d.querySelector('[data-inv-import-error]').textContent=error.message;commit.disabled=false;}
    };
  }

  function searchDialog() {
    const accountId=s.accountId;closeDialog();const d=document.createElement('dialog');dialog=d;d.className='inv-dialog';
    d.innerHTML='<h3>查找当前范围的投资研究与记录</h3><p>这里可搜索私人正文、名称与金额。通用搜索和时间线仅显示中性入口，不会自动读取这些正文。</p><form class="inv-form"><label>投资记录关键词<input name="q" maxlength="200" required autocomplete="off"></label><button type="submit" class="btn">查找</button></form><p role="alert" data-error></p><div data-results></div><button class="btn" data-close>关闭</button>';
    document.body.append(d);d.showModal();d.querySelector('[data-close]').onclick=closeDialog;
    d.querySelector('form').onsubmit=async event=>{
      event.preventDefault();const submit=event.target.querySelector('button');submit.disabled=true;
      try {
        const query=new URLSearchParams({account_id:accountId,q:event.target.elements.q.value});
        const result=await api('search?'+query);if(!d.isConnected)return;
        d.querySelector('[data-results]').innerHTML=`<p>找到 ${result.total} 条，当前显示前50条。</p>${result.items.map((r,index)=>`<article class="inv-record"><h4>${esc(r.title)}</h4><p>${esc(r.summary)}</p><button class="btn" type="button" data-open="${index}">查看私有记录</button></article>`).join('')}`;
        d.querySelectorAll('[data-open]').forEach(b=>b.onclick=async()=>{try{await openRecord(result.items[Number(b.dataset.open)]);}catch(error){status(error instanceof TypeError?'连接暂时中断，已保存记录未清除。请恢复连接后点击刷新重试。':error.message,true);}});
        d.querySelector('[data-error]').textContent='';
      }catch(error){d.querySelector('[data-error]').textContent=error.message;}
      finally{submit.disabled=false;}
    };
  }

  async function openRecord(target) {
    if(!['reviews','trade-plans','period-plans','dossiers','principles','research','policies','instruments','market-snapshots'].includes(target.resource))throw new Error('此投资引用暂不支持打开。');
    const record=await api(`${target.resource}/${encodeURIComponent(target.id)}`);
    const researchRecord=['research','dossiers','instruments','market-snapshots'].includes(target.resource);s.section=researchRecord?'research':'assets';s.accountId=record.account_id||null;if(researchRecord){s.researchAccountId=s.accountId;s.view='today';}else{s.assetAccountId=s.accountId;s.view=['reviews','principles'].includes(target.resource)?'review':'today';s.assetView=s.view;}saveLocation();await load();
    closeDialog();dialog=document.createElement('dialog');dialog.className='inv-dialog';
    dialog.innerHTML=`<h3>${esc(record.title || record.name || (target.resource==='market-snapshots'?'盘后行情快照':'投资复盘'))}</h3><p class="inv-preserve">${esc(record.text || record.rule || record.rationale || record.content || record.purpose || record.focus || record.technical_case || '请展开查看本人保存的研究内容。')}</p><p>版本 ${record.version}</p><details><summary>完整私有记录</summary><pre>${esc(JSON.stringify(record,null,2))}</pre></details><button class="btn">关闭</button>`;
    document.body.append(dialog);dialog.showModal();dialog.querySelector('button').onclick=closeDialog;
  }
  let overviewGeneration=0,overviewFlight=null,overviewCache=null;
  async function refreshOverview({navigating=false}={}) {
    const home=document.getElementById('view-personal');if(!home || home.style.display==='none' || (!navigating && window.location.hash && window.location.hash!=='#view/personal'))return;
    const generation=++overviewGeneration;
    let card=document.getElementById('investmentToday');
    if(!card){card=document.createElement('section');card.id='investmentToday';card.className='section';card.hidden=true;home.querySelector('.day-heading')?.after(card);}
    try {
      const day=document.getElementById('personalDate')?.value || today();
      const key=JSON.stringify([ownerId(),day]);let result;
      if(!overviewDirty && overviewCache?.key===key && Date.now()-overviewCache.at<30000)result=overviewCache.data;
      else{if(!overviewFlight || overviewFlight.key!==key)overviewFlight={key,promise:api(`overview?as_of=${encodeURIComponent(day)}`).finally(()=>{if(overviewFlight?.key===key)overviewFlight=null;})};result=await overviewFlight.promise;overviewCache={key,at:Date.now(),data:result};overviewDirty=false;}
      if(generation!==overviewGeneration)return;
      const counts=result.counts;card.hidden=!Object.values(counts).some(n=>n>0);
      card.innerHTML=`<h3>投资记录核对</h3><p>待核对事项 ${Number(counts['ledger-notices'] || 0)} · 计划草稿 ${Number(counts['trade-plans'] || 0)+Number(counts['period-plans'] || 0)} · 所选日复盘 ${Number(counts.reviews || 0)}</p><p class="desc">这里只显示计数，不展示金额或私人正文。</p><button class="btn" type="button">打开投资工作台</button>`;
      card.querySelector('button').onclick=()=>window.goTab?.('stocks');
    }catch(_error){if(generation===overviewGeneration)card.hidden=true;}
  }
  document.getElementById('personalDate')?.addEventListener('change',refreshOverview);
  (window.Account?.ready || Promise.resolve()).then(refreshOverview);
  window.addEventListener('account-session-changed',()=>{invalidateReads();s.generation++;overviewGeneration++;overviewCache=null;cacheOwner=null;clearFacts();s.accounts=[];s.instruments=[];s.accountId=s.assetAccountId=s.researchAccountId=null;if(root())root().innerHTML='';});
  window.Investments={open:async()=>{await (window.Account?.ready||Promise.resolve());if(!root())return;render();await load({force:false});},refresh:load,refreshOverview,openRecord};
})();
