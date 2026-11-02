/* Strategy IDE — CodeMirror editor with template gallery, parameter extraction and backtest execution. */
(() => {
  'use strict';
  const CM_CSS='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.css';
  const CM_THEME='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/theme/dracula.min.css';
  const CM_JS='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/codemirror.min.js';
  const CM_PY='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/mode/python/python.min.js';
  const CM_MATCH='https://cdnjs.cloudflare.com/ajax/libs/codemirror/5.65.2/addon/edit/matchbrackets.min.js';
  const loaded={css:false,theme:false,js:false,py:false,match:false};
  function loadCSS(href,key){return new Promise(r=>{if(loaded[key])return r();const l=document.createElement('link');l.rel='stylesheet';l.href=href;l.onload=()=>{loaded[key]=true;r();};l.onerror=()=>r();document.head.append(l);});}
  function loadJS(href,key){return new Promise(r=>{if(loaded[key])return r();const s=document.createElement('script');s.src=href;s.onload=()=>{loaded[key]=true;r();};s.onerror=()=>r();document.head.append(s);});}
  async function loadCodeMirror(){
    try {
      await Promise.all([loadCSS(CM_CSS,'css'),loadCSS(CM_THEME,'theme'),loadJS(CM_JS,'js'),loadJS(CM_PY,'py'),loadJS(CM_MATCH,'match')]);
      if (window.CodeMirror) return window.CodeMirror;
    } catch(e) { console.warn('CodeMirror CDN failed, falling back to textarea', e); }
    return null;
  }
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  async function api(path, body, key) {
    const opts = {credentials:'same-origin',headers:{'Content-Type':'application/json','X-Copilot-Request':'1'}};
    if (key) opts.headers['Idempotency-Key'] = key;
    if (body) {opts.method='POST';opts.body=JSON.stringify(body);}
    const r = await fetch('/api/investments/' + path, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.message || '请求失败');
    return data;
  }
  async function apiOptional(path, fallback = {items: []}) {
    try { return await api(path); } catch(e) { return fallback; }
  }
  function dialog(title, content) {
    const d = document.createElement('dialog');
    d.className = 'inv-dialog';
    d.style.width = '92vw';
    d.style.maxWidth = '1200px';
    d.innerHTML = `<h3>${esc(title)}</h3>${content}<button class="btn" data-close style="position:absolute;top:16px;right:16px">✕</button>`;
    document.body.append(d);
    d.showModal();
    d.querySelector('[data-close]').onclick = () => d.close();
    d.addEventListener('close', () => d.remove());
    return d;
  }

  async function open({accountId, instruments}) {
    const [CM, seriesData, templatesData, userStratsData, knowledgeData, tipData] = await Promise.all([
      loadCodeMirror(),
      apiOptional('strategy/series?account_id=' + encodeURIComponent(accountId || '')),
      api('strategy-templates'),
      apiOptional('user-strategies?account_id=' + encodeURIComponent(accountId || '')),
      apiOptional('knowledge?limit=100', {items: []}),
      apiOptional('knowledge/tip', {tip: null}),
    ]);
    const templates = templatesData.items;
    const userStrategies = userStratsData.items;
    const seriesList = seriesData.items;
    const knowledgeNodes = knowledgeData.items;
    const knowledgeTip = tipData.tip;

    const d = dialog('策略 IDE', `
      <div style="display:grid;grid-template-columns:260px 1fr;gap:16px;min-height:600px">
        <aside style="border-right:1px solid var(--border,#ddd);padding-right:16px;overflow-y:auto;max-height:75vh">
          <h4>📚 策略模板</h4>
          <div data-templates style="display:flex;flex-direction:column;gap:6px"></div>
          <h4 style="margin-top:16px">💾 我的策略</h4>
          <div data-user-strategies style="display:flex;flex-direction:column;gap:6px"></div>
          <h4 style="margin-top:16px">📖 投资知识</h4>
          <div data-knowledge-tip style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px;margin-bottom:8px;font-size:11px"></div>
          <div data-knowledge style="display:flex;flex-direction:column;gap:6px"></div>
        </aside>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <label style="font-size:13px">策略名称 <input type="text" data-name style="width:180px" placeholder="我的策略"></label>
            <label style="font-size:13px">标签 <input type="text" data-tags style="width:140px" placeholder="逗号分隔"></label>
            <button class="btn" data-save>💾 保存</button>
            <button class="btn" data-extract>🔍 提取参数</button>
            <button class="btn" data-run style="background:var(--success-text,#21805c);color:white">▶ 运行回测</button>
            <button class="btn" data-grid>🔬 网格搜索</button>
          </div>
          <div data-editor style="border:1px solid var(--border,#ddd);border-radius:4px"></div>
          <div data-params style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;min-height:28px"></div>
          <div style="border:1px solid var(--border,#ddd);border-radius:4px;padding:8px">
            <label style="font-size:13px;font-weight:600">📊 回测行情数据（多选）</label>
            <p style="font-size:11px;color:var(--muted,#777);margin:4px 0">先通过「行情与查询来源」或「市场研究工具」添加盘后日线数据</p>
            <select data-series multiple style="width:100%;min-height:60px;font-size:12px"></select>
            ${seriesList.length === 0 ? '<p style="color:var(--error-text,#cf4a4a);font-size:12px">⚠️ 尚无行情数据，请先添加盘后行情</p>' : ''}
          </div>
          <div data-result style="border:1px solid var(--border,#ddd);border-radius:4px;padding:12px;min-height:100px;display:none"></div>
        </div>
      </div>
    `);

    let editor;
    if (CM) {
      editor = CM(d.querySelector('[data-editor]'), {
        value: templates[0]?.code || '# 请选择策略模板或编写自己的策略\nfrom backtest_engine import BaseStrategy\n\nclass Strategy(BaseStrategy):\n    def __init__(self):\n        super().__init__("我的策略")\n\n    def init(self):\n        pass\n\n    def handle_bar(self):\n        pass\n',
        mode: 'python',
        theme: 'dracula',
        lineNumbers: true,
        matchBrackets: true,
        indentUnit: 4,
        tabSize: 4,
        lineWrapping: false,
        viewportMargin: Infinity,
      });
      editor.setSize(null, '420px');
    } else {
      const ta = document.createElement('textarea');
      ta.style.cssText = 'width:100%;height:420px;font-family:monospace;font-size:13px;padding:8px;border:none;background:#282a36;color:#f8f8f2;';
      ta.value = templates[0]?.code || '# 请选择策略模板或编写自己的策略';
      d.querySelector('[data-editor]').replaceChildren(ta);
      editor = { getValue: () => ta.value, setValue: v => ta.value = v };
    }

    let extractedParams = {};

    const seriesSelect = d.querySelector('[data-series]');
    seriesSelect.innerHTML = seriesList.map(s =>
      `<option value="${esc(s.id)}">${esc(s.name || s.code)} · ${esc(s.source)} · ${esc(String(s.bars))}根K线</option>`
    ).join('');

    function renderTemplates() {
      d.querySelector('[data-templates]').innerHTML = templates.map(t =>
        `<article class="inv-record" style="cursor:pointer;padding:8px" data-template="${esc(t.id)}">
          <h4 style="margin:0 0 2px;font-size:13px">${esc(t.name)}</h4>
          <p style="margin:0;font-size:11px;color:var(--muted,#777)">${esc(t.description)}</p>
          <div style="margin-top:3px">${(t.tags||[]).map(tag=>`<span style="background:var(--border,#ddd);padding:1px 5px;border-radius:3px;font-size:10px;margin-right:3px">${esc(tag)}</span>`).join('')}</div>
        </article>`
      ).join('');
      d.querySelectorAll('[data-template]').forEach(el => {
        el.onclick = () => {
          const t = templates.find(x => x.id === el.dataset.template);
          if (!t) return;
          editor.setValue(t.code);
          d.querySelector('[data-name]').value = t.name;
          d.querySelector('[data-tags]').value = (t.tags || []).join(',');
          extractedParams = {};
          d.querySelector('[data-params]').innerHTML = '';
          d.querySelector('[data-result]').style.display = 'none';
        };
      });
    }

    function renderUserStrategies() {
      d.querySelector('[data-user-strategies]').innerHTML = userStrategies.length
        ? userStrategies.map(s =>
            `<article class="inv-record" style="cursor:pointer;padding:8px" data-user-strategy="${esc(s.id)}">
              <h4 style="margin:0;font-size:13px">${esc(s.name)}</h4>
              ${(s.tags||[]).map(tag=>`<span style="background:var(--border,#ddd);padding:1px 4px;border-radius:3px;font-size:10px">${esc(tag)}</span>`).join(' ')}
            </article>`
          ).join('')
        : '<p style="color:var(--muted,#777);font-size:12px">尚未保存策略</p>';
      d.querySelectorAll('[data-user-strategy]').forEach(el => {
        el.onclick = () => {
          const s = userStrategies.find(x => x.id === el.dataset.userStrategy);
          if (!s) return;
          editor.setValue(s.code);
          d.querySelector('[data-name]').value = s.name;
          d.querySelector('[data-tags]').value = (s.tags || []).join(',');
          extractedParams = {};
          d.querySelector('[data-params]').innerHTML = '';
          d.querySelector('[data-result]').style.display = 'none';
        };
      });
    }

    function renderKnowledge() {
      // Render random tip
      const tipEl = d.querySelector('[data-knowledge-tip]');
      if (knowledgeTip) {
        tipEl.innerHTML = `
          <div style="font-weight:600;color:var(--success-text,#21805c);margin-bottom:4px">💡 每日学习</div>
          <div style="font-weight:500;margin-bottom:4px">${esc(knowledgeTip.name)}</div>
          <div style="color:var(--muted,#555);line-height:1.4">${esc(knowledgeTip.summary.slice(0, 120))}${knowledgeTip.summary.length > 120 ? '…' : ''}</div>
          <div style="margin-top:4px;font-size:10px;color:var(--muted,#777)">${esc(knowledgeTip.category_label || knowledgeTip.category)}</div>
        `;
      } else {
        tipEl.innerHTML = '<p style="color:var(--muted,#777);font-size:11px;margin:0">暂无知识推荐</p>';
      }

      // Group by category
      const categoryLabels = {
        'investing_basics': '投资基础',
        'technical_analysis': '技术分析',
        'strategy_theory': '策略理论',
        'risk_management': '风险管理',
        'behavioral_finance': '行为金融',
        'fundamental_analysis': '基本面分析',
        'macro_economics': '宏观经济',
      };
      const grouped = {};
      knowledgeNodes.forEach(n => {
        if (!grouped[n.category]) grouped[n.category] = [];
        grouped[n.category].push(n);
      });

      const knowledgeEl = d.querySelector('[data-knowledge]');
      knowledgeEl.innerHTML = Object.entries(grouped).map(([cat, nodes]) => `
        <details style="margin-bottom:6px">
          <summary style="cursor:pointer;font-size:12px;font-weight:600;padding:4px 0">${esc(categoryLabels[cat] || cat)} (${nodes.length})</summary>
          <div style="padding-left:8px;margin-top:4px;display:flex;flex-direction:column;gap:4px">
            ${nodes.map(n => `
              <article class="inv-record" style="cursor:pointer;padding:6px" data-knowledge-node="${esc(n.stable_id || n.id)}">
                <div style="font-size:11px;font-weight:500">${esc(n.name)}</div>
                <div style="font-size:10px;color:var(--muted,#777);margin-top:2px">${esc((n.summary || '').slice(0, 60))}${(n.summary || '').length > 60 ? '…' : ''}</div>
              </article>
            `).join('')}
          </div>
        </details>
      `).join('');

      // Click handler for knowledge nodes
      d.querySelectorAll('[data-knowledge-node]').forEach(el => {
        el.onclick = () => {
          const nodeId = el.dataset.knowledgeNode;
          const node = knowledgeNodes.find(n => (n.stable_id || n.id) === nodeId);
          if (!node) return;
          const kd = dialog(`📖 ${node.name}`, `
            <div style="max-width:700px">
              <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px;margin-bottom:12px">
                <div style="font-size:11px;color:var(--muted,#777)">${esc(categoryLabels[node.category] || node.category)} · ${esc(node.kind)}</div>
              </div>
              <div style="line-height:1.6;font-size:13px">${esc(node.summary)}</div>
              ${node.source ? `<div style="margin-top:12px;font-size:11px;color:var(--muted,#777)">来源: ${esc(node.source)}</div>` : ''}
            </div>
          `);
        };
      });
    }

    renderTemplates();
    renderUserStrategies();
    renderKnowledge();
    d.querySelector('[data-name]').value = templates[0]?.name || '';

    // Phase 4: Contextual knowledge tips based on user actions
    function showContextualTip(category, action) {
      const relevantNodes = knowledgeNodes.filter(n => n.category === category);
      if (!relevantNodes.length) return;
      const tip = relevantNodes[Math.floor(Math.random() * relevantNodes.length)];
      const resultPanel = d.querySelector('[data-result]');
      const existingTip = resultPanel.querySelector('[data-contextual-tip]');
      if (existingTip) existingTip.remove();

      const tipEl = document.createElement('div');
      tipEl.setAttribute('data-contextual-tip', '');
      tipEl.style.cssText = 'background:var(--bg-tertiary,#f5f5f5);border-left:3px solid var(--success-text,#21805c);padding:8px;margin-top:12px;border-radius:4px;font-size:11px';
      tipEl.innerHTML = `
        <div style="font-weight:600;color:var(--success-text,#21805c);margin-bottom:4px">💡 ${action}小贴士</div>
        <div style="font-weight:500;margin-bottom:4px">${esc(tip.name)}</div>
        <div style="color:var(--muted,#555);line-height:1.4">${esc(tip.summary.slice(0, 150))}${tip.summary.length > 150 ? '…' : ''}</div>
        <div style="margin-top:6px;font-size:10px;color:var(--muted,#777)">点击左侧知识目录查看详情 →</div>
      `;
      resultPanel.style.display = 'block';
      resultPanel.append(tipEl);
    }

    d.querySelector('[data-extract]').onclick = async () => {
      const code = editor.getValue();
      try {
        const result = await api('strategy/extract-params', {name:'_',code,tags:[],description:''});
        extractedParams = result.params || {};
        const defaults = result.defaults || {};
        const panel = d.querySelector('[data-params]');
        panel.innerHTML = Object.entries(extractedParams).map(([name, info]) =>
          `<label style="display:flex;align-items:center;gap:4px;font-size:12px">
            ${esc(name)}
            <input type="number" data-param="${esc(name)}" value="${esc(defaults[name] ?? '')}"
              style="width:72px;padding:2px 4px;font-size:12px" step="any">
          </label>`
        ).join('') || '<p style="color:var(--muted,#777);font-size:12px;margin:0">未提取到可调参数</p>';
      } catch (e) {
        d.querySelector('[data-params]').innerHTML = `<p style="color:var(--error-text,#cf4a4a);font-size:12px;margin:0">${esc(e.message)}</p>`;
      }
    };

    d.querySelector('[data-save]').onclick = async () => {
      const name = d.querySelector('[data-name]').value.trim();
      if (!name) return alert('请填写策略名称');
      const code = editor.getValue();
      try {
        await api('user-strategies?account_id=' + encodeURIComponent(accountId || ''), {
          name, code,
          tags: d.querySelector('[data-tags]').value.split(',').map(s => s.trim()).filter(Boolean),
          description: ''
        }, crypto.randomUUID());
        const fresh = (await api('user-strategies?account_id=' + encodeURIComponent(accountId || ''))).items;
        userStrategies.length = 0;
        userStrategies.push(...fresh);
        renderUserStrategies();
        d.querySelector('[data-result]').style.display = 'block';
        d.querySelector('[data-result]').innerHTML = '<p style="color:var(--success-text,#21805c);margin:0">✅ 策略已保存</p>';
        showContextualTip('behavioral_finance', '保存策略后');
      } catch (e) {
        alert('保存失败：' + e.message);
      }
    };

    d.querySelector('[data-run]').onclick = async () => {
      const name = d.querySelector('[data-name]').value.trim() || '用户策略';
      const code = editor.getValue();
      const selectedSeries = [...seriesSelect.selectedOptions].map(o => o.value);
      if (!selectedSeries.length) return alert('请先选择至少一个行情数据');
      const params = {};
      d.querySelectorAll('[data-param]').forEach(input => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) params[input.dataset.param] = v;
      });
      const resultPanel = d.querySelector('[data-result]');
      resultPanel.style.display = 'block';
      resultPanel.innerHTML = '<p>⏳ 正在运行回测…</p>';
      try {
        const result = await api('strategy/run?account_id=' + encodeURIComponent(accountId || ''), {
          strategy_code: code, strategy_name: name, params,
          series_ids: selectedSeries,
          initial_cash: '1000000', commission_rate: '0.0003', stamp_tax: '0.001'
        }, crypto.randomUUID());
        const r = result.result || result;
        const metrics = r.metrics || r;
        resultPanel.innerHTML = `
          <h4 style="margin:0 0 8px">回测结果：${esc(name)}</h4>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0">
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">初始资金</div>
              <div style="font-size:16px;font-weight:600">${esc((metrics.initial_capital || 0).toLocaleString())}</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">最终资金</div>
              <div style="font-size:16px;font-weight:600">${esc((metrics.final_capital || 0).toLocaleString())}</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">总收益率</div>
              <div style="font-size:16px;font-weight:600;color:${(metrics.total_return||0)>=0?'var(--error-text,#cf4a4a)':'var(--success-text,#21805c)'}">${esc((metrics.total_return || 0).toFixed(2))}%</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">年化收益</div>
              <div style="font-size:16px;font-weight:600">${esc((metrics.annual_return || 0).toFixed(2))}%</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">最大回撤</div>
              <div style="font-size:16px;font-weight:600;color:var(--error-text,#cf4a4a)">${esc((metrics.max_drawdown || 0).toFixed(2))}%</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">夏普比率</div>
              <div style="font-size:16px;font-weight:600">${esc((metrics.sharpe_ratio || 0).toFixed(2))}</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">胜率</div>
              <div style="font-size:16px;font-weight:600">${esc((metrics.win_rate || 0).toFixed(1))}%</div>
            </div>
            <div style="background:var(--bg-tertiary,#f5f5f5);padding:8px;border-radius:4px">
              <div style="font-size:11px;color:var(--muted,#777)">交易次数</div>
              <div style="font-size:16px;font-weight:600">${esc(metrics.total_trades || 0)}</div>
            </div>
          </div>
          <h4>权益曲线</h4>
          <div data-equity-chart style="height:160px;border:1px solid var(--border,#ddd);border-radius:4px"></div>
          <h4 style="margin-top:12px">回撤曲线</h4>
          <div data-drawdown-chart style="height:120px;border:1px solid var(--border,#ddd);border-radius:4px"></div>
          ${(r.trades || []).length ? `
            <h4 style="margin-top:12px">交易记录（最近50笔）</h4>
            <div style="max-height:200px;overflow-y:auto">
              <table style="width:100%;font-size:12px;border-collapse:collapse">
                <tr style="background:var(--bg-tertiary,#f5f5f5)"><th style="padding:4px">日期</th><th>标的</th><th>方向</th><th>价格</th><th>数量</th><th>金额</th></tr>
                ${(r.trades || []).slice(-50).map(t => `
                  <tr style="border-bottom:1px solid var(--border,#ddd)">
                    <td style="padding:3px">${esc(t.date)}</td><td>${esc(t.ts_code)}</td>
                    <td style="color:${t.side==='buy'?'var(--error-text,#cf4a4a)':'var(--success-text,#21805c)'}">${t.side==='buy'?'买入':'卖出'}</td>
                    <td>${esc(t.price)}</td><td>${esc(t.quantity)}</td><td>${esc(Number(t.amount||0).toFixed(0))}</td>
                  </tr>
                `).join('')}
              </table>
            </div>
          ` : ''}
          <p style="font-size:11px;color:var(--muted,#777);margin-top:8px">⚠️ 回测基于历史数据，不证明未来表现。参数优化须做样本外验证。</p>
        `;
        showContextualTip('risk_management', '回测完成后');
        const chartEl = resultPanel.querySelector('[data-equity-chart]');
        const values = r.equity_curve || [];
        if (values.length && chartEl) {
          const max = Math.max(...values.map(v => v.value));
          const min = Math.min(...values.map(v => v.value));
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 1000 160');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.style.width = '100%';
          svg.style.height = '100%';
          const points = values.map((v, i) => {
            const x = 55 + i * 920 / Math.max(1, values.length - 1);
            const y = 15 + (max - v.value) / (max - min || 1) * 120;
            return `${x},${y}`;
          }).join(' ');
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', points);
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke', '#4f6ef7');
          polyline.setAttribute('stroke-width', '2');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.append(polyline);
          chartEl.replaceChildren(svg);
        }
        // Drawdown chart
        const ddEl = resultPanel.querySelector('[data-drawdown-chart]');
        if (values.length && ddEl) {
          let peak = values[0].value;
          const drawdowns = values.map(v => {
            if (v.value > peak) peak = v.value;
            return { date: v.date, dd: (peak - v.value) / peak * 100 };
          });
          const maxDd = Math.max(...drawdowns.map(d => d.dd));
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('viewBox', '0 0 1000 120');
          svg.setAttribute('preserveAspectRatio', 'none');
          svg.style.width = '100%';
          svg.style.height = '100%';
          const points = drawdowns.map((d, i) => {
            const x = 55 + i * 920 / Math.max(1, drawdowns.length - 1);
            const y = 10 + d.dd / (maxDd || 1) * 100;
            return `${x},${y}`;
          }).join(' ');
          const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
          polyline.setAttribute('points', points);
          polyline.setAttribute('fill', 'none');
          polyline.setAttribute('stroke', '#cf4a4a');
          polyline.setAttribute('stroke-width', '2');
          polyline.setAttribute('vector-effect', 'non-scaling-stroke');
          svg.append(polyline);
          // Fill area under drawdown
          const area = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
          const firstX = 55, lastX = 55 + (drawdowns.length - 1) * 920 / Math.max(1, drawdowns.length - 1);
          area.setAttribute('points', `${firstX},10 ${points} ${lastX},10`);
          area.setAttribute('fill', 'rgba(207,74,74,0.1)');
          svg.insertBefore(area, polyline);
          ddEl.replaceChildren(svg);
        }
      } catch (e) {
        resultPanel.innerHTML = `<p style="color:var(--error-text,#cf4a4a)">❌ ${esc(e.message)}</p>`;
      }
    };

    d.querySelector('[data-grid]').onclick = async () => {
      if (!Object.keys(extractedParams).length) return alert('请先点击「提取参数」获取可调参数');
      const gd = document.createElement('dialog');
      gd.className = 'inv-dialog';
      gd.style.width = '700px';
      gd.innerHTML = `<h3>🔬 参数网格搜索</h3>
        <p style="font-size:12px;color:var(--muted,#777);margin:8px 0">为每个参数设置搜索值（逗号分隔），将遍历所有组合</p>
        <div data-grid-params style="display:flex;flex-direction:column;gap:8px;margin:12px 0"></div>
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button class="btn" data-grid-cancel>取消</button>
          <button class="btn" data-grid-run style="background:var(--success-text,#21805c);color:white">开始搜索</button>
        </div>`;
      document.body.append(gd);
      gd.showModal();
      const paramsDiv = gd.querySelector('[data-grid-params]');
      paramsDiv.innerHTML = Object.entries(extractedParams).map(([name, info]) =>
        `<label style="font-size:12px;display:block">
          <strong>${esc(name)}</strong> <span style="color:var(--muted,#777)">默认=${esc(info.default ?? '')}</span>
          <input type="text" data-grid-param="${esc(name)}" value="${esc(info.default ?? '')}"
            placeholder="如 5,10,20,30" style="width:100%;margin-top:4px;padding:4px 6px;font-size:12px">
        </label>`
      ).join('');
      gd.querySelector('[data-grid-cancel]').onclick = () => gd.close();
      gd.addEventListener('close', () => gd.remove());
      gd.querySelector('[data-grid-run]').onclick = async () => {
        const paramRanges = {};
        let totalCombos = 1;
        gd.querySelectorAll('[data-grid-param]').forEach(input => {
          const vals = input.value.split(',').map(v => parseFloat(v.trim())).filter(v => !isNaN(v));
          if (vals.length) { paramRanges[input.dataset.gridParam] = vals; totalCombos *= vals.length; }
        });
        if (!Object.keys(paramRanges).length) return alert('请至少为一个参数设置搜索值');
        if (totalCombos > 500) return alert(`组合数 ${totalCombos} 超过上限 500，请减少参数值`);
        gd.querySelector('[data-grid-run]').disabled = true;
        gd.querySelector('[data-grid-run]').textContent = `搜索中… (0/${totalCombos})`;
        try {
          const name = d.querySelector('[data-name]').value.trim() || '用户策略';
          const code = editor.getValue();
          const selectedSeries = [...seriesSelect.selectedOptions].map(o => o.value);
          if (!selectedSeries.length) return alert('请先选择行情数据');
          const result = await api('strategy/grid-search?account_id=' + encodeURIComponent(accountId || ''), {
            strategy_code: code, strategy_name: name, param_ranges: paramRanges,
            series_ids: selectedSeries, max_combinations: 500,
            initial_cash: '1000000', commission_rate: '0.0003', stamp_tax: '0.001'
          }, crypto.randomUUID());
          gd.close();
          showGridResults(result.items, extractedParams);
        } catch (e) {
          alert('网格搜索失败：' + e.message);
          gd.querySelector('[data-grid-run]').disabled = false;
          gd.querySelector('[data-grid-run]').textContent = '开始搜索';
        }
      };
    };

    function showGridResults(items, paramDefs) {
      const resultPanel = d.querySelector('[data-result]');
      resultPanel.style.display = 'block';
      if (!items.length) {
        resultPanel.innerHTML = '<p style="color:var(--error-text,#cf4a4a)">❌ 所有组合均执行失败</p>';
        return;
      }
      const sorted = [...items].sort((a, b) => (b.metrics?.sharpe_ratio || 0) - (a.metrics?.sharpe_ratio || 0));
      const paramNames = Object.keys(paramDefs);
      resultPanel.innerHTML = `
        <h4 style="margin:0 0 8px">🔬 网格搜索结果 (${items.length} 组，按夏普比率排序)</h4>
        <div style="max-height:400px;overflow-y:auto">
          <table style="width:100%;font-size:11px;border-collapse:collapse">
            <tr style="background:var(--bg-tertiary,#f5f5f5);position:sticky;top:0">
              <th style="padding:4px">排名</th>
              ${paramNames.map(n => `<th>${esc(n)}</th>`).join('')}
              <th>总收益%</th><th>年化%</th><th>最大回撤%</th><th>夏普</th><th>胜率%</th><th>交易数</th>
            </tr>
            ${sorted.map((item, i) => `
              <tr style="border-bottom:1px solid var(--border,#ddd);background:${i===0?'#e8f5e9':''}">
                <td style="padding:3px;font-weight:${i===0?'700':'400'}">${i+1}</td>
                ${paramNames.map(n => `<td>${esc(item.params[n] ?? '-')}</td>`).join('')}
                <td style="color:${(item.metrics?.total_return||0)>=0?'var(--error-text,#cf4a4a)':'var(--success-text,#21805c)'}">${(item.metrics?.total_return||0).toFixed(2)}</td>
                <td>${(item.metrics?.annual_return||0).toFixed(2)}</td>
                <td style="color:var(--error-text,#cf4a4a)">${(item.metrics?.max_drawdown||0).toFixed(2)}</td>
                <td style="font-weight:600">${(item.metrics?.sharpe_ratio||0).toFixed(2)}</td>
                <td>${(item.metrics?.win_rate||0).toFixed(1)}</td>
                <td>${item.metrics?.total_trades||0}</td>
              </tr>
            `).join('')}
          </table>
        </div>
        <p style="font-size:11px;color:var(--muted,#777);margin-top:8px">绿色高亮为夏普比率最优组合。⚠️ 样本内最优不代表样本外表现，需做交叉验证。</p>
      `;
      showContextualTip('strategy_theory', '网格搜索后');
    }
  }

  window.InvestmentIDE = { open };
})();
