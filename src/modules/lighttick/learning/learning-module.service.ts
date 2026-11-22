import type {NativeLearningService} from "./native-learning.service.ts";
import {fail,identity,integer,keys,object,text} from "./native-learning.validation.ts";
import type {LightTickOwner} from "../lighttick.types.ts";
import type {LearningModule} from "./learning-module.types.ts";
export const MODULE_TEMPLATES = [
  {id:"english-reading",title:"英文阅读",description:"按自己的基础与目标安排阅读和复习"},
  {id:"cognitive-reading",title:"认知阅读",description:"保留原文，区分事实、观点和依据"},
  {id:"daily-cognitive",title:"通识学习",description:"按个人节奏组织主题与问题"},
  {id:"thinking-tools",title:"思维工具",description:"通过个人案例练习分析与决策"},
  {id:"structured-expression",title:"结构化表达",description:"围绕自己的沟通场景组织练习"},
  {id:"deep-writing",title:"深度写作",description:"通过本人作品与反馈持续改进"},
] as const;
export const moduleId=(raw:unknown)=>identity(raw,"module-");
export const moduleFilter=(raw:string|undefined)=>raw===undefined?undefined:raw==="unassigned"?null:moduleId(raw);
export const moduleData=({appId:_,userId:__,templateId,createdAt,updatedAt,...row}:LearningModule)=>({...row,template_id:templateId,created_at:createdAt,updated_at:updatedAt});
export class LearningModuleService {
  constructor(readonly native:NativeLearningService){}
  get repo(){return this.native.repository;}
  async access(owner:LightTickOwner){const a=await this.native.requireActive(owner);if(!a.readingEnabled)fail(403,"请先确认学习阅读授权。");return a;}
  async templates(owner:LightTickOwner){return this.repo.transaction(owner,async()=>{await this.access(owner);return {items:structuredClone(MODULE_TEMPLATES)};});}
  async list(owner:LightTickOwner,query:Record<string,string|undefined>={}){
    const filter=query.filter??"active";if(!["active","archived","all"].includes(filter))fail(422,"模块筛选无效。");
    const limit=query.limit===undefined?50:integer(Number(query.limit),1,100),scope="modules:"+filter;
    return this.repo.transaction(owner,async()=>{const a=await this.access(owner);const rows=await this.repo.learningModules.list(owner,this.native.position(owner,scope,query.cursor??"",a.revision),limit+1,filter as "active"|"archived"|"all");
      const items=rows.slice(0,limit);return {items:items.map(moduleData),next_cursor:rows.length>limit?this.native.cursor(owner,scope,items.at(-1)!.id,a.revision):null};});
  }
  async read(owner:LightTickOwner,id:string){moduleId(id);return this.repo.transaction(owner,async()=>{await this.access(owner);const row=await this.repo.learningModules.get(owner,id);if(!row)fail(404,"未找到本人的学习模块。");return moduleData(row);});}
  async history(owner:LightTickOwner,id:string,before=2147483648){moduleId(id);integer(before,1,2147483648);return this.repo.transaction(owner,async()=>{await this.access(owner);if(!await this.repo.learningModules.get(owner,id))fail(404,"未找到本人的学习模块。");const rows=await this.repo.learningModules.history(owner,id,before,31);const items=rows.slice(0,30);return {items:items.map(moduleData),next_cursor:rows.length>30?String(items.at(-1)!.revision):null};});}
  async save(owner:LightTickOwner,id:string,raw:unknown,key:string,authorize?:()=>Promise<void>){
    moduleId(id);const b=structuredClone(object(raw));keys(b,["base_revision","title","description","template_id","archived"]);
    const base=integer(b.base_revision,0,2147483646),title=text(b.title,200,true),description=text(b.description,2000),templateId=b.template_id===null?null:text(b.template_id,80,true);
    if(templateId!==null&&!MODULE_TEMPLATES.some(t=>t.id===templateId))fail(422,"请选择现有分类建议或留空。");
    if(typeof b.archived!=="boolean")fail(422,"请明确模块归档状态。");
    return this.native.command(owner,key,"module",id,b,async()=>{const old=await this.repo.learningModules.get(owner,id),now=this.native.clock().toISOString();
      const row:LearningModule={...owner,id,title,description,templateId,archived:b.archived as boolean,revision:base+1,createdAt:old?.createdAt??now,updatedAt:now};
      await this.repo.learningModules.save(row,base);return moduleData(row);
    },authorize);
  }
}
