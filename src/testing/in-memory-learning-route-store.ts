import type { LearningRouteRepository, LearningRoute, LearningRouteVersion, RouteLessonLink } from "../modules/lighttick/learning/learning-route.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, ...ids: (string | number)[]) => JSON.stringify([o.appId,o.userId,...ids]);
export class InMemoryLearningRouteStore implements LearningRouteRepository {
  constructor(private readonly facts: LearningRouteRepository["readRouteProgressFacts"]) {}
  readRouteProgressFacts: LearningRouteRepository["readRouteProgressFacts"] = (o,id)=>this.facts(o,id);
  private routes = new Map<string,LearningRoute>();
  private versions = new Map<string,LearningRouteVersion>();
  private links = new Map<string,RouteLessonLink>();
  snapshot() { return structuredClone({ routes: [...this.routes], versions: [...this.versions], links: [...this.links] }); }
  restore(s: ReturnType<InMemoryLearningRouteStore["snapshot"]>) { this.routes=new Map(s.routes);this.versions=new Map(s.versions);this.links=new Map(s.links); }
  deleteOwner(o: LightTickOwner) { for (const map of [this.routes,this.versions,this.links]) for (const [id,r] of map) if(r.appId===o.appId&&r.userId===o.userId)map.delete(id); }
  async getLearningRoute(o: LightTickOwner,id: string) { return structuredClone(this.routes.get(key(o,id))); }
  async listLearningRoutes(o: LightTickOwner,after: string,limit: number,publishedOnly=false) {
    return structuredClone([...this.routes.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&(!publishedOnly||r.publishedVersion>0)&&Buffer.compare(Buffer.from(r.id),Buffer.from(after))>0).sort((a,b)=>Buffer.compare(Buffer.from(a.id),Buffer.from(b.id))).slice(0,limit));
  }
  async saveLearningRoute(row: LearningRoute,base: number) {
    if ((this.routes.get(key(row,row.id))?.revision??0)!==base) throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Course route changed.");
    this.routes.set(key(row,row.id),structuredClone(row));
  }
  async getLearningRouteVersion(o: LightTickOwner,id: string,v: number) {return structuredClone(this.versions.get(key(o,id,v)));}
  async insertLearningRouteVersion(r: LearningRouteVersion) {
    if(this.versions.has(key(r,r.routeId,r.version)))throw Error("Immutable route version already exists");
    this.versions.set(key(r,r.routeId,r.version),structuredClone(r));
  }
  async listRouteLessonLinks(o: LightTickOwner,id: string) {return structuredClone([...this.links.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.routeId===id).sort((a,b)=>a.number-b.number));}
  async insertRouteLessonLink(r: RouteLessonLink) {
    if(this.links.has(key(r,r.routeId,r.number))||[...this.links.values()].some(v=>key(v,v.lessonId)===key(r,r.lessonId)))throw Error("Course lesson already linked");
    this.links.set(key(r,r.routeId,r.number),structuredClone(r));
  }
}
