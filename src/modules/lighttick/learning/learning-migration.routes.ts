import type {LightTickOwner} from '../lighttick.types.ts';
import type {LearningRoute,LearningRouteVersion,RouteLessonLink} from './learning-route.types.ts';
import type {LearningCollection,NativeLesson,LessonPublication} from './native-learning.types.ts';
import type {LearningRouteRepository} from './learning-route.types.ts';
import {courseBrief,courseDocument} from './learning-route.validation.ts';
import {object,keys,identity,integer,version,digest,canonical,fail} from './native-learning.validation.ts';
export interface ImportedRoutes {routes:LearningRoute[];versions:LearningRouteVersion[];links:RouteLessonLink[]}
export function readImportedRoutes(owner:LightTickOwner,value:unknown,collections:LearningCollection[],lessons:NativeLesson[],publications:LessonPublication[],frozenAt:string):ImportedRoutes{
 const result:ImportedRoutes={routes:[],versions:[],links:[]};
 if(value===undefined)return result;
 if(!Array.isArray(value)||value.length>100)fail(422,'At most 100 formal course routes can be imported in one sealed bundle.');
 for(const raw of value){
  const r=object(raw);keys(r,['id','revision','published_version','status','brief','document','versions','lesson_links']);
  const id=identity(r.id,'plan-'),revision=integer(r.revision,1,2147483646),publishedVersion=integer(r.published_version,0,1000);
  if(id.length>75||!/^plan-[a-zA-Z0-9-]+$/.test(id)||result.routes.some(v=>v.id===id)||!['draft','active','paused','archived'].includes(r.status)||(!publishedVersion)!==(r.status==='draft'))fail(422,'Formal course route identity, status or version is invalid.');
  const brief=courseBrief(r.brief),document=courseDocument(r.document,brief);
  if(!Array.isArray(r.versions)||r.versions.length!==publishedVersion||!Array.isArray(r.lesson_links)||r.lesson_links.length>200)fail(422,'Every published course version and lesson relationship must be retained.');
  for(const [index,rawVersion]of r.versions.entries()){
   const v=object(rawVersion);keys(v,['version','brief','document','created_at']);
   if(v.version!==index+1)fail(422,'Course history versions must be consecutive.');
   const b=courseBrief(v.brief),d=courseDocument(v.document,b),created=v.created_at;
   if(created!==null&&(typeof created!=='string'||!/^\d{4}-\d\d-\d\dT/.test(created)||!Number.isFinite(Date.parse(created))))fail(422,'Invalid course publication time; retain unknown as null.');
   result.versions.push({...owner,routeId:id,version:v.version,brief:b,document:d,digest:digest({brief:b,document:d}),createdAt:created as string|null});
  }
  const latest=result.versions.find(v=>v.routeId===id&&v.version===publishedVersion),collection=collections.find(c=>c.id===id);
  if(publishedVersion&&(!collection||collection.title!==latest!.brief.title||collection.archived!==(r.status==='archived')))fail(422,'Formal route must match its preserved reading collection and archive grant.');
  for(const [index,rawLink]of r.lesson_links.entries()){
   const l=object(rawLink);keys(l,['number','lesson_id','route_version','first_content_version']);
   const number=integer(l.number,1,364),lessonId=identity(l.lesson_id,'lesson-'),routeVersion=integer(l.route_version,1,publishedVersion),firstContentVersion=version(l.first_content_version);
   const lesson=lessons.find(v=>v.id===lessonId);
   if(number!==index+1||!lesson||lesson.collectionId!==id||lesson.number!==number||result.links.some(x=>x.lessonId===lessonId)||!publications.some(p=>p.lessonId===lessonId&&p.contentVersion===firstContentVersion))fail(422,'Course lesson mapping or original content version is invalid.');
   const original=result.versions.find(v=>v.routeId===id&&v.version===routeVersion)?.document.lessons[number-1];
   if(!original)fail(422,'Course publication references a missing blueprint.');
   for(const later of result.versions.filter(v=>v.routeId===id&&v.version>=routeVersion))if(canonical(later.document.lessons[number-1])!==canonical(original))fail(409,'Imported course history changed an already published lesson blueprint.');
   result.links.push({...owner,routeId:id,number,lessonId,routeVersion,firstContentVersion});
  }
  if(lessons.some(l=>l.collectionId===id&&!result.links.some(x=>x.routeId===id&&x.lessonId===l.id)))fail(422,'Formal course export omitted a published lesson relationship.');
  result.routes.push({...owner,id,revision,publishedVersion,status:r.status as LearningRoute['status'],brief,document,updatedAt:frozenAt});
 }
 if(result.versions.length>1000)fail(413,'Formal route history exceeds this sealed bundle capacity.');
 return result;
}
export async function verifyImportedRoutes(store:LearningRouteRepository,owner:LightTickOwner,expected:ImportedRoutes){
 for(const r of expected.routes)if(digest(await store.getLearningRoute(owner,r.id))!==digest(r))fail(409,'Formal route digest mismatch.');
 for(const v of expected.versions)if(digest(await store.getLearningRouteVersion(owner,v.routeId,v.version))!==digest(v))fail(409,'Formal route version digest mismatch.');
 for(const r of expected.routes)if(digest(await store.listRouteLessonLinks(owner,r.id))!==digest(expected.links.filter(l=>l.routeId===r.id)))fail(409,'Formal route lesson mapping mismatch.');
}
