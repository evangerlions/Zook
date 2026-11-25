import {captureModel} from "../personal-model/personal-model.service.ts";
import type { JobQueue } from "../../../infrastructure/queue/job-queue.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { isPrivateLearningWork, isRouteDraft, type LearningWork, type LearningWorkKind, type TaskSummary } from "./learning-work.types.ts";
import { LearningRouteService } from "./learning-route.service.ts";
import { learningWorkContextCurrent } from "./learning-work-context.ts";
import { routeProgress } from "./learning-route.progress.ts";
import { courseBrief, courseLessonCount, routeFeedback, routeRefinementObservation } from "./learning-route.validation.ts";
import { identity, integer, text, keys, digest, fail } from "./native-learning.validation.ts";
import { sourceInputs } from "./learning-sources.ts";
import { STRUCTURED_THINKING_FOLLOWUP, tutorMaterial } from "./tutor-material.ts";
import { tutorFollowupPrerequisite, tutorFollowupPrerequisiteCurrent } from "./tutor-followup.ts";
import { prepareScheduleSuggestion } from "./learning-schedule-suggestion.ts";
import type { LearningAuthority } from "./native-learning.types.ts";
import { TutorObservations } from "./tutor-observations.ts";
export const LEARNING_WORK_JOB = "lighttick.learning.work";
export const LEARNING_WORK_LIMITS = { dailyJobs: 20, dailyEstimatedMicros: 20000000, concurrentPerOwner: 2, attempts: 3, leaseMs: 45000 } as const;
export class LearningWorkService {
  constructor(readonly routes: LearningRouteService, readonly queue: JobQueue, readonly tutorEnabled = () => true,
    readonly scheduleSuggestionsEnabled = () => false) {}
  get native(){return this.routes.native;}
  get store(){return this.native.repository.learningRoutes.work;}
  routeRefinementEnabled() { return this.tutorEnabled(); }
  data(w:LearningWork){return {id:w.id,route_id:w.routeId,revision:w.revision,kind:w.kind,status:w.status,base_revision:w.baseRouteRevision,
    ...(w.kind === "lesson_draft" && Number.isInteger(w.input.number) && { lesson_number: w.input.number }),
    ...(w.kind === "lesson_draft" && w.input.tutor_topic === STRUCTURED_THINKING_FOLLOWUP && { tutor_topic: STRUCTURED_THINKING_FOLLOWUP }),
    attempt:w.attempt,error_code:w.errorCode,output:w.output,output_digest:w.output?digest(w.output):null,adopted:w.adopted??null,progress:w.progress??null,created_at:w.createdAt,updated_at:w.updatedAt};}
  async create(owner:LightTickOwner,b:Record<string,unknown>,key:string,authorize?:()=>Promise<void>, browser?: {id: string; expiresAt: string}){
    keys(b,["kind","route_id","base_revision","brief","sources","source_job_id","number","file_name","content","tutor_topic","schedule","feedback","observation_source","text"]);
    const kind=b.kind as LearningWorkKind;
    // brief intake 不属于任何课程：合同要求 route_id 形如 plan-，这里落一个只占位的虚拟 id，不指向真实课程。
    const briefIntake=kind==='brief_intake',routeId=briefIntake?'plan-intake-'+digest([owner.userId,key]).slice(0,16):this.routes.routeId(b.route_id),base=briefIntake?0:integer(b.base_revision,0,2147483646);
    const fields:Record<string,string[]> = {
      route_draft: ["brief", "tutor_topic"], route_refine: ["brief", "feedback", "observation_source"],
      lesson_draft: ["sources", "source_job_id", "number", "tutor_topic"], collect_sources: ["sources"],
      file_ingest: ["file_name", "content"], schedule_draft: ["schedule"], brief_intake: ["text"],
    };
    if (!Object.hasOwn(fields, kind)) fail(422, "Unsupported learning work kind.");
    keys(b, ["kind", "route_id", "base_revision", ...fields[kind]]);
    if ((kind === "schedule_draft" || kind === "route_refine") && browser) fail(422, "This suggestion uses server generation.");
    const id='work-'+digest([owner.appId,owner.userId,key]).slice(0,40);
    const result=await this.native.command(owner,key,'work:create',id,b,async a=>{
      const route=briefIntake?undefined:await this.native.repository.learningRoutes.getLearningRoute(owner,routeId);
      if(!briefIntake&&((route?.revision??0)!==base||route?.status==='archived'))fail(409,"Course context changed; review before generating.");
      const now=this.native.clock().toISOString(),today=now.slice(0,10)+'T00:00:00.000Z';
      const recentAll=await this.store.recent(owner,today);
      // 浏览器围栏生成（browser）由客户端直接调用个人模型，只受并发上限约束；
      // 服务端生成沿用统一预算，但个人模型生成不计入平台估算成本。
      let reserve=0;
      let selection:any=undefined;
      if(browser){
        if(recentAll.filter(row=>row.status==='running'&&row.leaseUntil!>now).length>=LEARNING_WORK_LIMITS.concurrentPerOwner)fail(429,"Too many learning work items are running.");
      }else{
        selection=await captureModel(this.native.repository,owner);
        const personalGeneration=['route_draft','route_refine','lesson_draft','brief_intake'].includes(kind)&&selection.mode==='personal';
        const recent=recentAll.filter(r=>
          !(['route_draft','route_refine','lesson_draft','report_review','brief_intake'].includes(r.kind)&&r.input.model_selection?.mode==='personal'));
        reserve=personalGeneration?0:['route_draft','route_refine'].includes(kind)?750000:kind==='lesson_draft'?450000:kind==='brief_intake'?30000:kind==='schedule_draft'?250000:0;
        if(!personalGeneration&&(recent.length>=LEARNING_WORK_LIMITS.dailyJobs||recent.reduce((n,r)=>n+r.reservedMicros,0)+reserve>LEARNING_WORK_LIMITS.dailyEstimatedMicros))fail(429,"Daily learning work budget is exhausted.");
      }
      const input:Record<string,any>=browser ? {} : {model_selection:selection};
      const tutor = b.tutor_topic === undefined ? undefined : tutorMaterial(b.tutor_topic);
      const followup = tutor?.topic === STRUCTURED_THINKING_FOLLOWUP;
      if (tutor) {
        if (browser) fail(422, "Starter tutor work uses server generation.");
        if (followup && kind !== "lesson_draft") fail(422, "The follow-up material is only available for the second lesson.");
        if (!this.tutorEnabled()) fail(503, "Teaching generation is unavailable.");
        input.tutor_topic = tutor.topic;
      }
      if (kind === "schedule_draft") {
        if (!this.scheduleSuggestionsEnabled()) fail(503, "AI scheduling suggestions are unavailable.");
        input.schedule = await prepareScheduleSuggestion(this.native, owner, route, b.schedule);
        input.consent_revision = a.consentRevision ?? 0;
      } else if(kind==='file_ingest'){
        input.file_name=text(b.file_name,200,true);input.content=text(b.content,80000,true);
        if(Buffer.byteLength(input.content)>80000)fail(422,"Text file exceeds UTF-8 source capacity.");
      }else if(kind==='brief_intake'){
        // 一句愿望即可：只保留文本，不冻结课程、不挂来源。
        input.text=text(b.text,4000,true);
      }else if(isRouteDraft(kind)){
        const previous = route?.publishedVersion && await this.native.repository.learningRoutes.getLearningRouteVersion(owner, routeId, route.publishedVersion);
        input.brief = courseBrief(b.brief ?? (kind === "route_refine" && previous ? previous.brief : route?.brief));
        input.frozen = previous ? (await this.native.repository.learningRoutes.listRouteLessonLinks(owner,routeId))
          .map(link => previous.document.lessons[link.number - 1]) : [];
        if (kind === "route_refine") {
          if (!this.routeRefinementEnabled()) fail(503, "AI course refinement is unavailable.");
          if (route?.status !== "active" || !previous) fail(409, "Select an active, published course to refine.");
          const count = courseLessonCount(input.brief);
          if (count < input.frozen.length || input.frozen.some((lesson: { minutes: number }) => lesson.minutes > input.brief.minutes))
            fail(422, "The new course limits must keep the published lessons.");
          if (count === input.frozen.length && count === previous.document.lessons.length)
            fail(422, "Add a future lesson before requesting changes to this course.");
          const observation = routeRefinementObservation(b.observation_source);
          input.feedback = routeFeedback(b.feedback, !!observation);
          input.base_version = previous.version;
          input.current_outline = previous.document;
          if (observation) {
            const summary = await new TutorObservations(this).refinementSummary(owner, routeId, observation);
            if (!summary) fail(409, "Review the current learning observation before using it to refine this course.");
            input.observation_source = observation;
            input.learning_observation = summary;
            input.consent_revision = a.consentRevision ?? 0;
          }
        }
      }else{
        if (tutor) {
          if (b.source_job_id !== undefined || b.sources !== undefined || b.number !== (followup ? 2 : 1))
            fail(422, "A tutor lesson uses its assigned system material and number.");
          input.sources = [tutor.source];
        } else if(b.source_job_id){
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
        if (followup) {
          const prerequisite = await tutorFollowupPrerequisite(this.native.repository, owner, routeId, a);
          if (!prerequisite) fail(409, "Finish the current first structured-thinking tutor lesson before using its follow-up.");
          input.tutor_prerequisite = prerequisite;
        }
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
    try{await this.queue.add(LEARNING_WORK_JOB,{app_id:owner.appId,user_id:owner.userId,work_id:id},{attempts:3,jobId:'learning-'+digest([owner.userId,id]).slice(0,40),backoffMs:2000});}
    catch {await this.native.repository.transaction(owner,async()=>{const row=await this.store.get(owner,id);if(row?.status==='queued')await this.store.save({...row,revision:row.revision+1,errorCode:'QUEUE_UNAVAILABLE',updatedAt:this.native.clock().toISOString()},row.revision);});}
  }
  private checkPrivateWorkConsent(row: LearningWork, authority: LearningAuthority) {
    if (isPrivateLearningWork(row.kind) && !authority.privateEnabled)
      fail(403, "Private learning consent is required.");
    if ((row.kind === "tutor_turn" || row.kind === "schedule_draft") && row.input.consent_revision !== (authority.consentRevision ?? 0))
      fail(403, "This learning permission has changed.");
  }
  private async dataForReview(row: LearningWork) {
    if (row.kind === "route_refine" && row.input.observation_source && row.status === "succeeded" && !row.adopted &&
      !await new TutorObservations(this).refinementSummary(row, row.routeId, row.input.observation_source)) {
      return this.data({ ...row, status: "failed", output: null, errorCode: "LEARNING_CONTEXT_STALE" });
    }
    if (row.kind === "lesson_draft" && row.input.tutor_topic === STRUCTURED_THINKING_FOLLOWUP &&
      row.status === "succeeded" && !row.adopted && !await learningWorkContextCurrent(this, row)) {
      return this.data({ ...row, status: "failed", output: null, errorCode: "LEARNING_CONTEXT_STALE" });
    }
    return this.data(row);
  }
  async read(owner:LightTickOwner,id:string){return this.native.repository.transaction(owner,async()=>{
    const authority=await this.routes.access(owner);
    const row=await this.store.get(owner,identity(id,'work-'));if(!row)fail(404,"Learning work was not found.");
    this.checkPrivateWorkConsent(row,authority);
    return this.dataForReview(row);
  });}
  async list(owner:LightTickOwner,cursor='',limit=20){return this.native.repository.transaction(owner,async()=>{
    const a=await this.routes.access(owner);integer(limit,1,50);
    const rows=await this.store.list(owner,this.native.position(owner,'learning-work',cursor,a.revision),limit+1);
    const items = [];
    for (const row of rows.slice(0, limit)) {
      if (row.kind === "tutor_turn" || row.kind === "schedule_draft") continue;
      if (row.kind === "report_review" && !a.privateEnabled) items.push(this.data({ ...row, output: null }));
      else items.push(await this.dataForReview(row));
    }
    return {items,next_cursor:rows.length>limit?this.native.cursor(owner,'learning-work',rows[limit-1].id,a.revision):null};
  });}
  cancel(owner:LightTickOwner,id:string,b:Record<string,unknown>,key:string,authorize?:()=>Promise<void>){
    keys(b,['base_revision']);const base=integer(b.base_revision,1,2147483646);
    const workId=identity(id,'work-');
    return this.native.command(owner,key,'work:cancel',workId,b,async()=>{
      const row=await this.store.get(owner,workId);if(!row)fail(404,"Learning work was not found.");
      // A queued tutor turn may be claimed between the user seeing it and pressing cancel.
      const tutorJustStarted=row.kind==='tutor_turn'&&row.status==='running'&&row.attempt===1&&row.revision===base+1;
      if((row.revision!==base&&!tutorJustStarted)||!['queued','running'].includes(row.status))fail(409,"Work changed or already reached a terminal state.");
      const next={...row,revision:row.revision+1,status:'cancelled' as const,fence:null,leaseUntil:null,errorCode:'CANCELLED',updatedAt:this.native.clock().toISOString()};
      await this.store.save(next,row.revision);return this.data(next);
    },async()=>{
      await authorize?.();
      const row=await this.store.get(owner,workId);
      if(row&&isPrivateLearningWork(row.kind))this.checkPrivateWorkConsent(row,await this.native.requireActive(owner));
    });
  }
  adopt(owner:LightTickOwner,id:string,b:Record<string,unknown>,key:string,authorize?:()=>Promise<void>){
    keys(b,['base_revision','base_route_revision','expected_digest']);integer(b.base_revision,1,2147483646);integer(b.base_route_revision,0,2147483646);
    return this.native.command(owner,key,'work:adopt',identity(id,'work-'),b,async authority=>{
      const row=await this.store.get(owner,id);
      if(!row||row.status!=='succeeded'||row.revision!==b.base_revision||row.epoch!==authority.epoch||row.adopted||!row.output||digest(row.output)!==b.expected_digest)fail(409,"Review the exact successful draft before adopting it.");
      const route=await this.native.repository.learningRoutes.getLearningRoute(owner,row.routeId);
      if((route?.revision??0)!==b.base_route_revision||row.baseRouteRevision!==b.base_route_revision)fail(409,"Course changed after generation; preserve and compare the draft.");
      if (row.kind === "route_refine") {
        if (route?.status !== "active" || route.publishedVersion !== row.input.base_version ||
          (row.input.observation_source && !await new TutorObservations(this).refinementSummary(owner, row.routeId, row.input.observation_source)))
          fail(409, "The published course or selected observation changed; review the current course first.");
      }
      if (row.kind === "lesson_draft" && row.input.tutor_topic === STRUCTURED_THINKING_FOLLOWUP &&
        (route?.status !== "active" || !this.tutorEnabled() || !await tutorFollowupPrerequisiteCurrent(
          this.native.repository, owner, row.routeId, authority, row.input.tutor_prerequisite,
        ))) fail(409, "The completed first tutor lesson changed. Review the course before adopting this draft.");
      const internal='adopt-'+digest([id,key]).slice(0,40);
      let result:Record<string,any>;
      if(isRouteDraft(row.kind))result=await this.routes.save(owner,row.routeId,{base_revision:b.base_route_revision,brief:row.output.brief,document:row.output.document},internal,authorize,
        row.kind === "route_refine" ? { version: row.input.base_version, observation: row.input.observation_source } : undefined);
      else if(row.kind==='lesson_draft')result=await this.routes.publishLesson(owner,row.routeId,row.input.number,{base_revision:b.base_route_revision,base_lesson_revision:0,lesson_id:'lesson-'+digest([owner.userId,id]).slice(0,40),content:row.output.content,references:row.output.references,source_url:''},internal,authorize,row.input.tutor_topic);
      else if(row.kind==='brief_intake')result={brief_partial:row.output.brief_partial,missing_fields:row.output.missing_fields};
      else fail(422,"Collected sources require review in a generation request; they do not publish a course.");
      await this.store.save({...row,revision:row.revision+1,adopted:result,updatedAt:this.native.clock().toISOString()},row.revision);
      return {work_id:id,kind:row.kind,result};
    },authorize);
  }
  async listActiveTasks(owner: LightTickOwner, since: string): Promise<TaskSummary[]> {
    const works = await this.store.recent(owner, since);
    const active = works.filter(w =>
      !isPrivateLearningWork(w.kind) &&
      ["queued", "running", "succeeded", "failed"].includes(w.status)
    );
    return active.map(w => this.toTaskSummary(w));
  }
  private toTaskSummary(w: LearningWork): TaskSummary {
    const title = this.buildTaskTitle(w);
    const resultRef = this.buildResultRef(w);
    const retryRef = w.status === "failed" ? this.buildRetryRef(w) : null;
    return {
      id: w.id,
      type: w.kind,
      title,
      status: w.status as TaskSummary["status"],
      progress: w.progress ?? null,
      error: w.errorCode ? { code: w.errorCode, message: this.mapErrorCode(w.errorCode) } : null,
      resultRef,
      retryRef,
      createdAt: w.createdAt,
      completedAt: w.status === "succeeded" || w.status === "failed" ? w.updatedAt : null,
    };
  }
  private buildTaskTitle(w: LearningWork): string {
    const routeName = w.input?.brief?.title || "课程";
    const kindLabels: Record<string, string> = {
      route_draft: "课程大纲生成",
      route_refine: "课程大纲优化",
      lesson_draft: "课节内容生成",
      brief_intake: "需求整理",
      collect_sources: "资料收集",
      file_ingest: "文件处理",
    };
    const kindLabel = kindLabels[w.kind] || "任务";
    return `${routeName} · ${kindLabel}`;
  }
  private buildResultRef(w: LearningWork): { path: string; label: string } | null {
    if (w.status !== "succeeded") return null;
    if (w.kind === "route_draft" || w.kind === "route_refine") {
      return { path: `/grow/learning?route=${w.routeId}`, label: "查看课程大纲" };
    }
    if (w.kind === "lesson_draft" && w.input?.number) {
      return { path: `/grow/learning?route=${w.routeId}&lesson=${w.input.number}`, label: "查看课节内容" };
    }
    return null;
  }
  private buildRetryRef(w: LearningWork): { path: string; label: string } | null {
    if (w.status !== "failed") return null;
    return { path: `/grow/learning?create=course&route=${w.routeId}&retry=${w.id}`, label: "调整需求并重试" };
  }
  private mapErrorCode(code: string): string {
    const errors: Record<string, string> = {
      QUEUE_UNAVAILABLE: "队列暂不可用，任务已保留，将由服务恢复派发。",
      LEARNING_TIMEOUT: "本次请求超时，任务状态与输入已保留。",
      LEARNING_PROVIDER_UNAVAILABLE: "模型或资料服务暂不可用，请稍后重试。",
      LEARNING_OUTPUT_INVALID: "草案未通过课程规则校验，请核对学习条件或资料。",
      LEARNING_CONTEXT_STALE: "课程或授权已经变化，本次结果不会发布。",
      FILE_ACCESS_DENIED: "资料文件未确认或不属于当前账号。",
      ATTEMPTS_EXHAUSTED: "本次任务已达到重试上限，请核对条件后再提交。",
      CANCELLED: "本次任务已取消。",
    };
    return errors[code] || "任务失败，请稍后重试。";
  }
}
