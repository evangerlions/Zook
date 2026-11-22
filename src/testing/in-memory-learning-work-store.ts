import type { LearningWork, LearningWorkRepository, TutorObservation } from "../modules/lighttick/learning/learning-work.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key=(o:LightTickOwner,id:string)=>JSON.stringify([o.appId,o.userId,id]);
export class InMemoryLearningWorkStore implements LearningWorkRepository {
  private values=new Map<string,LearningWork>();
  private observations = new Map<string,TutorObservation>();
  countOwner(o:LightTickOwner){return [...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId).length;}
  snapshot(){return structuredClone({work:[...this.values], observations:[...this.observations]});}
  restore(v:ReturnType<InMemoryLearningWorkStore["snapshot"]>){this.values=new Map(v.work);this.observations=new Map(v.observations);}
  deleteOwner(o:LightTickOwner){for(const [k,r]of this.values)if(r.appId===o.appId&&r.userId===o.userId)this.values.delete(k);for (const [k,r] of this.observations) if (r.appId===o.appId&&r.userId===o.userId) this.observations.delete(k);}
  async courseSummaries(o:LightTickOwner,collection:string,after:string,limit:number){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.kind==="course_summary"&&r.routeId===collection&&r.id>after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit));}
  async reportAttempts(o:LightTickOwner,id:string,version:string){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.kind==='report_review'&&r.input.lesson_id===id&&r.input.content_version===version).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,50));}
  async tutorTurns(o:LightTickOwner,id:string,version:string){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.kind==='tutor_turn'&&r.input.lesson_id===id&&r.input.content_version===version).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,51));}
  async get(o:LightTickOwner,id:string){return structuredClone(this.values.get(key(o,id)));}
  async save(r:LearningWork,base:number){if((this.values.get(key(r,r.id))?.revision??0)!==base)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Learning work changed.");this.values.set(key(r,r.id),structuredClone(r));}
  async list(o:LightTickOwner,after:string,limit:number){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.id>after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit));}
  async tutorObservation(owner:LightTickOwner,lessonId:string) {
    return structuredClone(this.observations.get(key(owner,lessonId)));
  }
  async saveTutorObservation(row:TutorObservation,base:number) {
    const id = key(row,row.lessonId);
    if ((this.observations.get(id)?.revision??0)!==base) throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Learning observation changed.");
    this.observations.set(id,structuredClone(row));
  }
  async recent(o:LightTickOwner,since:string){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.createdAt>=since).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,201));}
  async recoverable(now:string,limit:number,tutorOnly?:boolean){return structuredClone([...this.values.values()].filter(r=>!r.browserGenerationId&&(tutorOnly===undefined||(r.kind==='tutor_turn')===tutorOnly)&&(r.status==='queued'||r.status==='running'&&r.leaseUntil!==null&&r.leaseUntil<=now)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,limit));}
}
