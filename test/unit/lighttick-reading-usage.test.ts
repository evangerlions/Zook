import test from "node:test";import assert from "node:assert/strict";
import {InMemoryLightTickRepository} from "../../src/testing/in-memory-lighttick-repository.ts";
import {InMemoryJobQueue} from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import {ReadingWorkService} from "../../src/modules/lighttick/reading/reading-work.service.ts";
test("pending reading capacity spans UTC boundaries without reading historical output payloads",async()=>{
 const repo=new InMemoryLightTickRepository(),owner={appId:"lighttick" as const,userId:"usage-midnight-owner"};let now=new Date("2026-11-11T23:59:00Z");const work=new ReadingWorkService(repo,new InMemoryJobQueue(),async()=>{},()=>now);
 const first=await work.create(owner,{kind:"collect_url",url:"https://example.com/first",title:"First"},"usage-original-first");now=new Date("2026-11-12T00:01:00Z");
 await work.create(owner,{kind:"collect_url",url:"https://example.com/second",title:"Second"},"usage-original-second");
 const usage=await work.store.usage(owner,"2026-11-12T00:00:00Z",now.toISOString());assert.deepEqual(usage,{daily:1,ai_daily:0,pending:2,running:0});
 await assert.rejects(work.create(owner,{kind:"collect_url",url:"https://example.com/third",title:"Third"},"usage-original-third"),{statusCode:429});
 assert.deepEqual(await work.create(owner,{kind:"collect_url",url:"https://example.com/first",title:"First"},"usage-original-first"),first);
});

