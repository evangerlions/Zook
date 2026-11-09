"""Synthetic Chrome + PostgreSQL acceptance for formal courses and existing worker integration."""
import argparse,json,re,uuid
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--account',default='course0@example.com');a=p.parse_args()
assert a.url.startswith('http://127.0.0.1:') and re.fullmatch(r'course\d+@example.com',a.account)
a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome');c=b.new_context(viewport={'width':1440,'height':1100});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  api=pw.request.new_context(base_url=a.url);auth=api.post('/api/v1/auth/login',data={'appId':'lighttick','account':a.account,'password':'Password1234','clientType':'app'}).json()['data'];h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick','X-Grow-Action-Schema':'2'}
  def get(path):
   r=api.get('/api/v1/lighttick/'+path,headers=h);assert r.status==200,r.text();return r.json()['data']
  def post(path,body):
   r=api.post('/api/v1/lighttick/'+path,headers={**h,'Idempotency-Key':str(uuid.uuid4())},data=body);assert r.status==200,r.text();return r.json()['data']
  page.goto(a.url+'/grow/learning');page.get_by_label('邮箱或手机号').fill(a.account);page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('heading',name='正式课程路线',exact=True)).to_be_visible()
  page.get_by_role('button',name='准备新课程路线',exact=True).click();name='合成正式路线 '+str(uuid.uuid4())[:8]
  page.get_by_label('路线名称',exact=True).fill(name);page.get_by_label('学习目的',exact=True).fill('解释并应用一个合成概念');page.get_by_label('当前基础',exact=True).fill('从合成案例开始')
  for n in [1,2]:
   page.get_by_label(f'阶段 {n} 目标',exact=True).fill('阶段合成目标 '+str(n));page.get_by_text(f'第 {n} 课：待填写主题',exact=True).click()
   for label,value in [('主题','合成课次 '+str(n)),('目标','解释具体结论'),('练习','写下一条应用'),('自查','核对证据')]:page.get_by_label(f'第 {n} 课{label}',exact=True).fill(value)
  lost=[]
  def lose(route):
   if route.request.method=='PUT':
    response=route.fetch();assert response.status==200,response.text();lost.append((route.request.url,route.request.post_data_json,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**/learning/routes/plan-*',lose);page.get_by_role('button',name='保存路线草案',exact=True).click();expect(page.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible();page.unroute('**/learning/routes/plan-*',lose)
  page.reload();page.get_by_role('button',name='准备新课程路线',exact=True).click();expect(page.get_by_role('button',name='重试原请求',exact=True)).to_be_visible()
  with page.expect_response(lambda r:r.request.method=='PUT' and '/learning/routes/' in r.url) as retry:page.get_by_role('button',name='重试原请求',exact=True).click()
  assert (retry.value.request.url,retry.value.request.post_data_json,retry.value.request.headers['idempotency-key'])==lost[0]
  rid=urlparse(lost[0][0]).path.rsplit('/',1)[1];root='learning/routes/'+rid
  expect(page.get_by_label('路线名称',exact=True)).to_have_value(name);page.get_by_role('button',name='核对并发布路线',exact=True).click();expect(page.get_by_role('heading',name='正式进度 · '+name,exact=True)).to_be_visible()
  page.get_by_role('button',name='准备正式第 1 课正文',exact=True).click();page.get_by_label('正式课次正文',exact=True).fill('第一版正式合成正文\n## 思考题\n- 如何应用？');page.get_by_label('正式课次参考资料',exact=True).fill('合成材料');page.get_by_role('button',name='核对并发布本课',exact=True).click();expect(page.get_by_role('button',name='阅读正式第 1 课',exact=True)).to_be_visible()
  first=get(root+'/progress')['lessons'][0];lid=first['lesson_id'];old=first['content_version']
  page.get_by_role('button',name='阅读正式第 1 课',exact=True).click();expect(page.get_by_label('私人笔记',exact=True)).to_be_visible();page.get_by_label('私人笔记',exact=True).fill('旧正文保留的本人合成笔记');page.get_by_role('button',name='保存笔记与作答',exact=True).click();page.get_by_label('阅读位置（字符）',exact=True).fill('123');page.get_by_role('button',name='保存阅读位置',exact=True).click()
  assert get(root+'/progress')['completed_lessons']==0
  page.get_by_role('button',name='确认本版本已学完',exact=True).click();expect(page.get_by_text('本版本已确认学完。',exact=True)).to_be_visible();page.get_by_role('button',name='刷新正式进度',exact=True).click();expect(page.get_by_text('已明确学完 1 / 2 课 · 50% · 已发布 1 课',exact=True)).to_be_visible()
  page.get_by_role('button',name='编辑正式第 1 课正文',exact=True).click();page.get_by_label('正式课次正文',exact=True).fill('第二版正式合成正文');page.get_by_role('button',name='核对并发布本课',exact=True).click();expect(page.get_by_text('已明确学完 0 / 2 课 · 0% · 已发布 1 课',exact=True)).to_be_visible()
  assert get('learning/lessons/'+lid+'/private?content_version='+old)['notes']=='旧正文保留的本人合成笔记'
  page.get_by_role('button',name='核对云端路线',exact=True).click();page.get_by_role('button',name='已比较，保留本机草案并采用云端基线',exact=True).click();page.get_by_label('学习目的',exact=True).fill('本机保留的路线目标')
  current=get(root);remote={**current['brief'],'goal':'另一端的路线目标'};response=api.put('/api/v1/lighttick/'+root,headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'base_revision':current['revision'],'brief':remote,'document':current['document']});assert response.status==200,response.text()
  page.get_by_role('button',name='保存路线草案',exact=True).click();expect(page.get_by_role('button',name='已核对，解除待核对状态',exact=True)).to_be_visible();expect(page.get_by_label('学习目的',exact=True)).to_have_value('本机保留的路线目标');page.get_by_role('button',name='已核对，解除待核对状态',exact=True).click();page.get_by_role('button',name='核对云端路线',exact=True).click();expect(page.get_by_text('另一端的路线目标',exact=True)).to_be_visible();page.get_by_role('button',name='已比较，保留本机草案并采用云端基线',exact=True).click();page.get_by_role('button',name='保存路线草案',exact=True).click();page.get_by_role('button',name='核对并发布路线',exact=True).click()
  page.get_by_role('button',name='阅读正式第 1 课',exact=True).click();expect(page.get_by_label('私人笔记',exact=True)).to_have_value('');page.get_by_role('button',name='确认本版本已学完',exact=True).click();expect(page.get_by_text('本版本已确认学完。',exact=True)).to_be_visible();page.get_by_role('button',name='刷新正式进度',exact=True).click()
  page.get_by_label('学习任务类型',exact=True).select_option('file_ingest');page.get_by_role('button',name='使用当前课程与学习条件',exact=True).click();page.get_by_label('资料文件名称',exact=True).fill('合成资料.txt');page.get_by_label('待上传文本正文',exact=True).fill('经明确上传并核对的合成材料，包含一个可练习的概念。');page.get_by_role('button',name='提交学习任务',exact=True).click();expect(page.get_by_role('button',name='将此文件加入资料清单',exact=True)).to_be_visible(timeout=15000);page.get_by_role('button',name='将此文件加入资料清单',exact=True).click();page.get_by_role('button',name='提交学习任务',exact=True).click();expect(page.get_by_role('button',name='使用此份已核对资料',exact=True)).to_be_visible(timeout=15000);page.get_by_role('button',name='使用此份已核对资料',exact=True).click();page.get_by_label('准备第几课',exact=True).fill('2');page.get_by_role('button',name='提交学习任务',exact=True).click()
  lessonCard=page.get_by_role('heading',name='课次草案',exact=True).locator('..');expect(lessonCard.get_by_text(re.compile('已生成，等待核对'))).to_be_visible(timeout=15000)
  assert get(root+'/progress')['published_lessons']==1,'worker cannot publish without reviewed adoption'
  lessonCard.get_by_role('button',name='核对后使用当前任务版本',exact=True).click();lessonCard.get_by_role('button',name='核对并发布本课草案',exact=True).click();expect(page.get_by_role('button',name='阅读正式第 2 课',exact=True)).to_be_visible(timeout=10000)
  progress=get(root+'/progress');assert progress['published_lessons']==2 and progress['completed_lessons']==1
  legacy=get('action-plans/learning-progress')['progress'];assert next(p for p in legacy['plans'] if p['id']==rid)['completed_lessons']==1
  page.get_by_role('button',name='准备新课程路线',exact=True).click();aiName='AI 合成路线 '+str(uuid.uuid4())[:8];page.get_by_label('路线名称',exact=True).fill(aiName);page.get_by_label('学习目的',exact=True).fill('理解并应用合成材料');page.get_by_label('当前基础',exact=True).fill('合成初学者');page.get_by_role('button',name='使用当前课程与学习条件',exact=True).click()
  with page.expect_response(lambda r:r.request.method=='POST' and r.url.endswith('/learning/work')) as aiResponse:page.get_by_role('button',name='提交学习任务',exact=True).click()
  aiId=aiResponse.value.json()['data']['route_id'];aiCard=page.get_by_role('heading',name='路线草案',exact=True).locator('..');expect(aiCard.get_by_text(re.compile('已生成，等待核对'))).to_be_visible(timeout=15000)
  assert api.get('/api/v1/lighttick/learning/routes/'+aiId,headers=h).status==404
  aiCard.get_by_role('button',name='核对后使用当前任务版本',exact=True).click();aiCard.get_by_role('button',name='核对并采用为路线草案',exact=True).click();expect(page.get_by_label('路线名称',exact=True)).to_have_value(aiName)
  assert get('learning/routes/'+aiId)['published_version']==0
  page.get_by_role('button',name='核对并发布路线',exact=True).click();expect(page.get_by_role('heading',name='正式进度 · '+aiName,exact=True)).to_be_visible()
  before=get('learning/routes/'+aiId);page.get_by_label('路线名称',exact=True).fill('慢任务 '+aiName);page.get_by_role('button',name='使用当前课程与学习条件',exact=True).click();page.get_by_role('button',name='提交学习任务',exact=True).click()
  slow=page.get_by_role('heading',name='路线草案',exact=True).locator('..').filter(has_text='正在执行');expect(slow).to_have_count(1,timeout=5000);slow.get_by_role('button',name='核对后使用当前任务版本',exact=True).click();slow.get_by_role('button',name='取消本次学习任务',exact=True).click();expect(page.get_by_text(re.compile('任务状态：已取消'))).to_be_visible(timeout=5000)
  assert get('learning/routes/'+aiId)==before,'cancelled generation cannot overwrite the course'
  page.screenshot(path=str(a.output/'course-desktop.png'),full_page=True);page.set_viewport_size({'width':375,'height':812});assert page.evaluate('document.documentElement.scrollWidth<=innerWidth');page.screenshot(path=str(a.output/'course-mobile.png'),full_page=True);assert not errors,errors
  (a.output/'result.json').write_text(json.dumps({'passed':True,'manual_route':rid,'ai_route':aiId,'lost_response_exact_replay':True,'route_cas_preserves_local':True,'per_content_completion':True,'file_source_worker_review':True,'explicit_ai_adoption':True,'cancel_no_publication':True,'legacy_progress':True,'console_errors':errors},ensure_ascii=False,indent=2))
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:c.close();b.close()
