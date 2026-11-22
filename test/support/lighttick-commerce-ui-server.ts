/** Local synthetic Alipay boundary; real HTTP auth, Zook commands and PostgreSQL. Never real payment. */
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {Pool} from 'pg';
import {createApplication} from './create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL,webRoot=process.env.LIGHTTICK_TEST_WEB_ROOT;
if(!dsn||!webRoot||new URL(dsn).hostname!=='127.0.0.1'||!new URL(dsn).pathname.startsWith('/grow_web_u1_commerce_ui_'))throw Error('Dedicated local fixture DB required');
await runPostgresMigrations({connectionString:dsn,log:()=>{}});const pool=new Pool({connectionString:dsn});const repo=new PostgresLightTickRepository(pool);
const seed=buildDefaultSeed(undefined,{includeLightTick:true});const owner={appId:'lighttick' as const,userId:'user_alice'};
seed.appUsers.push({...owner,id:'commerce-browser',status:'ACTIVE',accountRegion:'CN',joinedAt:new Date().toISOString()});
const record=seed.appConfigs.find(c=>c.appId==='lighttick'&&c.configKey==='admin.delivery_config')!;const config=JSON.parse(record.configValue);config.settings.runtimeScope='full';config.billing.limits={basic:128,premium:512,professional:1024};record.configValue=JSON.stringify(config);
let paid=false,queryCount=0,drop=false;
const gateway={checkout:async()=>({type:'page' as const,url:'https://openapi.alipay.com/gateway.do?synthetic-checkout-only=true'}),verifyNotify:async()=>false,query:async(id:string)=>{queryCount++;const o=await repo.findMerchantPaymentOrder(id);return paid?{code:'10000',out_trade_no:id,total_amount:(o!.amountMinor/100).toFixed(2),trade_no:'synthetic-'+id,trade_status:'TRADE_SUCCESS',send_pay_date:new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ')}:{code:'10000',out_trade_no:id,total_amount:(o!.amountMinor/100).toFixed(2),trade_no:'synthetic-'+id,trade_status:'WAIT_BUYER_PAY'};}};
const runtime=await createApplication({seed,lighttickEnabled:true,lighttickRepository:repo,lighttickAlipay:{production:{appId:'synthetic-merchant',gateway}}});const lighttick=runtime.services.lighttickRuntime!;
await repo.deleteOwnerData(owner);await pool.query('DELETE FROM zook_lighttick_payment_orders WHERE user_id=$1',[owner.userId]);lighttick.nativeLearning.enabled=true;
await lighttick.nativeLearning.authority(owner);
await repo.saveLearningCollection({...owner,id:'commerce-course',title:'配额验收课程',description:'',revision:1,archived:false,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()} as any,0);
const {createServer:createVite}=await import(pathToFileURL(join(webRoot,'node_modules/vite/dist/node/index.js')).href);const vite=await createVite({configFile:false,root:webRoot,base:'/grow/',server:{middlewareMode:true},appType:'spa'});
const server=createServer(async(req,res)=>{const url=new URL(req.url!,'http://127.0.0.1:3199');try {
 res.setHeader('cache-control','no-store');
 if(url.pathname==='/__commerce/drop'){drop=true;res.end('ok');return;}
 if(url.pathname==='/__commerce/release'){drop=false;res.end('ok');return;}
 if(url.pathname==='/__commerce/pay'){paid=true;res.end('ok');return;}
 if(url.pathname==='/__commerce/core'){config.settings.runtimeScope='core';config.billing.prices={};await runtime.services.appConfigService.setValue('lighttick','admin.delivery_config',JSON.stringify(config));res.end('ok');return;}
 if(url.pathname==='/__commerce/stats'){const orders=await repo.listPaymentOrders(owner,'production');res.setHeader('content-type','application/json');res.end(JSON.stringify({orders:orders.length,queryCount,usage:await repo.getStorageUsage(owner),publications:(await repo.getNativeLearningCounts(owner)).publications}));return;}
 if(!url.pathname.startsWith('/api/')){vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});return;}
 res.setHeader('content-type','application/json');
 if(url.pathname==='/api/v1/auth/refresh'){res.end(JSON.stringify({code:'OK',message:'',requestId:'fixture',data:{accessToken:runtime.services.tokenService.issueAccessToken(owner.userId,'lighttick'),user:{id:owner.userId,displayName:'合成购买验收'}}}));return;}
 let raw='';for await(const c of req)raw+=c;const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));
 const result=await runtime.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers,body:raw?JSON.parse(raw):undefined} as any);
 if(drop&&req.method==='POST'&&url.pathname.endsWith('/billing/orders')){res.destroy();return;}
 res.statusCode=result.statusCode;res.end(JSON.stringify(result.body));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({code:'FIXTURE_FAILURE',message:(error as Error).message}));}});
server.listen(Number(process.env.COMMERCE_UI_PORT??3199),'127.0.0.1',()=>console.log(`Commerce fixture ready http://127.0.0.1:${process.env.COMMERCE_UI_PORT??3199}/grow/`));
async function stop(){server.close();await vite.close();await pool.end();process.exit();}process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
