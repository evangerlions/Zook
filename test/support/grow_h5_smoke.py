"""Isolated PostgreSQL + real browser acceptance; never loads a user's env or DB."""
import argparse
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
import time

import httpx
from cryptography.fernet import Fernet
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]


def wait(url, process):
    for _ in range(200):
        if process.poll() is not None:
            raise RuntimeError('Synthetic service exited; inspect smoke logs.')
        try:
            if httpx.get(url, timeout=1).status_code == 200: return
        except httpx.TransportError: pass
        time.sleep(.1)
    raise RuntimeError('Synthetic service did not start.')


def run(output, pg_bin):
    output.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='grow-h5-smoke-') as temp:
        temp = Path(temp)
        pg_port, app_port, admin_port = port(), port(), port()
        pg_data = temp / 'postgres'
        subprocess.run([str(pg_bin/'initdb'), '-D', str(pg_data), '-A', 'trust', '-U', 'smoke'],
                       check=True, stdout=subprocess.DEVNULL)
        subprocess.run([str(pg_bin/'pg_ctl'), '-D', str(pg_data), '-l', str(temp/'postgres.log'),
                        '-o', f'-h 127.0.0.1 -p {pg_port} -k {temp}', 'start'], check=True,
                       stdout=subprocess.DEVNULL)
        processes = []
        logs = []
        try:
            server = temp / 'source/知行成长/server'
            shutil.copytree(ROOT/'services/grow/知行成长/server', server,
                            ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
            sys.path.insert(0, str(server))
            from web_prefix import prepare
            prepare(server/'static', '/grow')
            materials = temp/'materials'; materials.mkdir()
            env = {'PATH': os.environ['PATH'], 'PYTHONDONTWRITEBYTECODE': '1',
                   'DATABASE_URL': f'postgresql://smoke@127.0.0.1:{pg_port}/postgres',
                   'ACCOUNT_ENCRYPTION_KEY': Fernet.generate_key().decode(),
                   'APP_USERNAME': 'synthetic_owner', 'APP_PASSWORD': 'SYNTHETIC-H5-SMOKE-PASSWORD-ONLY',
                   'PLAN_CONTENT_BACKEND': 'github', 'CLOUD_DEPLOY': '0', 'WEB_CONCURRENCY': '1',
                   'GROW_BASE_PATH': '/grow', 'GROW_PUBLIC_URL': 'https://app-dev.youwoai.net/grow',
                   'GROW_SCHEDULED_READING_ENABLED': '0', 'RUNTIME_ROOT': str(temp/'runtime'),
                   'LEARN_ROOT': str(materials)}

            def start_app():
                log = (output/f'grow-{len(logs)}.log').open('w'); logs.append(log)
                process = subprocess.Popen([sys.executable, '-B', 'deployment.py', 'serve',
                                            '--port', str(app_port)], cwd=server, env=env,
                                           stdout=log, stderr=subprocess.STDOUT)
                processes.append(process)
                wait(f'http://127.0.0.1:{app_port}/api/health', process)
                return process

            app = start_app()
            log = (output/'admin.log').open('w'); logs.append(log)
            admin = subprocess.Popen(['node', '--experimental-transform-types', 'apps/admin-web/server.ts'],
                cwd=ROOT, env={**os.environ, 'PORT': str(admin_port),
                    'ADMIN_GROW_PROXY_TARGET': f'http://127.0.0.1:{app_port}'},
                stdout=log, stderr=subprocess.STDOUT)
            processes.append(admin)
            base = f'http://127.0.0.1:{admin_port}'
            wait(base+'/_admin/health', admin)
            with sync_playwright() as playwright:
                browser = playwright.chromium.launch()
                page = browser.new_page(viewport={'width': 1440, 'height': 1000})
                errors, escaped, failed = [], [], []
                page.on('pageerror', lambda error: errors.append(str(error)))
                page.on('request', lambda request: escaped.append(request.url)
                        if request.url.startswith(base+'/api/') or request.url.startswith(base+'/static/') else None)
                page.on('response', lambda response: failed.append({'url': response.url.split('?')[0], 'status': response.status})
                        if response.status >= 400 else None)
                page.goto(base+'/grow', wait_until='networkidle')
                assert page.url == base+'/grow/login', page.url
                page.screenshot(path=str(output/'login.png'), full_page=True)
                page.get_by_label('用户名', exact=True).fill(env['APP_USERNAME'])
                page.get_by_label('密码', exact=True).fill(env['APP_PASSWORD'])
                page.locator('#authSubmit').click()
                page.wait_for_url(base+'/grow/', timeout=20000)
                page.wait_for_function("document.getElementById('accountName').textContent === 'synthetic_owner'")
                page.wait_for_function("typeof dataLoaded !== 'undefined' && dataLoaded")
                page.screenshot(path=str(output/'home.png'), full_page=True)
                assert not errors, errors
                assert not escaped, escaped
                optional = {'/grow/api/plans', '/grow/api/copilot/drafts', '/grow/api/copilot/background-jobs', '/grow/api/copilot/today-task'}
                from urllib.parse import urlsplit
                initial_failures = list(failed)
                unexpected = [item for item in initial_failures if item['status'] != 503 or urlsplit(item['url']).path not in optional]
                assert not unexpected, unexpected
                headers = {'X-Copilot-Request': '1', 'X-Grow-Action-Schema': '2'}
                created = page.request.post(base+'/grow/api/action-plans', headers=headers, data={
                    'title': 'Synthetic H5 persistence proof', 'period': 'day', 'completion_mode': 'check',
                    'start_date': None, 'end_date': None, 'key': 'h5-smoke-action'})
                assert created.ok, created.text()
                app.terminate(); app.wait(timeout=20)
                start_app()
                read = page.request.get(base+'/grow/api/action-plans')
                assert read.ok and 'Synthetic H5 persistence proof' in read.text(), read.status
                logout = page.request.post(base+'/grow/api/auth/logout', headers=headers)
                assert logout.ok
                assert page.request.get(base+'/grow/api/auth/me').status == 401
                browser.close()
                result = {'login': True, 'assets_and_api_under_grow': True, 'browser_errors': errors,
                          'expected_unconfigured_github_responses': initial_failures, 'unexpected_responses': unexpected, 'write_and_restart_readback': True, 'logout': True,
                          'database': 'fresh disposable local PostgreSQL', 'https_verified': False,
                          'docker_verified': False, 'public_deployed': False}
                (output/'result.json').write_text(json.dumps(result, indent=2)+'\n')
                print(json.dumps(result))
        finally:
            for process in reversed(processes):
                if process.poll() is None:
                    process.terminate()
                    try: process.wait(timeout=20)
                    except subprocess.TimeoutExpired: process.kill(); process.wait()
            for log in logs: log.close()
            subprocess.run([str(pg_bin/'pg_ctl'), '-D', str(pg_data), '-m', 'fast', 'stop'],
                           check=True, stdout=subprocess.DEVNULL)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--pg-bin', type=Path, required=True)
    args = parser.parse_args()
    run(args.output.resolve(), args.pg_bin.resolve())
