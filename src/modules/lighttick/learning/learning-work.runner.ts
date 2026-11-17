import {REPORT_PROMPT,REPORT_SCHEMA,validateReportFeedback} from './work-report-practice.ts';
import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { randomUUID } from "node:crypto";
import type { LLMManager } from "../../../services/llm-manager.ts";
import { courseGenerationContext } from "./learning-generation-context.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT } from "../ai/lighttick-ai-prompts.ts";
import { parseLightTickJson } from "../ai/lighttick-ai-validation.ts";
import type { LearningWork, LearningWorkProgress } from "./learning-work.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, LearningWorkService } from "./learning-work.service.ts";
import { collectLearningSources, type LearningSourceAdapters } from "./learning-sources.ts";
import { courseBrief, courseDocument } from "./learning-route.validation.ts";
import { canonical, text, digest, keys, fail } from "./native-learning.validation.ts";

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
      if(!row||['succeeded','failed','cancelled'].includes(row.status)||row.status==='running'&&row.leaseUntil!>now)return;
      if(row.attempt>=LEARNING_WORK_LIMITS.attempts){await this.service.store.save({...row,revision:row.revision+1,status:'failed',fence:null,leaseUntil:null,errorCode:'ATTEMPTS_EXHAUSTED',updatedAt:now},row.revision);return;}
      const active=(await this.service.store.recent(owner,'1970-01-01T00:00:00.000Z')).filter(r=>r.status==='running'&&r.leaseUntil!>now);
      if(active.length>=LEARNING_WORK_LIMITS.concurrentPerOwner)return;
      const claimed:LearningWork={...row,revision:row.revision+1,status:'running',attempt:row.attempt+1,fence:randomUUID(),leaseUntil:new Date(this.native.clock().getTime()+Math.max(LEARNING_WORK_LIMITS.leaseMs,row.kind==='lesson_draft'?105000:0)).toISOString(),errorCode:null,updatedAt:now,
        progress:{phase:'claimed',received_chars:0,lesson_count_so_far:0,updated_at:now}};
      await this.service.store.save(claimed,row.revision);return claimed;
    });
  }
  private async check(work:LearningWork){
    await this.authorizeOwner(work);
    const current=await this.service.store.get(work,work.id),a=await this.repo.getLearningAuthority(work),r=await this.repo.learningRoutes.getLearningRoute(work,work.routeId);
    if(!current||current.status!=='running'||current.fence!==work.fence||!this.native.enabled||!a?.readingEnabled||a.phase!=='zook'||a.epoch!==work.epoch||
      (work.kind==='report_review'&&!a.privateEnabled)||(r?.revision??0)!==work.baseRouteRevision||r?.status==='archived'||current.leaseUntil!<=this.native.clock().toISOString())throw Error('LEARNING_CONTEXT_STALE');
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
    // 外层看门狗必须宽于内层模型超时（内层是 min(场景配置, 代码默认)），否则它会先掐断调用。
    // 只有真正调模型的四类任务需要长预算；纯文件类任务保持 30 秒，卡住能更快暴露。
    const modelKinds=['route_draft','route_refine','lesson_draft','report_review'];
    const watchdogMs=modelKinds.includes(work.kind)?Math.max(LIGHTTICK_AI_SCENES.learning_route.timeoutMs,LIGHTTICK_AI_SCENES.learning_lesson.timeoutMs):30000;
    const timeout=setTimeout(()=>controller.abort(Error('LEARNING_TIMEOUT')),watchdogMs);
    const poll=setInterval(()=>{if(polling)return;polling=true;void this.check(work).catch(()=>controller.abort(Error('LEARNING_CONTEXT_STALE'))).finally(()=>{polling=false;});},1000);
    try{
      await this.check(work);
      const perform=this.perform(work,controller.signal,report);
      output=await Promise.race([perform,new Promise<never>((_,reject)=>{controller.signal.addEventListener('abort',()=>reject(controller.signal.reason),{once:true});if(controller.signal.aborted)reject(controller.signal.reason);})]);
      await this.check(work);controller.signal.throwIfAborted();
    }catch(error:any){failure=controller.signal.aborted?String(controller.signal.reason?.message??'LEARNING_CANCELLED'):
      error?.details?.provider_status===401?'PERSONAL_MODEL_AUTH_REQUIRED':['LEARNING_CONTEXT_STALE','LEARNING_TIMEOUT'].includes(error?.message)?error.message:error?.code==='FILE_ACCESS_DENIED'?'FILE_ACCESS_DENIED':error?.statusCode===409&&work.input.model_selection?.mode==='personal'?'PERSONAL_MODEL_SETTINGS_CHANGED':error?.statusCode===403?'LEARNING_CONTEXT_STALE':error?.statusCode===422?'LEARNING_OUTPUT_INVALID':'LEARNING_PROVIDER_UNAVAILABLE';}
    finally{clearTimeout(timeout);clearInterval(poll);controller.abort();}
    return this.repo.transaction(owner,async()=>{
      const current=await this.service.store.get(owner,id);
      if(!current||current.status!=='running'||current.fence!==work.fence)return current;
      try{await this.authorizeOwner(owner);}catch{failure='LEARNING_CONTEXT_STALE';}
      if(current.leaseUntil!<=this.native.clock().toISOString())return current;
      // A newer owner transaction may withdraw consent after the network call finished.
      const a=await this.repo.getLearningAuthority(owner),route=await this.repo.learningRoutes.getLearningRoute(owner,work.routeId);
      if(!a?.readingEnabled||a.phase!=='zook'||a.epoch!==work.epoch||(work.kind==='report_review'&&!a.privateEnabled)||(route?.revision??0)!==work.baseRouteRevision||route?.status==='archived')failure='LEARNING_CONTEXT_STALE';
      const retry=work.input.model_selection?.mode!=='personal'&&failure&&['LEARNING_PROVIDER_UNAVAILABLE','LEARNING_TIMEOUT'].includes(failure)&&current.attempt<LEARNING_WORK_LIMITS.attempts;
      const next:LearningWork={...current,revision:current.revision+1,status:failure?retry?'queued':'failed':'succeeded',fence:null,leaseUntil:null,output:failure?null:output,errorCode:failure,updatedAt:this.native.clock().toISOString(),
        progress:{...progress,phase:failure?'failed':'done',updated_at:this.native.clock().toISOString()}};
      await this.service.store.save(next,current.revision);return next;
    });
  }
  private async perform(work:LearningWork,signal:AbortSignal,report:(patch:Partial<LearningWorkProgress>)=>Promise<void>):Promise<Record<string,any>>{
    if(work.kind==='file_ingest'){
      if(!this.sources.writeFile)fail(503,"Owner file storage is unavailable.");
      signal.throwIfAborted();
      const file=await this.sources.writeFile(work,work.id,work.input.file_name,work.input.content);
      signal.throwIfAborted();return {file,digest:digest(work.input.content)};
    }
    if(work.kind==='report_review'){
      await this.native.publication(work,work.input.lesson_id,work.input.content_version);
      const scene=await this.resolveScene('learning_practice_review');
      const result=await this.llm.complete({modelKey:scene.modelAlias,messages:[{role:'system',content:REPORT_PROMPT},{role:'user',content:JSON.stringify({rubric:work.input.rubric,submission:work.input.submission,schema:REPORT_SCHEMA})}],maxTokens:Math.min(scene.maxOutputTokens,2200),temperature:0.1,signal,usageOwner:{appId:work.appId,userId:work.userId},providerOptions:{...selectionOption(work.input.model_selection),response_format:{type:'json_object'},enable_thinking:false}});
      return {...validateReportFeedback(parseLightTickJson(result.text),work.input.submission),model:result.providerModel,provider:result.provider,prompt_version:'work-report-v1'};
    }
    const sources=work.input.sources?await collectLearningSources(work,work.input.sources,this.sources,signal):work.input.collected_sources??[];
    if(work.kind==='collect_sources')return {sources};
    const routeWork=work.kind==='route_draft'||work.kind==='route_refine';
    const sceneName=routeWork?'learning_route':'learning_lesson',scene=await this.resolveScene(sceneName),hard=LIGHTTICK_AI_SCENES[sceneName];
    const input:Record<string,any>={...work.input,sources};delete input.collected_sources;
    const context=routeWork?courseGenerationContext(courseBrief(work.input.brief)):null;
    const schema=context?context.schema:{type:'object',additionalProperties:false,required:['content','references'],properties:{content:{type:'string',maxLength:100000},references:{type:'string',maxLength:100000}}};
    const user=`${LIGHTTICK_SCENE_PROMPTS[sceneName]}\n${context?`COURSE_CONSTRAINTS=${JSON.stringify(context.constraints)}\n`:""}OUTPUT_JSON_SCHEMA=${JSON.stringify(schema)}\nINPUT_JSON=${JSON.stringify(input)}`;
    if(Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT+user)>Math.min(scene.maxContextTokens,hard.maxContextTokens))fail(422,'Reviewed source context exceeds learning scene capacity.');
    await report({phase:'calling_model'});
    const complete=this.llm.complete({modelKey:scene.modelAlias,messages:[{role:'system',content:LIGHTTICK_SYSTEM_PROMPT},{role:'user',content:user}],
      maxTokens:Math.min(scene.maxOutputTokens,hard.maxOutputTokens),temperature:0.2,signal,usageOwner:{appId:work.appId,userId:work.userId},
      providerOptions:{zookLightTickTimeoutMs:Math.min(scene.timeoutMs,hard.timeoutMs),...selectionOption(work.input.model_selection),response_format:{type:'json_object'},enable_thinking:false}});
    let timer:ReturnType<typeof setTimeout>|undefined;
    let result:Awaited<typeof complete>;
    try{result=await Promise.race([complete,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('LEARNING_TIMEOUT')),Math.min(scene.timeoutMs,hard.timeoutMs));})]);}finally{if(timer)clearTimeout(timer);}
    signal.throwIfAborted();await report({phase:'validating',received_chars:result.text.length});const raw=parseLightTickJson(result.text);
    let draft:Record<string,any>;
    if(routeWork){
      const brief=courseBrief(work.input.brief),document=courseDocument(raw,brief);
      for(const old of work.input.frozen??[])if(canonical(old)!==canonical(document.lessons[old.number-1]))fail(422,'AI draft changed an already published lesson blueprint.');
      await report({lesson_count_so_far:document.lessons.length});
      draft={brief,document};
    }else{
      keys(raw,['content','references']);const content=text(raw.content,100000,true),references=text(raw.references,100000,true);
      for(const section of ['引导问题','概念','示范','边界','练习','参考分析','自查','记忆提示'])if(!content.includes(section))fail(422,'Lesson teaching sections are incomplete.');
      const exercise=content.indexOf('练习'),analysis=content.indexOf('参考分析');
      if(analysis<=exercise||!content.slice(exercise,analysis).includes('\n---\n'))fail(422,'Separate exercise and reference analysis before publication.');
      const allowed=new Set<string>();
      for(const source of sources){if(source.source.url)allowed.add(source.source.url);for(const match of source.content.matchAll(/https?:\/\/[^\s<>\)\]"，。；]+/g))allowed.add(match[0]);}
      for(const match of (content+'\n'+references).matchAll(/https?:\/\/[^\s<>\)\]"，。；]+/g))if(!allowed.has(match[0]))fail(422,'Lesson references must come from reviewed source material.');
      draft={content,references,source_digests:sources.map((s:any)=>s.digest)};
    }
    return {...draft,prompt_version:LIGHTTICK_PROMPT_VERSION,scene_key:hard.key,provider:result.provider,model:result.providerModel};
  }
}
