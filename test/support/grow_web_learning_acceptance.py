"""Deterministic synthetic account/text only; Chrome + real disposable PG backend."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
assert a.url.startswith('http://127.0.0.1:');a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  n=pw.request.new_context(base_url=a.url);auth=n.post('/api/v1/auth/login',data={'appId':'lighttick','account':'alice@example.com','password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick','X-Grow-Action-Schema':'2'}
  page.goto(a.url+'/grow/learning');page.get_by_label('邮箱或手机号').fill('alice@example.com');page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('heading',name='学习',exact=True)).to_be_visible()
  name='合成课程 '+str(uuid.uuid4())[:8];title='独立位置与学习事实 '+str(uuid.uuid4())[:8]
  page.get_by_text('创建课程与发布课节',exact=True).click();page.get_by_label('课程名称',exact=True).fill(name);page.get_by_role('button',name='创建课程',exact=True).click();expect(page.get_by_role('button',name='保存课程名称',exact=True)).to_be_visible();page.get_by_label('所属课程',exact=True).select_option(label=name);page.get_by_label('课节标题',exact=True).fill(title);page.get_by_label('课节正文',exact=True).fill('第一版合成正文\n## 思考题\n- 如何应用？');page.get_by_role('button',name='发布课节',exact=True).click();expect(page.get_by_role('button',name='发布修订版本',exact=True)).to_be_visible();page.get_by_role('button',name='1. '+title,exact=True).click();expect(page.get_by_label('私人笔记',exact=True)).to_be_visible()
  lessons=n.get('/api/v1/lighttick/learning/lessons?limit=100',headers=h).json()['data']['items'];lesson=next(l for l in lessons if l['title']==title);lid=lesson['id'];version=lesson['published_version'];path='/api/v1/lighttick/learning/lessons/'+lid
  page.get_by_label('私人笔记',exact=True).fill('本机保留的笔记');page.get_by_role('button',name='添加作答：思考题 · 如何应用？',exact=True).click();page.get_by_label('思考题 · 如何应用？',exact=True).fill('第一版题目的本机答案');page.get_by_label('阅读位置（字符）',exact=True).fill('42')
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/private')):page.get_by_role('button',name='保存阅读位置',exact=True).click()
  cloud=n.get(path+'/private?content_version='+version,headers=h).json()['data'];assert cloud['position']==42 and not cloud['completed'] and cloud['notes_revision']==0;expect(page.get_by_label('私人笔记',exact=True)).to_have_value('本机保留的笔记')
  dropped=[]
  def lose(route):
   if route.request.method=='POST' and route.request.post_data_json.get('action')=='save':
    r=route.fetch();assert r.status==200,r.text();dropped.append((route.request.post_data_json,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**/learning/lessons/*/private',lose);page.get_by_role('button',name='保存笔记与作答',exact=True).click();expect(page.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/learning/lessons/*/private',lose);page.reload();page.get_by_role('button',name='1. '+title,exact=True).click();expect(page.get_by_role('button',name='重试原请求',exact=True)).to_be_visible()
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/private')) as retry:page.get_by_role('button',name='重试原请求',exact=True).click()
  assert (retry.value.request.post_data_json,retry.value.request.headers['idempotency-key'])==dropped[0]
  expect(page.get_by_role('button',name='重试原请求',exact=True)).not_to_be_visible();page.get_by_label('私人笔记',exact=True).fill('本机未覆盖的第二份笔记')
  cloud=n.get(path+'/private?content_version='+version,headers=h).json()['data'];remote=n.post(path+'/private',headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'action':'save','content_version':version,'base_revision':cloud['notes_revision'],'notes':'手机合成笔记','answers':[]});assert remote.status==200,remote.text()
  page.get_by_role('button',name='保存笔记与作答',exact=True).click();expect(page.get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible();expect(page.get_by_label('私人笔记',exact=True)).to_have_value('本机未覆盖的第二份笔记');page.get_by_role('button',name='已核对，解除待核对状态',exact=True).click();page.get_by_role('button',name='核对云端副本',exact=True).click();expect(page.get_by_text('手机合成笔记',exact=True)).to_be_visible();page.get_by_role('button',name='已比较，保留本机输入并采用云端基线',exact=True).click();page.get_by_role('button',name='保存笔记与作答',exact=True).click();page.get_by_role('button',name='确认本版本已学完',exact=True).click();expect(page.get_by_text('本版本已确认学完。',exact=True)).to_be_visible()
  before=n.get(path+'/private?content_version='+version,headers=h).json()['data'];assert before['notes']=='本机未覆盖的第二份笔记' and before['completed'] and before['answers'][0]['answer']=='第一版题目的本机答案'
  publication=n.get(path+'/versions/'+version,headers=h).json()['data'];updated=n.put(path+'/publications',headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'base_revision':publication['revision'],'collection_id':publication['collection_id'],'number':publication['number'],'title':title,'content':'第二版合成正文\n## 思考题\n- 新的问题？','references':'','source_url':''});assert updated.status==200,updated.text();newversion=updated.json()['data']['content_version']
  page.get_by_role('button',name='刷新课程',exact=True).click();page.get_by_role('button',name='1. '+title,exact=True).click();expect(page.get_by_label('私人笔记',exact=True)).to_have_value('');expect(page.get_by_text('阅读到末尾不会自动标记学完。',exact=True)).to_be_visible();assert n.get(path+'/private?content_version='+version,headers=h).json()['data']['notes']==before['notes']
  page.get_by_text('打开保留的旧版正文与私人输入',exact=True).click();page.get_by_label('正文版本摘要',exact=True).fill(version);page.get_by_role('button',name='打开此版本',exact=True).click();expect(page.get_by_label('私人笔记',exact=True)).to_have_value(before['notes']);page.get_by_role('button',name='查看私人历史',exact=True).click();expect(page.get_by_text('版本 1 · initial',exact=True)).to_be_visible()
  page.screenshot(path=str(a.output/'learning-desktop.png'),full_page=True);page.set_viewport_size({'width':375,'height':812});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(a.output/'learning-mobile.png'),full_page=True);assert not errors,errors
  (a.output/'result.json').write_text(json.dumps({'passed':True,'lesson_id':lid,'old_version':version,'new_version':newversion,'lost_response_replay':True,'component_cas':True,'old_answers_preserved':True,'console_errors':errors},ensure_ascii=False,indent=2))
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:c.close();b.close()
