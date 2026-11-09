"""Synthetic two-tab draft and explicit-rebase acceptance, same canonical HTTP/PG service."""
import argparse,json,re,uuid
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--expected-grow-revision',required=True);p.add_argument('--output',required=True,type=Path);a=p.parse_args();assert a.url=='http://127.0.0.1:58642' and re.fullmatch('[a-f0-9]{40}',a.expected_grow_revision);a.output.mkdir(exist_ok=True,parents=True)
marker=uuid.uuid4().hex[:10];a_title='Tab A unsubmitted '+marker;b_title='Tab B confirmed '+marker
with sync_playwright() as pw:
 b=pw.chromium.launch(channel='chrome',headless=True);ctx=b.new_context(viewport={'width':1440,'height':1000});one=ctx.new_page();two=None;errors=[]
 def hooks(page):page.on('dialog',lambda d:d.accept());page.on('pageerror',lambda e:errors.append(str(e)))
 hooks(one)
 def ws(page):return page.get_by_role('region',name='决策表单工作区',exact=True)
 def editor(page):return ws(page).get_by_role('group',name='当前表单编辑',exact=True)
 try:
  one.goto(a.url+'/grow/forms');one.get_by_label('邮箱或手机号',exact=True).fill('alice@example.com');one.get_by_label('密码',exact=True).fill('Password1234');one.get_by_role('button',name='登录并继续',exact=True).click();expect(ws(one).get_by_role('button',name='载入云端本栏副本',exact=True)).to_be_enabled();ws(one).get_by_role('button',name='载入云端本栏副本',exact=True).click();ws(one).get_by_role('button',name='编辑第 1 条',exact=True).click();editor(one).get_by_label('决策事项',exact=True).fill(a_title)
  two=ctx.new_page();hooks(two);two.goto(a.url+'/grow/forms?section=decisions');expect(ws(two).get_by_role('button',name='载入云端本栏副本',exact=True)).to_be_enabled();ws(two).get_by_role('button',name='载入云端本栏副本',exact=True).click();expect(editor(two)).to_have_count(0);expect(ws(two)).not_to_contain_text(a_title);ws(two).get_by_role('button',name='编辑第 1 条',exact=True).click();editor(two).get_by_label('决策事项',exact=True).fill(b_title);editor(two).get_by_role('button',name='加入本机列表',exact=True).click();ws(two).get_by_role('button',name='确认保存本栏到云端',exact=True).click();expect(ws(two).get_by_text('云端已确认。',exact=True)).to_be_visible()
  with one.expect_response(lambda r:r.request.method=='GET' and r.url.endswith('/form-records')):ws(one).get_by_role('button',name='核对云端表单',exact=True).click()
  expect(editor(one).get_by_label('决策事项',exact=True)).to_have_value(a_title);ws(one).get_by_text('比较原基线、云端与本机整栏',exact=True).click();expect(ws(one).get_by_role('button',name='已比较，保留本机整栏并采用云端基线',exact=True)).to_be_disabled()
  editor(one).get_by_role('button',name='加入本机列表',exact=True).click();expect(ws(one).get_by_role('button',name='确认保存本栏到云端',exact=True)).to_be_disabled();expect(ws(one).get_by_role('region',name='云端当前内容',exact=True)).to_contain_text(b_title);expect(ws(one).get_by_role('region',name='本机当前内容',exact=True)).to_contain_text(a_title);ws(one).get_by_role('button',name='已比较，保留本机整栏并采用云端基线',exact=True).click();ws(one).get_by_role('button',name='确认保存本栏到云端',exact=True).click();expect(ws(one).get_by_text('云端已确认。',exact=True)).to_be_visible()
  with two.expect_response(lambda r:r.request.method=='GET' and r.url.endswith('/form-records')):ws(two).get_by_role('button',name='核对云端表单',exact=True).click()
  ws(two).get_by_text('比较原基线、云端与本机整栏',exact=True).click();expect(ws(two).get_by_role('region',name='云端当前内容',exact=True)).to_contain_text(a_title);expect(ws(two).get_by_role('region',name='本机当前内容',exact=True)).to_contain_text(b_title)
  assert errors==[],errors;two.screenshot(path=str(a.output/'forms-two-tab-review.png'));result={'passed':True,'served_revision':a.expected_grow_revision,'same_owner_tabs_keep_separate_raw_editors':True,'refresh_never_overwrites_local_input':True,'adoption_requires_editor_to_be_reviewed_in_local_list':True,'stale_save_disabled_until_explicit_three_way_adoption':True,'other_tab_keeps_its_own_copy_after_remote_write':True,'page_errors':errors};(a.output/'two-tab-result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
 except Exception:one.screenshot(path=str(a.output/'two-tab-failure.png'));raise
 finally:b.close()
