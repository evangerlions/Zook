/** Isolated localhost acceptance: real common auth + real LightTick PostgreSQL. */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApplication} from './create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {ActionLinkService} from '../../src/modules/lighttick/actions/action-link.service.ts';
const connectionString=process.env.LIGHTTICK_ACTION_TEST_DATABASE_URL;
if(!connectionString||!['localhost','127.0.0.1'].includes(new URL(connectionString).hostname))throw Error('Explicit localhost database required');
const name='lighttick_action_qa_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});
await admin.query('CREATE DATABASE '+name);
const url=new URL(connectionString);url.pathname='/'+name;
await runPostgresMigrations({connectionString:url.toString(),log:()=>{}});
const pool=new Pool({connectionString:url.toString(),max:8}),repository=new PostgresLightTickRepository(pool);
process.env.LIGHTTICK_ACTIONS_ENABLED='1';
process.env.GROW_ACTION_BRIDGE_SECRET='TEST_ONLY_BRIDGE_SECRET_01234567890123456789';
const seed=buildDefaultSeed(undefined,{includeLightTick:true});
const delivery=seed.appConfigs.find(c=>c.id==='cfg_lighttick_delivery_config')!;
const deliveryValue=JSON.parse(delivery.configValue);
delivery.configValue=JSON.stringify({...deliveryValue,enabled:true,featureFlags:{...deliveryValue.featureFlags,offlineSync:true,notifications:true}});
for(const userId of ['user_alice','user_bob'])seed.appUsers.push({id:'action-qa-'+userId,appId:'lighttick',userId,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
const runtime=await createApplication({seed,lighttickEnabled:true,lighttickRepository:repository,accessTokenSecret:'TEST_ONLY_ACTION_QA_SESSION_SECRET_0123456789'});
const product=runtime.services.lighttickRuntime!;
product.actions=new ActionService(repository,()=>new Date(),async s=>`进展总结：累计 ${s.stats.minutes} 分钟，${s.stats.completed} 次达标。\n建议：先读五分钟，再决定是否继续。（隔离验收模型返回）`);
product.actionLinks=new ActionLinkService(product.actions,process.env.GROW_ACTION_BRIDGE_SECRET);
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url??'/', 'http://localhost');let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>6*1024*1024)throw Error('Too large');}
  const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v]));
  const result=await runtime.app.handle({method:req.method??'GET',path:url.pathname,query:Object.fromEntries(url.searchParams),headers,body:raw?JSON.parse(raw):undefined,hostname:'localhost',ipAddress:'127.0.0.1'});
  res.writeHead(result.statusCode,{'Content-Type':'application/json',...result.headers});res.end(JSON.stringify(result.body));
 }catch{res.writeHead(500);res.end(JSON.stringify({message:'Isolated fixture request failed'}));}
});
server.listen(18880,'127.0.0.1',()=>console.log(JSON.stringify({url:'http://127.0.0.1:18880',syntheticAccounts:['alice@example.com','bob@example.com'],database:name})));
process.once('SIGTERM',()=>server.close(async()=>{await pool.end();await admin.query('DROP DATABASE '+name+' WITH (FORCE)');await admin.end();process.exit(0);}));
