/** Synthetic test server only. Refuses non-local PostgreSQL and deletes its own owners on shutdown. */
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {createApplication} from './create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString||!['localhost','127.0.0.1'].includes(new URL(connectionString).hostname))throw Error('Disposable localhost PostgreSQL required');
await runPostgresMigrations({connectionString,log:()=>{}});
const pool=new Pool({connectionString}),repository=new PostgresLightTickRepository(pool),seed=buildDefaultSeed(undefined,{includeLightTick:true});
const owners=['alice','bob','carol','dave'].map(name=>({appId:'lighttick' as const,userId:'record-http-'+name+'-'+randomUUID()}));
for(const owner of owners){seed.users.push({...seed.users.find(u=>u.id==='user_alice')!,id:owner.userId,email:owner.userId+'@example.test'});seed.appUsers.push({id:randomUUID(),...owner,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});}
const app=await createApplication({seed,lighttickEnabled:true,lighttickRepository:repository});
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url!,'http://localhost');const buffers=[];for await(const chunk of req)buffers.push(chunk);const raw=Buffer.concat(buffers).toString();
 const result=await app.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers:req.headers,body:raw?JSON.parse(raw):undefined} as any);
 res.statusCode=result.statusCode;res.setHeader('content-type','application/json');res.end(JSON.stringify(result.body));
}catch(e){res.statusCode=500;res.end(JSON.stringify({message:String(e)}));}});
server.listen(0,'127.0.0.1',()=>console.log('READY '+JSON.stringify({port:(server.address() as any).port,owners:owners.map(owner=>({...owner,account:owner.userId+'@example.test',token:app.services.tokenService.issueAccessToken(owner.userId,'lighttick'),expired_token:app.services.tokenService.issueAccessToken(owner.userId,'lighttick',1,new Date(Date.now()-86400000))}))})));
process.on('SIGTERM',()=>server.close(async()=>{for(const owner of owners)await repository.deleteOwnerData(owner);await pool.end();process.exit(0);}));
