#!/usr/bin/env python3
"""Reproducible local ABBA/ABBA experiment; restores ONLY its fixed disposable DB.
Requires dedicated PostgreSQL 58671 and Redis 58672. No remote target accepted.
"""
import argparse, hashlib, json, math, os, platform, signal, subprocess, time, urllib.request
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--artifacts',required=True);p.add_argument('--seconds',type=int,default=30);p.add_argument('--rounds',type=int,choices=[4,8],default=8);args=p.parse_args()
out=Path(args.artifacts).resolve();out.mkdir(parents=True,exist_ok=True)
pg='/opt/homebrew/opt/postgresql@15/bin/'
dsn='postgresql://joint_qa@127.0.0.1:58671/joint_acceptance_qa'
redis='/opt/homebrew/bin/redis-cli'
# Never kill a listener owned by another process; user stops the native fixture first.
try:
 urllib.request.urlopen('http://127.0.0.1:3107/__state',timeout=1)
 raise RuntimeError('Stop the task native fixture on 3107 before starting controlled rounds.')
except (ConnectionError,urllib.error.URLError):pass
baseline=out/'benchmark-baseline.dump'
if baseline.exists():raise RuntimeError('Use a fresh artifact directory; existing experiment evidence is immutable.')
subprocess.run([pg+'pg_dump','-Fc','--dbname='+dsn,'--file='+str(baseline)],check=True)
env=os.environ.copy();env.update(LIGHTTICK_TEST_DATABASE_URL=dsn,JOINT_FILE_ROOT=str(out/'files'))
sequence=['off','core','core','off']*(args.rounds//4)
all_results=[]
for i,mode in enumerate(sequence,1):
 # Static DSN + task-owned cluster are intentionally not CLI options.
 subprocess.run([pg+'pg_restore','--clean','--if-exists','--no-owner','--dbname='+dsn,str(baseline)],check=True,stdout=subprocess.DEVNULL,stderr=(out/f'round-{i}-restore.log').open('w'))
 subprocess.run([redis,'-h','127.0.0.1','-p','58672','FLUSHDB'],check=True,stdout=subprocess.DEVNULL)
 env['JOINT_CONFIG_FILE']=str(out/f'round-{i}-public-config.json')
 log=(out/f'round-{i}-server.log').open('w')
 server=subprocess.Popen(['node','--experimental-transform-types','scripts/lighttick-basic-joint-server.ts']+(['--enabled'] if mode=='core' else []),env=env,stdout=log,stderr=subprocess.STDOUT)
 try:
  ready=False
  for attempt in range(120):
   if server.poll() is not None:raise RuntimeError(f'round {i} server exited')
   try:
    with urllib.request.urlopen('http://127.0.0.1:3107/__worker',timeout=1) as r:
     ready=r.status==200 and 'ticks' in json.load(r)
    if ready:break
   except Exception:time.sleep(.5)
  if not ready:raise RuntimeError('server readiness timeout')
  config=json.loads(Path(env['JOINT_CONFIG_FILE']).read_text())
  assert config['data']['enabled']==(mode=='core'),config
  result=out/f'round-{i}-{mode}.json'
  with (out/f'round-{i}-load.log').open('w') as load_log:
   subprocess.run(['python3','scripts/lighttick-basic-mixed-load.py','--mode',mode,'--seconds',str(args.seconds),'--output',str(result)],stdout=load_log,stderr=subprocess.STDOUT,check=True)
  data=json.loads(result.read_text());data['round']=i
  raw=subprocess.run([redis,'-p','58672','GET','zook:queue:job:joint-deferred-ai'],capture_output=True,text=True,check=True).stdout.strip()
  if raw:
   job=json.loads(raw);data['deferred_job']={k:job.get(k) for k in ['id','name','attemptsMade','maxAttempts','availableAt']}
  all_results.append(data)
  print(json.dumps({'round':i,'mode':mode,'worker':data['worker'],'errors':sum(v['non_200'] for v in data['summary'].values())}),flush=True)
 finally:
  server.send_signal(signal.SIGTERM)
  try:server.wait(timeout=15)
  except subprocess.TimeoutExpired:server.kill();server.wait()
  log.close()
def p95(values):
 values=sorted(values);return values[math.ceil(len(values)*.95)-1]
comparison={}
for op in all_results[0]['summary']:
 row={}
 for mode in ['off','core']:
  samples=[s for r in all_results if r['mode']==mode for s in r['samples'] if s['op']==op]
  row[mode]={'count':len(samples),'non_200':sum(s['status']!=200 for s in samples),'5xx':sum(s['status']>=500 for s in samples),'p95_ms':p95([s['ms'] for s in samples]),'p95_scheduled_ms':p95([s['schedule_ms'] for s in samples])}
 row['p95_increase_percent']=(row['core']['p95_ms']/row['off']['p95_ms']-1)*100
 row['pass']=row['p95_increase_percent']<=10 and row['core']['non_200']==0 and row['off']['non_200']==0
 comparison[op]=row
worker_gate=all(r['worker'].get('errors')==0 and r['worker'].get('otherJobs',0)>0 and (r['mode']=='off' or r.get('deferred_job',{}).get('attemptsMade')==0) for r in all_results)
arrival_gate=all(op['max_start_lag_ms']<=200 for r in all_results for op in r['summary'].values())
result={'worker_gate_pass':worker_gate,'arrival_gate_pass':arrival_gate,'backend_base':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),'host':platform.platform(),'node':subprocess.check_output(['node','--version'],text=True).strip(),'sequence':sequence,'seconds_per_round':args.seconds,'warmup_per_round':10,'other_app_rps':35,'core_additional_rps':10,'database':'full PostgresDatabase, all migrations, restored identical initial snapshot per round','queue':'dedicated Redis; real notification queue consumer, synthetic local email metadata only; no provider delivery','baseline_dump_sha256':hashlib.sha256(baseline.read_bytes()).hexdigest(),'comparison':comparison,'gate_pass':all(v['pass']for v in comparison.values()) and worker_gate and arrival_gate,'worker_rounds':[{'round':r['round'],'mode':r['mode'],'stats':r['worker'],'deferred_job':r.get('deferred_job')}for r in all_results]}
(out/'mixed-load-summary.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
