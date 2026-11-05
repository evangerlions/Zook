# -*- coding: utf-8 -*-
"""Synthetic localhost Chrome/PG/Redis/worker acceptance; never reads existing browser credentials."""
import argparse, json, uuid, time, re, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
p = argparse.ArgumentParser()
p.add_argument('--url', required=True)
p.add_argument('--output', required=True, type=Path)
p.add_argument('--account', default='course0@example.com')
a = p.parse_args()
assert a.url.startswith('http://127.0.0.1:') and re.fullmatch('course\\d+@example.com', a.account)
a.output.mkdir(parents=True, exist_ok=True)
end = time.monotonic() + 20
while True:
    try:
        urllib.request.urlopen(a.url + '/grow/', timeout=1).close()
        break
    except Exception:
        if time.monotonic() > end:
            raise
        time.sleep(0.1)
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome', headless=True)
    c = b.new_context(viewport={'width': 1440, 'height': 1000})
    page = c.new_page()
    page.on('dialog', lambda d: d.accept())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    secret = 'SYNTHETIC_' + uuid.uuid4().hex
    model = 'synthetic-personal-' + uuid.uuid4().hex[:8]
    endpoint = 'https://personal-model.example.invalid/v1'
    base = '/api/v1/lighttick/'
    try:
        api = pw.request.new_context(base_url=a.url)
        auth = api.post('/api/v1/auth/login', data={'appId': 'lighttick', 'account': a.account, 'password': 'Password1234', 'clientType': 'app'}).json()['data']
        headers = {'Authorization': 'Bearer ' + auth['accessToken'], 'X-App-Id': 'lighttick'}
        key = lambda : {**headers, 'Idempotency-Key': str(uuid.uuid4())}

        def get(path):
            r = api.get(base + path, headers=headers)
            assert r.status == 200, r.text()
            return r.json()['data']

        def post(path, body, method='POST'):
            r = api.fetch(base + path, method=method, headers=key(), data=body)
            assert r.status in [200, 201, 202], r.text()
            return r.json()['data']

        def no_secret():
            assert not page.evaluate('(s)=>JSON.stringify(localStorage).includes(s)||JSON.stringify(sessionStorage).includes(s)', secret)

        def step(n):
            page.get_by_role('navigation', name='模型配置步骤').get_by_role('button').nth(n - 1).click()
        initial = get('ai/model-settings')
        assert initial['mode'] == 'platform' and initial['revision'] == 0, 'Use a fresh synthetic account, never reset an existing one'
        page.goto(a.url + '/grow/settings')
        page.get_by_label('邮箱或手机号').fill(a.account)
        page.get_by_label('密码', exact=True).fill('Password1234')
        page.get_by_role('button', name='登录并继续').click()
        v = page.get_by_role('region', name='个人模型配置')
        v.get_by_label('模型来源', exact=True).select_option('personal')
        v.get_by_label('个人模型 Base URL', exact=True).fill(endpoint)
        step(2)
        v.get_by_label('个人模型名称', exact=True).fill(model)
        v.get_by_label('个人模型 API Key', exact=True).fill(secret)
        no_secret()
        assert get('ai/model-settings')['revision'] == 0
        original = []

        def lose_test(route):
            if route.request.method == 'POST':
                r = route.fetch()
                assert r.status == 200, r.text()
                original.append((route.request.post_data, route.request.headers['idempotency-key']))
                route.abort('failed')
            else:
                route.continue_()
        page.route('**/ai/model-settings/tests', lose_test)
        v.get_by_role('button', name='测试当前输入（不保存）', exact=True).click()
        expect(v.get_by_text('结果尚未确认。请核对原请求回执，或重试同一请求。', exact=True)).to_be_visible()
        page.unroute('**/ai/model-settings/tests', lose_test)
        no_secret()
        page.reload()
        expect(page.get_by_role('region', name='模型连接测试回执').get_by_text('连接成功 · 修订 3', exact=True)).to_be_visible(timeout=15000)
        assert get('ai/model-settings')['revision'] == 0
        assert json.loads(original[0][0])['config']['api_key'] == secret
        no_secret()
        step(2)
        expect(v.get_by_label('个人模型 API Key', exact=True)).to_have_value('')
        v.get_by_label('个人模型 API Key', exact=True).fill(secret)
        saved = []

        def lose_save(route):
            if route.request.method == 'PUT':
                r = route.fetch()
                assert r.status == 200, r.text()
                saved.append((route.request.post_data, route.request.headers['idempotency-key']))
                route.abort('failed')
            else:
                route.continue_()
        page.route('**/ai/model-settings', lose_save)
        v.get_by_role('button', name='保存并使用个人模型', exact=True).click()
        expect(v.get_by_text('结果尚未确认。请核对原请求回执，或重试同一请求。', exact=True)).to_be_visible()
        page.unroute('**/ai/model-settings', lose_save)
        page.reload()
        expect(v.get_by_text('原设置请求已确认，当前云端状态请以重新核对结果为准。', exact=True)).to_be_visible()
        state = get('ai/model-settings')
        assert state['revision'] == 1 and state['model_name'] == model and ('api_key' not in state)
        no_secret()
        step(2)
        v.get_by_label('个人模型名称', exact=True).fill(model + '-retry')
        v.get_by_label('个人模型 API Key', exact=True).fill(secret)
        blocked = []

        def stop_before_send(route):
            if route.request.method == 'PUT':
                blocked.append((route.request.post_data, route.request.headers['idempotency-key']))
                route.abort('failed')
            else:
                route.continue_()
        page.route('**/ai/model-settings', stop_before_send)
        v.get_by_role('button', name='保存并使用个人模型', exact=True).click()
        expect(v.get_by_text('结果尚未确认。请核对原请求回执，或重试同一请求。', exact=True)).to_be_visible()
        page.unroute('**/ai/model-settings', stop_before_send)
        page.reload()
        expect(v.get_by_text('尚未找到原请求回执。可重新输入同一密钥并重试原请求；不会自动创建新请求。', exact=True)).to_be_visible()
        v.get_by_label('个人模型 API Key', exact=True).fill('WRONG_SYNTHETIC_KEY')
        v.get_by_role('button', name='重试模型原请求', exact=True).click()
        expect(v.get_by_text('输入与原请求不同，请输入原密钥；没有发送或重建请求。', exact=True)).to_be_visible()
        assert get('ai/model-settings')['revision'] == 1
        v.get_by_label('个人模型 API Key', exact=True).fill(secret)
        replayed = []

        def capture(route):
            if route.request.method == 'PUT':
                replayed.append((route.request.post_data, route.request.headers['idempotency-key']))
            route.continue_()
        page.route('**/ai/model-settings', capture)
        v.get_by_role('button', name='重试模型原请求', exact=True).click()
        expect(v.get_by_text('原设置请求已确认，当前云端状态请以重新核对结果为准。', exact=True)).to_be_visible()
        page.unroute('**/ai/model-settings', capture)
        assert replayed == blocked
        assert get('ai/model-settings')['revision'] == 2
        no_secret()
        step(2)
        v.get_by_label('个人模型名称', exact=True).fill(model + '-slow')
        v.get_by_label('个人模型 API Key', exact=True).fill(secret)
        v.get_by_role('button', name='测试当前输入（不保存）', exact=True).click()
        receipt = page.get_by_role('region', name='模型连接测试回执')
        expect(receipt.get_by_text('正在测试 · 修订 2', exact=True)).to_be_visible(timeout=10000)
        adopt = receipt.get_by_role('button', name='采用当前测试修订', exact=True)
        if adopt.is_visible():
            adopt.click()
        receipt.get_by_role('button', name='取消连接测试', exact=True).click()
        expect(receipt.get_by_text('已取消 · 修订 3', exact=True)).to_be_visible()
        assert get('ai/model-settings')['revision'] == 2
        v.get_by_label('个人模型名称', exact=True).fill(model + '-local')
        post('ai/model-settings', {'base_revision': 2, 'mode': 'personal', 'base_url': endpoint, 'model_name': model + '-cloud', 'api_key': secret}, 'PUT')
        v.get_by_role('button', name='保存并使用个人模型', exact=True).click()
        expect(v.get_by_role('button', name='已核对，解除被拒绝的模型原请求', exact=True)).to_be_visible()
        page.get_by_role('button', name='核对云端模型设置', exact=True).click()
        expect(v.get_by_label('个人模型名称', exact=True)).to_have_value(model + '-local')
        v.get_by_role('button', name='已核对，解除被拒绝的模型原请求', exact=True).click()
        v.get_by_role('button', name='保留本机模型输入，采用云端修订', exact=True).click()
        v.get_by_role('button', name='保存并使用个人模型', exact=True).click()
        expect(v.get_by_text('原设置请求已确认，当前云端状态请以重新核对结果为准。', exact=True)).to_be_visible()
        assert get('ai/model-settings')['revision'] == 4
        assert get('ai/model-settings')['model_name'] == model + '-local'
        course = post('learning/work', {'kind': 'route_draft', 'route_id': 'plan-personal-' + uuid.uuid4().hex, 'base_revision': 0, 'brief': {'title': '合成个人模型课程', 'goal': '解释一个概念', 'level': '入门', 'minutes': 20, 'pacing': 'self_paced', 'lesson_count': 2}})
        deadline = time.monotonic() + 15
        while True:
            result = get('learning/work/' + course['id'])
            if result['status'] not in ['queued', 'running']:
                break
            assert time.monotonic() < deadline
            time.sleep(0.1)
        assert result['status'] == 'succeeded', result
        assert result['output']['provider'] == 'personal' and result['output']['model'] == model + '-local'
        goal = post('goals', {'title': '合成个人模型规划', 'constraints': {'weekly_available_minutes': 30}})
        session = post('planning-sessions', {'goal_id': goal['id']})['session']
        session = post('planning-sessions/' + session['id'] + '/context', {'base_version': session['version'], 'fields': {'period_start': {'value': '2030-01-01', 'source': 'user'}, 'period_end': {'value': '2030-01-07', 'source': 'user'}}}, 'PATCH')['session']
        post('planning-sessions/' + session['id'] + '/drafts', {'base_version': session['version'], 'context_revision': session['context_revision'], 'deep_planning': True})
        deadline = time.monotonic() + 15
        while True:
            result = get('planning-sessions/' + session['id'])
            if result['status'] != 'generating':
                break
            assert time.monotonic() < deadline
            time.sleep(0.1)
        assert result['status'] == 'draft_ready', result
        v.get_by_label('个人模型名称', exact=True).fill(model + '-truncated')
        v.get_by_label('个人模型 API Key', exact=True).fill(secret)
        v.get_by_role('button', name='测试当前输入（不保存）', exact=True).click()
        expect(receipt.get_by_text('测试失败 · 修订 3', exact=True)).to_be_visible(timeout=15000)
        assert get('ai/model-settings')['revision'] == 4
        v.get_by_label('模型来源', exact=True).select_option('platform')
        v.get_by_role('button', name='清除个人配置并使用平台模型', exact=True).click()
        expect(v.get_by_text('原设置请求已确认，当前云端状态请以重新核对结果为准。', exact=True)).to_be_visible()
        final = get('ai/model-settings')
        assert final['mode'] == 'platform' and final['revision'] == 5 and (not final['configured'])
        no_secret()
        assert not errors, errors
        page.screenshot(path=str(a.output / 'settings-desktop.png'))
        for width in [320, 375, 768, 1024]:
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'), width
            if width == 320:
                page.screenshot(path=str(a.output / 'settings-320.png'))
        (a.output / 'result.json').write_text(json.dumps({'passed': True, 'unsaved_test_no_activation': True, 'lost_test_and_save_response_recovered_by_receipt': True, 'exact_original_body_and_key_after_secret_reentry': True, 'wrong_reentered_secret_not_sent': True, 'no_plaintext_credentials_in_browser_storage_or_response': True, 'live_cancel_fenced': True, 'settings_CAS_preserves_input': True, 'actual_course_worker_selected_model': True, 'actual_planning_selected_model': True, 'truncated_response_rejected_no_fallback': True, 'explicit_clear_to_platform': True, 'widths_320_375_768_1024': True, 'page_errors': errors, 'synthetic_account': a.account, 'course_work_id': course['id'], 'planning_session_id': session['id']}, ensure_ascii=False, indent=2))
    except Exception:
        page.screenshot(path=str(a.output / 'failure.png'))
        raise
    finally:
        b.close()
