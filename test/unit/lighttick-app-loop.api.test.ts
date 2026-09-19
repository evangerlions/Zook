import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { createApplication } from '../support/create-test-application.ts';
import { LightTickAiRunner } from '../../src/modules/lighttick/ai/lighttick-ai-runner.ts';
import { LightTickWorker } from '../../src/modules/lighttick/lighttick-worker.ts';

test('HTTP loop: clarify context -> AI draft -> confirm -> Today -> complete -> grounded daily review -> proposed diff -> accept -> refreshed Today',async()=>{
 const seed=buildDefaultSeed(undefined,{includeLightTick:true});seed.appUsers.push({id:'loop-member',appId:'lighttick',userId:'user_alice',status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
 const app=await createApplication({seed,lighttickEnabled:true});const rt=app.services.lighttickRuntime;rt.planningEnabled=true;
 const owner={appId:'lighttick' as const,userId:'user_alice'};
 const headers={authorization:'Bearer '+app.services.tokenService.issueAccessToken(owner.userId,'lighttick'),'x-app-id':'lighttick'};
 let seq=0;const call=async(path:string,method:any='GET',body?:any)=>{const r=await app.app.handle({method,path:'/api/v1/lighttick/'+path,headers:{...headers,'idempotency-key':'loop-operation-'+(++seq)},body});assert.ok(r.statusCode<400,JSON.stringify({path,body:r.body}));return r.body.data as any;};
 const day=new Date().toISOString().slice(0,10);const goal=await call('goals','POST',{title:'提高工作思维与沟通能力',constraints:{weekly_available_minutes:60,pace:'balanced'}});
 let session=(await call('planning-sessions','POST',{goal_id:goal.id})).session;
 session=(await call(`planning-sessions/${session.id}/context`,'PATCH',{base_version:session.version,fields:{period_start:{value:day,source:'user'},period_end:{value:day,source:'user'},outcome:{value:'提交一份有证据和取舍的汇报',source:'user'}}})).session;
 let mode='plan';let remainingTask='';let reviewContext:any;
 rt.worker=new LightTickWorker(new LightTickAiRunner(rt.repository,{complete:async(input:any)=>{
  const context=JSON.parse(input.messages[1].content.split('INPUT_JSON=')[1]);
  let output:any;
  if(mode==='plan') output={summary:'先核实事实，再比较方案',assumptions:[],tasks:[{title:'写事实与未知清单',estimated_minutes:15,scheduled_for:day,completion_criteria:'列出三个事实和一个未知',steps:['阅读项目记录','区分事实与假设'],guidance:{purpose:'训练证据推理',materials:['自己的项目记录'],expected_output:'事实清单'}},{title:'比较两个方案',estimated_minutes:20,scheduled_for:day,completion_criteria:'两个方案均说明收益风险',steps:['列出两个方案','说明取舍']}]};
  else if(mode==='review'){reviewContext=context;output={insights:['已完成事实清单；没有证据证明整体能力达成'],recommendations:['下一步先用简短表格比较两个方案']};}
  else output={diff:[{action:'update_task',task_id:remainingTask,title:'用两行表比较两个方案',estimated_minutes:10}],impact:{reason:'缩小产出形式，保留方案比较目的'}};
  return {provider:'deterministic-test',providerModel:'test',text:JSON.stringify(output)};
 }} as any));
 const process=()=>app.queue.processDueJobs(job=>rt.worker!.process(job),new Date('2030-01-01'));
 await call(`planning-sessions/${session.id}/drafts`,'POST',{base_version:session.version,context_revision:session.context_revision,deep_planning:true});await process();
 session=await call(`planning-sessions/${session.id}`);const plan=await call(`plans/${session.draft_plan_id}`);
 assert.equal((await rt.repository.listTasks(owner)).length,0);assert.equal(plan.proposal.tasks[0].steps.length,2);
 await call(`planning-sessions/${session.id}/confirm`,'POST',{base_version:session.version,context_revision:session.context_revision,draft_plan_id:plan.id,plan_version:plan.version});
 let today=await call('today');const tasks=await rt.repository.listTasks(owner,plan.id);const first=tasks.find(t=>t.title==='写事实与未知清单')!;remainingTask=tasks.find(t=>t.id!==first.id)!.id;
 const visible=(today.executable_tasks??today.tasks??[]).find((t:any)=>t.id===first.id);assert.ok(visible,JSON.stringify(today));assert.equal(visible.steps.length,2);assert.equal(visible.guidance.expected_output,'事实清单');
 await call(`tasks/${first.id}/complete`,'POST',{base_version:first.version,actual_duration_minutes:12,note:'仅本地呈现的私人备注'});
 mode='review';const run=await call('review-runs','POST',{goal_id:goal.id,period:'daily',period_start:day,period_end:day,self_reflection:'今天没时间写长方案，希望缩短产出'});await process();
 const finished=await call(`runs/${run.id}`);const review=await call(`reviews/${finished.result_resource_id}`);
 assert.equal(review.period,'daily');assert.equal(reviewContext.review.facts.event_counts.task_complete,1);assert.equal(reviewContext.request.self_reflection,'今天没时间写长方案，希望缩短产出');assert.ok(!JSON.stringify(reviewContext).includes('私人备注'));
 mode='proposal';const pendingRun=await call('change-proposal-runs','POST',{plan_id:plan.id,base_version:plan.version+1,reason:'low_energy',review_id:review.id});await process();
 const proposed=await call(`runs/${pendingRun.id}`);const proposal=await call(`change-proposals/${proposed.result_resource_id}`);
 assert.equal((await rt.repository.getTask(owner,remainingTask))!.estimatedMinutes,20);
 await call(`change-proposals/${proposal.id}/accept`,'POST',{base_version:proposal.version});
 today=await call('today');const adjusted=(today.executable_tasks??today.tasks??[]).find((t:any)=>t.id===remainingTask);assert.equal(adjusted.estimated_duration_minutes,10);assert.equal(adjusted.title,'用两行表比较两个方案');
 assert.equal((await rt.repository.getTask(owner,first.id))!.status,'completed');assert.equal((await rt.repository.listTaskSteps(owner,first.id)).length,2);
});
