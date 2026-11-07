# -*- coding: utf-8 -*-
"""Local synthetic monitor creation, exact decimal editing and explicit enable/stop."""
import argparse, json, uuid
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

p = argparse.ArgumentParser()
p.add_argument('--url', required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--expected-grow-revision', required=True)
p.add_argument('--fixture', type=Path, required=True)
a = p.parse_args()
assert a.url.startswith('http://127.0.0.1:')
seed = json.loads(a.fixture.read_text())
assert seed['synthetic'] and seed['owner'] == 'user_course_9'
a.output.mkdir(parents=True, exist_ok=True)
with sync_playwright() as pw:
    b = pw.chromium.launch(channel='chrome', headless=True)
    c = b.new_context(viewport={'width': 1440, 'height': 1000})
    page = c.new_page()
    page.on('dialog', lambda d: d.accept())
    errors = []
    page.on('pageerror', lambda e: errors.append(str(e)))
    api = pw.request.new_context(base_url=a.url)
    assert a.expected_grow_revision in api.get('/grow/runtime-config.js').text()
    try:
        page.goto(a.url + '/grow/investments')
        page.get_by_label('邮箱或手机号').fill('course9@example.com')
        page.get_by_label('密码', exact=True).fill('Password1234')
        page.get_by_role('button', name='登录并继续').click()
        panel = page.get_by_role('region', name='预测反馈与日线监控', exact=True)
        panel.get_by_role('button', name='日线监控', exact=True).click()
        panel.get_by_role('button', name='准备新日线监控', exact=True).click()
        editor = panel.get_by_role('region', name='日线监控编辑', exact=True)
        label = 'Synthetic structured monitor ' + uuid.uuid4().hex[:6]
        editor.get_by_label('观察标的', exact=True).select_option(seed['instrument']['id'])
        editor.get_by_label('监控名称', exact=True).fill(label)
        editor.get_by_label('监控日线条件', exact=True).select_option('close')
        editor.get_by_label('监控比较', exact=True).select_option('gt')
        editor.get_by_label('监控阈值', exact=True).fill('12.340000000000000001')
        editor.get_by_label('监控供应商', exact=True).select_option('tencent')
        editor.get_by_label('监控检查间隔', exact=True).fill('86400')
        editor.get_by_label('监控提醒冷却', exact=True).fill('3600')
        editor.get_by_label('明确启用日线检查与站内事件', exact=True).uncheck()
        with page.expect_response(lambda r: r.request.method == 'PUT' and '/observations/monitors/' in r.url) as saved:
            editor.get_by_role('button', name='保存日线监控', exact=True).click()
        assert saved.value.status == 200, saved.value.text()
        row = saved.value.json()['data']
        mid = row['id']
        assert row['fields']['threshold'] == '12.340000000000000001'
        assert row['fields']['account_id'] is None and not row['fields']['enabled']
        expect(panel.get_by_role('button', name=label + ' · 日线监控 v1 · ' + mid, exact=True)).to_be_visible()
        expect(editor).to_have_count(1)
        expect(editor.get_by_label('观察标的', exact=True)).to_be_disabled()
        run = panel.get_by_role('region', name='日线监控检查与历史', exact=True)
        expect(run.get_by_role('button', name='提交日线监控检查', exact=True)).to_be_disabled()
        editor.get_by_label('监控日线条件', exact=True).select_option('ma_bullish')
        expect(editor.get_by_label('监控阈值', exact=True)).to_be_disabled()
        expect(editor.get_by_label('监控阈值', exact=True)).to_have_value('1')
        editor.get_by_label('明确启用日线检查与站内事件', exact=True).check()
        editor.get_by_role('button', name='保存日线监控', exact=True).click()
        expect(panel.get_by_role('button', name=label + ' · 日线监控 v2 · ' + mid, exact=True)).to_be_visible()
        expect(editor).to_have_count(1)
        editor.get_by_role('button', name='停止日线监控', exact=True).click()
        expect(panel.get_by_role('button', name=label + ' · 日线监控 v3 · ' + mid, exact=True)).to_be_visible()
        expect(editor.get_by_label('明确启用日线检查与站内事件', exact=True)).not_to_be_checked()
        editor.get_by_role('button', name='查看日线监控历史', exact=True).click()
        history = editor.get_by_role('region', name='日线监控历史', exact=True)
        expect(history.get_by_role('article', name='日线监控版本 ' + mid + ' 1', exact=True)).to_contain_text('12.340000000000000001')
        editor.screenshot(path=str(a.output / 'structured-monitor.png'))
        assert not errors, errors
        result = {'passed': True, 'served_revision': a.expected_grow_revision, 'monitor_id': mid,
                  'structured_create_no_account_exact_decimal_and_explicit_supplier': True,
                  'controlled_boolean_condition_enable_stop_and_history': True, 'page_errors': errors}
    except Exception:
        page.screenshot(path=str(a.output / 'failure.png'), full_page=True)
        raise
    finally:
        page.close(run_before_unload=False)
        api.dispose()
        c.close()
        b.close()
    result['browser_cleanup_completed'] = True
    (a.output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
    print('GSTACK_STEP_OK', flush=True)
