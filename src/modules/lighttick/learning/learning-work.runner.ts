import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { randomUUID } from "node:crypto";
import type { LLMManager, LLMCompletionRequest, LLMCompletionResult, LLMStreamingCompletionCapability } from "../../../services/llm-manager.ts";
import { courseGenerationContext } from "./learning-generation-context.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT } from "../ai/lighttick-ai-prompts.ts";
import { parseLightTickJson } from "../ai/lighttick-ai-validation.ts";
import type { LearningSource, LearningWork, LearningWorkProgress } from "./learning-work.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, LearningWorkService } from "./learning-work.service.ts";
import { collectLearningSources, type LearningSourceAdapters } from "./learning-sources.ts";
import { courseBrief, courseDocument } from "./learning-route.validation.ts";
import { REPORT_PROMPT, reportQuoteOptions, reportQuoteSchema, resolveReportQuotes, validateReportFeedback } from "./work-report-practice.ts";
import { createProgressCoalescer, type ProgressCoalescer } from "./learning-stream-progress.ts";
import { canonical, integer, keys, object, text, digest, fail } from "./native-learning.validation.ts";
import { tutorMaterial } from "./tutor-material.ts";
import { learningGenerationScene, prepareLearningGeneration, validateLearningGeneration } from "./learning-work-generation.ts";
import { learningWorkContextCurrent } from "./learning-work-context.ts";
import { parseSolvability, solvabilityInput, SOLVABILITY_OUTPUT_SCHEMA, type SolvabilityVerdict } from "./lesson-solvability.ts";

/**
 * 任务必须活过模型预算。租约短于调用时间，生成会在中途被判过期（租约失效 → LEARNING_CONTEXT_STALE），
 * 表现为大课时大纲反复失败而小课时正常；看门狗同理，必须宽于内层 min(场景配置, 代码默认)。
 * 纯文件类任务没有场景，保持 30 秒，卡住能更快暴露。
 */
const SCENE_BY_KIND:Record<string,LightTickAiSceneName>={route_draft:'learning_route',route_refine:'learning_route',lesson_draft:'learning_lesson',report_review:'learning_practice_review',brief_intake:'brief_intake',tutor_turn:'learning_tutor',schedule_draft:'learning_schedule'};
/**
 * brief intake 的宽松结构：八字段都可为 null，只保证类型与范围。
 * 严格的八字段完整性留给用户提交后的 courseBrief()——从一句愿望替人填满周期就是编造。
 */
const BRIEF_INTAKE_SCHEMA={type:'object',additionalProperties:false,
  required:['title','goal','level','minutes','pacing','weeks','sessions','lesson_count'],
  properties:{
    title:{type:'string',minLength:1,maxLength:200},goal:{type:'string',minLength:1,maxLength:500},
    level:{anyOf:[{type:'string',maxLength:100},{type:'null'}]},
    minutes:{anyOf:[{type:'integer',minimum:5,maximum:120},{type:'null'}]},
    pacing:{anyOf:[{type:'string',enum:['weekly','self_paced']},{type:'null'}]},
    weeks:{anyOf:[{type:'integer',minimum:1,maximum:52},{type:'null'}]},
    sessions:{anyOf:[{type:'integer',minimum:1,maximum:7},{type:'null'}]},
    lesson_count:{anyOf:[{type:'integer',minimum:2,maximum:364},{type:'null'}]},
  }};
/** 把模型的原样八字段收成 brief_partial：null 原样保留，缺失项列出给表单提示。 */
function briefIntakeOutput(raw:unknown){
  const value=object(raw),missing:string[]=[];
  keys(value,['title','goal','level','minutes','pacing','weeks','sessions','lesson_count']);
  const title=text(value.title,200,true),goal=text(value.goal,500,true);
  const str=(key:string,max:number)=>{const v=value[key];if(v==null){missing.push(key);return null;}return text(v,max,true);};
  const num=(key:string,min:number,max:number)=>{const v=value[key];if(v==null){missing.push(key);return null;}return integer(v,min,max);};
  const level=str('level',100),minutes=num('minutes',5,120);
  let pacing:string|null=null;
  if(value.pacing!=null){pacing=text(value.pacing,16,true);if(!['weekly','self_paced'].includes(pacing))fail(422,'Unknown course pacing.');}
  if(pacing===null)missing.push('pacing');
  const weeks=pacing==='weekly'?num('weeks',1,52):null,sessions=pacing==='weekly'?num('sessions',1,7):null;
  const lessonCount=pacing==='self_paced'?num('lesson_count',2,364):null;
  return {brief_partial:{title,goal,level,minutes,pacing,weeks,sessions,lesson_count:lessonCount},missing_fields:[...new Set(missing)]};
}
function workBudgetMs(kind:string){
  const scene=LIGHTTICK_AI_SCENES[SCENE_BY_KIND[kind] as LightTickAiSceneName] as {timeoutMs?:number}|undefined;
  const base=Math.max(scene?.timeoutMs??0,30000);
  // 课节质量门把一次生成变成「生成 → 盲解 →（一次定向修复 → 再盲解）」，
  // 租约与看门狗必须覆盖整条链，否则修复途中租约失效会被误判 LEARNING_CONTEXT_STALE。
  if(kind!=='lesson_draft')return base;
  const solve=LIGHTTICK_AI_SCENES.lesson_solvability.timeoutMs;
  return base+2*solve+LIGHTTICK_AI_SCENES.learning_lesson.timeoutMs;
}

/**
 * Streaming is an optional capability, not a requirement: test doubles and
 * providers that cannot stream keep implementing `complete` alone.
 */
export type LearningWorkLlm = Pick<LLMManager,'complete'> & LLMStreamingCompletionCapability;

export class LearningWorkRunner {
  constructor(readonly service:LearningWorkService,readonly llm:LearningWorkLlm,readonly sources:LearningSourceAdapters,
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
      // Tutor turns and course refinements are billed once: a retried prompt would bill twice.
      const oneInvocation=row.kind==='tutor_turn'||row.kind==='route_refine';
      if(row.attempt>=(oneInvocation?1:LEARNING_WORK_LIMITS.attempts)){await this.service.store.save({...row,revision:row.revision+1,status:'failed',fence:null,leaseUntil:null,errorCode:oneInvocation?'LEARNING_INVOCATION_UNKNOWN':'ATTEMPTS_EXHAUSTED',updatedAt:now},row.revision);return;}
      const active=(await this.service.store.recent(owner,'1970-01-01T00:00:00.000Z')).filter(r=>r.status==='running'&&r.leaseUntil!>now);
      if(active.length>=LEARNING_WORK_LIMITS.concurrentPerOwner)return;
      const claimed:LearningWork={...row,revision:row.revision+1,status:'running',attempt:row.attempt+1,fence:randomUUID(),leaseUntil:new Date(this.native.clock().getTime()+Math.max(LEARNING_WORK_LIMITS.leaseMs,workBudgetMs(row.kind)+15000)).toISOString(),errorCode:null,updatedAt:now,
        progress:{phase:'claimed',received_chars:0,lesson_count_so_far:0,updated_at:now}};
      await this.service.store.save(claimed,row.revision);return claimed;
    });
  }
  private async check(work:LearningWork){
    await this.repo.transaction(work,async()=>{
      await this.authorizeOwner(work);
      const current=await this.service.store.get(work,work.id);
      if(!current||current.status!=='running'||current.fence!==work.fence||current.leaseUntil!<=this.native.clock().toISOString()||
        !await learningWorkContextCurrent(this.service,work))throw Error('LEARNING_CONTEXT_STALE');
    });
  }
  async execute(owner:LightTickOwner,id:string){
    const work=await this.claim(owner,id);if(!work)return;
    const progress:LearningWorkProgress=work.progress??{phase:'claimed',received_chars:0,lesson_count_so_far:0,updated_at:work.updatedAt};
    // Phase updates never touch revision: a bump would break the cancel CAS.
    const report=async(patch:Partial<LearningWorkProgress>)=>{
      Object.assign(progress,patch,{updated_at:this.native.clock().toISOString()});
      await this.service.store.progress(work,work.id,work.fence!,{...progress}).catch(()=>{});
    };
    const controller=new AbortController();
    let polling=false,output:Record<string,any>|null=null,failure:string|null=null;
    // Coalesced token progress. Fire-and-forget on purpose: awaiting a database
    // write inside the stream callback would stall the model.
    const live=createProgressCoalescer({write:patch=>report(patch)});
    // 比模型预算多留 5 秒：让模型自己的超时先返回（错误码更具体），而不是被看门狗抢先判成 LEARNING_TIMEOUT。
    const timeout=setTimeout(()=>controller.abort(Error('LEARNING_TIMEOUT')),workBudgetMs(work.kind)+5000);
    const poll=setInterval(()=>{if(polling)return;polling=true;void this.check(work).catch(()=>controller.abort(Error('LEARNING_CONTEXT_STALE'))).finally(()=>{polling=false;});},1000);
    try{
      await this.check(work);
      const perform=this.perform(work,controller.signal,report,live);
      output=await Promise.race([perform,new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});if(controller.signal.aborted)reject(controller.signal.reason);})]);
      await this.check(work);controller.signal.throwIfAborted();
    }catch(error:any){failure=controller.signal.aborted?String(controller.signal.reason?.message??'LEARNING_CANCELLED'):
      error?.details?.provider_status===401?'PERSONAL_MODEL_AUTH_REQUIRED':['LEARNING_CONTEXT_STALE','LEARNING_TIMEOUT'].includes(error?.message)?error.message:error?.code==='FILE_ACCESS_DENIED'?'FILE_ACCESS_DENIED':error?.statusCode===409&&work.input.model_selection?.mode==='personal'?'PERSONAL_MODEL_SETTINGS_CHANGED':error?.statusCode===403?'LEARNING_CONTEXT_STALE':error?.statusCode===422?'LEARNING_OUTPUT_INVALID':'LEARNING_PROVIDER_UNAVAILABLE';}
    // Flush before the terminal transaction so no progress write can land after it.
    finally{clearTimeout(timeout);clearInterval(poll);await live.close();controller.abort();}
    return this.repo.transaction(owner,async()=>{
      const current=await this.service.store.get(owner,id);
      if(!current||current.status!=='running'||current.fence!==work.fence)return current;
      try{await this.authorizeOwner(owner);}catch{failure='LEARNING_CONTEXT_STALE';}
      if(current.leaseUntil!<=this.native.clock().toISOString())return current;
      // A newer owner transaction may withdraw consent after the network call finished.
      const a=await this.repo.getLearningAuthority(owner),route=await this.repo.learningRoutes.getLearningRoute(owner,work.routeId);
      if(!a?.readingEnabled||(work.kind==='report_review'&&!a.privateEnabled)||a.phase!=='zook'||a.epoch!==work.epoch||(route?.revision??0)!==work.baseRouteRevision||route?.status==='archived')failure='LEARNING_CONTEXT_STALE';
      const retry=work.input.model_selection?.mode!=='personal'&&failure&&['LEARNING_PROVIDER_UNAVAILABLE','LEARNING_TIMEOUT'].includes(failure)&&current.attempt<LEARNING_WORK_LIMITS.attempts;
      const next:LearningWork={...current,revision:current.revision+1,status:failure?retry?'queued':'failed':'succeeded',fence:null,leaseUntil:null,output:failure?null:output,errorCode:failure,updatedAt:this.native.clock().toISOString(),
        progress:{...progress,phase:failure?'failed':'done',updated_at:this.native.clock().toISOString()}};
      await this.service.store.save(next,current.revision);return next;
    });
  }
  private async perform(work:LearningWork,signal:AbortSignal,report:(patch:Partial<LearningWorkProgress>)=>Promise<void>,live:ProgressCoalescer):Promise<Record<string,any>>{
    if(work.kind==='file_ingest'){
      if(!this.sources.writeFile)fail(503,"Owner file storage is unavailable.");
      signal.throwIfAborted();
      const file=await this.sources.writeFile(work,work.id,work.input.file_name,work.input.content);
      signal.throwIfAborted();return {file,digest:digest(work.input.content)};
    }
    const sources=work.input.sources?await collectLearningSources(work,work.input.sources,this.sources,signal):work.input.collected_sources??[];
    if(work.kind==='collect_sources')return {sources};
    // 家教回合、课程改写建议与排期建议共用统一生成管线：输入裁剪、输出校验与阶段保留规则都在
    // learning-work-generation.ts，避免每个工种各写一套提示词与校验。
    if(work.kind==='tutor_turn'||work.kind==='schedule_draft'||work.kind==='route_refine'||work.kind==='lesson_draft')
      return await this.performUnified(work,sources,signal,report,live);
    const review=work.kind==='report_review';
    const routeWork=work.kind==='route_draft';
    const briefIntake=work.kind==='brief_intake';
    const sceneName=briefIntake?'brief_intake':review?'learning_practice_review':routeWork?'learning_route':'learning_lesson',scene=await this.resolveScene(sceneName),hard=LIGHTTICK_AI_SCENES[sceneName];
    // 汇报反馈只把稿件与冻结评分标准发给模型；课程标识、模型选择等本地字段不进入提示词。
    const quotes=review?reportQuoteOptions(work.input.submission):[];
    const input:Record<string,any>=briefIntake?{text:work.input.text}:review?{submission_segments:quotes,rubric:work.input.rubric}:{...work.input,sources};
    if(!review&&!briefIntake)delete input.collected_sources;
    // 家教带教的课程草稿把首课的边界（概念、来源、练习）显式交给模型，避免它自行扩写范围。
    let starterRule="";
    if(typeof work.input.tutor_topic==='string'){
      const material=tutorMaterial(work.input.tutor_topic);
      input.starter_scope={concept:material.concept,source:material.source.text,practice:material.question.prompt};
      starterRule="\nUse starter_scope as the lesson's boundary. Focus the first lesson on its selected concept. The dedicated exercise is rendered separately. Use the source example for teaching and do not solve starter_scope.practice in the visible lesson sections.";
    }
    const context=briefIntake?null:routeWork?courseGenerationContext(courseBrief(work.input.brief)):null;
    const schema=briefIntake?BRIEF_INTAKE_SCHEMA:review?reportQuoteSchema(quotes):context?context.schema:{type:'object',additionalProperties:false,required:['content','references'],properties:{content:{type:'string',maxLength:100000},references:{type:'string',maxLength:100000}}};
    const instruction=review?REPORT_PROMPT:LIGHTTICK_SCENE_PROMPTS[sceneName];
    const user=`${instruction}${starterRule}\n${context?`COURSE_CONSTRAINTS=${JSON.stringify(context.constraints)}\n`:""}OUTPUT_JSON_SCHEMA=${JSON.stringify(schema)}\nINPUT_JSON=${JSON.stringify(input)}`;
    if(Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT+user)>Math.min(scene.maxContextTokens,hard.maxContextTokens))fail(422,'Reviewed source context exceeds learning scene capacity.');
    await report({phase:'calling_model'});
    const request:LLMCompletionRequest={modelKey:scene.modelAlias,messages:[{role:'system',content:LIGHTTICK_SYSTEM_PROMPT},{role:'user',content:user}],
      maxTokens:Math.min(scene.maxOutputTokens,hard.maxOutputTokens),temperature:0.2,signal,usageOwner:{appId:work.appId,userId:work.userId},
      providerOptions:{zookLightTickTimeoutMs:Math.min(scene.timeoutMs,hard.timeoutMs),...selectionOption(work.input.model_selection),response_format:{type:'json_object'},enable_thinking:false}};
    // Capability is detected by presence, never by probing with try/catch: a
    // failed stream must surface as a failure, not silently re-bill as a second call.
    const streaming=this.llm.completeViaStream;
    const complete=streaming
      ?streaming.call(this.llm,request,{onContentDelta:(_delta,full)=>live.text(full)})
      :this.llm.complete(request);
    let timer:ReturnType<typeof setTimeout>|undefined;
    let result:LLMCompletionResult;
    try{result=await Promise.race([complete,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('LEARNING_TIMEOUT')),Math.min(scene.timeoutMs,hard.timeoutMs));})]);}finally{if(timer)clearTimeout(timer);}
    await live.close();
    signal.throwIfAborted();await report({phase:'validating',received_chars:result.text.length});const raw=parseLightTickJson(result.text);
    let draft:Record<string,any>;
    if(briefIntake){
      draft=briefIntakeOutput(raw);
    }else if(routeWork){
      const brief=courseBrief(work.input.brief),document=courseDocument(raw,brief);
      for(const old of work.input.frozen??[])if(canonical(old)!==canonical(document.lessons[old.number-1]))fail(422,'AI draft changed an already published lesson blueprint.');
      await report({lesson_count_so_far:document.lessons.length});
      draft={brief,document};
    }else if(review){
      draft=validateReportFeedback(resolveReportQuotes(raw,quotes),work.input.submission);
    }else{
      // 2.7：lesson_draft 在上方已走 performUnified，这里只剩 route_draft/report_review/brief_intake。
      // 旧的第二套课节标题与分隔线校验已删除，避免与 learning-work-generation.ts 互相矛盾。
      fail(422,'Unsupported learning work kind for the legacy generation path.');
    }
    return {...draft,prompt_version:LIGHTTICK_PROMPT_VERSION,scene_key:hard.key,provider:result.provider,model:result.providerModel};
  }
  private async performUnified(work:LearningWork,sources:LearningSource[],signal:AbortSignal,report:(patch:Partial<LearningWorkProgress>)=>Promise<void>,live:ProgressCoalescer):Promise<Record<string,any>>{
    const scene=await this.resolveScene(learningGenerationScene(work.kind));
    const prepared=prepareLearningGeneration(work,sources,scene);
    await report({phase:'calling_model'});
    const result=await this.callScene(work,prepared.request,prepared.timeoutMs,signal,live,true);
    signal.throwIfAborted();
    await report({phase:'validating',received_chars:result.text.length});
    let draft=validateLearningGeneration(prepared,result) as Record<string,any>;
    // A 路线：design 已在生成校验里变成必填，故课节草稿一律走盲解，不再有省略 design 的短路。
    if(work.kind!=='lesson_draft')return draft;

    let verdict=await this.blindSolve(work,sources,draft,signal);
    let repairs=0;
    if(!verdict.answerable){
      // 3.4 只允许一次定向修复：把缺失条件作为 repair_targets 重写，二次仍不可解则失败且不发布。
      repairs=1;
      await report({phase:'calling_model'});
      const repair=prepareLearningGeneration(work,sources,scene,verdict.missing_conditions);
      const repaired=await this.callScene(work,repair.request,repair.timeoutMs,signal,live,true);
      signal.throwIfAborted();
      await report({phase:'validating',received_chars:repaired.text.length});
      draft=validateLearningGeneration(repair,repaired) as Record<string,any>;
      if(!draft.design)fail(422,'The repaired lesson must keep its design block.');
      verdict=await this.blindSolve(work,sources,draft,signal);
      if(!verdict.answerable)fail(422,'Lesson exercise is still unsolvable after one targeted repair; the lesson is not published.');
    }
    // 3.3 结论只留档在 work 输出，不进入阅读器正文。
    return {...draft,solvability:{...verdict,repairs}};
  }
  /** 3.5 复用当前 work 的 usageOwner 与模型选择，不新建计费主体；超时/取消路径与 lesson_draft 一致。 */
  private async callScene(work:LearningWork,request:LLMCompletionRequest,timeoutMs:number,signal:AbortSignal,live:ProgressCoalescer|undefined,streamToLive:boolean):Promise<LLMCompletionResult>{
    const full:LLMCompletionRequest={...request,signal,usageOwner:{appId:work.appId,userId:work.userId},
      providerOptions:{...selectionOption(work.input.model_selection),response_format:{type:'json_object'},enable_thinking:false,
        zookLightTickTimeoutMs:timeoutMs,
        ...(work.kind==='tutor_turn'||work.kind==='route_refine'?{zookLogBodyMode:'suppress'}:{})}};
    // 与其它学习场景一致：优先流式，把已收到的正文推成进度，失败不静默重试。
    // 盲解检查不流式：它的 JSON 是内部裁决，推给阅读器就等于泄露答案分析。
    const streaming=streamToLive?this.llm.completeViaStream:undefined;
    const complete=streaming
      ?streaming.call(this.llm,full,{onContentDelta:(_delta,text)=>live?.text(text)})
      :this.llm.complete(full);
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([complete,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('LEARNING_TIMEOUT')),timeoutMs);})]);}finally{if(timer)clearTimeout(timer);}
  }
  private async blindSolve(work:LearningWork,sources:LearningSource[],draft:Record<string,any>,signal:AbortSignal):Promise<SolvabilityVerdict>{
    const scene=await this.resolveScene('lesson_solvability'),hard=LIGHTTICK_AI_SCENES.lesson_solvability;
    const input=solvabilityInput(draft.design,draft.content,sources);
    const user=`${LIGHTTICK_SCENE_PROMPTS.lesson_solvability}\nOUTPUT_JSON_SCHEMA=${JSON.stringify(SOLVABILITY_OUTPUT_SCHEMA)}\nINPUT_JSON=${JSON.stringify(input)}`;
    const timeoutMs=Math.min(scene.timeoutMs,hard.timeoutMs);
    if(Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT+user)>Math.min(scene.maxContextTokens,hard.maxContextTokens))fail(422,'Lesson context exceeds the blind solve scene capacity.');
    const result=await this.callScene(work,{modelKey:scene.modelAlias,messages:[{role:'system',content:LIGHTTICK_SYSTEM_PROMPT},{role:'user',content:user}],
      maxTokens:Math.min(scene.maxOutputTokens,hard.maxOutputTokens),temperature:0.2},timeoutMs,signal,undefined,false);
    signal.throwIfAborted();
    return parseSolvability(parseLightTickJson(result.text));
  }
}
