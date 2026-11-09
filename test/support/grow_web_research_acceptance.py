# -*- coding: utf-8 -*-
"""Synthetic localhost PG/worker/Chrome acceptance for independent versioned research dossiers."""
import argparse, json, uuid, time, re, urllib.request, hashlib
from pathlib import Path
from playwright.sync_api import sync_playwright, expect
p = argparse.ArgumentParser()
p.add_argument('--url', required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('--account', default='course10@example.com')
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
    try:
        api = pw.request.new_context(base_url=a.url)
        auth = api.post('/api/v1/auth/login', data={'appId': 'lighttick', 'account': a.account, 'password': 'Password1234', 'clientType': 'app'}).json()['data']
        h = {'Authorization': 'Bearer ' + auth['accessToken'], 'X-App-Id': 'lighttick'}
        key = lambda : {**h, 'Idempotency-Key': str(uuid.uuid4())}
        label = '研究合成 ' + uuid.uuid4().hex[:8]
        code = '600' + str(uuid.uuid4().int % 1000).zfill(3)
        root = '/api/v1/lighttick/investments/'

        def get(path):
            r = api.get(root + path, headers=h)
            assert r.status == 200, r.text()
            return r.json()['data']

        def post(path, body):
            r = api.post(root + path, headers=key(), data=body)
            assert r.status == 200, r.text()
            return r.json()['data']

        def put(path, body):
            r = api.put(root + path, headers=key(), data=body)
            assert r.status == 200, r.text()
            return r.json()['data']
        assert not get('accounts')['items']
        symbol = post('instruments', {'market': 'SSE', 'code': code, 'kind': 'stock', 'name': label})['instrument']
        sid = symbol['id']
        work = post('market/work', {'instrument_id': sid, 'base_revision': 1, 'supplier': 'csv', 'start': '2026-10-30', 'end': '2026-10-30', 'declared_source': 'Synthetic research CSV', 'volume_unit': 'shares', 'amount_unit': 'CNY', 'csv': 'date,open,high,low,close,volume,amount\n2026-10-30,10,12,9,11,1,10'})
        deadline = time.monotonic() + 15
        while True:
            w = get('market/work/' + work['id'])
            if w['status'] not in ['queued', 'running']:
                break
            assert time.monotonic() < deadline
            time.sleep(0.1)
        assert w['status'] == 'succeeded'
        snapshot = get('market/snapshots/' + w['snapshot_id'])
        page.goto(a.url + '/grow/investments')
        page.get_by_label('邮箱或手机号').fill(a.account)
        page.get_by_label('密码', exact=True).fill('Password1234')
        page.get_by_role('button', name='登录并继续').click()
        page.get_by_role('button', name=label + ' · ' + code + ' · SSE', exact=True).click()
        v = page.get_by_role('region', name='投资研究档案')
        v.get_by_role('button', name='准备新研究档案', exact=True).click()
        editor = v.get_by_role('region', name='研究档案编辑')
        editor.get_by_label('研究标题', exact=True).fill(label)
        editor.get_by_label('技术假设', exact=True).fill('原始技术判断')
        editor.get_by_label('反证与相反判断', exact=True).fill('保留反例，不代表成功')
        editor.get_by_label('缺失资料', exact=True).fill('缺少公司行动与执行状态')
        editor.get_by_role('button', name='添加资料或观察', exact=True).click()
        editor.get_by_label('资料 1 标题', exact=True).fill('合成原始资料')
        editor.get_by_label('资料 1 原文', exact=True).fill('  合成原文\n保留空白  ')
        editor.get_by_label('资料 1 时间', exact=True).fill('2026-10-30T16:00:00+08:00')
        editor.get_by_label('资料 1 定位', exact=True).fill('合成第 3 页')
        editor.get_by_label('资料 1 反证', exact=True).fill('仍待核对')
        editor.get_by_role('checkbox', name=re.compile('2026-10-30 至 2026-10-30 · csv')).check()
        original = []
        saved = []

        def lose(route):
            if route.request.method == 'PUT':
                r = route.fetch()
                assert r.status == 200, r.text()
                original.append((route.request.post_data, route.request.headers['idempotency-key'], route.request.url))
                saved.append(r.json()['data'])
                route.abort('failed')
            else:
                route.continue_()
        page.route('**/investments/research/*', lose)
        editor.get_by_role('button', name='保存研究档案', exact=True).click()
        expect(editor.get_by_text('结果尚未确认，请恢复连接后重试原请求。', exact=True)).to_be_visible()
        page.unroute('**/investments/research/*', lose)
        page.reload()
        page.get_by_role('button', name=label + ' · ' + code + ' · SSE', exact=True).click()
        v = page.get_by_role('region', name='投资研究档案')
        v.get_by_role('button', name='准备新研究档案', exact=True).click()
        editor = v.get_by_role('region', name='研究档案编辑')
        expect(editor.get_by_role('button', name='重试原请求', exact=True)).to_be_visible()
        replay = []

        def capture(route):
            if route.request.method == 'PUT':
                replay.append((route.request.post_data, route.request.headers['idempotency-key'], route.request.url))
            route.continue_()
        page.route('**/investments/research/*', capture)
        editor.get_by_role('button', name='重试原请求', exact=True).click()
        expect(v.get_by_role('button', name=label + ' · 修订 1', exact=True)).to_be_visible()
        assert replay == original
        page.unroute('**/investments/research/*', capture)
        rid = saved[0]['id']
        assert saved[0]['evidence'][0]['content'] == '  合成原文\n保留空白  '
        assert saved[0]['market_sources'] == [{'id': snapshot['id'], 'version': 1, 'input_digest': snapshot['dataset']['input_digest']}]
        first = get('research/' + rid)
        body = json.loads(original[0][0])
        local = '本机编辑：保留原始假设与反证'
        editor.get_by_label('技术假设', exact=True).fill(local)
        cloud = put('research/' + rid, {**body, 'base_revision': 1, 'technical_case': '手机端的新判断', 'title': label + ' 云端'})
        assert cloud['revision'] == 2
        editor.get_by_role('button', name='保存研究档案', exact=True).click()
        expect(editor.get_by_role('button', name='已核对，解除待核对状态', exact=True)).to_be_visible()
        editor.get_by_role('button', name='核对云端研究', exact=True).click()
        compare = editor.get_by_role('region', name='研究冲突核对')
        expect(compare.get_by_text('手机端的新判断', exact=True)).to_be_visible()
        compare.get_by_text('保存时的研究基线', exact=True).click()
        expect(compare.get_by_text('原始技术判断', exact=True)).to_be_visible()
        expect(editor.get_by_label('技术假设', exact=True)).to_have_value(local)
        editor.get_by_role('button', name='已核对，解除待核对状态', exact=True).click()
        editor.get_by_role('button', name='已比较，保留本机研究并采用云端基线', exact=True).click()
        editor.get_by_role('button', name='保存研究档案', exact=True).click()
        expect(v.get_by_role('button', name=label + ' · 修订 3', exact=True)).to_be_visible()
        assert get('research/' + rid)['technical_case'] == local
        assert [x['technical_case'] for x in get('research/' + rid + '/history')['items']] == [local, '手机端的新判断', '原始技术判断']
        editor.get_by_role('button', name='归档研究档案', exact=True).click()
        expect(editor.get_by_role('button', name='恢复研究档案', exact=True)).to_be_visible()
        expect(editor.get_by_label('技术假设', exact=True)).to_be_disabled()
        assert not get('research?instrument_id=' + sid)['items']
        editor.get_by_role('button', name='恢复研究档案', exact=True).click()
        expect(v.get_by_role('button', name=label + ' · 修订 5', exact=True)).to_be_visible()
        expect(editor.get_by_label('技术假设', exact=True)).to_be_enabled()
        retained = '离线与分页冲突后仍保留的输入'
        editor.get_by_label('缺失资料', exact=True).fill(retained)
        editor.get_by_role('button', name='查看研究历史', exact=True).click()
        expect(editor.get_by_role('region', name='已保存研究历史')).to_be_visible()
        c.set_offline(True)
        page.evaluate("window.dispatchEvent(new Event('offline'))")
        expect(editor.get_by_role('region', name='已保存研究历史')).not_to_be_visible()
        expect(editor.get_by_label('缺失资料', exact=True)).to_have_value(retained)
        c.set_offline(False)
        page.evaluate("window.dispatchEvent(new Event('online'))")
        v.get_by_role('button', name='刷新研究与行情来源', exact=True).click()
        expect(editor.get_by_label('缺失资料', exact=True)).to_have_value(retained)
        for rev in [5, 6]:
            put('research/' + rid, {**body, 'base_revision': rev, 'technical_case': '云端历史 ' + str(rev)})
        editor.get_by_role('button', name='查看研究历史', exact=True).click()
        expect(editor.get_by_role('button', name='更多研究历史', exact=True)).to_be_visible()
        put('research/' + rid, {**body, 'base_revision': 7, 'technical_case': '云端最新历史'})
        editor.get_by_role('button', name='更多研究历史', exact=True).click()
        expect(editor.get_by_role('region', name='已保存研究历史')).not_to_be_visible()
        expect(editor.get_by_label('缺失资料', exact=True)).to_have_value(retained)
        for n in range(20):
            put('research/inv-' + str(uuid.uuid4()), {**body, 'base_revision': 0, 'title': label + ' 分页 ' + str(n)})
        v.get_by_role('button', name='刷新研究与行情来源', exact=True).click()
        expect(v.get_by_role('button', name='更多研究档案', exact=True)).to_be_visible()
        put('research/inv-' + str(uuid.uuid4()), {**body, 'base_revision': 0, 'title': label + ' 游标失效'})
        v.get_by_role('button', name='更多研究档案', exact=True).click()
        expect(v.get_by_role('alert').filter(has_text='本机编辑和原请求仍保留')).to_be_visible()
        expect(editor.get_by_label('缺失资料', exact=True)).to_have_value(retained)
        v.get_by_role('button', name='刷新研究与行情来源', exact=True).click()
        v.get_by_role('button', name='更多研究档案', exact=True).click()
        assert len(get('research?instrument_id=' + sid)['items']) == 20
        export = api.get('/api/v1/lighttick/review/export', headers=h)
        assert export.status == 200, export.text()
        doc = export.json()['data']
        assert hashlib.sha256(doc['content'].encode()).hexdigest() == doc['sha256']
        research = json.loads(doc['content'])['investments']['research']
        history = [e for e in research['versions'] if e['id'] == rid]
        assert len(history) == 8
        assert next((r for r in research['receipts'] if r['id'] == rid and r['revision'] == 1))['request_body'] == body
        assert not get('accounts')['items']
        other = api.post('/api/v1/auth/login', data={'appId': 'lighttick', 'account': 'course8@example.com', 'password': 'Password1234', 'clientType': 'app'}).json()['data']
        foreign = {**h, 'Authorization': 'Bearer ' + other['accessToken']}
        assert api.get(root + 'research/' + rid, headers=foreign).status == 404
        editor.get_by_label('研究标题', exact=True).focus()
        page.keyboard.press('Tab')
        expect(editor.get_by_label('研究周期', exact=True)).to_be_focused()
        editor.scroll_into_view_if_needed()
        page.screenshot(path=str(a.output / 'research-desktop.png'))
        for width in [320, 375, 768, 1024]:
            page.set_viewport_size({'width': width, 'height': 900})
            if not page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'):
                (a.output/'layout.json').write_text(json.dumps(page.evaluate("[...document.querySelectorAll('main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).map(e=>({tag:e.tagName,classes:e.className,right:e.getBoundingClientRect().right,width:e.getBoundingClientRect().width})).slice(0,30)"),indent=2))
                raise AssertionError(width)
            if width == 320:
                editor.get_by_label('研究标题', exact=True).scroll_into_view_if_needed()
                page.screenshot(path=str(a.output / 'research-320.png'))
        assert not errors, errors
        (a.output / 'result.json').write_text(json.dumps({'passed': True, 'no_asset_account_required': True, 'lost_response_reload_original_request': True, 'baseline_local_cloud_CAS': True, 'exact_evidence_and_market_provenance': True, 'archive_restore_history': True, 'offline_and_two_cursor_invalidations_keep_draft': True, 'authorized_export_and_cross_owner_denial': True, 'keyboard_and_320_375_768_1024': True, 'page_errors': errors, 'instrument_id': sid, 'research_id': rid}, ensure_ascii=False, indent=2))
    except Exception:
        page.screenshot(path=str(a.output / 'failure.png'))
        raise
    finally:
        b.close()
