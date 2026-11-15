import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { ManualLoginSessions } from "../../src/modules/billing-accounts/manual/login-sessions.ts";
import { SessionVault } from "../../src/modules/billing-accounts/manual/session-vault.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
async function fixture() {
 const kv=await KVManager.create({backend:new InMemoryKVBackend()}); const store=new AccountStore(kv,["key"]);
 const a=await store.save({name:"Manual",type:"geyan",providers:[],alerts:false,warning:1,critical:0});
 const state={needsChallenge:false,selected:true,logged:false,resets:0,typed:[] as any[],closed:0,samples:[] as any[]};
 const vault=new SessionVault(kv,["key"]);
 const manager=new ManualLoginSessions(kv,store,{recordManual:async(_id:any,result:any,_now:any,revision:any)=>{state.samples.push({result,revision});return result;}} as any,vault,
  async(id,accountId,owner,provider,saved)=>{
   state.logged=Boolean(saved);
   return {id,accountId,owner,provider,exclusive:async fn=>fn(),view:async()=>({sessionId:id,image:"",width:1120,height:760,expiresAt:"2030"}),
    resetLogin:async()=>{state.resets++;state.logged=false;state.selected=true;},
    input:async action=>{if(action.kind==="credentials"){if(!state.selected)throw new ApplicationError(409,"REQ_INVALID_BODY","Select password mode");state.typed.push(action);state.logged=!state.needsChallenge;}else if(action.kind==="text")state.logged=true;},
    read:async()=>state.logged?{status:"ok",metrics:[{kind:"manual_console_balance",scope:"account",unit:"次",remaining:42}]}:{status:"error",metrics:[]},
    state:async()=>JSON.stringify({storageState:{cookies:[],origins:[]},sessionStorage:{},pageUrl:"https://dev.getui.com/#/gy/usage"}),close:async()=>{state.closed++;}};
  });
 return {kv,store,a,state,manager};
}
test("saved credentials auto-login, query and persist sample; next refresh reuses saved browser state",async()=>{
 const {store,a,state,manager}=await fixture();
 try {
  await store.saveLogin(a.id,{username:"saved-user",password:"saved-pass"});
  const first=await manager.start(a.id,"admin");assert.equal(first.completed,true);assert.equal(state.typed.length,1);assert.equal(state.samples[0].result.metrics[0].remaining,42);assert.equal(state.closed,1);
  const next=await manager.start(a.id,"admin");assert.equal(next.completed,true);assert.equal(state.typed.length,1);
 } finally{await manager.close();}
});
test("saved credentials remain configured on mode mismatch; retry preserves selected mode, verification resumes automatic reading",async()=>{
 const {store,a,state,manager}=await fixture();
 try {
  const view=await manager.start(a.id,"admin");state.selected=false;
  const pending=await manager.operate(a.id,view.sessionId,"admin","input",{kind:"credentials",username:"user",password:"password"}) as any;
  assert.equal(pending.loginConfigured,true);assert.equal(pending.notice,"Select password mode");assert.deepEqual(await store.login(a.id),{username:"user",password:"password"});
  state.selected=true;state.needsChallenge=true;
  const challenged=await manager.operate(a.id,view.sessionId,"admin","input",{kind:"credentials"}) as any;
  assert.equal(challenged.completed,false);assert.equal(state.resets,0);
  const verified=await manager.operate(a.id,view.sessionId,"admin","input",{kind:"text",text:"test-code"}) as any;
  assert.equal(verified.completed,true);assert.equal(state.samples.length,1);
 }finally{await manager.close();}
});
