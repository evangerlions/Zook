"""Legacy-only release groups. No data restore or authority migration is performed here."""
import hashlib
import json
import os
import tempfile
import time
import uuid
from pathlib import Path
from urllib.request import urlopen
import grow_acceptance as acceptance
import grow_group_state as state
import grow_plan
import grow_source


def probe(group, engine):
    health = group['health']
    if not engine.wait_for_release(group['project_name'],health['bind_ip'],health['host_port'],health['health_path'],
                                   health['admin_host_port'],health['admin_health_path']):
        return False
    if not state.configuration_matches(group,Path(group['snapshot']).parents[3]):
        return False
    if 'grow' not in group['images']:return True
    deadline = time.monotonic()+90
    while time.monotonic()<deadline:
        item = state.container(group['project_name'],'grow')
        try:
            with urlopen('http://127.0.0.1:'+group['grow_host_port']+'/api/health',timeout=3) as response:
                value=json.load(response)
            if (item and item['State'].get('Health',{}).get('Status')=='healthy' and value.get('ok') is True
                    and value.get('revision')==group['components']['grow']['source_commit']):return True
        except Exception:pass
        time.sleep(2)
    return False


def public_manifest(group):
    return {k:group[k] for k in ('group_version','source_main','source_tree','lock_sha256','components','images','config_revision','schema_bundle_sha256','authority') if k in group}


def reconcile(state_file, journal, deploy_root, engine):
    if not journal.exists():return False
    data=json.loads(journal.read_text());target=data['target'];previous=data.get('previous')
    if data.get('phase') in ('migrating','migration_failed'):
        raise ValueError('Interrupted/failed migration requires operator review; no database or authority is restored.')
    state.checked_snapshot(target,deploy_root)
    if data.get('phase')=='deploying' and state.configuration_matches(target,deploy_root) and probe(target,engine):
        state.atomic_json(state_file,{'active_release':target,'previous_release':previous or {}})
        journal.unlink();return True
    restore(previous,target,state_file,journal,deploy_root,engine)
    return True


def restore(previous,target,state_file,journal,deploy_root,engine):
    if previous:
        state.compatible(previous,target)
        snapshot=state.checked_snapshot(previous,deploy_root)
        # A changed image/tag cannot silently change the schema-compatibility conclusion.
        if state.migration_digest(previous['images']['api']) != previous['schema_bundle_sha256']:
            raise ValueError('Previous migration identity changed; operator review is required.')
        state.apply(previous['project_name'],snapshot)
        if not probe(previous,engine):raise ValueError('Previous group recovery failed; pending journal retained.')
        state.atomic_json(state_file,{'active_release':previous,'previous_release':{}})
    else:
        state.stop(target['project_name'],state.checked_snapshot(target,deploy_root))
        state.atomic_json(state_file,{'active_release':{},'previous_release':{}})
    journal.unlink()


def execute(*,repo,args,project,slot,state_file,compose_files,compose_env,new_release,previous,health,engine):
    deploy_root=state_file.parent.parent
    journal=state_file.parent/'grow-pending.json'
    if not args.dry_run and reconcile(state_file,journal,deploy_root,engine):
        print('Recovered pending Grow group; inspect state and rerun the requested deployment.')
        return 1
    plan=grow_plan.prepare(repo,slot,Path(compose_env['APP_ENV_FILE']))
    source_main,source_tree=acceptance.source_identity(repo,engine.git_output)
    if args.dry_run:
        print(json.dumps({'grow_enabled':bool(plan),'source_main':source_main,'source_tree':source_tree,
                          'grow_commit':plan['lock']['commit'] if plan else None,'pending_recovery':journal.exists(),
                          'action':'plan_only_no_build_no_private_snapshot'},indent=2))
        return 0
    if slot=='online':
        promoted=acceptance.promoted(deploy_root,source_main,source_tree,plan)
        primary=promoted['api']
        state.docker('tag',primary,new_release['image'])
        print('Promoting the accepted dev image IDs without rebuilding.')
    else:
        engine.build_local_image(repo,repo/args.dockerfile,new_release['image'],new_release['image_name'],new_release['image_tag'],new_release['commit'])
        primary=state.image_id(new_release['image'])
        promoted={s:primary for s in state.CORE}
    component={'zook':{'image_id':primary,'build_ref':primary if slot=='online' else new_release['image']}}
    if plan:
        if slot!='online':
            image=new_release['image_name']+'-grow:'+plan['lock']['commit'][:12]+'-'+uuid.uuid4().hex[:12]+'-'+engine.sanitize_tag_component(args.tag_suffix)
            with tempfile.TemporaryDirectory(prefix='zook-grow-source-') as d:
                grow_source.extract_context(grow_source.read_archive(plan['mirror'],plan['lock']),plan['lock'],Path(d))
                engine.run_command(['docker','build','-t',image,'--build-arg','GROW_REVISION='+plan['lock']['commit'],d])
            promoted['grow']=state.image_id(image)
        component['grow']={'image_id':promoted['grow'],'build_ref':promoted['grow'] if slot=='online' else image,'source_commit':plan['lock']['commit'],'protocol_version':1}
    config_id=uuid.uuid4().hex
    directory=state_file.parent/'groups'/config_id
    directory.mkdir(parents=True,mode=0o700)
    api_env=grow_plan.env_file(Path(compose_env['APP_ENV_FILE']))
    files=list(compose_files)
    variables={**api_env,**compose_env}
    # Capture all actual interpolation inputs before producing a literal private Compose document.
    import re
    for path in files:
        for key in re.findall(r'\$\{([A-Z][A-Z0-9_]*)',path.read_text()):
            if key not in compose_env and key in os.environ:variables[key]=os.environ[key]
    variables['DEPLOY_IMAGE']='sha256';variables['IMAGE_TAG']=primary.split(':',1)[1]
    if plan:
        files.append(repo/'compose.grow.yaml')
        variables.update(GROW_IMAGE_REF=promoted['grow'],GROW_APP_ENV_FILE=plan['env_file'],
                         GROW_SOURCE_COMMIT=plan['lock']['commit'],GROW_HOST_PORT=plan['host_port'])
    config=state.render(repo,project,files,variables)
    grow_plan.verify_frozen(plan,config)
    for service in config['services'].values():
        service.setdefault('labels',{})['io.zook.release.config-revision']=config_id
    snapshot=directory/'runtime.compose.json';state.freeze(snapshot,config)
    target={**new_release,'group_version':1,'project_name':project,'slot':slot,'source_main':source_main,'source_tree':source_tree,
            'group_retired':not bool(plan),'lock_sha256':plan['lock_sha256'] if plan else None,'dirty_checkout':bool(engine.get_git_status(repo)),'components':component,'images':promoted,
            'snapshot':str(snapshot),'snapshot_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),
            'config_revision':config_id,'schema_bundle_sha256':state.migration_digest(primary),'authority':'legacy',
            'health':health,'grow_host_port':plan['host_port'] if plan else None}
    if previous and previous.get('group_version')!=1:
        previous=state.initial_baseline(project,config,repo,directory,previous)
        if previous:
            previous.update(group_version=1,project_name=project,slot=slot)
            previous.setdefault('health',health)
    elif not previous:
        previous=state.initial_baseline(project,config,repo,directory,None)
        if previous:
            previous.update(group_version=1,project_name=project,slot=slot)
            previous.setdefault('health',health)
    if previous:state.checked_snapshot(previous,deploy_root)
    state.compatible(previous,target)
    if plan and plan['host_port'] in (health['host_port'],health['admin_host_port']):
        raise ValueError('Grow host port collides with a core service.')
    migration_env = directory/'migration.env'
    content=[]
    for key,value in config['services']['api'].get('environment',{}).items():
        value=str(value)
        if '\n' in value or '\r' in value or '\x00' in value:raise ValueError('Multiline migration env is unsupported.')
        content.append(key+'='+value)
    fd=os.open(migration_env,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as f:f.write('\n'.join(content)+'\n')
    state.atomic_json(journal,{'phase':'migrating','previous':previous,'target':target})
    try:
        engine.run_database_migrations(primary,migration_env)
    except Exception:
        state.atomic_json(journal,{'phase':'migration_failed','previous':previous,'target':target})
        raise ValueError('Migration failed; no service replacement performed. Review the pending journal.') from None
    state.atomic_json(journal,{'phase':'deploying','previous':previous,'target':target})
    try:
        state.apply(project,str(snapshot))
        if not probe(target,engine):raise ValueError('Release group readiness failed.')
        state.atomic_json(state_file,{'active_release':target,'previous_release':previous or {}})
        journal.unlink()
    except Exception:
        print('Grow group failed; restoring the frozen previous application group, never the database.')
        restore(previous,target,state_file,journal,deploy_root,engine)
        return 1
    # Keep all component tags/IDs, not just the Zook core image, across both slots.
    if not args.skip_image_cleanup:
        for name in (new_release['image_name'],new_release['image_name']+'-grow'):
            engine.cleanup_old_release_images(image_name=name,tag_suffix=args.tag_suffix,deploy_root=deploy_root,keep_releases=engine.resolve_keep_releases(args))
    print(json.dumps(public_manifest(target),indent=2))
    print('Grow group deployed. Functional dev acceptance is a separate explicit step.')
    return 0
