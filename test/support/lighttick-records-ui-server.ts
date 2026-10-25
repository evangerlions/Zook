/** Local-only native acceptance harness. Never deploy: uses synthetic identity and a disposable PostgreSQL URL. */
import {createServer} from 'node:http';
import {Pool} from 'pg';
import {createApplication} from './create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
const connectionString=process.env.GROW_RECORDS_UI_DATABASE_URL;
if(!connectionString||!['localhost','127.0.0.1'].includes(new URL(connectionString).hostname))throw new Error('Explicit disposable localhost GROW_RECORDS_UI_DATABASE_URL required');
await runPostgresMigrations({connectionString,log:()=>{}});
const pool=new Pool({connectionString}),repository=new PostgresLightTickRepository(pool),service=new LightTickRecordService(repository);
const testPort=Number(process.env.GROW_RECORDS_UI_PORT??3106),testUser=process.env.GROW_RECORDS_UI_OWNER??'user_alice';
if(!Number.isInteger(testPort)||testPort<1024||testPort>65535||!['user_alice','user_bob'].includes(testUser))throw Error('Synthetic fixture configuration invalid');
const owner={appId:'lighttick' as const,userId:testUser};const seed=buildDefaultSeed(undefined,{includeLightTick:true});
seed.appUsers.push({id:'record-ui-member',...owner,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
const app=await createApplication({seed,lighttickEnabled:true,lighttickRepository:repository});
const token=app.services.tokenService.issueAccessToken(owner.userId,'lighttick');let offline=false;
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url!,'http://localhost:3106');res.setHeader('Content-Type','application/json');
 if(url.pathname==='/__reset'){offline=false;await repository.deleteOwnerData(owner);res.end('{}');return;}
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
 if(headers.authorization==='Bearer record-ui-only')headers.authorization='Bearer '+token;
 const raw=Buffer.concat(buffers).toString();
 const result=await app.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers,body:raw?JSON.parse(raw):undefined} as any);
 res.statusCode=result.statusCode;res.end(JSON.stringify(result.body));
}catch(error){res.statusCode=500;res.end(JSON.stringify({error:String(error)}));}});
server.listen(testPort,'127.0.0.1',()=>console.log('Grow records UI harness on 127.0.0.1:3106 (synthetic owner, isolated PG)'));
process.on('SIGTERM',()=>server.close(()=>{void pool.end();}));
