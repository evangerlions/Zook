import {learningMigrationFixture} from './native-learning-migration-fixture.ts';
import {routeFixture} from './learning-route-fixture.ts';
import {digest} from '../../src/modules/lighttick/learning/native-learning.validation.ts';
export function courseMigrationFixture(target='course-migration-owner'){
 const f=learningMigrationFixture(target),course=routeFixture(),id='plan-preserved-course';
 course.brief.title=f.bundle.collections[0].title;course.document.lessons[0].topic=f.bundle.lessons[0].title;
 const versions=[{version:1,...structuredClone(course),created_at:null},{version:2,...structuredClone(course),brief:{...course.brief,goal:'Second formal goal'},created_at:f.bundle.source.frozen_at}];
 const route={id,revision:7,published_version:2,status:'active',...course,brief:{...course.brief,goal:'Unpublished local source draft'},versions,
  lesson_links:[{number:1,lesson_id:f.lesson,route_version:1,first_content_version:f.old}]};
 const bundle={...f.bundle,collections:[{...f.bundle.collections[0],id}],lessons:f.bundle.lessons.map(l=>({...l,collection_id:id})),routes:[route]};
 return {...f,id,bundle,digest:digest(bundle)};
}
