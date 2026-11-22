import type {LearningModule,LearningModuleRepository} from "../modules/lighttick/learning/learning-module.types.ts";
import type {LightTickOwner} from "../modules/lighttick/lighttick.types.ts";
import {ApplicationError} from "../shared/errors.ts";
const key=(o:LightTickOwner,id:string)=>JSON.stringify([o.appId,o.userId,id]);
export class InMemoryLearningModuleStore implements LearningModuleRepository {
  private rows=new Map<string,LearningModule>();
  private versions=new Map<string,LearningModule[]>();
  async get(o:LightTickOwner,id:string){return structuredClone(this.rows.get(key(o,id)));}
  async list(o:LightTickOwner,after:string,limit:number,filter:"active"|"archived"|"all"){
    return structuredClone([...this.rows.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.id>after&&(filter==="all"||r.archived===(filter==="archived"))).sort((a,b)=>a.id<b.id?-1:1).slice(0,limit));
  }
  async save(row:LearningModule,base:number){if((this.rows.get(key(row,row.id))?.revision??0)!==base)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","模块已变化，请保留本机输入并核对。");this.rows.set(key(row,row.id),structuredClone(row));this.versions.set(key(row,row.id),[...(this.versions.get(key(row,row.id))??[]),structuredClone(row)]);}
  async history(o:LightTickOwner,id:string,before:number,limit:number){return structuredClone((this.versions.get(key(o,id))??[]).filter(r=>r.revision<before).reverse().slice(0,limit));}
  snapshot(){return structuredClone({rows:[...this.rows],versions:[...this.versions]});}
  restore(snapshot:ReturnType<InMemoryLearningModuleStore["snapshot"]>){this.rows=new Map(snapshot.rows);this.versions=new Map(snapshot.versions);}
  deleteOwner(o:LightTickOwner){for(const [k,r]of this.rows)if(r.appId===o.appId&&r.userId===o.userId){this.rows.delete(k);this.versions.delete(k);}}
}
