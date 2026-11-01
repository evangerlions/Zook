#!/usr/bin/env python3
"""Disposable dual-database Docker infrastructure. Never uses a user's DATABASE_URL."""
import argparse
import base64
import json
import os
import secrets
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'build_scripts'))
import grow_group_state as s


def port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1',0));return sock.getsockname()[1]


def private_env(path,data):
    path.write_text(''.join(k+'='+str(v)+'\n' for k,v in data.items()));path.chmod(0o600)


def initialize(root,mirror):
    root=root.resolve();root.mkdir(parents=True,mode=0o700,exist_ok=False)
    run='zook-z1-'+uuid.uuid4().hex[:8]
    ports={k:port() for k in ('pg','api','admin','grow','tls_grow','tls_api','online_api','online_admin','online_grow','online_tls_grow','online_tls_api')}
    network=run+'-private'
    s.docker('network','create','--label','io.zook.qa='+run,network)
    subnet=json.loads(s.docker('network','inspect',network))[0]['IPAM']['Config'][0]['Subnet']
    cert=root/'certs';cert.mkdir()
    subprocess.run(['openssl','req','-x509','-nodes','-newkey','rsa:2048','-keyout',str(cert/'server.key'),'-out',str(cert/'server.crt'),'-days','2','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,DNS:zook-z1.test,DNS:zook-z1-online.test,IP:127.0.0.1'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    (root/'init.sql').write_text(''.join('CREATE DATABASE '+name+';\n' for name in ['zook_z1_dev','grow_z1_dev','zook_z1_online','grow_z1_online','zook_z1_restored','grow_z1_restored']))
    password=secrets.token_hex(20)
    bridge=secrets.token_hex(32)
    api={'DATABASE_URL':f'postgresql://qa:{password}@pg:5432/zook_z1_dev','DIRECT_URL':f'postgresql://qa:{password}@pg:5432/zook_z1_dev','REDIS_URL':'redis://redis:6379/0','AUTH_ACCESS_TOKEN_SECRET':secrets.token_hex(32),'REFRESH_TOKEN_SECRET':secrets.token_hex(32),'LIGHTTICK_ENABLED':'1','LIGHTTICK_SEED_ENABLED':'1','LIGHTTICK_ACTIONS_ENABLED':'1','LIGHTTICK_ACTIONS_V2_ENABLED':'1','LIGHTTICK_MANUAL_PLANNING_ENABLED':'1','LIGHTTICK_NATIVE_CONTINUATION_ENABLED':'1','LIGHTTICK_CONVERSATIONAL_PLANNING_ENABLED':'0','GROW_ACTION_BRIDGE_SECRET':bridge,'ADMIN_BASIC_AUTH_USERNAME':'qa-admin','ADMIN_BASIC_AUTH_PASSWORD':secrets.token_hex(24),'APP_ENV':'development','ADMIN_DEFAULT_APP_ID':'lighttick','DEPLOY_SLOT':'dev','COMPOSE_PROJECT_NAME':run+'-dev','DEPLOY_HOST_PORT':ports['api'],'ADMIN_HOST_PORT':ports['admin'],'ADMIN_CONTAINER_PORT':'3110','PORT':'3100','DEPLOY_HOST_BIND_IP':'127.0.0.1','GROW_DEPLOY_ENABLED':'1','GROW_SOURCE_MIRROR':str(mirror),'GROW_APP_ENV_FILE':str(root/'grow.env'),'GROW_HOST_PORT':ports['grow'],'ZOOK_APP_RUN_DATA_HOST_PATH':str(root/'runtime')}
    grow={'DATABASE_URL':f'postgresql://qa:{password}@pg:5432/grow_z1_dev','ACCOUNT_ENCRYPTION_KEY':base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(),'APP_USERNAME':'qaowner','APP_PASSWORD':secrets.token_hex(24),'PLAN_CONTENT_BACKEND':'github','GITHUB_CONTENT_REPO':'qa/isolated-teaching-fixture','GITHUB_CONTENT_BRANCH':'main','GITHUB_CONTENT_TOKEN':'synthetic-unused-qa-token','CLOUD_DEPLOY':'1','WEB_CONCURRENCY':'1','GROW_PUBLIC_URL':'https://localhost:'+str(ports['tls_grow']),'LIGHTTICK_BRIDGE_URL':'https://zook-z1.test','GROW_ZOOK_WEB_AUTH_ENABLED':'1','GROW_NATIVE_BASIC_PLANS_ENABLED':'1','GROW_ACTION_BRIDGE_SECRET':bridge,'GROW_SCHEDULED_READING_ENABLED':'0','FORWARDED_ALLOW_IPS':subnet,'SSL_CERT_FILE':'/qa-ca/server.crt'}
    private_env(root/'api.env',api);private_env(root/'grow.env',grow)
    runtime=root/'runtime';runtime.mkdir();runtime.chmod(0o777) # Only this disposable synthetic bind directory.
    for phase,hostname,prefix in [('dev','zook-z1.test',''),('online','zook-z1-online.test','online_')]:
        conf=f'''server {{ listen 443 ssl; server_name {hostname}; ssl_certificate /certs/server.crt; ssl_certificate_key /certs/server.key; location / {{ proxy_pass http://{run}-{phase}-api-1:3100; proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr; }} }}
server {{ listen 444 ssl; server_name localhost; ssl_certificate /certs/server.crt; ssl_certificate_key /certs/server.key; location / {{ proxy_pass http://{run}-{phase}-grow-1:8756; proxy_set_header Host $http_host; proxy_set_header X-Forwarded-Proto https; proxy_set_header X-Forwarded-For $remote_addr; }} }}'''
        (root/(phase+'-nginx.conf')).write_text(conf)
    infra={'services':{'pg':{'image':'postgres:15-bookworm','environment':{'POSTGRES_USER':'qa','POSTGRES_PASSWORD':password,'POSTGRES_DB':'postgres'},'volumes':[str(root/'init.sql')+':/docker-entrypoint-initdb.d/init.sql:ro'],'ports':['127.0.0.1:'+str(ports['pg'])+':5432'],'networks':{'default':{'aliases':['pg']}}},'redis':{'image':'redis:7-alpine','networks':{'default':{'aliases':['redis']}}}},'networks':{'default':{'external':True,'name':network}}}
    # Start proxies after application DNS names exist; no placeholder DNS failure at nginx startup.
    for phase,hostname,prefix in [('dev','zook-z1.test',''),('online','zook-z1-online.test','online_')]:
        infra['services']['proxy-'+phase]={'image':'nginx:alpine','volumes':[str(root/(phase+'-nginx.conf'))+':/etc/nginx/conf.d/default.conf:ro',str(cert)+':/certs:ro'],'ports':['127.0.0.1:'+str(ports[prefix+'tls_api'])+':443','127.0.0.1:'+str(ports[prefix+'tls_grow'])+':444'],'networks':{'default':{'aliases':[hostname]}}}
    s.atomic_json(root/'infra.json',infra)
    s.atomic_json(root/'overlay.json',{'networks':{'default':{'external':True,'name':network}},'services':{'grow':{'volumes':[str(cert)+':/qa-ca:ro']}}})
    s.atomic_json(root/'base-overlay.json',{'networks':{'default':{'external':True,'name':network}}})
    s.atomic_json(root/'fixture.json',{'run':run,'network':network,'ports':ports,'root':str(root)})
    s.docker('compose','-p',run+'-infra','-f',root/'infra.json','up','-d','pg','redis')
    for _ in range(60):
        try:
            s.docker('exec',run+'-infra-pg-1','pg_isready','-U','qa');break
        except ValueError:time.sleep(1)
    else:raise ValueError('Disposable PostgreSQL did not start.')
    print(json.dumps({'run':run,'root':str(root),'ports':ports}))


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--root',type=Path,required=True);parser.add_argument('--mirror',type=Path,required=True)
    args=parser.parse_args();initialize(args.root,args.mirror)
