import test from 'node:test';
import assert from 'node:assert/strict';
import {LightTickReflectionAssistService} from '../../src/modules/lighttick/lighttick-reflection-assist.service.ts';
const owner={appId:'lighttick',userId:'core-test'};
const input={reflection_id:'reflection-core',kind:'clarify' as const,text:'今天开会没有解释清楚需求，我想先确认听众背景。'};
const repo:any={personalModels:{get:async()=>({mode:'personal',revision:4})}};
test('reflection assist reports failure when no model exists instead of simulated success',async()=>{
 const r=await new LightTickReflectionAssistService(repo).assist(owner,input);assert.equal(r.status,'failed');assert.equal(r.questions,undefined);
});
test('reflection assist preserves personal model selection and returns actual structured output',async()=>{
 let request:any;
 const r=await new LightTickReflectionAssistService(repo,{complete:async(r:any)=>{request=r;return {text:JSON.stringify({questions:[{id:'q1',text:'你如何确认听众背景？'}]})} as any;}}).assist(owner,input);
 assert.equal(r.status,'ready');assert.equal(r.questions?.[0].text,'你如何确认听众背景？');assert.deepEqual(request.providerOptions.zookLightTickModelSelection,{mode:'personal',revision:4});
});
test('reflection provider failure never creates a ready template',async()=>{
 const r=await new LightTickReflectionAssistService(repo,{complete:async()=>{throw Error('offline')}}).assist(owner,input);assert.equal(r.status,'failed');assert.equal(r.sections,undefined);
});

import { personalThinkingOptions } from '../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts';
test('Ark bounded scenes explicitly disable default reasoning without changing other providers',()=>{
 assert.deepEqual(personalThinkingOptions('https://ark.cn-beijing.volces.com/api/plan/v3',{enable_thinking:false}),{thinking:{type:'disabled'}});
 assert.deepEqual(personalThinkingOptions('https://example.com/v1',{enable_thinking:false}),{});
 assert.deepEqual(personalThinkingOptions('https://ark.cn-beijing.volces.com/api/plan/v3'),{});
});
