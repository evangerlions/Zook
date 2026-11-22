import {captureModel} from "../personal-model/personal-model.service.ts";
import type { RedisJobQueue } from "../../../infrastructure/queue/bullmq/redis-queue.ts";
import type { JobQueue } from "../../../infrastructure/queue/job-queue.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningWork, LearningWorkKind } from "./learning-work.types.ts";
import { LearningRouteService } from "./learning-route.service.ts";
import { routeProgress } from "./learning-route.progress.ts";
import { courseBrief, routeFeedback } from "./learning-route.validation.ts";
import { identity, integer, text, keys, digest, fail } from "./native-learning.validation.ts";
import { prepareScheduleSuggestion } from "./learning-schedule-suggestion.ts";
import { sourceInputs } from "./learning-sources.ts";
import { TUTOR_STARTER_TOPICS, tutorMaterial } from "./tutor-material.ts";
import { isPrivateLearningWork } from "./learning-work.types.ts";
export const LEARNING_WORK_JOB = "lighttick.learning.work";
export const LEARNING_WORK_LIMITS = { dailyJobs: 20, dailyEstimatedMicros: 2000000, concurrentPerOwner: 2, attempts: 3, leaseMs: 45000 } as const;
export class LearningWorkService {
  tutorQueue?: RedisJobQueue;
  tutorDispatchQueue?: JobQueue;
  constructor(readonly routes: LearningRouteService, readonly queue: JobQueue,
    readonly scheduleSuggestionsEnabled: () => boolean = () => false,
    readonly starterTopics = TUTOR_STARTER_TOPICS) {}
  get native(){return this.routes.native;}
  get store(){return this.native.repository.learningRoutes.work;}
  data(w:LearningWork){return {id:w.id,route_id:w.routeId,revision:w.revision,kind:w.kind,status:w.status,base_revision:w.baseRouteRevision,
    attempt:w.attempt,error_code:w.errorCode,output:w.output,output_digest:w.output?digest(w.output):null,adopted:w.adopted??null,...(w.progress&&!isPrivateLearningWork(w.kind)&&w.status!=="queued"&&w.status!=="cancelled"?{progress:w.progress}:{}),created_at:w.createdAt,updated_at:w.updatedAt};}
  async create(owner:LightTickOwner,b:Record<string,unknown>,key:string,authorize?:()=>Promise<void>, browser?: {id: string; expiresAt: string}){
    keys(b,["kind","route_id","base_revision","brief","sources","source_job_id","number","file_name","content","feedback","schedule","tutor_topic"]);
    const routeId=this.routes.routeId(b.route_id),base=integer(b.base_revision,0,2147483646),kind=b.kind as LearningWorkKind;
    if(!['route_draft','route_refine','lesson_draft','collect_sources','file_ingest','schedule_draft'].includes(kind))fail(422,"Unsupported learning work kind.");
    keys(b,['kind','route_id','base_revision',...(kind==='schedule_draft'?['schedule']:kind==='route_draft'?['brief','tutor_topic']:kind==='route_refine'?['brief','feedback']:kind==='file_ingest'?['file_name','content']:kind==='lesson_draft'?['sources','source_job_id','number','tutor_topic']:['sources'])]);
    const id='work-'+digest([owner.appId,owner.userId,key]).slice(0,40);
    const result=await this.native.command(owner,key,'work:create',id,b,async a=>{
      const route=await this.native.repository.learningRoutes.getLearningRoute(owner,routeId);
      if((route?.revision??0)!==base||route?.status==='archived')fail(409,"Course context changed; review before generating.");
      const now=this.native.clock().toISOString(),today=now.slice(0,10)+'T00:00:00.000Z';
      const recent=await this.store.recent(owner,today),reserve=browser?0:kind==='route_draft'||kind==='route_refine'?750000:kind==='lesson_draft'?450000:kind==='schedule_draft'?250000:0;
      if(recent.length>=LEARNING_WORK_LIMITS.dailyJobs||recent.reduce((n,r)=>n+r.reservedMicros,0)+reserve>LEARNING_WORK_LIMITS.dailyEstimatedMicros)fail(429,"Daily learning work budget is exhausted.");
      if (browser && recent.filter(row => row.status === "running" && row.leaseUntil! > now).length >= LEARNING_WORK_LIMITS.concurrentPerOwner)
        fail(429, "Too many learning work items are running.");
      const input:Record<string,any>=browser ? {} : {model_selection:await captureModel(this.native.repository,owner)};
      if (b.tutor_topic !== undefined && !this.starterTopics.includes(String(b.tutor_topic))) {
        fail(422, "This starter topic is unavailable.");
      }
      const tutor = b.tutor_topic === undefined ? undefined : tutorMaterial(b.tutor_topic);
      if (tutor) {
        if (!this.scheduleSuggestionsEnabled()) fail(503, "Teaching generation is unavailable.");
        input.tutor_topic = tutor.topic;
      }
      if(kind==='schedule_draft'){
        input.consent_revision=a.consentRevision??0;
        if(!this.scheduleSuggestionsEnabled())fail(503,"AI schedule suggestions are unavailable; manual scheduling remains available.");
        input.schedule=await prepareScheduleSuggestion(this.native,owner,route,b.schedule);
      }else if(kind==='file_ingest'){
        input.file_name=text(b.file_name,200,true);input.content=text(b.content,80000,true);
        if(Buffer.byteLength(input.content)>80000)fail(422,"Text file exceeds UTF-8 source capacity.");
      }else if(kind==='route_draft'||kind==='route_refine'){
        if (kind==='route_refine') {
          if (!route?.publishedVersion || route.status!=='active') fail(409,"Publish and activate the course before refining it.");
          input.feedback=routeFeedback(b.feedback);
        }
        input.brief=courseBrief(b.brief??route?.brief);
        input.frozen=[];
        if(route?.publishedVersion){
          const version=await this.native.repository.learningRoutes.getLearningRouteVersion(owner,routeId,route.publishedVersion);
          if (!version) fail(409,"The published course version is missing.");
          input.frozen=(await this.native.repository.learningRoutes.listRouteLessonLinks(owner,routeId)).map(l=>version.document.lessons[l.number-1]);
          if (kind==='route_refine') input.current_document=version.document;
        }
      }else{
        if(tutor){
          if(b.source_job_id!==undefined||b.sources!==undefined||b.number!==1)fail(422,"The starter lesson uses its reviewed system material.");
          input.sources=[tutor.source];
        }else if(b.source_job_id){
          if(b.sources!==undefined)fail(422,"Select collected sources or explicit source inputs, not both.");
          const source=await this.store.get(owner,identity(b.source_job_id,'work-'));
          if(!source||source.kind!=='collect_sources'||source.status!=='succeeded'||source.routeId!==routeId||source.baseRouteRevision!==base||source.epoch!==a.epoch)fail(409,"Source collection is unavailable or belongs to another course context.");
          input.collected_sources=source.output?.sources;
        }else input.sources=sourceInputs(b.sources);
      }
      if(kind==='lesson_draft'){
        if(!route?.publishedVersion||route.status!=='active')fail(409,"Publish and activate the formal course before preparing lessons.");
        const progress=await routeProgress(this.native,owner,routeId),number=integer(b.number,1,364);
        if(number!==progress.published_lessons+1||progress.completed_lessons!==progress.published_lessons)fail(409,"Explicitly finish published lessons before generating the next one.");
        const v=(await this.native.repository.learningRoutes.getLearningRouteVersion(owner,routeId,route.publishedVersion))!;
        if(!v.document.lessons[number-1])fail(409,"The formal course has no further planned lesson; review and extend its route first.");
        input.brief=v.brief;input.lesson=v.document.lessons[number-1];input.number=number;
      }
      const work:LearningWork={...owner,id,routeId,revision:1,kind,status:browser?'running':'queued',epoch:a.epoch,baseRouteRevision:base,input,output:null,
        attempt:browser?1:0,fence:browser?.id??null,leaseUntil:browser?.expiresAt??null,reservedMicros:reserve,
        ...(browser?{browserGenerationId:browser.id}:{}),errorCode:null,createdAt:now,updatedAt:now};
      await this.store.save(work,0);return this.data(work);
    },authorize);
    if (!browser) await this.dispatch(owner,result.id);
    return result;
  }
  async dispatch(owner:LightTickOwner,id:string){
    const current=await this.store.get(owner,id);
    if(!current||current.browserGenerationId||current.status!=='queued'&&!(current.status==='running'&&current.leaseUntil!<=this.native.clock().toISOString()))return;
    const queue = current.kind === "tutor_turn" ? this.tutorDispatchQueue ?? this.queue : this.queue;
    try{await queue.add(LEARNING_WORK_JOB,{app_id:owner.appId,user_id:owner.userId,work_id:id},{attempts:3,jobId:'learning-'+digest([owner.userId,id]).slice(0,40),backoffMs:2000});}
    catch {await this.native.repository.transaction(owner,async()=>{const row=await this.store.get(owner,id);if(row?.status==='queued')await this.store.save({...row,revision:row.revision+1,errorCode:'QUEUE_UNAVAILABLE',updatedAt:this.native.clock().toISOString()},row.revision);});}
  }
  async read(owner:LightTickOwner,id:string){return this.native.repository.transaction(owner,async()=>{
    const authority=await this.routes.access(owner);
    const row=await this.store.get(owner,identity(id,'work-'));if(!row)fail(404,"Learning work was not found.");
    if(isPrivateLearningWork(row.kind)&&!authority.privateEnabled)fail(403,"Private learning consent is required.");
    if(row.kind==='tutor_turn'&&row.input.consent_revision!==(authority.consentRevision??0))fail(403,"This teaching permission has changed.");
    return this.data(row);
  });}
  async list(owner:LightTickOwner,cursor='',limit=20){return this.native.repository.transaction(owner,async()=>{
    const a=await this.routes.access(owner);integer(limit,1,50);
    const rows=await this.store.list(owner,this.native.position(owner,'learning-work',cursor,a.revision),limit+1);
    return {items:rows.slice(0,limit).filter(r=>r.kind!=="report_review"&&r.kind!=="tutor_turn"&&(r.kind!=="schedule_draft"||a.privateEnabled)).map(r=>this.data(r)),next_cursor:rows.length>limit?this.native.cursor(owner,'learning-work',rows[limit-1].id,a.revision):null};
  });}
  cancel(owner:LightTickOwner,id:string,b:Record<string,unknown>,key:string,authorize?:()=>Promise<void>){
    keys(b,['base_revision']);const base=integer(b.base_revision,1,2147483646);
    return this.native.command(owner,key,'work:cancel',identity(id,'work-'),b,async authority=>{
      const row=await this.store.get(owner,id);if(!row)fail(404,"Learning work was not found.");
      if(isPrivateLearningWork(row.kind)&&!authority.privateEnabled)fail(403,"Private learning consent is required.");
      if(row.kind==='tutor_turn'&&row.input.consent_revision!==(authority.consentRevision??0))fail(403,"This teaching permission has changed.");
      const tutorJustStarted=row.kind==='tutor_turn'&&row.status==='running'&&row.attempt===1&&row.revision===base+1;
      if((row.revision!==base&&!tutorJustStarted)||!['queued','running'].includes(row.status))fail(409,"Work changed or already reached a terminal state.");
      const next={...row,revision:row.revision+1,status:'cancelled' as const,fence:null,leaseUntil:null,errorCode:'CANCELLED',updatedAt:this.native.clock().toISOString()};
      await this.store.save(next,row.revision);return this.data(next);
    },authorize);
  }
  adopt(owner:LightTickOwner,id:string,b:Record<string,unknown>,key:string,authorize?:()=>Promise<void>){
    keys(b,['base_revision','base_route_revision','expected_digest']);integer(b.base_revision,1,2147483646);integer(b.base_route_revision,0,2147483646);
    return this.native.command(owner,key,'work:adopt',identity(id,'work-'),b,async authority=>{
      const row=await this.store.get(owner,id);
      if(!row||row.status!=='succeeded'||row.revision!==b.base_revision||row.epoch!==authority.epoch||row.adopted||!row.output||digest(row.output)!==b.expected_digest)fail(409,"Review the exact successful draft before adopting it.");
      const route=await this.native.repository.learningRoutes.getLearningRoute(owner,row.routeId);
      if((route?.revision??0)!==b.base_route_revision||row.baseRouteRevision!==b.base_route_revision)fail(409,"Course changed after generation; preserve and compare the draft.");
      const internal='adopt-'+digest([id,key]).slice(0,40);
      let result:Record<string,any>;
      if(row.kind==='route_draft'||row.kind==='route_refine')result=await this.routes.save(owner,row.routeId,{base_revision:b.base_route_revision,brief:row.output.brief,document:row.output.document},internal,authorize);
      else if(row.kind==='lesson_draft')result=await this.routes.publishLesson(owner,row.routeId,row.input.number,{base_revision:b.base_route_revision,base_lesson_revision:0,lesson_id:'lesson-'+digest([owner.userId,id]).slice(0,40),content:row.output.content,references:row.output.references,source_url:''},internal,authorize,row.input.tutor_topic);
      else fail(422,"Collected sources require review in a generation request; they do not publish a course.");
      await this.store.save({...row,revision:row.revision+1,adopted:result,updatedAt:this.native.clock().toISOString()},row.revision);
      return {work_id:id,kind:row.kind,result};
    },authorize);
  }
}
