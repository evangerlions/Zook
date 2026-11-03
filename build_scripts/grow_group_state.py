"""Private frozen Compose groups and Docker identity helpers for optional Grow releases."""
import copy
import hashlib
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path

CORE = ('api', 'worker', 'admin-web')
CLIENT_ENV = ('PATH','HOME','TMPDIR','DOCKER_CONFIG','DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','HTTP_PROXY','HTTPS_PROXY','NO_PROXY')


def docker(*args, env=None):
    process = {k: os.environ[k] for k in CLIENT_ENV if k in os.environ}
    if env:
        process.update(env)
    try:
        result = subprocess.run(['docker', *map(str,args)], capture_output=True, text=True, env=process, timeout=180)
    except subprocess.TimeoutExpired:
        raise ValueError('Docker operation timed out: '+str(args[0])) from None
    if result.returncode:
        # Docker/config output can contain resolved secrets. Never echo it.
        raise ValueError('Docker operation failed ('+str(result.returncode)+'): '+str(args[0]))
    return result.stdout.strip()


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent, 0o700)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix='.pending-')
    try:
        with os.fdopen(fd, 'w') as f:
            json.dump(value, f, indent=2); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def escaped(value):
    # Materialized values must not be interpolated a second time by Compose on replay.
    if isinstance(value, str): return value.replace('$', '$$')
    if isinstance(value, dict): return {k: escaped(v) for k,v in value.items()}
    if isinstance(value, list): return [escaped(v) for v in value]
    return value


def unescaped(value):
    # `docker compose config` serializes literal dollars escaped for round-trip YAML/JSON.
    if isinstance(value,str):return value.replace('$$','$')
    if isinstance(value,dict):return {k:unescaped(v) for k,v in value.items()}
    if isinstance(value,list):return [unescaped(v) for v in value]
    return value


def image_id(reference):
    value = docker('image','inspect',reference,'--format','{{.Id}}')
    if not re.fullmatch(r'sha256:[0-9a-f]{64}',value):
        raise ValueError('Invalid Docker image identity.')
    return value


def container(project, service):
    identifier = docker('ps','-aq','--filter','label=com.docker.compose.project='+project,
                        '--filter','label=com.docker.compose.service='+service).splitlines()
    if not identifier: return None
    if len(identifier) != 1: raise ValueError('Ambiguous component container: '+service)
    return json.loads(docker('inspect',identifier[0]))[0]


def render(repo, project, compose_files, env):
    args = ['compose','--project-directory',str(repo),'--project-name',project]
    for file in compose_files: args += ['-f', str(file)]
    config = unescaped(json.loads(docker(*args,'config','--no-env-resolution','--format','json',env=env)))
    from grow_plan import env_file
    for service in config['services'].values():
        literal={}
        for item in service.get('env_file',[]):
            filename=item['path'] if isinstance(item,dict) else item
            path=Path(filename)
            if not path.exists() and isinstance(item,dict) and item.get('required') is False:continue
            literal.update(env_file(path))
        service['environment']={**literal,**service.get('environment',{})}
        if any(v is None for v in service.get('environment',{}).values()):
            raise ValueError('Resolve every environment variable explicitly before freezing the group.')
        service.pop('env_file',None)  # Resolved private environment is in this frozen document.
    return config


def freeze(path, config):
    atomic_json(path, escaped(config))


def apply(project, snapshot):
    docker('compose','--project-name',project,'-f',snapshot,'up','-d','--force-recreate','--remove-orphans')


def stop(project, snapshot):
    docker('compose','--project-name',project,'-f',snapshot,'down')  # Never delete volumes.


def actual_images(project, services):
    return {s:(container(project,s) or {}).get('Image') for s in services}


def configuration_matches(group, deploy_root):
    snapshot=checked_snapshot(group,deploy_root)
    hashes=docker('compose','--project-name',group['project_name'],'-f',snapshot,'config','--hash','*')
    expected=dict(line.split() for line in hashes.splitlines() if line.strip())
    if actual_images(group['project_name'],group['images']) != group['images']:return False
    config=unescaped(json.loads(docker('compose','--project-name',group['project_name'],'-f',snapshot,'config','--format','json')))
    for service,image in group['images'].items():
        item=container(group['project_name'],service)
        if not item or item['Config'].get('Labels',{}).get('com.docker.compose.config-hash')!=expected.get(service):return False
        base=json.loads(docker('image','inspect',image))[0]['Config']
        actual=dict(x.split('=',1) for x in item['Config'].get('Env',[]) if '=' in x)
        env=dict(x.split('=',1) for x in base.get('Env',[]) if '=' in x)
        env.update({k:str(v) for k,v in config['services'][service].get('environment',{}).items()})
        if actual!=env:return False
    return True


def migration_digest(image):
    script = "import fs from 'node:fs';import crypto from 'node:crypto';const p='src/infrastructure/database/postgres/migrations/';const h=crypto.createHash('sha256');for(const f of fs.readdirSync(p).filter(x=>x.endsWith('.sql')).sort()){h.update(f+'\\0');h.update(fs.readFileSync(p+f));h.update('\\0');}console.log(h.digest('hex'));"
    value = docker('run','--rm','--entrypoint','node',image,'--input-type=module','-e',script)
    if not re.fullmatch('[0-9a-f]{64}',value): raise ValueError('Invalid migration bundle digest.')
    return value


def initial_baseline(project, template, repo, directory, previous):
    """Capture actual old values, not the just-edited env/Compose interpolation values."""
    found = {s:container(project,s) for s in CORE}
    if not any(found.values()):
        if previous: raise ValueError('Stored release exists but baseline containers are missing.')
        return None
    if not all(found.values()): raise ValueError('Cannot snapshot an incomplete baseline group.')
    if set(template['services'])-set(CORE)-{'grow'}:
        raise ValueError('Initialize legacy baseline using the standard three-service Compose.')
    old = copy.deepcopy(template)
    old['services'].pop('grow',None)
    identities = {}
    for service, item in found.items():
        if item['State']['Status'] != 'running': raise ValueError('Baseline component is not running: '+service)
        cfg = item['Config']
        values = dict(x.split('=',1) for x in cfg.get('Env',[]) if '=' in x)
        commit = cfg.get('Labels',{}).get('org.opencontainers.image.revision',values.get('GIT_SHA',''))
        if not re.fullmatch('[0-9a-f]{40}',commit):
            raise ValueError('Baseline image lacks verifiable GIT_SHA; initialize a current base release first.')
        original = subprocess.run(['git','show',commit+':compose.yaml'],cwd=repo,capture_output=True)
        if original.returncode or original.stdout != (repo/'compose.yaml').read_bytes():
            raise ValueError('Baseline Compose changed; a reviewed baseline snapshot is required.')
        target = old['services'][service]
        target['image'] = item['Image']; identities[service] = item['Image']
        target['environment'] = values
        target['command'] = cfg.get('Cmd')
        target['entrypoint'] = cfg.get('Entrypoint')
        target['restart'] = item['HostConfig']['RestartPolicy']['Name']
        ports = []
        for key, binds in (item.get('NetworkSettings',{}).get('Ports') or {}).items():
            for binding in binds or []:
                port, protocol = key.split('/')
                ports.append({'target':int(port),'published':binding['HostPort'],'host_ip':binding['HostIp'],'protocol':protocol})
        target['ports'] = ports
        mounts = []
        for mount in item.get('Mounts',[]):
            if mount['Type'] != 'bind': raise ValueError('Legacy baseline requires review of non-bind storage mounts.')
            mounts.append({'type':'bind','source':mount['Source'],'target':mount['Destination'],'read_only':not mount['RW']})
        target['volumes'] = mounts
        health = cfg.get('Healthcheck')
        if health:
            target['healthcheck'] = {'test':health['Test'],'retries':health.get('Retries',3)}
            for k,label in [('Interval','interval'),('Timeout','timeout'),('StartPeriod','start_period')]:
                if k in health:target['healthcheck'][label]=str(health[k])+'ns'
    if len(set(identities.values())) != 1: raise ValueError('Baseline core components use mixed images.')
    snapshot = directory/'baseline.compose.json';freeze(snapshot,old)
    return {**(previous or {}),'snapshot':str(snapshot),'images':identities,'components':{},'authority':'legacy',
            'snapshot_sha256':hashlib.sha256(snapshot.read_bytes()).hexdigest(),'schema_bundle_sha256':migration_digest(identities['api']),'config_revision':directory.name+'-baseline','health':{'bind_ip':'127.0.0.1','host_port':old['services']['api']['ports'][0]['published'],'admin_host_port':old['services']['admin-web']['ports'][0]['published'],'health_path':'api/health','admin_health_path':'_admin/health'}}


def checked_snapshot(group, deploy_root):
    path = Path(group['snapshot']).resolve()
    if not path.is_relative_to(Path(deploy_root).resolve()) or not path.is_file():
        raise ValueError('Frozen release artifact is missing or outside deployment storage.')
    if group.get('snapshot_sha256') and hashlib.sha256(path.read_bytes()).hexdigest()!=group['snapshot_sha256']:
        raise ValueError('Frozen release artifact checksum mismatch.')
    return str(path)


def compatible(previous, target):
    if not previous: return
    if previous.get('authority') != 'legacy' or target.get('authority') != 'legacy':
        raise ValueError('Authority migration requires a live migration coordinator, not legacy group rollback.')
    if previous.get('schema_bundle_sha256') != target.get('schema_bundle_sha256'):
        raise ValueError('Migration bundle changed: deploy and verify the base with Grow disabled before enabling the group.')
    old_grow = previous.get('components',{}).get('grow')
    new_grow = target.get('components',{}).get('grow')
    if old_grow and new_grow and old_grow['source_commit'] != new_grow['source_commit']:
        raise ValueError('Grow source upgrade needs reviewed storage compatibility before automatic group rollback.')
