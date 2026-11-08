"""Synthetic localhost only; real Chrome and disposable PostgreSQL, no real accounts."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',required=True,type=Path);p.add_argument('--account',default='course7@example.com');a=p.parse_args()
assert a.url.startswith('http://127.0.0.1:') and a.account.startswith('course') and a.account.endswith('@example.com');a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000},accept_downloads=True);page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  api=pw.request.new_context(base_url=a.url);auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'}
  key=lambda:{**h,'Idempotency-Key':str(uuid.uuid4())}
  token='回看合成 '+str(uuid.uuid4())[:8];rid='record-'+str(uuid.uuid4());record={'base_version':0,'raw_text':token+' 原始观察','record_date':'2026-11-04','prompt_kind':'learning','guided_answers':{},'tags':[]}
  r=api.put('/api/v1/lighttick/records/'+rid,headers=key(),data=record);assert r.status==200,r.text()
  page.goto(a.url+'/grow/review');page.get_by_label('邮箱或手机号').fill(a.account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('heading',name='知识与回看',exact=True)).to_be_visible()
  page.get_by_role('button',name='准备知识笔记',exact=True).click();editor=page.get_by_role('region',name='知识认知编辑');page.get_by_label('笔记类型',exact=True).select_option('cognition');page.get_by_label('知识标题',exact=True).fill(token+' 认知');page.get_by_label('知识正文',exact=True).fill('第一份已核对解释');page.get_by_role('button',name='添加精确来源',exact=True).click();page.get_by_label('来源 1 标识',exact=True).fill(rid);page.get_by_label('来源 1 版本',exact=True).fill('1')
  dropped=[]
  def lose(route):
   if route.request.method=='PUT':
    response=route.fetch();assert response.status==200,response.text();dropped.append((route.request.post_data_json,route.request.headers['idempotency-key'],route.request.url));route.abort('failed')
   else:route.continue_()
  page.route('**/knowledge/*',lose);page.get_by_role('button',name='保存知识与认知',exact=True).click();expect(page.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/knowledge/*',lose);page.reload();page.get_by_role('button',name='准备知识笔记',exact=True).click();expect(page.get_by_label('知识正文',exact=True)).to_have_value('第一份已核对解释')
  with page.expect_response(lambda r:r.request.method=='PUT' and '/knowledge/' in r.url) as retried:page.get_by_role('button',name='重试原请求',exact=True).click()
  assert (retried.value.request.post_data_json,retried.value.request.headers['idempotency-key'],retried.value.request.url)==dropped[0];saved=retried.value.json()['data'];kid=saved['id'];kp='/api/v1/lighttick/knowledge/'+kid
  expect(page.get_by_text('当前修订 1',exact=False)).to_be_visible();page.get_by_label('知识正文',exact=True).fill('本机冲突后保留的解释')
  cloud={k:saved[k] for k in ['kind','title','body','tags','sources']};cloud.update(base_revision=1,body='另一端保存的云端解释');r=api.put(kp,headers=key(),data=cloud);assert r.status==200,r.text()
  page.get_by_role('button',name='保存知识与认知',exact=True).click();expect(page.get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible();page.get_by_role('button',name='核对云端知识',exact=True).click();expect(page.get_by_text('另一端保存的云端解释',exact=True)).to_be_visible();expect(page.get_by_label('知识正文',exact=True)).to_have_value('本机冲突后保留的解释');page.get_by_role('button',name='已核对，解除待核对状态',exact=True).click();page.get_by_role('button',name='已比较，保留本机正文并采用云端基线',exact=True).click();page.get_by_role('button',name='保存知识与认知',exact=True).click();expect(page.get_by_text('当前修订 3',exact=False)).to_be_visible()
  page.get_by_role('button',name='查看知识历史',exact=True).click();expect(page.get_by_text('另一端保存的云端解释',exact=True)).to_be_visible();expect(page.get_by_text('第一份已核对解释',exact=True)).to_be_visible()
  r=api.put('/api/v1/lighttick/records/'+rid,headers=key(),data={**record,'base_version':1,'raw_text':token+' 新版观察'});assert r.status==200,r.text()
  page.get_by_label('搜索已确认内容',exact=True).fill(token);page.get_by_role('button',name='刷新回看',exact=True).click();article=page.locator('article').filter(has=page.get_by_role('heading',name=token+' 认知',exact=True));article.get_by_text('来源关系与原文',exact=True).click();article.get_by_role('button',name='核对这份来源原文',exact=True).click();expect(page.get_by_role('heading',name='来源原文 · 记录原文',exact=True)).to_be_visible();expect(page.get_by_text(token+' 原始观察',exact=True)).to_be_visible();expect(page.get_by_text('引用版本 1 · 当前版本 2',exact=True)).to_be_visible()
  with page.expect_download() as download:page.get_by_role('button',name='导出本人授权数据',exact=True).click()
  dest=a.output/'synthetic-authorized-export.json';download.value.save_as(dest);exported=json.loads(dest.read_text());entry=next(k for k in exported['knowledge'] if k['entry']['id']==kid);assert len(entry['versions'])==3 and entry['entry']['body']=='本机冲突后保留的解释';assert 'operations' not in exported and 'jobs' not in exported
  page.get_by_role('button',name='归档知识',exact=True).click();expect(page.get_by_role('button',name='恢复知识',exact=True)).to_be_visible();page.get_by_role('button',name='恢复知识',exact=True).click();expect(page.get_by_role('button',name='归档知识',exact=True)).to_be_visible()
  for n in range(32):
   r=api.put('/api/v1/lighttick/knowledge/knowledge-'+str(uuid.uuid4()),headers=key(),data={'base_revision':0,'kind':'knowledge','title':token+' 分页 '+str(n),'body':'明确保存的分页事实','tags':[],'sources':[]});assert r.status==200,r.text()
  page.get_by_role('button',name='刷新回看',exact=True).click();expect(page.get_by_role('button',name='更多确认内容',exact=True)).to_be_visible();page.get_by_label('知识正文',exact=True).fill('游标重建仍保留的本机草稿')
  r=api.put('/api/v1/lighttick/knowledge/knowledge-'+str(uuid.uuid4()),headers=key(),data={'base_revision':0,'kind':'knowledge','title':token+' 游标变化','body':'新确认事实','tags':[],'sources':[]});assert r.status==200
  page.get_by_role('button',name='更多确认内容',exact=True).click();expect(page.get_by_text('事实或授权已变化，请刷新回看；本机知识草稿和原请求已保留。',exact=True)).to_be_visible();expect(page.get_by_label('知识正文',exact=True)).to_have_value('游标重建仍保留的本机草稿');page.get_by_role('button',name='刷新回看',exact=True).click();expect(page.get_by_role('heading',name='成长事实',exact=True)).to_be_visible()
  page.screenshot(path=str(a.output/'review-desktop.png'),full_page=True);page.set_viewport_size({'width':375,'height':900});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1');page.screenshot(path=str(a.output/'review-mobile.png'),full_page=True)
  c.set_offline(True)
  r=api.post('/api/v1/lighttick/records/'+rid+'/archive',headers=key(),data={'base_version':2});assert r.status==200
  r=api.get(kp,headers=h);assert r.status==403,r.text();c.set_offline(False);expect(page.get_by_label('知识正文',exact=True)).to_have_count(0);assert page.evaluate("Object.keys(localStorage).some(k=>k.includes('knowledge-')&&localStorage.getItem(k).includes('游标重建仍保留的本机草稿'))");result=api.get('/api/v1/lighttick/review',headers=h,params={'q':token+' 认知'}).json()['data'];assert result['total']==0
  other=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':'course8@example.com','password':'Password1234','clientType':'app'}).json()['data'];assert api.get(kp,headers={'Authorization':'Bearer '+other['accessToken'],'X-App-Id':'lighttick'}).status==404
  assert not errors,errors;(a.output/'result.json').write_text(json.dumps({'passed':True,'entry_id':kid,'lost_response_exact_replay':True,'CAS_keeps_three_copies':True,'exact_old_source_read':True,'authorized_export_history':True,'cursor_rebuild_keeps_draft':True,'archive_restore':True,'source_withdrawal':True,'owner_isolation':True,'console_errors':errors},ensure_ascii=False,indent=2))
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:b.close()
