import { finalizeLearningWork } from "./learning-work-finalize.ts";
import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { randomUUID } from "node:crypto";
import type { LLMManager } from "../../../services/llm-manager.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import type { LearningWork } from "./learning-work.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, LearningWorkService } from "./learning-work.service.ts";
import { collectLearningSources, type LearningSourceAdapters } from "./learning-sources.ts";
import { digest, fail } from "./native-learning.validation.ts";
import { learningGenerationScene, prepareLearningGeneration, validateLearningGeneration } from "./learning-work-generation.ts";

export class LearningWorkRunner {
  constructor(readonly service:LearningWorkService,readonly llm:Pick<LLMManager,'complete'>,readonly sources:LearningSourceAdapters,
    readonly authorizeOwner:(owner:LightTickOwner)=>Promise<void>=async()=>{},
    readonly resolveScene=async(name:LightTickAiSceneName)=>LIGHTTICK_AI_SCENES[name]){}
  get native(){return this.service.native;}
  get repo(){return this.native.repository;}
  async recover(){
    const rows=await this.service.store.recoverable(this.native.clock().toISOString(),100);
    for(const row of rows)await this.service.dispatch(row,row.id);
    return rows.length;
  }
  private async claim(owner:LightTickOwner,id:string){
    return this.repo.transaction(owner,async()=>{
      const row=await this.service.store.get(owner,id),now=this.native.clock().toISOString();
      if(!row||row.browserGenerationId||['succeeded','failed','cancelled'].includes(row.status)||row.status==='running'&&row.leaseUntil!>now)return;
      if(row.attempt>=LEARNING_WORK_LIMITS.attempts){await this.service.store.save({...row,revision:row.revision+1,status:'failed',fence:null,leaseUntil:null,errorCode:'ATTEMPTS_EXHAUSTED',updatedAt:now},row.revision);return;}
      const active=(await this.service.store.recent(owner,'1970-01-01T00:00:00.000Z')).filter(r=>r.status==='running'&&r.leaseUntil!>now);
      if(active.length>=LEARNING_WORK_LIMITS.concurrentPerOwner)return;
      const claimed:LearningWork={...row,revision:row.revision+1,status:'running',attempt:row.attempt+1,fence:randomUUID(),leaseUntil:new Date(this.native.clock().getTime()+LEARNING_WORK_LIMITS.leaseMs).toISOString(),errorCode:null,updatedAt:now};
      await this.service.store.save(claimed,row.revision);return claimed;
    });
  }
  private async check(work:LearningWork){
    await this.authorizeOwner(work);
    const current=await this.service.store.get(work,work.id),a=await this.repo.getLearningAuthority(work),r=await this.repo.learningRoutes.getLearningRoute(work,work.routeId);
    if(!current||current.status!=='running'||current.fence!==work.fence||!this.native.enabled||!a?.readingEnabled||(work.kind==='report_review'&&!a.privateEnabled)||a.phase!=='zook'||a.epoch!==work.epoch||
      (work.kind!=='report_review'&&((r?.revision??0)!==work.baseRouteRevision||r?.status==='archived'))||current.leaseUntil!<=this.native.clock().toISOString())throw Error('LEARNING_CONTEXT_STALE');
  }
  async execute(owner:LightTickOwner,id:string){
    const work=await this.claim(owner,id);if(!work)return;
    const controller=new AbortController();
    let polling=false,output:Record<string,any>|null=null,failure:string|null=null;
    const timeout=setTimeout(()=>controller.abort(Error('LEARNING_TIMEOUT')),30000);
    const poll=setInterval(()=>{if(polling)return;polling=true;void this.check(work).catch(()=>controller.abort(Error('LEARNING_CONTEXT_STALE'))).finally(()=>{polling=false;});},1000);
    try{
      await this.check(work);
      const perform=this.perform(work,controller.signal);
      output=await Promise.race([perform,new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});if(controller.signal.aborted)reject(controller.signal.reason);})]);
      await this.check(work);controller.signal.throwIfAborted();
    }catch(error:any){failure=controller.signal.aborted?String(controller.signal.reason?.message??'LEARNING_CANCELLED'):
      ['LEARNING_CONTEXT_STALE','LEARNING_TIMEOUT'].includes(error?.message)?error.message:error?.code==='FILE_ACCESS_DENIED'?'FILE_ACCESS_DENIED':error?.statusCode===409&&work.input.model_selection?.mode==='personal'?'PERSONAL_MODEL_SETTINGS_CHANGED':error?.statusCode===403?'LEARNING_CONTEXT_STALE':error?.statusCode===422?'LEARNING_OUTPUT_INVALID':'LEARNING_PROVIDER_UNAVAILABLE';}
    finally{clearTimeout(timeout);clearInterval(poll);controller.abort();}
    return finalizeLearningWork(this.service, work, output, failure, this.authorizeOwner);
  }
  private async perform(work:LearningWork,signal:AbortSignal):Promise<Record<string,any>>{
    if(work.kind==='file_ingest'){
      if(!this.sources.writeFile)fail(503,"Owner file storage is unavailable.");
      signal.throwIfAborted();
      const file=await this.sources.writeFile(work,work.id,work.input.file_name,work.input.content);
      signal.throwIfAborted();return {file,digest:digest(work.input.content)};
    }
    const sources=work.input.sources?await collectLearningSources(work,work.input.sources,this.sources,signal):work.input.collected_sources??[];
    if(work.kind==='collect_sources')return {sources};
    const scene = await this.resolveScene(learningGenerationScene(work.kind));
    const prepared = prepareLearningGeneration(work, sources, scene);
    const complete = this.llm.complete({ ...prepared.request, signal, usageOwner: { appId: work.appId, userId: work.userId },
      providerOptions: { ...selectionOption(work.input.model_selection), response_format: { type: "json_object" }, enable_thinking: false } });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([complete,
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("LEARNING_TIMEOUT")), prepared.timeoutMs); })]);
      signal.throwIfAborted();
      return validateLearningGeneration(prepared, result);
    } finally {
      clearTimeout(timer);
    }
  }
}
