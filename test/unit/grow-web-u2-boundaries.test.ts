import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../support/create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';

async function fixture(){
 const seed=buildDefaultSeed(undefined,{includeLightTick:true});
 for(const userId of ['user_alice','user_bob'])seed.appUsers.push({id:'u2-'+userId,appId:'lighttick',userId,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
 const app=await createApplication({seed,lighttickEnabled:true});const runtime=app.services.lighttickRuntime!;runtime.planningEnabled=true;runtime.actionsEnabled=true;runtime.actions=new ActionService(runtime.repository,()=>new Date(),undefined,true);
 const token=app.services.tokenService.issueAccessToken('user_alice','lighttick');
 const call=(path:string,method='GET',body?:unknown,key='u2-read',extra:Record<string,string>={})=>app.app.handle({path:'/api/v1/lighttick/'+path,method,body,headers:{authorization:'Bearer '+token,'x-app-id':'lighttick','x-lighttick-task-schema':'2','x-grow-action-schema':'2','idempotency-key':key,...extra}});
 return {app,runtime,call};
}
for(const revoked of ['BLOCKED','DELETED'] as const)test('U2 receipts and fresh commands respect '+revoked+' membership',async()=>{
 const {app,runtime,call}=await fixture();
 const goal=(await call('goals','POST',{title:'Synthetic owner goal'},'u2-goal-create')).body.data as any;
 const input={goal_id:goal.id};const session=(await call('planning-sessions','POST',input,'u2-planning')).body.data as any;
 const actionInput={title:'Synthetic action',period:'day',completion_mode:'check',key:'u2-action-create'};
 assert.equal((await call('action-plans','POST',actionInput)).statusCode,200);
 const reflection={goal_id:goal.id,period_start:'2030-01-01',period_end:'2030-01-07',content:'Synthetic reflection',next_action:'Next step',base_version:0};
 assert.equal((await call('reflections/u2-reflection','PUT',reflection)).statusCode,200);
 const before=JSON.stringify({session:await runtime.repository.getPlanningSession({appId:'lighttick',userId:'user_alice'},session.session.id),workspace:await runtime.repository.getActionWorkspace({appId:'lighttick',userId:'user_alice'}),reflections:await runtime.repository.listReflections({appId:'lighttick',userId:'user_alice'})});
 await app.database.updateAppUserStatus('lighttick','user_alice',revoked);
 for(const [path,method,body,key] of [
  ['planning-sessions','POST',input,'u2-planning'],['planning-sessions','POST',input,'u2-new-planning'],
  ['planning-sessions/'+session.session.id,'GET',undefined,'read'],['action-plans','GET',undefined,'read'],
  ['action-plans','POST',actionInput,'ignored-header'],['reflections/u2-reflection','PUT',reflection,'read'],
  ['goals/'+goal.id+'/lifecycle','POST',{base_version:goal.version,action:'pause'},'u2-new-pause'],
  ['goals/'+goal.id+'/conditions','POST',{},'u2-condition'],['manual-plans','POST',{},'u2-manual'],
 ] as const){const result=await call(path,method,body,key);assert.equal(result.statusCode,403,path+JSON.stringify(result.body));}
 assert.equal(JSON.stringify({session:await runtime.repository.getPlanningSession({appId:'lighttick',userId:'user_alice'},session.session.id),workspace:await runtime.repository.getActionWorkspace({appId:'lighttick',userId:'user_alice'}),reflections:await runtime.repository.listReflections({appId:'lighttick',userId:'user_alice'})}),before);
});
test('old action writer is gated, foreign session is private, and generic push cannot duplicate U2 domain commands',async()=>{
 const {app,runtime,call}=await fixture();
 const goal=(await call('goals','POST',{title:'Compatibility goal'},'compat-goal')).body.data as any;
 const created=(await call('planning-sessions','POST',{goal_id:goal.id},'compat-session')).body.data as any;
 const bob=app.services.tokenService.issueAccessToken('user_bob','lighttick');
 assert.equal((await call('planning-sessions/'+created.session.id,'GET',undefined,'read',{authorization:'Bearer '+bob})).statusCode,404);
 assert.equal((await call('action-plans','POST',{title:'Old writer',period:'day',completion_mode:'check',key:'old-writer' },'ignored',{'x-grow-action-schema':'1'})).statusCode,409);
 assert.equal((await call('action-plans')).statusCode,200);
 for(const entity of ['record','goal','plan','planning_session','action_workspace','reflection']){
  const op={operation_id:'u2-push-'+entity,device_id:'synthetic',entity_type:entity,entity_id:goal.id,action:'create',base_version:0,client_occurred_at:new Date().toISOString(),payload:{}};
  const result=await runtime.sync.push({appId:'lighttick',userId:'user_alice'},[op]);
  assert.equal((result as any).results[0].status,'rejected',entity);
 }
 assert.equal((await runtime.repository.listPlans({appId:'lighttick',userId:'user_alice'})).length,0);
});
test('REST receipts are bound to the reviewed resource as well as action and body',async()=>{
 const {runtime,call}=await fixture(),owner={appId:'lighttick' as const,userId:'user_alice'};
 const a=await runtime.goals.create(owner,{title:'First goal',constraints:{}}),b=await runtime.goals.create(owner,{title:'Second goal',constraints:{}});
 const first=await runtime.goals.transition(owner,a.id,a.version,'resume',{resumeMode:'original_pace'});
 const second=await runtime.goals.transition(owner,b.id,b.version,'resume',{resumeMode:'original_pace'});
 const body={base_version:first.version,action:'pause',reason:'Review pace'};
 assert.equal((await call('goals/'+a.id+'/lifecycle','POST',body,'owner-resource-key')).statusCode,200);
 const crossed=await call('goals/'+b.id+'/lifecycle','POST',{...body,base_version:second.version},'owner-resource-key');
 assert.equal(crossed.statusCode,409,JSON.stringify(crossed.body));
 assert.equal(crossed.body.code,'LIGHTTICK_IDEMPOTENCY_MISMATCH');
 assert.equal((await runtime.repository.getGoal(owner,b.id))!.status,'active');
});
