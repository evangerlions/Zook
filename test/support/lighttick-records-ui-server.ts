import {exchangePrivate} from '../../src/modules/lighttick/learning/learning-private.ts';
import {receiveLibrary} from '../../src/modules/lighttick/learning/learning-library.ts';
import {digest} from '../../src/modules/lighttick/actions/action.validation.ts';
import {readFileSync} from 'node:fs';
/** Local-only native acceptance harness. Never deploy: uses synthetic identity and a disposable PostgreSQL URL. */
import {createServer} from 'node:http';
import {Pool} from 'pg';
import {createApplication} from './create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {receiveLearningProgress} from '../../src/modules/lighttick/actions/action-learning-progress.ts';
const connectionString=process.env.GROW_RECORDS_UI_DATABASE_URL;
if(!connectionString||!['localhost','127.0.0.1'].includes(new URL(connectionString).hostname))throw new Error('Explicit disposable localhost GROW_RECORDS_UI_DATABASE_URL required');
await runPostgresMigrations({connectionString,log:()=>{}});
const pool=new Pool({connectionString}),repository=new PostgresLightTickRepository(pool),service=new LightTickRecordService(repository);
const testPort=Number(process.env.GROW_RECORDS_UI_PORT??3106),testUser=process.env.GROW_RECORDS_UI_OWNER??'user_alice';
if(!Number.isInteger(testPort)||testPort<1024||testPort>65535||!['user_alice','user_bob'].includes(testUser))throw Error('Synthetic fixture configuration invalid');
const owner={appId:'lighttick' as const,userId:testUser};const seed=buildDefaultSeed(undefined,{includeLightTick:true});
process.env.LIGHTTICK_ACTIONS_ENABLED='1';
process.env.LIGHTTICK_ACTIONS_V2_ENABLED='1';
process.env.GROW_ACTION_BRIDGE_SECRET='synthetic-native-actions-secret-1234567890';
process.env.LIGHTTICK_RECORD_HANDOFF_ENABLED='1';
process.env.GROW_RECORDS_SOURCE_ID='synthetic-records-ui';
process.env.GROW_RECORDS_BRIDGE_SECRET='synthetic-records-ui-secret-1234567890';
seed.appUsers.push({id:'record-ui-member',...owner,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
const app=await createApplication({seed,lighttickEnabled:true,lighttickRepository:repository});
const actions=app.services.lighttickRuntime!.actions;
let offline=false;
let dropPracticeResponse=false;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url!,'http://localhost:3106');res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
 if(url.pathname==='/__reset'){offline=false;await repository.deleteOwnerData(owner);res.end('{}');return;}
 if(url.pathname==='/__actions_reset'){
  offline=false;await repository.deleteOwnerData(owner);const day=new Date().toISOString().slice(0,10);
  await actions.request(owner,'POST','',{key:'synthetic-action-seed-'+Date.now(),title:'UI计时行动',period:'day',start_date:day,end_date:day,timezone:'UTC',target_minutes:20,minimum_minutes:5});res.end('{}');return;
 }
 if(url.pathname==='/__actions_snapshot'){res.end(JSON.stringify(await actions.request(owner,'GET','')));return;}
 if(url.pathname==='/__practice_drop_next'){dropPracticeResponse=true;res.end('{}');return;}
 if(url.pathname==='/__practice_seed'){
  offline=false;dropPracticeResponse=false;await repository.deleteOwnerData(owner);
  const link={...owner,source_account_id:'practice-native-'+testUser,binding_id:'practice-native-binding-'+testUser,phase:'active' as const};await repository.saveActionLink(link);
  const content='# 实践来源\n\n将结论先行用于一次真实汇报。',references='';
  const lesson={id:'lesson-practice-ui',collection_id:'practice-ui',collection_title:'实践验收课程',number:1,title:'结论先行',content,references,content_version:digest({content,references}),learning_state:'completed',source_url:'https://grow.example/#mobile/learn/lesson-practice-ui'};
  await receiveLibrary(actions,link,{action:'learning-library',action_schema_version:2,binding_id:link.binding_id,source_revision:1,observed_at:new Date().toISOString(),consent_enabled:true,lessons:[lesson]});
  res.end(JSON.stringify(lesson));return;
 }
 if(url.pathname==='/__actions_modes'){
  offline=false;await repository.deleteOwnerData(owner);const day=new Date().toISOString().slice(0,10);
  for(const mode of ['time','check'])await actions.request(owner,'POST','',{key:'synthetic-'+mode+'-'+Date.now(),title:mode==='time'?'UI计时行动':'UI勾选行动',period:'day',completion_mode:mode,start_date:day,end_date:day,timezone:'UTC'});
  const row=await actions.readWorkspace(owner);row.data.content_sources=[{kind:'plan',plan_id:'plan-native-ui',lesson_no:1}];await repository.saveActionWorkspace({...row,version:row.version+1});
  await actions.request(owner,'POST','',{key:'synthetic-content-'+Date.now(),title:'UI内容行动',period:'day',completion_mode:'content',target:{kind:'plan',plan_id:'plan-native-ui',lesson_no:1},start_date:null,end_date:null,timezone:'UTC'});
  const link={...owner,source_account_id:'native-ui-'+testUser,binding_id:'native-ui-binding-'+testUser,phase:'active' as const};await repository.saveActionLink(link);
  const first={total_lessons:1,published_lessons:1,completed_lessons:1,percent:100},second={total_lessons:1,published_lessons:0,completed_lessons:0,percent:0};
  await receiveLearningProgress(actions,link,{action:'learning-progress',action_schema_version:2,binding_id:link.binding_id,source_revision:1,observed_at:new Date().toISOString(),web_url:'http://127.0.0.1:61500/',plans:[{id:'plan-native-ui',name:'手机学习进度',version:1,status:'active',total_lessons:2,published_lessons:1,completed_lessons:1,percent:50,stages:[{number:1,title:'基础',...first},{number:2,title:'应用',...second}]}]});res.end('{}');return;
 }
 if(['/__learning_seed','/__learning_update','/__learning_revoke','/__private_seed'].includes(url.pathname)){
  offline=false;
  const source='reading-ui-'+testUser,binding='reading-ui-binding-'+testUser;
  if(['/__learning_seed','/__private_seed'].includes(url.pathname)){await repository.deleteOwnerData(owner);await repository.saveActionLink({...owner,source_account_id:source,binding_id:binding,phase:'staged'});}
  const link=await repository.getActionLink(source);if(!link)throw Error('Seed the synthetic reading binding first');
  const old=await repository.getLearningLibrary(owner),revision=Number(old?.source_revision??0)+1;
  const lessons=[1,2].map(n=>{const l=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/learning-lesson-sample-'+n+'.json',import.meta.url),'utf8')).data.lesson;
   l.id='lesson-private-'+n;l.collection_id='yingyu';l.collection_title='UI 来源英文课程';l.source_url='http://127.0.0.1:61500/#mobile/learn/'+l.id;
   if(url.pathname==='/__learning_update')l.content+='\n\n## Published revision two\n\nPlease review this updated source.';
   l.content_version=digest({content:l.content,references:l.references});return l;});
  const receipt=await receiveLibrary(actions,link,{action:'learning-library',action_schema_version:2,binding_id:binding,source_revision:revision,observed_at:new Date().toISOString(),consent_enabled:url.pathname!='/__learning_revoke',lessons:url.pathname==='/__learning_revoke'?[]:lessons});
  if(url.pathname==='/__private_seed')await exchangePrivate(actions,link,{action:'learning-private',action_schema_version:2,binding_id:binding,source_revision:1,enabled:true,lessons:lessons.map(l=>({id:l.id,content_version:l.content_version,draft_version:l.content_version,revision:1,notes:'Synthetic H5 note',answers:[{id:'exercise:1',prompt:'Explain the main idea',answer:'Synthetic H5 answer'}],questions:[{id:'exercise:1',prompt:'Explain the main idea',answer:''}],completed:false,completed_at:null,position:1,updated_at:new Date().toISOString()})),results:[]});
  res.end(JSON.stringify(receipt));return;
 }
 if(['/__private_apply','/__private_conflict','/__private_revoke'].includes(url.pathname)){
  const link=await repository.getOwnerActionLink(owner),row=await repository.getLearningPrivate(owner);if(!link||!row)throw Error('Seed private learning first');
  const lessons=structuredClone(row.lessons),results=[];
  for(const request of row.requests.filter((r:any)=>r.status==='pending')){const body=request.body,l=lessons.find((s:any)=>s.id===body.lesson_id);const conflict=url.pathname==='/__private_conflict';if(l){l.revision++;l.updated_at=new Date().toISOString();if(conflict)l.notes='H5 changed in another page';else{if(body.action==='save'){l.notes=body.notes;l.answers=body.answers};if(body.action==='complete'){l.completed=true;l.completed_at=new Date().toISOString()};if(body.action==='save'||body.action==='position')l.position=body.position;}}results.push({id:request.id,status:conflict?'conflict':'applied',error:conflict?'Source changed':''});}
  res.end(JSON.stringify(await exchangePrivate(actions,link,{action:'learning-private',action_schema_version:2,binding_id:link.binding_id,source_revision:row.source_revision+1,enabled:url.pathname!='/__private_revoke',lessons:url.pathname==='/__private_revoke'?[]:lessons,results:url.pathname==='/__private_revoke'?[]:results})));return;
 }
 if(url.pathname==='/__private_snapshot'){const row=await repository.getLearningPrivate(owner);res.end(JSON.stringify({pending:row?.requests.filter((r:any)=>r.status==='pending').length??0}));return;}
 if(url.pathname==='/__offline'){offline=true;res.end('{}');return;}
 if(url.pathname==='/__online'){offline=false;res.end('{}');return;}
 if(url.pathname==='/__health'){res.end(JSON.stringify({ok:true,offline}));return;}
 if(url.pathname==='/__conflict'){
  const rows=await repository.listRecords(owner);const row=rows.find(r=>r.id===url.searchParams.get('id'))??rows[0];
  if(!row)throw new Error('missing record');
  const {raw_text,record_date,prompt_kind,guided_answers,tags}=row.payload;
  await service.mutate(owner,row.id,'save',{raw_text:raw_text+' 云端改动',record_date,prompt_kind,guided_answers,tags,base_version:row.version},'ui-conflict-'+Date.now());res.end('{}');return;
 }
 if(offline){res.statusCode=503;res.end('{"code":"UNAVAILABLE","data":null}');return;}
 const buffers=[];for await(const chunk of req)buffers.push(chunk);
 const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])) as Record<string,string>;
 if(headers.authorization==='Bearer record-ui-only')headers.authorization='Bearer '+app.services.tokenService.issueAccessToken(owner.userId,'lighttick');
 const raw=Buffer.concat(buffers).toString();
 const result=await app.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers,body:raw?JSON.parse(raw):undefined} as any);
 if(dropPracticeResponse&&req.method==='POST'&&url.pathname==='/api/v1/lighttick/action-plans/practices'&&result.statusCode===200){dropPracticeResponse=false;res.statusCode=503;res.end('{"message":"Synthetic committed response lost"}');return;}
 if(url.pathname.endsWith('/private')){const data=(result.body as any)?.data;console.log(JSON.stringify({method:req.method,status:result.statusCode,revision:data?.state?.revision,submitted_revision:raw?JSON.parse(raw).revision:undefined,operations:data?.operations?.map((o:any)=>o.status)}));}
 res.statusCode=result.statusCode;res.end(JSON.stringify(result.body));
}catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}});
server.listen(testPort,'127.0.0.1',()=>console.log('Grow records UI harness on 127.0.0.1:3106 (synthetic owner, isolated PG)'));
process.on('SIGTERM',()=>server.close(()=>{void pool.end();}));
