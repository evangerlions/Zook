import { DeferJobError } from "../../../infrastructure/queue/job-queue.ts";
import { TutorObservations } from "./tutor-observations.ts";
import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { randomUUID } from "node:crypto";
import type { LLMManager } from "../../../services/llm-manager.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { isPrivateLearningWork, type LearningWork } from "./learning-work.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, LearningWorkService } from "./learning-work.service.ts";
import { collectLearningSources, type LearningSourceAdapters } from "./learning-sources.ts";
import { validateScheduleSuggestion } from "./learning-schedule-suggestion.ts";
import { digest, fail } from "./native-learning.validation.ts";
import { learningGenerationScene, prepareLearningGeneration, validateLearningGeneration } from "./learning-work-generation.ts";

interface TutorTiming {
  workId: string;
  queueWaitMs: number;
  providerMs: number | null;
  terminalMs: number;
  status: LearningWork["status"];
}

export class LearningWorkRunner {
  observeTutorTiming?: (timing: TutorTiming) => void;
  constructor(readonly service:LearningWorkService,readonly llm:Pick<LLMManager,'complete'>,readonly sources:LearningSourceAdapters,
    readonly authorizeOwner:(owner:LightTickOwner)=>Promise<void>=async()=>{},
    readonly resolveScene=async(name:LightTickAiSceneName)=>LIGHTTICK_AI_SCENES[name]){}
  get native(){return this.service.native;}
  get repo(){return this.native.repository;}
  async recover(tutorOnly?: boolean){
    const selection = tutorOnly ?? (this.service.tutorQueue ? false : undefined);
    const rows=await this.service.store.recoverable(this.native.clock().toISOString(),selection === true ? 25 : 100,selection);
    for(const row of rows)await this.service.dispatch(row,row.id);
    return rows.length;
  }
  private async claim(owner:LightTickOwner,id:string){
    return this.repo.transaction(owner,async()=>{
      const row=await this.service.store.get(owner,id),now=this.native.clock().toISOString();
      if(!row||['succeeded','failed','cancelled'].includes(row.status)||row.status==='running'&&row.leaseUntil!>now)return;
      if(row.attempt>=(row.kind==='tutor_turn'?1:LEARNING_WORK_LIMITS.attempts)){await this.service.store.save({...row,revision:row.revision+1,status:'failed',fence:null,leaseUntil:null,errorCode:row.kind==='tutor_turn'?'LEARNING_INVOCATION_UNKNOWN':'ATTEMPTS_EXHAUSTED',updatedAt:now},row.revision);return;}
      const active=(await this.service.store.recent(owner,'1970-01-01T00:00:00.000Z')).filter(r=>r.status==='running'&&r.leaseUntil!>now);
      if(active.length>=LEARNING_WORK_LIMITS.concurrentPerOwner)throw new DeferJobError(1500);
      const claimed:LearningWork={...row,revision:row.revision+1,status:'running',attempt:row.attempt+1,fence:randomUUID(),leaseUntil:new Date(this.native.clock().getTime()+LEARNING_WORK_LIMITS.leaseMs).toISOString(),errorCode:null,updatedAt:now};
      await this.service.store.save(claimed,row.revision);return claimed;
    });
  }
  private async check(work:LearningWork){
    await this.authorizeOwner(work);
    if(work.kind==='schedule_draft'&&!this.service.scheduleSuggestionsEnabled())throw Error('LEARNING_CONTEXT_STALE');
    const current=await this.service.store.get(work,work.id),a=await this.repo.getLearningAuthority(work),r=await this.repo.learningRoutes.getLearningRoute(work,work.routeId);
    if(!current||current.status!=='running'||current.fence!==work.fence||!this.native.enabled||!a?.readingEnabled||(isPrivateLearningWork(work.kind)&&(!a.privateEnabled||(a.consentRevision??0)!==work.input.consent_revision))||a.phase!=='zook'||a.epoch!==work.epoch||
      (work.kind!=='report_review'&&((r?.revision??0)!==work.baseRouteRevision||r?.status==='archived'))||current.leaseUntil!<=this.native.clock().toISOString())throw Error('LEARNING_CONTEXT_STALE');
    if(work.kind==='tutor_turn')await this.checkTutor(work);
  }
  private async checkTutor(work: LearningWork) {
    const input = work.input;
    const lesson = await this.repo.getNativeLesson(work, input.lesson_id);
    if (!this.service.scheduleSuggestionsEnabled() ||
      !lesson || lesson.archived || lesson.publishedVersion !== input.content_version) throw Error('LEARNING_CONTEXT_STALE');
    if (input.observation_revision !== undefined) await new TutorObservations(this.service).assertCurrent(work);
    if (input.answer_revision !== undefined) {
      const state = await this.repo.getNativePrivateState(work, input.lesson_id, input.content_version);
      if (state?.notesRevision !== input.answer_revision) throw Error('LEARNING_CONTEXT_STALE');
    }
  }
  async execute(owner:LightTickOwner,id:string){
    const work=await this.claim(owner,id);if(!work)return;
    const claimedAt = this.native.clock().getTime();
    let providerMs: number | null = null;
    const controller=new AbortController();
    let polling=false,output:Record<string,any>|null=null,failure:string|null=null;
    const timeout=setTimeout(()=>controller.abort(Error('LEARNING_TIMEOUT')),30000);
    const poll=setInterval(()=>{if(polling)return;polling=true;void this.check(work).catch(()=>controller.abort(Error('LEARNING_CONTEXT_STALE'))).finally(()=>{polling=false;});},1000);
    try{
      await this.check(work);
      const perform=this.perform(work,controller.signal, elapsed => { providerMs = elapsed; });
      output=await Promise.race([perform,new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});if(controller.signal.aborted)reject(controller.signal.reason);})]);
      await this.check(work);controller.signal.throwIfAborted();
    }catch(error:any){failure=controller.signal.aborted?String(controller.signal.reason?.message??'LEARNING_CANCELLED'):
      ['LEARNING_CONTEXT_STALE','LEARNING_TIMEOUT'].includes(error?.message)?error.message:error?.code==='FILE_ACCESS_DENIED'?'FILE_ACCESS_DENIED':error?.statusCode===409&&work.input.model_selection?.mode==='personal'?'PERSONAL_MODEL_SETTINGS_CHANGED':error?.statusCode===403?'LEARNING_CONTEXT_STALE':error?.statusCode===422?'LEARNING_OUTPUT_INVALID':'LEARNING_PROVIDER_UNAVAILABLE';}
    finally{clearTimeout(timeout);clearInterval(poll);controller.abort();}
    const result = await this.repo.transaction(owner,async()=>{
      const current=await this.service.store.get(owner,id);
      if(!current||current.status!=='running'||current.fence!==work.fence)return current;
      try{await this.authorizeOwner(owner);}catch{failure='LEARNING_CONTEXT_STALE';}
      if(current.leaseUntil!<=this.native.clock().toISOString())return current;
      // A newer owner transaction may withdraw consent after the network call finished.
      const a=await this.repo.getLearningAuthority(owner),route=await this.repo.learningRoutes.getLearningRoute(owner,work.routeId);
      if(!a?.readingEnabled||(isPrivateLearningWork(work.kind)&&(!a.privateEnabled||(a.consentRevision??0)!==work.input.consent_revision))||a.phase!=='zook'||a.epoch!==work.epoch||(work.kind!=='report_review'&&((route?.revision??0)!==work.baseRouteRevision||route?.status==='archived')))failure='LEARNING_CONTEXT_STALE';
      if(!failure&&work.kind==='tutor_turn'&&a)try{await this.checkTutor(work);}catch{failure='LEARNING_CONTEXT_STALE';}
      if(!failure&&output&&work.kind==='schedule_draft'){
        if(!this.service.scheduleSuggestionsEnabled())failure='LEARNING_CONTEXT_STALE';
        else try{await validateScheduleSuggestion(this.native,work,output);}catch(error:any){
          failure=error?.statusCode===422?'LEARNING_OUTPUT_INVALID':'LEARNING_CONTEXT_STALE';
        }
      }
      const retry=work.kind!=='tutor_turn'&&work.input.model_selection?.mode!=='personal'&&failure&&['LEARNING_PROVIDER_UNAVAILABLE','LEARNING_TIMEOUT'].includes(failure)&&current.attempt<LEARNING_WORK_LIMITS.attempts;
      const next:LearningWork={...current,revision:current.revision+1,status:failure?retry?'queued':'failed':'succeeded',fence:null,leaseUntil:null,output:failure?null:output,errorCode:failure,updatedAt:this.native.clock().toISOString()};
      await this.service.store.save(next,current.revision);return next;
    });
    if (work.kind === "tutor_turn" && result && this.observeTutorTiming) {
      this.observeTutorTiming({
        workId: work.id,
        queueWaitMs: Math.max(0, claimedAt - Date.parse(work.createdAt)),
        providerMs,
        terminalMs: Math.max(0, this.native.clock().getTime() - Date.parse(work.createdAt)),
        status: result.status,
      });
    }
    return result;
  }
  private async perform(work:LearningWork,signal:AbortSignal, observeProvider: (ms: number) => void):Promise<Record<string,any>>{
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
    const providerStarted = performance.now();
    const complete=this.llm.complete({...prepared.request,signal,usageOwner:{appId:work.appId,userId:work.userId},
      providerOptions:{...selectionOption(work.input.model_selection),response_format:{type:'json_object'},enable_thinking:false,
        ...(isPrivateLearningWork(work.kind)?{zookLogBodyMode:'suppress'}:{})}});
    let timer:ReturnType<typeof setTimeout>|undefined;
    let result:Awaited<typeof complete>;
    try{result=await Promise.race([complete,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('LEARNING_TIMEOUT')),prepared.timeoutMs);})]);}finally{if(timer)clearTimeout(timer);observeProvider(Math.round(performance.now()-providerStarted));}
    signal.throwIfAborted();
    return validateLearningGeneration(prepared, result);
  }
}
