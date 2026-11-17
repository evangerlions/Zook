import assert from "node:assert/strict";
import test from "node:test";
import { defaultSearchConfig } from "../../src/modules/ai-novel/search/search-config.ts";
import { DeepSeekSearchClient } from "../../src/modules/ai-novel/search/deepseek-search-client.ts";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";

test("encrypted search request forwards the original question to the provider", async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await f.runtime.services.commonPasswordConfigService.set('deepseek.web_search_api_key','fixture','fixture-only');
    const search = f.runtime.services.aiNovelLlmService.webSearch!;
    await search.config.save({...defaultSearchConfig,enabled:true});
    await f.runtime.services.appRegistryService.finalizeAccountRegion('ai_novel','user_alice','CN');
    (search as any).moderationReady = async () => true;
    (search as any).safety = { assertUserInputAllowed: async () => ({allowed:true,layer:'llm'}) };
    let upstream: any;
    (search as any).client = new DeepSeekSearchClient(async (_url, init) => {
      upstream = JSON.parse(init!.body as string);
      return Response.json({results:[]});
    });
    const payload = {sceneKey:'write_turn',agentProtocol:'pi-v1',toolCallId:'s1',query:'鲜切花 停电 保鲜',originalQuestion:'暴雨停电后，花店怎么保存鲜切花？'};
    const res = await fetch(`${f.url}/api/v1/ai_novel/ai/web-search`, {method:'POST',headers:{Authorization:`Bearer ${f.token}`,'X-App-Id':'ai_novel','X-App-Version':'1.8.0','Content-Type':'application/json'},body:JSON.stringify(encryptCreditsFixture(payload))});
    assert.equal(res.status, 200);
    assert.equal(decodeCreditsFixture(await res.json()).data.status, 'completed');
    assert.equal(upstream.ori_question, payload.originalQuestion);
    assert.equal((await search.usage.records())[0].input?.originalQuestion, payload.originalQuestion);
  } finally { await f.close(); await f.runtime.close(); }
});

test("independent search HTTP endpoint preserves authentication/encryption and version admission", async () => {
  const f = await startCreditsHttpRuntime();
  try {
    for (const [version, expected] of [["1.8.0", "unavailable"], ["1.7.9", "WEB_SEARCH_UNSUPPORTED"]]) {
      const response = await fetch(`${f.url}/api/v1/ai_novel/ai/web-search`, { method: "POST", headers: { Authorization: `Bearer ${f.token}`, "X-App-Id": "ai_novel", "X-App-Version": version, "Content-Type": "application/json" }, body: JSON.stringify(encryptCreditsFixture({ sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: "s1", query: "historical costume" })) });
      assert.equal(response.status, 200);
      const encrypted = await response.json(); assert.equal(encrypted.encrypted, true);
      const decoded = decodeCreditsFixture(encrypted);
      assert.equal(expected === "unavailable" ? decoded.data.status : decoded.code, expected);
    }
    const denied = await fetch(`${f.url}/api/v1/ai_novel/ai/web-search`, { method: "POST", headers: { "X-App-Id": "ai_novel", "Content-Type": "application/json" }, body: "{}" });
    assert.equal(denied.status, 401);
    await f.runtime.services.commonPasswordConfigService.set('deepseek.web_search_api_key','fixture','fixture-only');
    await f.runtime.services.aiNovelLlmService.webSearch!.config.save({...defaultSearchConfig,enabled:true});
    await f.runtime.services.appRegistryService.finalizeAccountRegion('ai_novel','user_alice','CN');
    const current=await f.runtime.services.commonContentSafetyConfigService.getCurrentConfig();
    await f.runtime.services.commonContentSafetyConfigService.updateConfig({...current,enabled:true,llm:{...current.llm,enabled:false}});
    const guarded=await fetch(`${f.url}/api/v1/ai_novel/ai/web-search`,{method:'POST',headers:{Authorization:`Bearer ${f.token}`,'X-App-Id':'ai_novel','X-App-Version':'1.8.0','Content-Type':'application/json'},body:JSON.stringify(encryptCreditsFixture({sceneKey:'write_turn',agentProtocol:'pi-v1',toolCallId:'s2',query:'reference'}))});
    assert.equal(decodeCreditsFixture(await guarded.json()).data.code,'MODERATION_UNAVAILABLE');
    assert.equal(f.calls(), 0);
  } finally { await f.close(); await f.runtime.close(); }
});


test('Admin search records require authentication and return saved input and output',async()=>{
 const credentials={username:'search-admin',password:'fixture-only-search-admin'};
 const f=await startCreditsHttpRuntime(0,'test',undefined,{adminBasicAuth:credentials});
 const base=`${f.url}/api/v1/admin/apps/ai_novel/web-search`;
 const auth=`Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`;
 const call=(path:string,method='GET',body?:unknown)=>fetch(base+path,{method,headers:{Authorization:auth,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 try {
  assert.equal((await fetch(base)).status,401);
  const initial=await(await call('')).json();assert.equal(initial.data.config.enabled,false);
  const saved=await(await call('','PUT',{config:{...defaultSearchConfig,dailyLimit:30},desc:'search test'})).json();
  assert.equal(saved.data.config.dailyLimit,30);assert.ok(saved.data.revisions.length);
  const revision=saved.data.revisions[0].revision;
  assert.equal((await call(`/revisions/${revision}`)).status,200);
  assert.equal((await call(`/revisions/${revision}/restore`,'POST',{})).status,200);
  const response=await(await call('/test','POST',{query:'PRIVATE QUERY',region:'CN'})).json();
  assert.equal(response.data.status,'unavailable');assert.equal(JSON.stringify(response).includes('PRIVATE QUERY'),false);
  await f.runtime.services.aiNovelLlmService.webSearch!.usage.record({ requestId:'record-1', userId:'u1', sceneKey:'write_turn', toolCallId:'s1', timestamp:new Date().toISOString(), status:'completed', returnedCount:0, filteredCount:0, latencyMs:1, provider:'deepseek', upstreamCalls:1, input:{sceneKey:'write_turn',agentProtocol:'pi-v1',toolCallId:'s1',query:'历史资料',limit:5},output:{status:'completed',results:[]} });
  assert.equal((await fetch(base+'/records')).status,401);
  const records=await(await call('/records')).json();
  assert.equal(records.data.items[0].input.query,'历史资料');
  assert.deepEqual(records.data.items[0].output,{status:'completed',results:[]});
  const bad=await call('','PUT',{config:{...defaultSearchConfig,secretRef:'plain-key'}});assert.equal(bad.status,400);
 } finally {await f.close();await f.runtime.close();}
});
