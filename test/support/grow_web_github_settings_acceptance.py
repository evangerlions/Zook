# -*- coding: utf-8 -*-
"""Only disposable localhost accounts and synthetic GitHub credentials."""
import argparse,json,re,time,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True)
p.add_argument('--output',type=Path,required=True)
p.add_argument('--account',default='course2@example.com');p.add_argument('--expected-grow-revision');a=p.parse_args()
assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account)
a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True)
 c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page()
 page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 token='SYNTHETIC_'+uuid.uuid4().hex;path='/api/v1/lighttick/account/github'
 api=pw.request.new_context(base_url=a.url)
 expected_revision=a.expected_grow_revision or json.loads(Path('static/grow/grow-manifest.json').read_text())['source_revision']
 config=api.get('/grow/runtime-config.js')
 assert config.status==200
 served=re.search(r'"revision":"([a-f0-9]{40})"',config.text())
 assert served and served.group(1)==expected_revision,'Running static package differs from expected SHA; restart the synthetic web fixture after installing the artifact'

 auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data']
 headers={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick'}
 def get(suffix=''):
  r=api.get(path+suffix,headers=headers);assert r.status==200,r.text();return r.json()['data']
 def save(body):
  r=api.put(path,headers={**headers,'Idempotency-Key':str(uuid.uuid4())},data=body)
  assert r.status==200,r.text();return r.json()['data']
 def no_secret():
  assert not page.evaluate('(s)=>JSON.stringify(localStorage).includes(s)||JSON.stringify(sessionStorage).includes(s)',token)
  assert token not in json.dumps(get())
 try:
  assert get()['revision']==0,'Use a fresh synthetic account; never clear existing history'
  page.goto(a.url+'/grow/settings');page.get_by_label('邮箱或手机号').fill(a.account)
  page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click()
  v=page.get_by_role('region',name='GitHub 内容仓库设置')
  v.get_by_label('GitHub 存储方式').select_option('custom')
  v.get_by_label('GitHub 仓库',exact=True).fill('fixture/content')
  v.get_by_label('GitHub 分支',exact=True).fill('main')
  v.get_by_label('GitHub Token',exact=True).fill(token)
  v.get_by_role('button',name='测试 GitHub 当前输入（不保存）',exact=True).click()
  receipt=page.get_by_role('region',name='GitHub 连接测试回执')
  expect(receipt.get_by_role('status').filter(has_text=re.compile('^(等待执行|正在测试|连接成功|测试失败|已取消)'))).to_contain_text('连接成功',timeout=20000)
  assert get()['revision']==0;no_secret()
  accepted=[]
  def lose(route):
   if route.request.method=='PUT':
    r=route.fetch();assert r.status==200,r.text()
    accepted.append((route.request.post_data,route.request.headers['idempotency-key']))
    route.abort('failed')
   else:route.continue_()
  page.route('**'+path,lose)
  v.get_by_role('button',name='检查并保存 GitHub 配置',exact=True).click()
  expect(v.get_by_text('结果尚未确认。请核对原请求回执，或重试同一请求。',exact=True)).to_be_visible()
  assert len(accepted)==1 and get()['revision']==1;no_secret()
  page.unroute('**'+path,lose);page.reload()
  expect(v.get_by_role('button',name='核对 GitHub 原请求回执',exact=True)).not_to_be_visible()
  expect(v.get_by_text(re.compile('^云端修订 1'))).to_be_visible()
  expect(v.get_by_label('GitHub Token',exact=True)).to_have_value('')
  v.get_by_label('GitHub 分支',exact=True).fill('topic/retained')
  v.get_by_role('button',name='检查并保存 GitHub 配置',exact=True).click()
  expect(v.get_by_text(re.compile('^云端修订 2'))).to_be_visible();assert get()['branch']=='topic/retained'
  save({'base_revision':2,'mode':'custom','repository':'fixture/content','branch':'remote','token':None})
  v.get_by_label('GitHub 分支',exact=True).fill('local')
  v.get_by_role('button',name='检查并保存 GitHub 配置',exact=True).click()
  expect(v.get_by_role('button',name='已核对，解除被拒绝的 GitHub 原请求')).to_be_visible()
  expect(v.get_by_label('GitHub 分支',exact=True)).to_have_value('local')
  assert get()['branch']=='remote'
  v.get_by_role('button',name='已核对，解除被拒绝的 GitHub 原请求').click()
  v.get_by_role('button',name='核对云端 GitHub 设置',exact=True).click()
  expect(v.get_by_text(re.compile('^云端修订 3'))).to_be_visible()
  v.get_by_role('button',name='保留本机仓库输入，采用云端修订').click()
  v.get_by_role('button',name='检查并保存 GitHub 配置',exact=True).click()
  expect(v.get_by_text(re.compile('^云端修订 4'))).to_be_visible();assert get()['branch']=='local'
  original=[]
  def reject(route):
   if route.request.method=='PUT':
    original.append((route.request.post_data,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**'+path,reject)
  v.get_by_label('GitHub 分支',exact=True).fill('reentry')
  v.get_by_label('GitHub Token',exact=True).fill(token)
  v.get_by_role('button',name='检查并保存 GitHub 配置',exact=True).click()
  expect(v.get_by_text('结果尚未确认。请核对原请求回执，或重试同一请求。',exact=True)).to_be_visible()
  page.unroute('**'+path,reject);page.reload()
  expect(v.get_by_role('button',name='重试 GitHub 原请求',exact=True)).to_be_visible()
  replay=[]
  def capture(route):
   if route.request.method=='PUT':replay.append((route.request.post_data,route.request.headers['idempotency-key']))
   route.continue_()
  page.route('**'+path,capture)
  v.get_by_label('GitHub Token',exact=True).fill('SYNTHETIC_WRONG')
  v.get_by_role('button',name='重试 GitHub 原请求',exact=True).click()
  expect(v.get_by_text('输入与原请求不同，请输入原密钥；没有发送或重建请求。',exact=True)).to_be_visible()
  assert replay==[]
  v.get_by_label('GitHub Token',exact=True).fill(token)
  v.get_by_role('button',name='重试 GitHub 原请求',exact=True).click()
  expect(v.get_by_text(re.compile('^云端修订 5'))).to_be_visible()
  assert original==replay;no_secret();page.unroute('**'+path,capture)
  v.get_by_label('GitHub 分支',exact=True).fill('slow')
  v.get_by_role('button',name='测试 GitHub 当前输入（不保存）',exact=True).click()
  expect(receipt.get_by_role('status').filter(has_text=re.compile('^(等待执行|正在测试|连接成功|测试失败|已取消)'))).to_contain_text('正在测试',timeout=20000)
  adopt=receipt.get_by_role('button',name='采用当前测试修订',exact=True)
  if adopt.is_visible():adopt.click()
  receipt.get_by_role('button',name='取消连接测试',exact=True).click()
  expect(receipt.get_by_role('status').filter(has_text=re.compile('^(等待执行|正在测试|连接成功|测试失败|已取消)'))).to_contain_text('已取消',timeout=20000)
  v.get_by_label('GitHub 分支',exact=True).fill('failed')
  v.get_by_role('button',name='检查并保存 GitHub 配置',exact=True).click()
  expect(v.get_by_role('button',name='已核对，解除被拒绝的 GitHub 原请求')).to_be_visible()
  assert get()['branch']=='reentry'
  v.get_by_role('button',name='已核对，解除被拒绝的 GitHub 原请求').click()
  v.get_by_label('GitHub 存储方式').select_option('default')
  v.get_by_role('button',name='清除 GitHub 配置并使用原生内容',exact=True).click()
  expect(v.get_by_text(re.compile('^云端修订 6'))).to_be_visible();assert not get()['configured']
  no_secret();assert errors==[],errors
  page.screenshot(path=str(a.output/'settings-desktop.png'),full_page=True)
  for width in [320,375,768,1024]:
   page.set_viewport_size({'width':width,'height':900})
   assert page.evaluate('document.documentElement.scrollWidth<=innerWidth'),width
  page.set_viewport_size({'width':320,'height':900})
  page.evaluate('async()=>{await document.fonts.ready;await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)}')
  v.scroll_into_view_if_needed()
  page.screenshot(path=str(a.output/'settings-320.png'))
  scope=page.evaluate("Object.keys(localStorage).find(k=>k.includes('github-settings')&&k.endsWith(':'+sessionStorage.getItem('grow.draft.document')))")
  assert scope
  raw=page.evaluate("k=>{const s=JSON.parse(localStorage.getItem(k));s.base.repository={invalid:true};const raw=JSON.stringify(s);localStorage.setItem(k,raw);return raw}",scope)
  writes=[]
  page.on('request',lambda r:writes.append(r.url) if r.method=='PUT' and path in r.url else None)
  page.reload()
  expect(v.get_by_role('alert')).to_contain_text('本机设置无法安全保存')
  assert page.evaluate('k=>localStorage.getItem(k)',scope)==raw
  assert writes==[]
  inherited=page.evaluate("Object.keys(localStorage).find(k=>k.includes('github-settings')&&k.endsWith(':'+sessionStorage.getItem('grow.draft.document')))")
  assert inherited!=scope and page.evaluate('k=>localStorage.getItem(k)',inherited)==raw
  (a.output/'result.json').write_text(json.dumps({'passed':True,'account':a.account,'unsaved_test_no_activation':True,'lost_save_response_receipt_recovery':True,'retained_token_without_echo':True,'CAS_preserves_local_input':True,'exact_original_after_token_reentry':True,'wrong_token_not_sent':True,'running_cancel_fenced':True,'failed_read_does_not_save':True,'explicit_native_clear':True,'no_token_in_storage_or_response':True,'widths':[320,375,768,1024],'page_errors':errors,'corrupt_baseline_blocks_without_deleting_raw':True,'served_grow_revision':served.group(1)},indent=2))
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:
  api.dispose();c.close();b.close()
