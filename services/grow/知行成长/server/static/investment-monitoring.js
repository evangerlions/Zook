/* Opt-in server monitors and page notifications; no order placement or external messages. */
(() => {
  'use strict';
  let timer=null;const watching=new Map();
  const ui=()=>window.InvestmentPlatformUI;
  async function poll(){
    const {api}=ui();
    for(const [account,settings] of watching){
      if(!window.Account?.isCurrent(settings.owner)){watching.delete(account);continue;}
      try{
        const result=await api('monitor-events?'+new URLSearchParams({account_id:account,unread:'true',page_size:'100'}));
        for(const event of result.items){
          if(Date.parse(event.created_at)<Date.parse(settings.since)||Notification.permission!=='granted')continue;
          const notify=async()=>{if(!window.Account.isCurrent(settings.owner))return;const key='grow-investment-notified:'+settings.owner;let seen=[];try{seen=JSON.parse(localStorage.getItem(key)||'[]');}catch{}if(seen.includes(event.id))return;localStorage.setItem(key,JSON.stringify([...seen,event.id].slice(-1000)));new Notification('投资条件待核对',{body:event.name+'：条件已触发，请到站内查看来源与时点。',tag:event.id});};
          if(navigator.locks)await navigator.locks.request('grow-investment-event:'+event.id,notify);else await notify();
        }
      }catch{ /* Persisted server events remain available in the inbox. */ }
    }
  }
  window.addEventListener('account-session-changed',()=>{watching.clear();if(timer)clearInterval(timer);timer=null;});
  async function open(context){
    const {api,dialog,action,field,read,esc}=ui();
    const policy=await api('monitors/source-policy');
    const d=dialog('后台条件监控与站内提醒',`<p>默认关闭。服务运行时关闭网页仍会核对并保存站内事件；浏览器通知须授权且页面可用。监控不会修改持仓或成交。</p><p>已允许的报价接口主机：${esc(policy.allowed_hosts.join('、')||'尚未配置；可先使用已保存盘后日线条件')}</p><label>已有监控<select data-saved><option value="">新建监控</option></select></label><div class="inv-form">${field('name','监控名称')}<label>监控证券<select data-instrument><option value="">请选择</option>${context.instruments.filter(i=>['stock','etf'].includes(i.kind)).map(i=>`<option value="${i.id}">${esc(i.name)} · ${esc(i.code)}</option>`).join('')}</select></label><label>条件<select data-field>${[['price_above','价格高于'],['price_below','价格低于'],['change_above','日涨跌幅高于（%）'],['change_below','日涨跌幅低于（%）'],['cost_above','偏离持仓成本高于（%）'],['cost_below','偏离持仓成本低于（%）'],['ma_bullish','盘后MA5>MA10>MA20'],['volume_surge','盘后量比高于']].map(([v,t])=>`<option value="${v}">${t}</option>`).join('')}</select></label>${field('threshold','条件阈值','text','0')}${field('source-label','来源说明','text','本人核对来源')}${field('url','本人HTTPS报价接口（编辑时留空保留）','url')}${field('token','接口凭证（只加密保存，不回显）','password')}${field('interval','核对间隔秒数（最少300）','number','300')}${field('cooldown','重复提醒冷却秒数','number','86400')}${field('age','报价最长有效秒数','number','120')}</div><label><input type="checkbox" data-confirm>我已核对来源、使用范围与自动访问频率</label><label><input type="checkbox" data-enable>显式开启服务端监控</label><div class="inv-actions"><button class="btn" data-save>保存监控配置</button><button class="btn" data-refresh>刷新监控与站内事件</button><button class="btn" data-notify>开启此页面的浏览器提醒</button></div><div data-monitors></div><h4>站内触发事件</h4><div data-events></div><div class="inv-actions"><button class="btn" data-prev>上一页事件</button><span data-page></span><button class="btn" data-next>下一页事件</button></div>`);
    d.dataset.accountId=context.accountId;window.InvestmentPortfolio.referenceSearch(d,d.querySelector('[data-instrument]'),'instruments');
    let items=[],selected=null,page=1,total=0;
    const sourceFields=()=>{const daily=['ma_bullish','volume_surge'].includes(read(d,'field'));for(const key of ['url','token','age'])d.querySelector('[data-'+key+']').parentElement.hidden=daily;};d.querySelector('[data-field]').onchange=sourceFields;sourceFields();
    async function refresh(){
      const [monitors,events]=await Promise.all([api('monitors?account_id='+context.accountId),api('monitor-events?'+new URLSearchParams({account_id:context.accountId,page:String(page),page_size:'50'}))]);items=monitors.items;total=events.total;
      d.querySelector('[data-saved]').innerHTML='<option value="">新建监控</option>'+items.map(m=>`<option value="${m.id}" ${selected?.id===m.id?'selected':''}>${esc(m.name)} · 版本${m.version}</option>`).join('');
      d.querySelector('[data-monitors]').innerHTML=items.map(m=>`<article class="inv-record"><h4>${esc(m.name)} · ${m.enabled?'已开启':'已关闭'}</h4><p>版本 ${m.version} · ${esc(m.source_label)} · 核对间隔${m.interval_seconds}秒 · 冷却${m.cooldown_seconds}秒</p><p>执行状态 ${esc(m.runtime.state)} · 最近核对 ${esc(m.runtime.last_checked_at||'尚未执行')}</p><p>${esc(m.runtime.last_result?.reason||'')}</p><button class="btn" data-check="${m.id}">核对一次（仍受时段与间隔约束）</button><button class="btn" data-stop="${m.id}">停止此监控</button></article>`).join('')||'<p>尚未配置监控。</p>';
      d.querySelector('[data-events]').innerHTML=events.items.map(e=>`<article class="inv-record"><h4>${esc(e.name)} · ${e.read?'已读':'未读'}</h4><p>${esc(e.created_at)} · ${esc(e.field)} · 阈值${esc(e.threshold)}</p><details><summary>查看触发依据</summary><pre>${esc(JSON.stringify(e.observation,null,2))}</pre></details>${e.read?'':`<button class="btn" data-read="${e.id}" data-version="${e.version}">标为已读</button>`}</article>`).join('')||'<p>尚无触发事件。</p>';
      d.querySelector('[data-prev]').disabled=page===1;d.querySelector('[data-next]').disabled=page*50>=total;
      d.querySelector('[data-page]').textContent=`第${page}页 · 共${total}条`;
      d.querySelectorAll('[data-check]').forEach(b=>b.onclick=async()=>{b.disabled=true;try{const result=await api('monitors/'+b.dataset.check+'/check',{});d.querySelector('[data-error]').textContent='本次核对：'+result.state;await refresh();}catch(e){d.querySelector('[data-error]').textContent=e.message;}finally{b.disabled=false;}});
      d.querySelectorAll('[data-stop]').forEach(b=>b.onclick=async()=>{try{const m=items.find(i=>i.id===b.dataset.stop);await api('monitors/'+m.id+'/stop',{version:m.version},crypto.randomUUID());selected=null;await refresh();}catch(e){d.querySelector('[data-error]').textContent=e.message;}});
      d.querySelectorAll('[data-read]').forEach(b=>b.onclick=async()=>{try{await api('monitor-events/'+b.dataset.read+'/read',{version:Number(b.dataset.version)},crypto.randomUUID());await refresh();}catch(e){d.querySelector('[data-error]').textContent=e.message;}});
    }
    d.querySelector('[data-saved]').onchange=()=>{selected=items.find(m=>m.id===read(d,'saved'))||null;if(!selected){d.querySelector('[data-enable]').checked=false;return;}const m=selected;for(const [k,v] of Object.entries({name:m.name,instrument:m.instrument_id,field:m.field,threshold:m.threshold,'source-label':m.source_label,interval:m.interval_seconds,cooldown:m.cooldown_seconds,age:m.max_age_seconds,url:'',token:''}))d.querySelector('[data-'+k+']').value=v;d.querySelector('[data-confirm]').checked=m.use_confirmed;d.querySelector('[data-enable]').checked=m.enabled;sourceFields();};
    action(d,'[data-save]',async()=>{const type=read(d,'field'),data={account_id:context.accountId,instrument_id:read(d,'instrument'),name:read(d,'name'),field:type,threshold:read(d,'threshold'),source:['ma_bullish','volume_surge'].includes(type)?'saved_daily':'https_quotes',source_label:read(d,'source-label'),url:read(d,'url'),token:read(d,'token'),use_confirmed:d.querySelector('[data-confirm]').checked,enabled:d.querySelector('[data-enable]').checked,interval_seconds:Number(read(d,'interval')),cooldown_seconds:Number(read(d,'cooldown')),max_age_seconds:Number(read(d,'age'))};if(selected){const response=await fetch('/api/investments/monitors/'+selected.id,{method:'PUT',headers:{'Content-Type':'application/json','X-Copilot-Request':'1','Idempotency-Key':crypto.randomUUID()},body:JSON.stringify({version:selected.version,data})});const result=await response.json();if(!response.ok)throw Error(result.message);selected=result;}else selected=await api('monitors',data,crypto.randomUUID());d.querySelector('[data-token]').value='';d.querySelector('[data-url]').value='';await refresh();});
    action(d,'[data-refresh]',refresh);action(d,'[data-prev]',async()=>{if(page>1){page--;await refresh();}});action(d,'[data-next]',async()=>{if(page*50<total){page++;await refresh();}});
    action(d,'[data-notify]',async()=>{if(!('Notification' in window))throw Error('当前浏览器不支持系统通知，站内历史仍可使用。');const permission=await Notification.requestPermission();if(permission!=='granted')throw Error('尚未授权浏览器通知，站内事件继续保存。');const owner=window.Account.user.id;watching.set(context.accountId,{owner,since:new Date().toISOString()});if(!timer)timer=setInterval(poll,30000);d.querySelector('[data-error]').textContent='此页面将每30秒检查新事件；关闭页面后不承诺系统通知。';});await refresh();
  }
  window.InvestmentMonitoring={open};
})();
