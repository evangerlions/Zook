import test from 'node:test';import assert from 'node:assert/strict';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {receiveLearningProgress} from '../../src/modules/lighttick/actions/action-learning-progress.ts';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
test('only the active bound source updates progress; replay, revisions and stage totals are protected',async()=>{
 const repo=new InMemoryLightTickRepository(),actions=new ActionService(repo,()=>new Date('2026-10-25T10:00:00Z'));
 const link={appId:'lighttick',userId:'alice',source_account_id:'grow-alice',binding_id:'bound-alice',phase:'active'} as const;await repo.saveActionLink(link);
 const counts={total_lessons:2,published_lessons:1,completed_lessons:1,percent:50};
 const input={action:'learning-progress',action_schema_version:2,binding_id:link.binding_id,source_revision:1,observed_at:'2026-10-25T10:00:00Z',web_url:'https://grow.example/',plans:[{id:'plan-test',name:'正式规划',version:1,status:'active',...counts,stages:[{number:1,title:'阶段一',...counts}]}]};
 const first=await receiveLearningProgress(actions,link,input);assert.deepEqual(await receiveLearningProgress(actions,link,input),first);assert.equal((await actions.readWorkspace(link)).version,1);
 assert.equal(((await actions.request(link,'GET','/learning-progress')) as any).progress.plans[0].percent,50);
 assert.equal(((await actions.request({...link,userId:'bob'},'GET','/learning-progress')) as any).progress,null);
 await assert.rejects(receiveLearningProgress(actions,link,{...input,binding_id:'someone-else'}));
 await assert.rejects(receiveLearningProgress(actions,link,{...input,source_revision:2,plans:[{...input.plans[0],percent:100}]}));
 await assert.rejects(receiveLearningProgress(actions,link,{...input,source_revision:2,web_url:'https://token@other.example/'}));
 await receiveLearningProgress(actions,link,{...input,source_revision:2});await assert.rejects(receiveLearningProgress(actions,link,input));
 await repo.saveActionLink({...link,phase:'staged'});await assert.rejects(receiveLearningProgress(actions,link,{...input,source_revision:3}));
});
