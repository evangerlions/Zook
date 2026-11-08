#!/usr/bin/env python3
"""Loopback-only fixed-arrival HTTP load; never stores bearer tokens.
Run server --enabled (core) or without it; record every sample, including errors.
"""
import argparse, concurrent.futures, http.client, json, math, threading, time, urllib.parse
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--mode',choices=['off','core'],required=True)
parser.add_argument('--output',required=True)
parser.add_argument('--seconds',type=int,default=30)
parser.add_argument('--warmup',type=int,default=10)
args=parser.parse_args()
base='127.0.0.1:3107'
local=threading.local()
def request(app,method,path,body=None,extra=None):
    if not hasattr(local,'conn'):local.conn=http.client.HTTPConnection(base,timeout=20)
    headers={'Content-Type':'application/json','X-App-Id':app}
    if app in tokens:headers['Authorization']='Bearer '+tokens[app]
    headers.update(extra or {})
    raw=None if body is None else json.dumps(body)
    try:
        local.conn.request(method,path,raw,headers)
        res=local.conn.getresponse();data=res.read()
        try:value=json.loads(data)
        except Exception:value={}
        return res.status,value
    except Exception as e:
        local.conn.close();local.conn=http.client.HTTPConnection(base,timeout=20)
        return 0,{'transport':type(e).__name__}
tokens={}
for app in ['frogsleep','bodylog','ai_novel']+(['lighttick'] if args.mode=='core' else []):
    status,reply=request(app,'POST','/api/v1/auth/login',{'appId':app,'clientType':'app','account':'alice@example.com','password':'Password1234'})
    if status!=200:raise RuntimeError(f'login {app} {status} {reply.get("code")}')
    data=reply['data'];tokens[app]=data.get('access_token',data.get('accessToken'))
    assert tokens[app],app
status,state=request('frogsleep','GET','/api/v1/frogsleep/product-data/personal-sync/state')
assert status==200,(status,state.get('code'))
epoch=state['data']['sync_epoch']
ops=[('frogsleep.write','frogsleep','POST','/api/v1/frogsleep/product-data/sleep-sessions',None),
 ('frogsleep.state','frogsleep','GET','/api/v1/frogsleep/product-data/personal-sync/state',None),
 ('frogsleep.sessions','frogsleep','GET','/api/v1/frogsleep/product-data/sleep-sessions',None),
 ('bodylog.profile','bodylog','GET','/api/v1/bodylog/profile',None),
 ('bodylog.profile-write','bodylog','PUT','/api/v1/bodylog/profile',{'nickname':'Joint QA','avatarKey':'mint_runner'}),
 ('orange.models','ai_novel','GET','/api/v1/ai_novel/models',None),
 ('orange.credits','ai_novel','GET','/api/v1/ai_novel/credits',None)]
if args.mode=='core':ops += [('lighttick.today','lighttick','GET','/api/v1/lighttick/today',None),
 ('lighttick.record-write','lighttick','PUT','/api/v1/lighttick/records/joint-load-record',None)]
# One stable record per request, same base version under serial write schedule.
record_version=0
if args.mode=='core':
 status,record=request('lighttick','GET','/api/v1/lighttick/records/joint-load-record')
 if status==200:record_version=record['data']['version']
# Validate actual routes, not a 404/401 throughput benchmark.
for name,app,method,path,body in ops:
 if name in ['lighttick.record-write','frogsleep.write']:continue
 status,reply=request(app,method,path,body)
 assert status==200,(name,status,reply.get('code'),reply.get('message'))
def percentile(values,p):
    values=sorted(values);return values[max(0,math.ceil(len(values)*p)-1)] if values else None
samples=[]
lock=threading.Lock()
def work(op,scheduled,measured,index):
    global record_version
    name,app,method,path,body=op
    headers={}
    if name=='frogsleep.write':
        body={'session_id':f'joint-{time.time_ns()}-{index}','schema_version':'1','status':'completed','started_at':'2026-11-07T22:00:00+08:00','ended_at':'2026-11-08T06:00:00+08:00','sleep_intent':'night_sleep','timezone':'Asia/Shanghai','data':{'break_count':1},'events':[]}
        headers={'Idempotency-Key':f'joint-sleep-{time.time_ns()}-{index}','X-Sync-Epoch':epoch}
    if name=='lighttick.record-write':
        body={'raw_text':'Synthetic mixed-load record','record_date':time.strftime('%Y-%m-%d'),'prompt_kind':'free','guided_answers':{},'tags':[],'base_version':record_version}
        headers['Idempotency-Key']=f'joint-{args.mode}-{time.time_ns()}-{index}'
    started=time.perf_counter();status,reply=request(app,method,path,body,headers);ended=time.perf_counter()
    if name=='lighttick.record-write' and status==200:record_version=reply['data']['version']
    if measured:
        with lock:samples.append({'op':name,'status':status,'ms':(ended-started)*1000,'schedule_ms':(ended-scheduled)*1000,'start_lag_ms':(started-scheduled)*1000,'error_code':reply.get('code') if status!=200 else None})
with concurrent.futures.ThreadPoolExecutor(max_workers=32) as executor:
 for measured,seconds in [(False,args.warmup),(True,args.seconds)]:
    start=time.perf_counter();jobs=[]
    # 5 arrivals/sec/operation: other Apps 35 RPS, core adds 10 RPS.
    for tick in range(seconds*5):
        scheduled=start+tick/5
        time.sleep(max(0,scheduled-time.perf_counter()))
        for op in ops:jobs.append(executor.submit(work,op,scheduled,measured,tick))
    for job in jobs:job.result()
summary={}
for name in [op[0] for op in ops]:
    values=[s for s in samples if s['op']==name]
    summary[name]={'count':len(values),'non_200':sum(s['status']!=200 for s in values),'5xx':sum(s['status']>=500 for s in values),'p95_ms':percentile([s['ms'] for s in values],.95),'p95_scheduled_ms':percentile([s['schedule_ms'] for s in values],.95),'max_start_lag_ms':max(s['start_lag_ms'] for s in values)}
status,worker=request('', 'GET','/__worker')
result={'mode':args.mode,'seconds':args.seconds,'warmup_seconds':args.warmup,'other_app_rps':35,'lighttick_rps':10 if args.mode=='core' else 0,'max_workers':32,'summary':summary,'worker':worker,'samples':samples}
Path(args.output).write_text(json.dumps(result,indent=2))
print(json.dumps({k:v for k,v in result.items() if k!='samples'},indent=2))
