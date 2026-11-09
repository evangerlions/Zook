"""Real-browser acceptance against an explicit disposable Grow Web fixture."""
import argparse, json
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument('--url', required=True)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
assert args.url.startswith('http://127.0.0.1:'), 'Localhost-only fixture required'
args.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, channel='chrome')
    context = browser.new_context(viewport={'width': 1440, 'height': 1000})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    page.goto(args.url + '/grow/')
    expect(page.get_by_role('alert')).to_have_count(0)
    page.get_by_label('邮箱或手机号').fill('alice@example.com')
    page.get_by_label('密码', exact=True).fill('Password1234')
    page.get_by_role('button', name='登录并继续').click()
    expect(page.get_by_role('heading', name='记录', exact=True)).to_be_visible()
    page.get_by_role('button', name='＋ 记一条').click()
    page.get_by_label('此刻，想记下什么？').fill('Web 记录：把复杂的事拆成一个小行动。')
    page.get_by_label('标签，以逗号分隔').press_sequentially('思考, 行动')
    with page.expect_response(lambda r: '/lighttick/records/' in r.url and r.request.method == 'PUT') as received:
        page.get_by_role('button', name='保存到云端', exact=True).click()
    first = received.value.json()['data']
    assert first['version'] == 1 and first['tags'] == ['思考','行动'], first
    record_id = first['id']
    expect(page.get_by_text('已保存到云端。', exact=True)).to_be_visible()
    # Existing native contract: bearer auth, same canonical object and CAS, no Web identity bridge.
    native = p.request.new_context(base_url=args.url)
    login = native.post('/api/v1/auth/login', data={'appId':'lighttick','account':'alice@example.com','password':'Password1234','clientType':'app'}).json()['data']
    token = login['accessToken']
    headers = {'Authorization':'Bearer '+token, 'X-App-Id':'lighttick', 'Idempotency-Key':'grow-web-native-update-'+record_id}
    canonical = native.get('/api/v1/lighttick/records/'+record_id, headers=headers).json()['data']
    assert canonical == first
    changed = {k:canonical[k] for k in ['raw_text','record_date','prompt_kind','guided_answers','tags']}
    changed.update(raw_text='手机端修改：今天先做最小的一步。', base_version=1)
    native_response = native.put('/api/v1/lighttick/records/'+record_id, data=changed, headers=headers)
    assert native_response.status == 200, native_response.text()
    # The browser retains its older base and edits concurrently.
    page.get_by_label('此刻，想记下什么？').fill('Web 保留的不同思考：先想清楚什么最重要。')
    page.get_by_role('button', name='保存到云端', exact=True).click()
    expect(page.get_by_role('heading', name='另一端的版本')).to_be_visible()
    expect(page.get_by_label('此刻，想记下什么？')).to_have_value('Web 保留的不同思考：先想清楚什么最重要。')
    expect(page.get_by_text(changed['raw_text'], exact=True)).to_be_visible()
    page.screenshot(path=str(args.output/'conflict-desktop.png'), full_page=True)
    page.get_by_role('button', name='保留本机内容并重新核对').click()
    page.get_by_role('button', name='保存到云端', exact=True).click()
    expect(page.get_by_text('已保存到云端。', exact=True)).to_be_visible()
    after = native.get('/api/v1/lighttick/records/'+record_id, headers=headers).json()['data']
    assert after['version'] == 3
    # Two browser documents rotate the shared cookie through the session lock.
    other_page = context.new_page()
    other_page.goto(args.url + '/grow/records', wait_until='commit')
    page.reload(wait_until='commit')
    expect(other_page.get_by_role('heading', name='记录', exact=True)).to_be_visible()
    other_page.close()
    assert any(c['name']=='refreshToken' and c['httpOnly'] for c in context.cookies())
    expect(page.get_by_role('heading', name='记录', exact=True)).to_be_visible()
    page.locator('[data-record-id="'+record_id+'"]').click()
    expect(page.get_by_label('此刻，想记下什么？')).to_have_value(after['raw_text'])
    context.set_offline(True)
    page.get_by_label('此刻，想记下什么？').fill('离线输入：恢复后只提交一次。')
    page.get_by_role('button', name='保存到云端', exact=True).click()
    expect(page.get_by_role('button', name='重试原提交')).to_be_visible()
    pending = page.evaluate('JSON.parse(Object.values(localStorage).find(v=>v.includes("original-request") || v.includes("base_version")))')
    command = next(d['pending'] for d in pending if d.get('pending'))
    context.set_offline(False)
    page.reload()
    page.locator('[data-record-id="'+record_id+'"]').click()
    with page.expect_response(lambda r: '/lighttick/records/' in r.url and r.request.method == 'PUT') as received:
        page.get_by_role('button', name='重试原提交').click()
    assert received.value.request.headers['idempotency-key'] == command['key']
    expect(page.get_by_text('已保存到云端。', exact=True)).to_be_visible()
    final = native.get('/api/v1/lighttick/records/'+record_id, headers=headers).json()['data']
    assert final['version'] == 4
    assert final['raw_text'] == '离线输入：恢复后只提交一次。'
    versions = native.get('/api/v1/lighttick/records/'+record_id+'/versions', headers=headers).json()['data']['items']
    assert len(versions) == 4
    page.get_by_role('button', name='版本历史', exact=True).click()
    expect(page.get_by_role('heading', name='版本历史', exact=True)).to_be_visible()
    page.screenshot(path=str(args.output/'records-desktop.png'), full_page=True)
    page.set_viewport_size({'width':375,'height':900})
    assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(args.output/'records-mobile.png'), full_page=True)
    # Archiving is a separate versioned intent, with no record deletion.
    with page.expect_response(lambda r:r.url.endswith('/'+record_id+'/archive')) as archived_response:
        page.get_by_role('button', name='归档', exact=True).click()
    assert archived_response.value.status == 200
    expect(page.get_by_text('已保存到云端。', exact=True)).to_be_visible()
    archived_record = native.get('/api/v1/lighttick/records/'+record_id, headers=headers).json()['data']
    assert archived_record['version'] == 5 and archived_record.get('archived_at')
    with page.expect_response(lambda r:r.url.endswith('/'+record_id+'/restore')) as restored_response:
        page.get_by_role('button', name='恢复记录', exact=True).click()
    assert restored_response.value.status == 200
    expect(page.get_by_text('已保存到云端。', exact=True)).to_be_visible()
    restored = native.get('/api/v1/lighttick/records/'+record_id, headers=headers).json()['data']
    assert restored['version'] == 6 and not restored.get('archived_at')
    page.get_by_role('button', name='退出登录', exact=True).click()
    expect(page.get_by_role('heading', name='登录 LightTick')).to_be_visible()
    page.get_by_label('邮箱或手机号').fill('bob@example.com')
    page.get_by_label('密码', exact=True).fill('Password1234')
    page.get_by_role('button', name='登录并继续').click()
    expect(page.get_by_role('heading', name='记录', exact=True)).to_be_visible()
    expect(page.locator('[data-record-id="'+record_id+'"]').first).to_have_count(0)
    # Bob's native session cannot read Alice's record.
    bob = native.post('/api/v1/auth/login', data={'appId':'lighttick','account':'bob@example.com','password':'Password1234','clientType':'app'}).json()['data']
    assert native.get('/api/v1/lighttick/records/'+record_id,headers={'Authorization':'Bearer '+bob['accessToken'],'X-App-Id':'lighttick'}).status == 404
    storage = page.evaluate('JSON.stringify({...localStorage})')
    assert token not in storage and login['refreshToken'] not in storage
    assert not errors, errors
    (args.output/'result.json').write_text(json.dumps({'passed':True,'record_id':record_id,'versions_before_archive':len(versions),'final_version':restored['version'],'browser_errors':errors,'checks':['real_web_login','same_native_contract_object','CAS_conflict_preserves_both_inputs','HttpOnly_refresh','multi_tab_session_rotation','sequential_tag_input','offline_original_key_recovery','history','archive_restore_versions','browser_account_switch','mobile_no_overflow','cross_owner_denied','no_tokens_in_storage'],'native_scope':'existing native HTTP contract exercised; not native device UI'},ensure_ascii=False,indent=2))
    native.dispose()
    context.close()
    browser.close()
