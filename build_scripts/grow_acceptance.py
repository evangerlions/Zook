"""Explicit dev acceptance and image promotion. Receipts are trusted local operator artifacts."""
import hashlib
import json
from pathlib import Path
import grow_group_state as state
from grow_plan import database_name

CORE_CHECKS = ('api_healthy','worker_healthy','admin_healthy','restart_retry','https_verified')
REQUIRED_CHECKS = ('course_same_id','note_source_receipt','plan_same_id','account_isolation','restart_retry','https_verified')


def source_identity(repo, git):
    parents = git(repo,'rev-list','--parents','-n','1','HEAD').split()
    branch = git(repo,'rev-parse','--abbrev-ref','HEAD')
    tree = git(repo,'rev-parse','HEAD^{tree}')
    subject = git(repo,'show','-s','--format=%s','HEAD')
    source = parents[0]
    if branch in ('release-dev','release-online') and subject == 'Merge origin/main into '+branch and len(parents) == 3:
        source = parents[2]
        if tree != git(repo,'rev-parse',source+'^{tree}'):
            raise ValueError('Release wrapper differs from its source main tree.')
    return source, tree


def accept(deploy_root, evidence_path):
    deploy_root = Path(deploy_root)
    if (deploy_root/'dev/grow-pending.json').exists():
        raise ValueError('Recover the pending dev deployment before acceptance.')
    active = json.loads((deploy_root/'dev/deploy_state.json').read_text()).get('active_release',{})
    evidence = json.loads(Path(evidence_path).read_text())
    required = REQUIRED_CHECKS if 'grow' in active.get('images',{}) else CORE_CHECKS
    if active.get('group_version') != 1 or active.get('dirty_checkout') or any(evidence.get('checks',{}).get(k) is not True for k in required):
        raise ValueError('Every dev functional acceptance check must have actual passing evidence.')
    if evidence.get('config_revision') != active.get('config_revision'):
        raise ValueError('Acceptance evidence belongs to a different configuration revision.')
    if not state.configuration_matches(active,deploy_root):
        raise ValueError('Dev containers no longer match the accepted release group.')
    receipt = {'source_main':active['source_main'],'source_tree':active['source_tree'],
               'lock_sha256':active.get('lock_sha256'),'config_revision':active['config_revision'],
               'images':active['images'],'evidence_sha256':hashlib.sha256(Path(evidence_path).read_bytes()).hexdigest()}
    state.atomic_json(deploy_root/'dev/grow-accepted.json',receipt)
    return receipt


def promoted(deploy_root, source_main, source_tree, plan):
    deploy_root = Path(deploy_root)
    if (deploy_root/'dev/grow-pending.json').exists(): raise ValueError('Dev release is pending recovery.')
    try:
        receipt = json.loads((deploy_root/'dev/grow-accepted.json').read_text())
        active = json.loads((deploy_root/'dev/deploy_state.json').read_text())['active_release']
    except (OSError, KeyError, ValueError):
        raise ValueError('Online Grow deployment requires an explicit dev acceptance receipt.') from None
    if active.get('dirty_checkout'):raise ValueError('Dirty dev builds cannot be promoted online.')
    expected = {'source_main':source_main,'source_tree':source_tree,'lock_sha256':plan['lock_sha256'] if plan else None,
                'config_revision':active.get('config_revision'),'images':active.get('images')}
    if any(receipt.get(k) != v for k,v in expected.items()) or not state.configuration_matches(active,deploy_root):
        raise ValueError('Dev acceptance is stale or differs from the requested source/component lock.')
    if bool(plan) != ('grow' in receipt['images']): raise ValueError('Dev and online component sets differ.')
    for image in receipt['images'].values(): state.image_id(image)
    if plan:
        # Inspect the private frozen config, not a public hash or current mutable env file.
        private = state.unescaped(json.loads(Path(state.checked_snapshot(active,deploy_root)).read_text()))['services']
        dev_grow = private['grow']['environment']
        if database_name(dev_grow['DATABASE_URL']) == database_name(plan['env']['DATABASE_URL']):
            raise ValueError('Dev and online Grow database names must differ.')
        if dev_grow.get('ACCOUNT_ENCRYPTION_KEY') == plan['env'].get('ACCOUNT_ENCRYPTION_KEY'):
            raise ValueError('Dev and online Grow encryption keys must differ.')
        if dev_grow.get('GROW_PUBLIC_URL') == plan['env'].get('GROW_PUBLIC_URL'):
            raise ValueError('Dev and online Grow origins must differ.')
    return receipt['images']
