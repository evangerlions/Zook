/** Local acceptance entry: production API/services, isolated Redis queue and current-code worker. */
import {createServer} from 'node:http';
import {existsSync,readFileSync} from 'node:fs';
import {applyLocalDefaults} from './local-dev-config.ts';
applyLocalDefaults(process.env,existsSync('deploy_configs/local.env')?readFileSync('deploy_configs/local.env','utf8'):'');
if(process.env.APP_ENV!=='local')throw Error('Local acceptance entry only');
const {resolveRuntimeDatabaseUrl,resolveRuntimeRedisUrl}=await import('../src/infrastructure/runtime/runtime-readiness.ts');
const databaseUrl=new URL(resolveRuntimeDatabaseUrl()!),queueUrl=new URL(resolveRuntimeRedisUrl()!);
if(![databaseUrl.hostname,queueUrl.hostname].every(h=>['localhost','127.0.0.1','[::1]'].includes(h)))throw Error('Loopback dependencies required');
queueUrl.pathname='/15';
const {init}=await import('../src/infrastructure/runtime/init.ts');
const runtime=await init({serviceName:'api',emitLogs:false,queueRedisUrl:queueUrl.toString()});
const {readRequestBody}=await import('../src/infrastructure/http/request-body.ts');
let draining=false;
const timer=setInterval(async()=>{if(draining)return;draining=true;try{await runtime.queue.processDueJobs(job=>runtime.services.lighttickRuntime!.worker!.process(job));}catch(error){console.error((error as Error).message);}finally{draining=false;}},500);
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url!,'http://127.0.0.1:3106');
 const result=await runtime.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])),body:await readRequestBody(req,req.headers['content-type']),ipAddress:'127.0.0.1'});
 res.writeHead(result.statusCode,{'Content-Type':'application/json',...result.headers});res.end(JSON.stringify(result.body));
}catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:'LOCAL_ACCEPTANCE_ERROR',message:(error as Error).message}));}});
server.listen(3106,'127.0.0.1',()=>console.log('Local acceptance API 3106; dedicated Redis queue DB15; real Postgres and model.'));
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>{clearInterval(timer);server.close(()=>{void runtime.close().then(()=>process.exit(0));});});
