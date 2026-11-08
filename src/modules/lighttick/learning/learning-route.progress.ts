import type { NativeLearningService } from "./native-learning.service.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { fail } from "./native-learning.validation.ts";
// Preserve the legacy Python banker-rounding percentage semantics.
function counts(total: number, published: number, completed: number) {
  const raw=total?completed*100/total:0, lower=Math.floor(raw);
  const percent=raw-lower===0.5 ? lower%2===0?lower:lower+1 : Math.round(raw);
  return {total_lessons:total,published_lessons:published,completed_lessons:completed,percent};
}
export async function routeProgress(native: NativeLearningService, owner: LightTickOwner, id: string) {
  const repo=native.repository;
  return repo.transaction(owner,async()=>{
    const a=await native.requireActive(owner);if(!a.readingEnabled)fail(403,"Reading consent is required.");
    const route=await repo.learningRoutes.getLearningRoute(owner,id);
    if(!route?.publishedVersion)fail(404,"Formal course route is not published.");
    const v=(await repo.learningRoutes.getLearningRouteVersion(owner,id,route.publishedVersion))!;
    const facts=await repo.learningRoutes.readRouteProgressFacts(owner,id);
    const completed=(n:number)=>facts.some(f=>f.number===n&&(a.privateEnabled&&f.completed||f.sourceCompleted));
    const stages=v.document.stages.map((stage,index)=>{
      const specs=v.document.lessons.filter(l=>l.stage===index+1);
      return {number:index+1,title:stage.title,...counts(specs.length,specs.filter(l=>facts.some(f=>f.number===l.number)).length,specs.filter(l=>completed(l.number)).length)};
    });
    return {id,name:v.brief.title,version:v.version,status:route.status as "active"|"paused"|"archived",
      ...counts(v.document.lessons.length,facts.length,v.document.lessons.filter(l=>completed(l.number)).length),stages,
      lessons:v.document.lessons.map(l=>({number:l.number,stage:l.stage,topic:l.topic,requires:l.requires,kind:l.kind,
        lesson_id:facts.find(f=>f.number===l.number)?.lessonId??null,content_version:facts.find(f=>f.number===l.number)?.contentVersion??null,completed:completed(l.number)}))};
  });
}
export async function compatibleRouteProgress(native: NativeLearningService, owner: LightTickOwner, webUrl: string | null) {
  return native.repository.transaction(owner,async()=>{
    const a=await native.requireActive(owner);
    if(!a.readingEnabled||!webUrl)return null;
    const routes=await native.repository.learningRoutes.listLearningRoutes(owner,"",101,true);
    if(routes.length>100)fail(409,"Course progress exceeds compatibility capacity; use paginated routes.");
    const plans=[];
    for(const route of routes){const {lessons,...p}=await routeProgress(native,owner,route.id);
      if(p.name.length>500||p.stages.length>100||p.stages.some(s=>s.title.length>500))fail(409,"Course exceeds legacy progress capacity; use the canonical route projection.");
      plans.push(p);
    }
    if(!plans.length)return null;
    const observed=native.clock().toISOString();
    return {source_revision:a.revision,observed_at:observed,received_at:observed,web_url:webUrl,plans};
  });
}
