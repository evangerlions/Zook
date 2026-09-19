// Real-provider evaluation harness. No production data; human scores are never filled by this script.
import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {execFileSync} from "node:child_process";
import {BailianOpenAICompatibleProvider} from "../src/services/bailian-openai-compatible-provider.ts";
import {InMemoryLightTickRepository} from "../src/testing/in-memory-lighttick-repository.ts";
import {LightTickGoalService} from "../src/modules/lighttick/lighttick-goal.service.ts";
import {LightTickAiRunner} from "../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import {LIGHTTICK_AI_SCENES} from "../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import {LIGHTTICK_PROMPT_VERSION} from "../src/modules/lighttick/ai/lighttick-ai-prompts.ts";
const args=process.argv.slice(2);
const arg=(key:string)=>args[args.indexOf(key)+1];
const out=resolve(args.includes("--out")?arg("--out"):"/tmp/lighttick-planning-quality");
const fixture=JSON.parse(await readFile(args.includes("--inputs")?resolve(arg("--inputs")):new URL("../test/fixtures/lighttick-planning-quality-inputs.json",import.meta.url),"utf8"));
const dimensions=["relevance","actionability","observable_outcome","continuity","recovery_fit"];
const report:any={candidate:execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim(),promptVersion:LIGHTTICK_PROMPT_VERSION,
 startedAt:new Date().toISOString(),status:"prepared",realProviderCases:0,cases:fixture.cases.map((c:any)=>({...c,result:null,
 human:{reviewer:null,reviewedAt:null,scores:Object.fromEntries(dimensions.map(k=>[k,null])),naReasons:{},notes:null}}))};
await mkdir(out,{recursive:true});
if(!args.includes("--config")){
 await writeFile(resolve(out,"review.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
 process.stdout.write("Prepared "+report.cases.length+" cases. No provider called. Supply --config with a private provider configuration file.\n");
}else{
 let config:any;
 try { config=JSON.parse(await readFile(resolve(arg("--config")),"utf8")); } catch { throw new Error("Cannot read the private provider configuration."); }
 if(!config.apiKey||!config.model||!config.baseUrl||new URL(config.baseUrl).protocol!=="https:"||String(config.apiKey).includes("mock"))
  throw new Error("A real HTTPS provider configuration is required.");
 await writeFile(resolve(out,"review.json"),JSON.stringify(report,null,2),{flag:"wx",mode:0o600});
 const provider=new BailianOpenAICompatibleProvider({providerName:config.provider??"configured",baseUrl:config.baseUrl,apiKey:config.apiKey});
 report.provider={name:config.provider??"configured",model:config.model,endpointHost:new URL(config.baseUrl).hostname};
 for(const c of report.cases){
  const repository=new InMemoryLightTickRepository(),owner={appId:"lighttick" as const,userId:"quality-"+c.id};
  const goal=await new LightTickGoalService(repository).create(owner,{title:c.message.slice(0,200),constraints:c.request});
  const scene=LIGHTTICK_AI_SCENES[c.scene as keyof typeof LIGHTTICK_AI_SCENES];
  let raw:any,called=false;const started=Date.now();
  const llm={complete:async(request:any)=>{
   called=true;
   raw=await provider.complete({...request,model:{provider:config.provider??"configured",modelKey:request.modelKey,
    resolvedModelKey:request.modelKey,providerModel:config.model},signal:AbortSignal.timeout(scene.timeoutMs)});
   return raw;
  }};
  const now=new Date().toISOString();
  const queued=await repository.saveAiRun({...owner,id:"eval-"+c.id,kind:scene.kind,status:"queued",sceneKey:scene.key,promptVersion:LIGHTTICK_PROMPT_VERSION,
   schemaVersion:scene.schemaVersion,attemptCount:0,inputContext:{...c.request,goal_id:goal.id,message:c.message},usage:{},createdAt:now,updatedAt:now});
  try{
   const run=await new LightTickAiRunner(repository,llm as any).execute(owner,queued.id,c.scene);
   const usage=raw?.usage??null;
   const priced=usage&&Number.isFinite(usage.promptTokens)&&Number.isFinite(usage.completionTokens)&&Number.isFinite(config.inputPerMillion)&&Number.isFinite(config.outputPerMillion)&&config.inputPerMillion>=0&&config.outputPerMillion>=0;
   c.result={providerCalled:called,status:run.status,errorCode:run.errorCode??null,rawOutput:raw?.text??null,
    output:run.output??null,fallback:run.provider==="deterministic_template",latencyMs:Date.now()-started,usage,
    estimatedCost:priced?(usage.promptTokens*config.inputPerMillion+usage.completionTokens*config.outputPerMillion)/1e6:null,
    currency:priced?(config.currency??null):null,costSource:priced?"configured_rates":"unavailable"};
  }catch{c.result={providerCalled:called,status:"failed",errorCode:"EVALUATION_FAILED",latencyMs:Date.now()-started};}
  if(called && raw?.text)report.realProviderCases++;
  report.status="awaiting_human_review";
  await writeFile(resolve(out,"review.json"),JSON.stringify(report,null,2),{mode:0o600});
  process.stdout.write(c.id+": "+c.result.status+"; provider called="+called+"\n");
 }
 report.completedAt=new Date().toISOString();
 report.coverageSatisfied=report.realProviderCases>=20;
 await writeFile(resolve(out,"review.json"),JSON.stringify(report,null,2),{mode:0o600});
}
