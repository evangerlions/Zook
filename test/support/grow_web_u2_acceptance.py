"""U2 UI against real PG and actual queue/AI runner, deterministic provider output only."""
import argparse,json,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser()
p.add_argument('--url',required=True)
p.add_argument('--output',required=True,type=Path)
a=p.parse_args()
assert a.url.startswith('http://127.0.0.1:')
a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome')
 c=b.new_context(viewport={'width':1440,'height':1000})
 page=c.new_page()
 page.on('dialog',lambda d:d.accept())
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 try:
  n=pw.request.new_context(base_url=a.url)
  auth=n.post('/api/v1/auth/login',data={'appId':'lighttick','account':'alice@example.com','password':'Password1234','clientType':'app'}).json()['data']
  h={'Authorization':'Bearer '+auth['accessToken'],'X-App-Id':'lighttick','X-Grow-Action-Schema':'2','X-LightTick-Task-Schema':'2'}
  name='U2目标 '+str(uuid.uuid4())[:8]
  r=n.post('/api/v1/lighttick/goals',headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'title':name,'constraints':{'weekly_available_minutes':30}})
  assert r.status==201,r.text()
  goal=r.json()['data']
  gid=goal['id']
  page.goto(a.url+'/grow/planning')
  page.get_by_label('邮箱或手机号').fill('alice@example.com')
  page.get_by_label('密码',exact=True).fill('Password1234')
  page.get_by_role('button',name='登录并继续').click()
  expect(page.get_by_role('heading',name='AI 规划',exact=True)).to_be_visible()
  page.get_by_label('选择已有目标').select_option(gid)
  page.get_by_role('button',name='开始新规划会话').click()
  expect(page.get_by_role('heading',name='规划上下文')).to_be_visible()
  sid=page.get_by_label('接续会话编号').input_value()
  page.get_by_label('规划开始日期',exact=True).fill('2030-01-01')
  page.get_by_label('规划结束日期',exact=True).fill('2030-01-07')
  dropped=[]
  def lose_context(route):
   if route.request.method=='PATCH':
    response=route.fetch()
    assert response.status==200,response.text()
    dropped.append((route.request.post_data_json,route.request.headers.get('idempotency-key')))
    route.abort('failed')
   else:route.continue_()
  page.route('**/planning-sessions/*/context',lose_context)
  page.get_by_role('button',name='确认并保存上下文').click()
  expect(page.get_by_text('结果尚未确认，请恢复连接后重试原请求。',exact=True)).to_be_visible()
  page.unroute('**/planning-sessions/*/context',lose_context)
  page.reload()
  expect(page.get_by_role('button',name='重试原请求',exact=True)).to_be_visible()
  with page.expect_response(lambda r:r.url.endswith('/context') and r.request.method=='PATCH') as retried:page.get_by_role('button',name='重试原请求',exact=True).click()
  assert (retried.value.request.post_data_json,retried.value.request.headers.get('idempotency-key'))==dropped[0]
  expect(page.get_by_text('云端已确认。',exact=True)).to_be_visible()
  page.get_by_label('补充说明',exact=True).fill('安排一个足够小的步骤')
  page.get_by_role('button',name='发送规划说明',exact=True).click()
  expect(page.get_by_text('请核对投入与日期，再审阅草案。',exact=False)).to_be_visible(timeout=20000)
  page.get_by_label('预期成果',exact=True).fill('本机保留的成果描述')
  current=n.get('/api/v1/lighttick/planning-sessions/'+sid,headers=h).json()['data']
  changed=n.patch('/api/v1/lighttick/planning-sessions/'+sid+'/context',headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'base_version':current['version'],'fields':{'outcome':{'value':'手机修改的成果','source':'confirmed'}}})
  assert changed.status==200,changed.text()
  page.get_by_role('button',name='确认并保存上下文').click()
  expect(page.get_by_role('button',name='已核对，解除待核对状态')).to_be_visible()
  expect(page.get_by_label('预期成果',exact=True)).to_have_value('本机保留的成果描述')
  page.get_by_role('button',name='刷新规划',exact=True).click()
  page.get_by_role('button',name='已核对，解除待核对状态').click()
  page.get_by_role('button',name='保留本机上下文并重新审阅').click()
  page.get_by_role('button',name='确认并保存上下文').click()
  expect(page.get_by_text('云端已确认。',exact=True)).to_be_visible()
  page.get_by_label('我主动选择详细规划').check()
  page.get_by_role('button',name='生成待审阅草案',exact=True).click()
  expect(page.get_by_role('button',name='载入云端草案供审阅')).to_be_visible(timeout=20000)
  page.get_by_role('button',name='载入云端草案供审阅').click()
  expect(page.get_by_label('草案行动标题')).to_have_value('合成规划步骤')
  s=n.get('/api/v1/lighttick/planning-sessions/'+sid,headers=h).json()['data']
  pid=s['draft_plan_id']
  assert n.get('/api/v1/lighttick/plans/'+pid+'/tasks',headers=h).json()['data']['items']==[]
  page.get_by_label('草案行动标题').fill('网页审阅后的具体步骤')
  remote=n.get('/api/v1/lighttick/plans/'+pid,headers=h).json()['data']
  current=n.get('/api/v1/lighttick/planning-sessions/'+sid,headers=h).json()['data']
  updated=n.patch('/api/v1/lighttick/planning-sessions/'+sid+'/draft',headers={**h,'Idempotency-Key':str(uuid.uuid4())},data={'base_version':current['version'],'context_revision':current['context_revision'],'draft_plan_id':pid,'plan_version':remote['version'],'tasks':[{'title':'手机修订的草案','estimated_minutes':5,'scheduled_for':'2030-01-01T09:00:00Z'}]})
  assert updated.status==200,updated.text()
  page.get_by_role('button',name='保存 AI 草案修改').click()
  expect(page.get_by_role('button',name='已核对，解除待核对状态')).to_be_visible()
  expect(page.get_by_label('草案行动标题')).to_have_value('网页审阅后的具体步骤')
  page.get_by_role('button',name='刷新规划',exact=True).click()
  page.get_by_role('button',name='已核对，解除待核对状态').click()
  page.get_by_role('button',name='保留本机草案，在云端新版上重新审阅').click()
  page.get_by_role('button',name='保存 AI 草案修改').click()
  expect(page.get_by_label('草案行动标题')).not_to_be_visible()
  page.get_by_role('button',name='载入云端草案供审阅').click()
  expect(page.get_by_label('草案行动标题')).to_have_value('网页审阅后的具体步骤')
  page.get_by_role('button',name='审阅后确认 AI 安排').click()
  expect(page.get_by_text('状态：confirmed',exact=False)).to_be_visible()
  tasks=n.get('/api/v1/lighttick/plans/'+pid+'/tasks',headers=h).json()['data']['items']
  assert len(tasks)==1 and tasks[0]['title']=='网页审阅后的具体步骤'
  tid=tasks[0]['id']
  def disable_planning_ui(route):
   response=route.fetch()
   value=response.json();value['data']['features']['conversational_planning']=False
   route.fulfill(response=response,json=value)
  page.route('**/lighttick/public/config',disable_planning_ui)
  page.get_by_role('button',name='刷新规划',exact=True).click()
  expect(page.get_by_role('button',name='开始新规划会话')).to_be_disabled()
  expect(page.get_by_text('状态：confirmed',exact=False)).to_be_visible()
  page.unroute('**/lighttick/public/config',disable_planning_ui)
  # Pause, confirm actual capacity, save reflection, replace all outstanding tasks and resume atomically.
  page.get_by_role('link',name='目标续排',exact=True).click()
  expect(page.get_by_role('heading',name='目标与续排',exact=True)).to_be_visible()
  page.get_by_label('目标',exact=False).first.select_option(gid)
  page.get_by_label('审阅窗口开始').fill('2030-01-01')
  page.get_by_label('审阅窗口结束').fill('2030-01-07')
  expect(page.get_by_role('button',name='暂停目标',exact=True)).to_be_visible()
  page.get_by_label('暂停原因').fill('根据实际投入重新安排')
  page.get_by_role('button',name='暂停目标',exact=True).click()
  expect(page.get_by_text('当前 paused',exact=False)).to_be_visible()
  page.get_by_label('条件确认原因').fill('每天能安排20分钟')
  page.get_by_role('button',name='确认投入条件').click()
  expect(page.get_by_text('每天能安排20分钟',exact=False)).to_be_visible()
  page.get_by_label('复盘内容',exact=True).fill('需要缩小动作，按真实条件接着做')
  page.get_by_label('复盘后的下一步').fill('下一轮写出结论')
  page.get_by_role('button',name='保存目标复盘').click()
  expect(page.get_by_label('用这份已保存复盘续排')).to_be_checked()
  page.get_by_label('将此任务替换为新的安排（历史和来源保留）').check()
  page.get_by_label('审阅全部未完成任务后，确认新安排时恢复目标').check()
  page.get_by_role('button',name='建立待确认续排草案').click()
  expect(page.get_by_role('heading',name='计划与行动',exact=True)).to_be_visible()
  page.get_by_role('button',name='保存计划草稿').click()
  expect(page.get_by_text('草稿已保存。确认前不会创建执行任务。',exact=True)).to_be_visible()
  before=n.get('/api/v1/lighttick/goals/'+gid,headers=h).json()['data']
  assert before['status']=='paused'
  page.get_by_role('button',name='审阅后确认安排').click()
  expect(page.get_by_text('已确认，行动安排已生效。',exact=True)).to_be_visible()
  after=n.get('/api/v1/lighttick/goals/'+gid,headers=h).json()['data']
  assert after['status']=='active'
  original=n.get('/api/v1/lighttick/plans/'+pid+'/tasks',headers=h).json()['data']['items']
  assert next(t for t in original if t['id']==tid)['status']=='cancelled'
  # Full hierarchy creation/edit and manual review use independent action IDs.
  page.get_by_role('link',name='✓ 共享行动',exact=True).click()
  page.get_by_text('完整安排：年 / 月 / 周 / 日、内容来源和提醒',exact=True).click()
  form=page.locator('details').first
  form.get_by_label('行动名称',exact=True).fill('周行动 '+name)
  form.get_by_label('周期',exact=False).select_option('week')
  form.get_by_label('起始日期',exact=True).fill('2030-01-01')
  form.get_by_label('截止日期').fill('2030-01-07')
  
  with page.expect_response(lambda r:r.url.endswith('/action-plans') and r.request.method=='POST') as created:form.get_by_role('button',name='保存完整行动').click()
  assert created.value.status==200,created.value.text()
  aid=created.value.json()['data']['plans'][0]['id']
  form.get_by_label('行动名称',exact=True).fill('子行动 '+name)
  form.get_by_label('起始日期',exact=True).fill('2030-01-01')
  form.get_by_label('上级行动').select_option(aid)
  with page.expect_response(lambda r:r.url.endswith('/action-plans') and r.request.method=='POST') as child:form.get_by_role('button',name='保存完整行动').click()
  assert child.value.status==200,child.value.text()
  assert child.value.json()['data']['plans'][0]['parent_id']==aid
  card=page.locator('[data-action-id="'+aid+'"]')
  card.get_by_role('button',name='编辑与复盘').click()
  card.get_by_label('行动名称',exact=True).fill('修订周行动 '+name)
  card.get_by_label('行动理由').fill('保留明确的投入理由')
  card.get_by_role('button',name='保存完整行动').click()
  expect(card.get_by_role('heading',name='修订周行动 '+name,exact=True)).to_be_visible()
  card.get_by_label('复盘开始日期').fill('2030-01-01')
  card.get_by_label('复盘结束日期').fill('2030-01-07')
  card.get_by_role('button',name='查看事实预览').click()
  expect(card.get_by_text('实际投入 0 分钟',exact=False)).to_be_visible()
  card.get_by_label('哪些做法有效？').fill('先确认边界再行动')
  card.get_by_role('button',name='保存行动复盘').click()
  expect(card.get_by_text('先确认边界再行动',exact=True)).to_be_visible()
  assert n.get('/api/v1/lighttick/action-plans/reviews?plan_id='+aid,headers=h).json()['data']['review_total']==1
  page.set_viewport_size({'width':375,'height':900})
  page.evaluate('window.scrollTo(0,0)')
  assert page.evaluate('document.documentElement.scrollWidth<=innerWidth')
  page.screenshot(path=str(a.output/'u2-mobile.png'))
  assert not errors,errors
  (a.output/'result.json').write_text(json.dumps({'passed':True,'goal_id':gid,'session_id':sid,'plan_id':pid,'action_id':aid,'checks':['AI_actual_queue_runner_synthetic_provider','clarification_history','delivery_disabled_history_readable','draft_no_tasks','draft_edit','planning_context_CAS_retains_local','draft_CAS_explicit_rebase','accepted_context_response_lost_exact_retry','explicit_confirm_same_task','pause','confirmed_capacity','reflection_source_revision','reviewed_replacement_resumes_goal','original_task_cancelled','full_period_edit','explicit_child_identity','manual_action_review','mobile_no_overflow'],'limits':'Synthetic model output, native canonical HTTP, no physical devices or live model quality claim'},ensure_ascii=False,indent=2))
  n.dispose()
  c.close()
  b.close()
 except Exception:
  page.screenshot(path=str(a.output/'failure.png'),full_page=True)
  print(page.locator('body').inner_text()[:6000])
  raise
