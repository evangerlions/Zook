"""Actual browser/canonical API story for manual plans and task execution."""
import argparse, json, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
parser=argparse.ArgumentParser();parser.add_argument('--url',required=True);parser.add_argument('--output',required=True,type=Path);args=parser.parse_args()
assert args.url.startswith('http://127.0.0.1:')
args.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as p:
 browser=p.chromium.launch(headless=True,channel='chrome');c=browser.new_context(viewport={'width':1440,'height':1000});page=c.new_page();page.on('dialog',lambda d:d.accept());errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
 page.goto(args.url+'/grow/plans');page.get_by_label('邮箱或手机号').fill('alice@example.com');page.get_by_label('密码',exact=True).fill('Password1234');page.get_by_role('button',name='登录并继续').click();expect(page.get_by_role('heading',name='计划与行动',exact=True)).to_be_visible()
 page.get_by_role('button',name='＋ 制定计划').click();name='新建共同计划 '+str(uuid.uuid4())[:8]
 page.get_by_label('目标标题').fill(name);page.get_by_label('做到什么算有进展？').fill('写出一个可执行步骤');page.get_by_label('行动标题').fill('把第一步写下来');page.get_by_label('完成标准',exact=True).fill('明确写下时间和动作')
 with page.expect_response(lambda r:r.url.endswith('/lighttick/manual-plans') and r.request.method=='POST') as sent:page.get_by_role('button',name='保存计划草稿').click()
 initial=sent.value.json()['data'];assert initial['version']==1 and initial['status']=='proposed';pid=initial['id']
 expect(page.get_by_text('草稿已保存。确认前不会创建执行任务。',exact=True)).to_be_visible()
 native=p.request.new_context(base_url=args.url);login=native.post('/api/v1/auth/login',data={'appId':'lighttick','account':'alice@example.com','password':'Password1234','clientType':'app'}).json()['data'];headers={'Authorization':'Bearer '+login['accessToken'],'X-App-Id':'lighttick','X-LightTick-Task-Schema':'2'}
 assert native.get('/api/v1/lighttick/plans/'+pid+'/tasks',headers=headers).json()['data']['items']==[]
 revised={**initial['draft'],'title':name+' 手机修改','base_version':1}
 result=native.patch('/api/v1/lighttick/manual-plans/'+pid,data=revised,headers={**headers,'Idempotency-Key':'native-plan-'+pid});assert result.status==200,result.text();assert result.json()['data']['version']==2
 page.get_by_label('做到什么算有进展？').fill('网页保留的完成标准')
 page.get_by_role('button',name='保存计划草稿').click();expect(page.get_by_role('heading',name='计划已在另一端变化')).to_be_visible();expect(page.get_by_label('做到什么算有进展？')).to_have_value('网页保留的完成标准')
 page.get_by_role('button',name='保留本机修改并重新核对').click();page.get_by_role('button',name='保存计划草稿').click();expect(page.get_by_text('草稿已保存。确认前不会创建执行任务。',exact=True)).to_be_visible()
 with page.expect_response(lambda r:r.url.endswith('/'+pid+'/confirm')) as sent:page.get_by_role('button',name='审阅后确认安排').click()
 assert sent.value.status==200,sent.value.text();active=sent.value.json()['data'];assert active['version']==4 and active['status']=='active';assert len(active['tasks'])==1
 task=active['tasks'][0];tid=task['id'];expect(page.get_by_text('已确认，行动安排已生效。',exact=True)).to_be_visible();page.screenshot(path=str(args.output/'plan-desktop.png'),full_page=True)
 # Native consumes exactly the same plan and canonical task IDs.
 current=native.get('/api/v1/lighttick/manual-plans/'+pid,headers=headers).json()['data'];assert current['tasks'][0]['id']==tid and current['version']==4
 page.get_by_role('link',name='◷ 今日').click();card=page.locator('[data-task-id="'+tid+'"]');expect(card).to_be_visible()
 with page.expect_response(lambda r:r.url.endswith('/'+tid+'/complete')) as sent:card.get_by_role('button',name='确认完成').click()
 assert sent.value.status==200,sent.value.text();task_after=next(t for t in native.get('/api/v1/lighttick/plans/'+pid+'/tasks',headers=headers).json()['data']['items'] if t['id']==tid);assert task_after['status']=='completed'
 page.set_viewport_size({'width':375,'height':900});assert page.evaluate('document.documentElement.scrollWidth <= innerWidth');page.screenshot(path=str(args.output/'today-mobile.png'),full_page=True)
 assert not errors,errors
 (args.output/'result.json').write_text(json.dumps({'passed':True,'plan_id':pid,'task_id':tid,'plan_version':4,'checks':['draft_creates_no_tasks','native_same_plan','cross_client_CAS','explicit_confirmation','single_canonical_task','web_completion_visible_to_native','mobile_no_overflow'],'native_scope':'native canonical HTTP, not device UI'},ensure_ascii=False,indent=2))
 native.dispose();c.close();browser.close()
