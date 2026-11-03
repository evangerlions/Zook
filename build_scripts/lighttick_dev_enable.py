#!/usr/bin/env python3
"""Fail closed dev-only operator helper. Defaults to read-only; never edits online or Render."""
from pathlib import Path
from urllib.parse import urlsplit,unquote,parse_qsl
import argparse,json,os,re,subprocess,sys,tempfile,time
sys.path.insert(0,str(Path(__file__).resolve().parent))
from grow_plan import env_file
from build_and_push_docker import deployment_lock,sanitize_image_name
parser=argparse.ArgumentParser(description="Check isolated dev and optionally enable LightTick on its verified release.")
parser.add_argument('--repo',type=Path,default=Path.cwd())
parser.add_argument('--expected-release',required=True)
parser.add_argument('--apply',action='store_true')
parser.add_argument('--rebuild',action='store_true')
args=parser.parse_args()
release=args.expected_release
if not re.fullmatch('[0-9a-f]{40}',release):parser.error('expected-release must be a full commit SHA.')
if args.rebuild and not args.apply:parser.error('--rebuild requires --apply.')
repo=args.repo.resolve();path=repo/'deploy_configs/dev.env';online=repo/'deploy_configs/online.env'
flags={'APP_ENV':'dev','DEPLOY_SLOT':'dev','LIGHTTICK_ENABLED':'1','LIGHTTICK_SEED_ENABLED':'0',
       'LIGHTTICK_ACTIONS_ENABLED':'1','LIGHTTICK_ACTIONS_V2_ENABLED':'1',
       'LIGHTTICK_MANUAL_PLANNING_ENABLED':'1','LIGHTTICK_NATIVE_CONTINUATION_ENABLED':'1',
       'LIGHTTICK_CONVERSATIONAL_PLANNING_ENABLED':'0','GROW_DEPLOY_ENABLED':'0'}
client_keys=('PATH','HOME','TMPDIR','SSH_AUTH_SOCK','DOCKER_CONFIG','DOCKER_HOST','DOCKER_CONTEXT',
             'DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','HTTP_PROXY','HTTPS_PROXY','NO_PROXY')
client_env={k:os.environ[k] for k in client_keys if k in os.environ}
def docker(*args):
    result=subprocess.run(['docker',*args],capture_output=True,text=True,env=client_env)
    if result.returncode:raise SystemExit('STOP: Docker metadata check failed; env unchanged.')
    return result.stdout.strip()
with deployment_lock(repo/'.deploy/deploy.lock',0):
    if subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip()!=release:
        raise SystemExit('STOP: server checkout is not the current verified dev release.')
    if subprocess.check_output(['git','status','--porcelain'],cwd=repo,text=True).strip():
        raise SystemExit('STOP: deployment checkout is not clean.')
    if not path.is_file() or not online.is_file():raise SystemExit('STOP: both private slot env files are required.')
    dev=env_file(path);prod=env_file(online)
    if (dev.get('APP_ENV') or 'dev') not in ('dev','development') or dev.get('DEPLOY_SLOT','dev')!='dev':
        raise SystemExit('STOP: private dev env is not explicitly a dev slot.')
    def project(env,slot):
        image=sanitize_image_name(env.get('DOCKER_IMAGE_NAME') or repo.name)
        return sanitize_image_name(env.get('COMPOSE_PROJECT_NAME') or image+'-'+slot)
    image_name=sanitize_image_name(dev.get('DOCKER_IMAGE_NAME') or repo.name)
    dev_project=project(dev,'dev');online_project=project(prod,'online')
    if dev_project==online_project:raise SystemExit('STOP: dev/online Compose project collision.')
    active=json.loads((repo/'.deploy/dev/deploy_state.json').read_text())['active_release']
    if active.get('commit')!=release or 'grow' in active.get('images',{}):
        raise SystemExit('STOP: recorded dev release differs or already contains Grow.')
    api=docker('ps','-q','--filter','label=com.docker.compose.project='+dev_project,'--filter','label=com.docker.compose.service=api').splitlines()
    if len(api)!=1:raise SystemExit('STOP: expected one running dev API container.')
    actual=docker('inspect',api[0],'--format','{{.Image}}')
    recorded=active.get('images',{}).get('api') or active.get('image')
    if not recorded or docker('image','inspect',recorded,'--format','{{.Id}}')!=actual:
        raise SystemExit('STOP: recorded dev image differs from running API.')
    if docker('inspect',api[0],'--format','{{index .Config.Labels "org.opencontainers.image.revision"}}')!=release:
        raise SystemExit('STOP: running dev API source revision differs.')
    def target(value,kind):
        p=urlsplit(value);host=p.hostname
        if not host or p.scheme not in (('postgres','postgresql') if kind=='database' else ('redis','rediss')):
            raise SystemExit('STOP: missing or invalid '+kind+' endpoint; review private env.')
        allowed_query={'schema','ssl','sslmode','sslrootcert','sslcert','sslkey','uselibpqcompat','application_name','connect_timeout'} if kind=='database' else set()
        if any(key not in allowed_query for key,_ in parse_qsl(p.query,keep_blank_values=True)) or '%' in host or ',' in host:
            raise SystemExit('STOP: endpoint query or hostname needs private target review.')
        host='host-loopback' if host in ('localhost','127.0.0.1','host.docker.internal','::1') else host
        database=unquote(p.path).strip('/')
        if kind=='redis':
            if database and not database.isdecimal():raise SystemExit('STOP: invalid Redis database index.')
            database=str(int(database or '0'))
        elif not database:raise SystemExit('STOP: database name missing.')
        return host,p.port or (5432 if kind=='database' else 6379),database
    devdb={target(dev[k],'database') for k in ('DATABASE_URL','DIRECT_URL') if dev.get(k)}
    proddb={target(prod[k],'database') for k in ('DATABASE_URL','DIRECT_URL') if prod.get(k)}
    if not dev.get('DATABASE_URL') or not prod.get('DATABASE_URL') or devdb & proddb:
        raise SystemExit('STOP: dev/online database isolation needs review. Nothing changed.')
    if target(dev.get('REDIS_URL',''),'redis')==target(prod.get('REDIS_URL',''),'redis'):
        raise SystemExit('STOP: dev/online Redis isolation needs review. Nothing changed.')
    default='/var/lib/zook/appRunData'
    def data_path(value):
        candidate=Path(value or default)
        return (candidate if candidate.is_absolute() else repo/candidate).resolve()
    if data_path(dev.get('ZOOK_APP_RUN_DATA_HOST_PATH'))==data_path(prod.get('ZOOK_APP_RUN_DATA_HOST_PATH')):
        raise SystemExit('STOP: dev/online file storage isolation needs review. Nothing changed.')
    if dev.get('GROW_DEPLOY_ENABLED','0') not in ('0',''):
        raise SystemExit('STOP: Grow already enabled; review its actual deployment before changing config.')
    old=path.read_bytes();text=old.decode()
    lines=[line for line in text.splitlines() if not re.match(r'^\s*(?:export\s+)?(?:'+ '|'.join(flags)+r')\s*=',line)]
    lines=[line for line in lines if line!='# LightTick isolated dev runtime']
    new=('\n'.join(lines).rstrip()+'\n\n# LightTick isolated dev runtime\n'+''.join(k+'='+v+'\n' for k,v in flags.items())).encode()
    if args.apply and new!=old:
        backup=Path.home()/'.zook-private/lighttick-dev';backup.mkdir(parents=True,exist_ok=True,mode=0o700);backup.chmod(0o700)
        file=backup/('dev.env.before-enable-'+str(time.time_ns()))
        fd=os.open(file,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
        with os.fdopen(fd,'wb') as out:out.write(old)
        fd,temp=tempfile.mkstemp(dir=path.parent,prefix='.dev-runtime-')
        try:
            with os.fdopen(fd,'wb') as out:out.write(new);out.flush();os.fsync(out.fileno())
            if path.read_bytes()!=old:raise SystemExit('STOP: env changed concurrently; retained original file.')
            os.replace(temp,path)
        finally:
            if os.path.exists(temp):os.unlink(temp)
        print('Runtime flags patched; private backup: '+str(file))
    else:print('Dry run: checks passed; no env change.' if not args.apply else 'Runtime flags already match; no rewrite.')
    if args.apply:path.chmod(0o600)
    print('No DB/auth values printed or replaced; Grow remains disabled.')
# Deploy from a clean client environment; all runtime values come from dev.env.
client_env['GROW_DEPLOY_ENABLED']='0'
if args.rebuild:subprocess.run([sys.executable,'build_scripts/build_and_push_docker.py',
    '--branch','release-dev','--commit',release,'--slot','dev','--image-name',image_name,
    '--env-file','deploy_configs/dev.env','--app-env-file','deploy_configs/dev.env',
    '--skip-image-cleanup','--skip-builder-prune'],cwd=repo,env=client_env,check=True)
