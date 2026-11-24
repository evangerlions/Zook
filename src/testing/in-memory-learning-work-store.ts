import type { LearningWork, LearningWorkProgress, LearningWorkRepository, TutorObservation } from "../modules/lighttick/learning/learning-work.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key=(o:LightTickOwner,id:string)=>JSON.stringify([o.appId,o.userId,id]);
export class InMemoryLearningWorkStore implements LearningWorkRepository {
  private values=new Map<string,LearningWork>();
  private observations = new Map<string, TutorObservation>();
  countOwner(o:LightTickOwner){return [...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId).length;}
  snapshot() { return structuredClone({ work: [...this.values], observations: [...this.observations] }); }
  restore(snapshot: ReturnType<InMemoryLearningWorkStore["snapshot"]>) {
    this.values = new Map(snapshot.work);
    this.observations = new Map(snapshot.observations);
  }
  deleteOwner(owner: LightTickOwner) {
    for (const [id, row] of this.values) if (row.appId === owner.appId && row.userId === owner.userId) this.values.delete(id);
    for (const [id, row] of this.observations) if (row.appId === owner.appId && row.userId === owner.userId) this.observations.delete(id);
  }
  async reportAttempts(o:LightTickOwner,id:string,version:string){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.kind==='report_review'&&r.input.lesson_id===id&&r.input.content_version===version).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,50));}
  async tutorTurns(owner: LightTickOwner, lessonId: string, contentVersion: string) {
    const rows = [...this.values.values()].filter(row =>
      row.appId === owner.appId && row.userId === owner.userId && row.kind === "tutor_turn" &&
      row.input.lesson_id === lessonId && row.input.content_version === contentVersion,
    );
    return structuredClone(rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(0, 51));
  }
  async tutorObservation(owner: LightTickOwner, lessonId: string) {
    return structuredClone(this.observations.get(key(owner, lessonId)));
  }
  async saveTutorObservation(row: TutorObservation, baseRevision: number) {
    const id = key(row, row.lessonId);
    if ((this.observations.get(id)?.revision ?? 0) !== baseRevision)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Learning observation changed.");
    this.observations.set(id, structuredClone(row));
  }
  async get(o:LightTickOwner,id:string){return structuredClone(this.values.get(key(o,id)));}
  async save(r:LearningWork,base:number){if((this.values.get(key(r,r.id))?.revision??0)!==base)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Learning work changed.");this.values.set(key(r,r.id),structuredClone(r));}
  async progress(o:LightTickOwner,id:string,fence:string,value:LearningWorkProgress){const row=this.values.get(key(o,id));if(!row||row.fence!==fence||row.status!=='running')return;row.progress=structuredClone(value);}
  async list(o:LightTickOwner,after:string,limit:number){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.id>after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,limit));}
  async recent(o:LightTickOwner,since:string){return structuredClone([...this.values.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.createdAt>=since).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,201));}
  async recoverable(now:string,limit:number){return structuredClone([...this.values.values()].filter(r=>!r.browserGenerationId&&(r.status==='queued'||r.status==='running'&&r.leaseUntil!==null&&r.leaseUntil<=now)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id)).slice(0,limit));}
}
