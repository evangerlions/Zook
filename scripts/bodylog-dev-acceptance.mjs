import {writeFile} from 'node:fs/promises';
const base=new URL(process.env.BODYLOG_QA_BASE_URL??'https://app-dev.youwoai.net');
if(base.username||base.password||base.pathname!=='/'||base.search||base.hash||
 !(base.protocol==='https:'||(base.protocol==='http:'&&['127.0.0.1','localhost'].includes(base.hostname))))throw new Error('Use a clean HTTPS origin or loopback origin.');
const expected=process.env.BODYLOG_EXPECTED_VERSION;
if(!expected)throw new Error('BODYLOG_EXPECTED_VERSION is required; health alone is not a release gate.');
const checks=[];const check=(name,passed)=>checks.push({name,passed});
async function request(path,body,token,key){const r=await fetch(new URL(path,base),{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-App-ID':'bodylog',...(token?{Authorization:`Bearer ${token}`} :{}),...(key?{'Idempotency-Key':key}:{})},body:body===undefined?undefined:JSON.stringify(body),redirect:'manual',signal:AbortSignal.timeout(15000)});let value;try{value=await r.json();}catch{}return {status:r.status,value};}
let cleanupPair,aliceToken;
try {
 const health=await request('/api/health');check('expected deployed version',health.status===200&&health.value?.data?.version===expected);
 const flags=await request('/api/v1/bodylog/public/config');
 for(const name of ['buddyDeliveryV2','invitationManagement','retentionLedger'])check(`capability ${name}`,flags.status===200&&flags.value?.data?.[name]===true);
 for(const path of ['/entitlements','/missions','/rewards','/retention/assignment'])check(`Bearer required ${path}`,(await request('/api/v1/bodylog'+path)).status===401);
 const tokens=[];
 for(const name of ['A','B']){
  const account=process.env[`QA_${name}_EMAIL`],password=process.env[`QA_${name}_PASSWORD`];
  if(!account||!password)throw new Error('Both reserved QA account credentials are required.');
  const auth=await request('/api/v1/auth/login',{appId:'bodylog',account,password,clientType:'app'});
  check(`password login ${name}`,auth.status===200&&Boolean(auth.value?.data?.accessToken));
  if(auth.status!==200)throw new Error('QA login failed.');
  const token=auth.value.data.accessToken;tokens.push({token,user:auth.value.data.user.id});
  for(const path of ['/profile','/invitations','/buddies','/entitlements','/missions','/rewards','/campaigns/active'])check(`account ${name} read ${path}`,(await request('/api/v1/bodylog'+path,undefined,token)).status===200);
 }
 check('distinct authenticated accounts',tokens[0].user!==tokens[1].user);
 const assignment=await request('/api/v1/bodylog/retention/assignment',undefined,tokens[0].token);
 check('no unreviewed experiment enabled',assignment.value?.data?.experimentId==='disabled');
 if(process.env.BODYLOG_QA_MUTATIONS==='1'){
  if(!['localhost','127.0.0.1','app-dev.youwoai.net'].includes(base.hostname))throw new Error('Mutation gate is limited to loopback and the named dev slot.');
  aliceToken=tokens[0].token;
  const prior=await request('/api/v1/bodylog/buddies',undefined,aliceToken);
  if(prior.value?.data?.buddies?.some(row=>row.partnerUserId===tokens[1].user))throw new Error('Existing pair preserved. Use reserved accounts without an active/pending pair.');
  const made=await request('/api/v1/bodylog/buddies',{partnerUserId:tokens[1].user,sharedHabitIds:['habit-read']},aliceToken);
  cleanupPair=made.value?.data?.pair?.id;check('create addressed pair',made.status===200&&Boolean(cleanupPair));
  if(!cleanupPair)throw new Error('Pair was not confirmed.');
  check('recipient accepts pair',(await request(`/api/v1/bodylog/buddies/${cleanupPair}/accept`,{},tokens[1].token)).status===200);
  const key=crypto.randomUUID(),body={pairId:cleanupPair,emoji:'💪',isSameAction:false};
  const first=await request('/api/v1/bodylog/buddies/encouragements',body,aliceToken,key),again=await request('/api/v1/bodylog/buddies/encouragements',body,aliceToken,key);
  check('durable encouragement confirmation',first.status===200&&again.status===200&&first.value?.data?.id===again.value?.data?.id);
 }
}catch(error){checks.push({name:'acceptance completed',passed:false,detail:error instanceof Error?error.message:'Acceptance failed.'});}
finally{if(cleanupPair&&aliceToken){try{check('only this run pair dissolved',(await request(`/api/v1/bodylog/buddies/${cleanupPair}/dissolve`,{},aliceToken)).status===200);}catch{check('only this run pair dissolved',false);}}}
const report={at:new Date().toISOString(),origin:base.origin,expectedVersion:expected,mutations:process.env.BODYLOG_QA_MUTATIONS==='1',passed:checks.every(row=>row.passed),checks};
if(process.env.BODYLOG_ACCEPTANCE_REPORT)await writeFile(process.env.BODYLOG_ACCEPTANCE_REPORT,JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
