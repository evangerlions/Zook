/** Localhost-only fault-injection server. Not imported by production code. */
import {createServer} from 'node:http';import {readFile} from 'node:fs/promises';import {Pool} from 'pg';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {ActionHandoffService} from '../../src/modules/lighttick/actions/action-handoff.service.ts';
import {ActionLinkService} from '../../src/modules/lighttick/actions/action-link.service.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {tryHandleLightTickActionRoutes} from '../../src/app/lighttick-action-routes.ts';
const url=process.env.LIGHTTICK_ACTION_TEST_DATABASE_URL!,schema=process.env.SOURCE_TEST_SCHEMA!,token=process.env.SOURCE_TEST_TOKEN!;
if(!url||!['localhost','127.0.0.1'].includes(new URL(url).hostname)||!/^source_http_[a-f0-9]{32}$/.test(schema)||token.length<32)throw Error('Explicit disposable localhost fixture configuration required');
const admin=new Pool({connectionString:url});await admin.query('CREATE SCHEMA IF NOT EXISTS '+schema);
const pool=new Pool({connectionString:url,options:'-c search_path='+schema,max:5});
await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/074_lighttick_action_workspaces.sql',import.meta.url),'utf8'));
const operations=await readFile(new URL('../../src/infrastructure/database/postgres/migrations/031_lighttick_sync_devices.sql',import.meta.url),'utf8');await pool.query(operations.match(/CREATE TABLE IF NOT EXISTS zook_lighttick_operations[\s\S]+?\n\);/)![0]);
let now=new Date('2026-10-19T12:00:00Z'),drop=false,failReceipt=false,failHandoffReceipt=false,member=true;
const repo=new PostgresLightTickRepository(pool),save=repo.saveOperation.bind(repo);
repo.saveOperation=async row=>{if(failReceipt&&row.action==='source-confirmation'){failReceipt=false;throw Error('TEST_ONLY receipt persistence fault');}await save(row);};
const saveLink=repo.saveActionLink.bind(repo);
repo.saveActionLink=async row=>{if(failHandoffReceipt&&row.phase==='active'&&row.import_hash){failHandoffReceipt=false;throw Error('TEST_ONLY handoff receipt persistence fault');}await saveLink(row);};
const actions=new ActionService(repo,()=>now),links=new ActionLinkService(actions,process.env.GROW_ACTION_BRIDGE_SECRET!);
const owner={appId:'lighttick',userId:'zook-fixture'} as const;
const runtime={actions,actionLinks:links,actionsEnabled:true} as any;
const context={database:{findAppUser:async(_app:string,user:string)=>member&&user===owner.userId?{status:'ACTIVE'}:undefined,findUserById:async(user:string)=>member&&user===owner.userId?{status:'ACTIVE'}:undefined},
 ok:(data:any,requestId:string,headers:any)=>({statusCode:200,headers,body:{code:'OK',message:'OK',data,requestId}})} as any;
const server=createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>5*1024*1024)throw Error('fixture body limit');}const body=JSON.parse(raw||'{}');
  if(req.url?.startsWith('/fixture/')&&req.headers['x-test-token']===token){
   let result:any;
   if(req.url==='/fixture/handoff'){
    const source=String(req.headers['x-grow-account-id']??'');
    links.verify(source,String(req.headers['x-grow-timestamp']??''),String(req.headers['x-grow-nonce']??''),String(req.headers['x-grow-signature']??''),body);
    if(!member)throw Error('TEST_ONLY inactive member');
    if(!await repo.getActionLink(source))await repo.saveActionLink({...owner,source_account_id:source,binding_id:'binding-fixture',phase:'staged'});
    const handoff=new ActionHandoffService(links);
    result=body.action==='import-preflight'?await handoff.preflight(source,body):await handoff.import(source,body);
    if(drop&&body.action==='import'){drop=false;req.socket.destroy();return;}
   }else if(req.url==='/fixture/setup'){
    await repo.saveActionLink({...owner,source_account_id:'grow-fixture',binding_id:'binding-fixture',phase:'active'});
    const row=await actions.readWorkspace(owner);row.data.content_sources=[body.target];row.version++;await repo.saveActionWorkspace(row);
    result=await actions.request(owner,'POST','/schedules',{key:'fixture-'+body.date,title:'SOURCE PRIVATE TITLE',target:body.target,date:body.date});
   }else if(req.url==='/fixture/action')result=await actions.request(owner,body.method??'POST',body.path??'',body.body??{});
   else if(req.url==='/fixture/control'){if(body.now)now=new Date(body.now);if(body.drop)drop=true;if(body.failReceipt)failReceipt=true;if(body.failHandoffReceipt)failHandoffReceipt=true;if(body.member!==undefined)member=body.member;result={ok:true};}
   else if(req.url==='/fixture/workspace')result=await repo.getActionWorkspace(owner)??null;
   else throw Error('unknown fixture control');
   res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(result));return;
  }
  const result=await tryHandleLightTickActionRoutes(context,true,runtime,{method:req.method!,path:req.url!,headers:req.headers as any,body,requestId:'source-http-test'});
  if(drop&&body.action==='source-confirmation'&&result?.statusCode===200){drop=false;req.socket.destroy();return;}
  res.writeHead(result?.statusCode??404,{'Content-Type':'application/json',...result?.headers});res.end(JSON.stringify(result?.body??{}));
 }catch(error){res.writeHead((error as any).statusCode??500,{'Content-Type':'application/json'});res.end(JSON.stringify({code:(error as any).code??'INTERNAL_SERVER_ERROR',message:'TEST_ONLY injected or validation failure'}));}
});
server.listen(0,'127.0.0.1',()=>console.log(JSON.stringify({port:(server.address() as any).port})));
process.on('SIGTERM',()=>{server.close();void Promise.all([pool.end(),admin.end()]).then(()=>process.exit(0));});
