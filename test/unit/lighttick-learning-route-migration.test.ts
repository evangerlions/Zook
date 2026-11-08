import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {NativeLearningService} from '../../src/modules/lighttick/learning/native-learning.service.ts';
import {LearningMigrationService} from '../../src/modules/lighttick/learning/learning-migration.service.ts';
import {LearningRouteService} from '../../src/modules/lighttick/learning/learning-route.service.ts';
import {routeProgress} from '../../src/modules/lighttick/learning/learning-route.progress.ts';
import {digest} from '../../src/modules/lighttick/learning/native-learning.validation.ts';
import {courseMigrationFixture} from '../support/learning-route-migration-fixture.ts';
test('sealed course migration preserves formal route versions, unpublished draft, unknown time and original lesson relationships',async()=>{
 const f=courseMigrationFixture(),owner={appId:'lighttick' as const,userId:f.bundle.mapping.target_user_id},repo=new InMemoryLightTickRepository(),native=new NativeLearningService(repo,true),migration=new LearningMigrationService(native);
 const preview=await migration.preflight(owner,f.bundle,f.digest);assert.equal(preview.counts.routes,1);assert.equal(preview.counts.route_versions,2);assert.equal(preview.counts.route_links,1);
 for(const action of ['freeze','import','verify','activate'] as const){const a=await repo.getLearningAuthority(owner);await migration.command(owner,action,f.bundle,f.digest,a?.revision??0,'course-migrate-'+action);}
 const routes=new LearningRouteService(native);
 assert.equal((await routes.read(owner,f.id)).brief.goal,'Unpublished local source draft');
 assert.equal((await routes.read(owner,f.id,1)).created_at,null);
 assert.equal((await routes.read(owner,f.id,2)).brief.goal,'Second formal goal');
 assert.equal((await routeProgress(native,owner,f.id)).version,2);
 assert.equal((await routeProgress(native,owner,f.id)).lessons[0].lesson_id,f.lesson);
 assert.equal((await repo.learningRoutes.listRouteLessonLinks(owner,f.id))[0].firstContentVersion,f.old);
 const state=await native.privateState(owner,f.lesson,f.current);
 await native.privateCommand(owner,f.lesson,{action:'complete',content_version:f.current,base_revision:state.completionRevision},'course-migrated-complete');
 assert.equal((await routeProgress(native,owner,f.id)).completed_lessons,1);
 const a=(await repo.getLearningAuthority(owner))!;await assert.rejects(migration.command(owner,'abort',f.bundle,f.digest,a.revision,'course-migrate-unsafe-rollback'),{statusCode:409});
});
test('course preflight rejects lost relationships or rewritten published blueprints and abort clears new staging only',async()=>{
 const f=courseMigrationFixture(),owner={appId:'lighttick' as const,userId:f.bundle.mapping.target_user_id},repo=new InMemoryLightTickRepository(),native=new NativeLearningService(repo,true),migration=new LearningMigrationService(native);
 for(const change of [(b:any)=>{b.routes[0].lesson_links=[];},(b:any)=>{b.routes[0].versions[1].document.lessons[0].goal='Changed published blueprint';}]){
  const bundle=structuredClone(f.bundle);change(bundle);await assert.rejects(migration.preflight(owner,bundle,digest(bundle)));
 }
 for(const action of ['freeze','import'] as const){const a=await repo.getLearningAuthority(owner);await migration.command(owner,action,f.bundle,f.digest,a?.revision??0,'course-verify-'+action);}
 const row=(await repo.learningRoutes.getLearningRoute(owner,f.id))!;await repo.learningRoutes.saveLearningRoute({...row,revision:row.revision+1,brief:{...row.brief,title:'Corrupted staging'}},row.revision);
 const a=(await repo.getLearningAuthority(owner))!;await assert.rejects(migration.command(owner,'verify',f.bundle,f.digest,a.revision,'course-corrupt-verify'),{statusCode:409});
 await migration.command(owner,'abort',f.bundle,f.digest,a.revision,'course-before-activation-abort');
 assert.ok(Object.values(await repo.getNativeLearningCounts(owner)).every(n=>n===0));assert.equal((await repo.getLearningAuthority(owner))!.phase,'legacy');
});
