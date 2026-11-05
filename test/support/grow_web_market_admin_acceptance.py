"""Chrome against the disposable localhost admin fixture; credentials are synthetic literals."""
import argparse,json,uuid,re
from pathlib import Path
from playwright.sync_api import sync_playwright,expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();assert a.url.startswith('http://127.0.0.1:');a.output.mkdir(parents=True,exist_ok=True)
with sync_playwright() as pw:
 b=pw.chromium.launch(headless=True,channel='chrome');c=b.new_context(viewport={'width':1440,'height':1000});page=c.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));path='/api/v1/admin/apps/lighttick/market-providers/tushare-credential';secret='synthetic-ui-'+uuid.uuid4().hex
 try:
  r=c.request.post(a.url+'/api/v1/admin/auth/login',data={'username':'fixture-market-admin','password':'synthetic-market-password'});assert r.status==200
  page.goto(a.url+'/lighttick');page.get_by_role('combobox',name='项目空间').click();page.get_by_role('option').filter(has_text='lighttick').click();card=page.locator('.ant-card').filter(has=page.get_by_text('行情供应商凭据',exact=True));expect(card.get_by_text('密钥只留服务端',exact=True)).to_be_visible();field=card.get_by_label('新的 Tushare Token');field.fill(secret)
  assert not page.evaluate('(s)=>JSON.stringify(localStorage).includes(s)||JSON.stringify(sessionStorage).includes(s)',secret)
  original=[]
  def lose(route):
   if route.request.method=='PUT':
    response=route.fetch();assert response.status==200,(response.status,response.text());original.append((route.request.post_data,route.request.headers['idempotency-key']));route.abort('failed')
   else:route.continue_()
  page.route('**'+path,lose);card.get_by_role('button',name='更新 Tushare 凭据',exact=True).click()
  def verify():
   dialog=page.get_by_role('dialog',name='确认更新服务端行情凭据');inputs=dialog.locator('input');expect(inputs).to_have_count(6)
   for i,d in enumerate('199510'):inputs.nth(i).fill(d)
   dialog.get_by_role('button',name='验证并继续',exact=True).click();return dialog
  dialog=verify();expect(card.get_by_text('本次提交尚未确认或已被拒绝。原请求仅保存在此页内存；请核对后重试原请求。',exact=True)).to_be_visible();page.unroute('**'+path,lose);dialog.get_by_role('button',name=re.compile(r'取\s*消')).click();expect(dialog).not_to_be_visible();assert len(original)==1
  summary=c.request.get(a.url+path);assert summary.status==200 and secret not in summary.text();revision=summary.json()['data']['revision'];assert summary.json()['data']['configured']
  replay=[]
  def capture(route):
   if route.request.method=='PUT':replay.append((route.request.post_data,route.request.headers['idempotency-key']))
   route.continue_()
  page.route('**'+path,capture);card.get_by_role('button',name='重试凭据原请求',exact=True).click();verify();expect(card.get_by_role('button',name='重试凭据原请求',exact=True)).not_to_be_visible();assert replay==original;expect(field).to_have_value('');assert c.request.get(a.url+path).json()['data']['revision']==revision
  card.get_by_role('button',name='移除 Tushare 凭据',exact=True).click();verify();expect(card.get_by_text('未配置 Tushare',exact=False)).to_be_visible();summary=c.request.get(a.url+path).json()['data'];assert not summary['configured'] and summary['revision']==revision+1
  assert not page.evaluate('(s)=>JSON.stringify(localStorage).includes(s)||JSON.stringify(sessionStorage).includes(s)',secret);assert secret not in page.locator('body').inner_text();assert not errors,errors;page.screenshot(path=str(a.output/'admin-market.png'),full_page=True)
  (a.output/'result.json').write_text(json.dumps({'passed':True,'sensitive_operation_UI':True,'lost_response_exact_original_retry':True,'revision_CAS_and_remove':True,'no_secret_in_storage_or_response':True,'page_errors':errors},indent=2))
 except Exception:page.screenshot(path=str(a.output/'failure.png'),full_page=True);raise
 finally:b.close()
