"""Opt-in Grow deployment configuration. All secret values stay in private memory/files."""
import hashlib
import json
import os
import re
from pathlib import Path
from urllib.parse import urlsplit, unquote
from grow_source import read_lock


def env_file(path):
    values = {}
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise ValueError('Invalid runtime env format; use KEY=value.')
        key, value = line.split('=', 1)
        if not re.fullmatch('[A-Za-z_][A-Za-z0-9_]*', key):
            raise ValueError('Invalid runtime env key.')
        value = value.strip()
        if value.startswith('"'):
            value = json.loads(value)
        elif len(value) >= 2 and value[0] == value[-1] == "'":
            value = value[1:-1]
        if '\x00' in value or '\n' in value or '\r' in value:
            raise ValueError('Runtime env values must be single-line.')
        values[key] = value
    return values


def database_name(value):
    parsed = urlsplit(value)
    if parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname or not parsed.path.strip('/'):
        raise ValueError('A valid PostgreSQL DATABASE_URL is required.')
    return unquote(parsed.path.strip('/'))


def prepare(repo, slot, api_env_file, environ=None):
    environ = os.environ if environ is None else environ
    if environ.get('GROW_DEPLOY_ENABLED') != '1':
        return None  # No file reads or Grow credentials needed in the default deployment.
    if slot not in ('dev', 'online'):
        raise ValueError('Grow compatibility deployment requires an explicit dev/online slot.')
    lock_path = repo / 'deploy_configs/grow-source.lock.json'
    lock = read_lock(lock_path)
    file = Path(environ.get('GROW_APP_ENV_FILE', repo / ('deploy_configs/grow-'+slot+'.env'))).resolve()
    grow = env_file(file)
    api = {**env_file(api_env_file), **{k: environ[k] for k in ('DATABASE_URL', 'GROW_ACTION_BRIDGE_SECRET') if k in environ}}
    for key in ('DATABASE_URL', 'ACCOUNT_ENCRYPTION_KEY', 'APP_PASSWORD', 'GROW_PUBLIC_URL', 'LIGHTTICK_BRIDGE_URL', 'GROW_ACTION_BRIDGE_SECRET'):
        if not grow.get(key):
            raise ValueError('Missing Grow runtime variable: '+key)
    if database_name(grow['DATABASE_URL']) == database_name(api.get('DATABASE_URL', '')):
        raise ValueError('Grow and Zook must use distinct database names.')
    if len(grow['APP_PASSWORD']) < 24:
        raise ValueError('Grow initial APP_PASSWORD must have at least 24 characters.')
    if grow.get('PLAN_CONTENT_BACKEND') != 'github' or grow.get('WEB_CONCURRENCY', '1') != '1' or grow.get('CLOUD_DEPLOY') != '1':
        raise ValueError('Grow requires github storage, one worker and HTTPS-proxy mode.')
    if not grow.get('FORWARDED_ALLOW_IPS') or '*' in grow['FORWARDED_ALLOW_IPS']:
        raise ValueError('Set FORWARDED_ALLOW_IPS to the controlled HTTPS proxy addresses, never wildcard trust.')
    for key in ('GROW_PUBLIC_URL', 'LIGHTTICK_BRIDGE_URL'):
        p = urlsplit(grow[key])
        allowed_paths = ('', '/', '/grow', '/grow/') if key == 'GROW_PUBLIC_URL' else ('', '/')
        if p.scheme != 'https' or not p.hostname or p.username or p.password or p.query or p.fragment or p.path not in allowed_paths:
            raise ValueError('Grow origins must be plain HTTPS origins: '+key)
    import secrets
    if not secrets.compare_digest(grow['GROW_ACTION_BRIDGE_SECRET'], api.get('GROW_ACTION_BRIDGE_SECRET', '')):
        raise ValueError('Grow and target Zook source credentials must match.')
    try:
        import base64
        if len(base64.urlsafe_b64decode(grow['ACCOUNT_ENCRYPTION_KEY'])) != 32:
            raise ValueError()
    except Exception:
        raise ValueError('Invalid Grow ACCOUNT_ENCRYPTION_KEY.') from None
    port = str(environ.get('GROW_HOST_PORT', '8757' if slot == 'dev' else '8756'))
    if not port.isdecimal() or not 1 <= int(port) <= 65535:
        raise ValueError('Invalid Grow private host port.')
    mirror = environ.get('GROW_SOURCE_MIRROR')
    if lock.get('source_type') == 'bundled':
        mirror = str(repo / 'services/grow')
    elif not mirror:
        raise ValueError('GROW_SOURCE_MIRROR must name the approved server-managed Git mirror.')
    return {'lock': lock, 'lock_sha256': hashlib.sha256(lock_path.read_bytes()).hexdigest(),
            'env_file': str(file), 'env': grow, 'api_env': api, 'mirror': mirror, 'host_port': port}


def schema_bundle(repo):
    digest = hashlib.sha256()
    for p in sorted((repo/'src/infrastructure/database/postgres/migrations').glob('*.sql')):
        digest.update(p.name.encode()+b'\0'+p.read_bytes()+b'\0')
    return digest.hexdigest()


def verify_frozen(plan, config):
    """Bind validated credentials to the actual configuration, after any long builds."""
    if not plan:return
    actual = config['services']['grow'].get('environment', {})
    if any(str(actual.get(k)) != v for k, v in plan['env'].items()):
        raise ValueError('Grow runtime env changed after preflight; rerun deployment.')
    for service in ('api', 'worker'):
        actual = config['services'][service].get('environment', {})
        for key in ('DATABASE_URL', 'GROW_ACTION_BRIDGE_SECRET'):
            if actual.get(key) != plan['api_env'].get(key):
                raise ValueError('Zook runtime credentials changed after preflight; rerun deployment.')
