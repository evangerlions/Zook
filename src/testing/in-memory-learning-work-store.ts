import type { LearningWork, LearningWorkRepository } from "../modules/lighttick/learning/learning-work.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key=(o:LightTickOwner,id:string)=>JSON.stringify([o.appId,o.userId,id]);
export class InMemoryLearningWorkStore implements LearningWorkRepository {
  private values=new Map<string,LearningWork>();
  snapshot(){return structuredClone([...this.values]);}
  restore(v:ReturnType<InMemoryLearningWorkStore["snapshot"]>){this.values=new Map(v);}
  deleteOwner(o:LightTickOwner){for(const [k,r]of this.values)if(r.appId===o.appId&&r.userId===o.userId)this.values.delete(k);}
  async get(o:LightTickOwner,id:string){return structuredClone(this.values.get(key(o,id)));}
  async save(r:LearningWork,base:number){if((this.values.get(key(r,r.id))?.revision??0)!==base)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Learning work changed.");this.values.set(key(r,r.id),structuredClone(r));}
  async list(o:LightTickOwner,after:string,limit:number){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.id>after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit));}
  async recent(o:LightTickOwner,since:string){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.createdAt>=since).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,201));}
  async recoverable(now:string,limit:number){return structuredClone([...this.values.values()].filter(r=>r.status==='queued'||r.status==='running'&&r.leaseUntil!==null&&r.leaseUntil<=now).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,limit));}
}
