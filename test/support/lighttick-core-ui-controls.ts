/** Controls for disposable, synthetic UI acceptance only. No runtime entry imports this file. */
import type { createApplication } from '../../src/app.module.ts';
import { LightTickRecordService } from '../../src/modules/lighttick/lighttick-record.service.ts';
type Runtime = Awaited<ReturnType<typeof createApplication>>;
export function coreUIControls(app:Runtime,owner:{appId:'lighttick';userId:string}) {
 const repo=app.services.lighttickRepository,records=new LightTickRecordService(repo);
 let offline=false,dropPractice=false;
 let lessonId="lesson-core-shared",oldVersion="";
 const learning=app.services.lighttickRuntime.nativeLearning;
 return {
  get offline(){return offline;},
  takePracticeDrop(){const value=dropPractice;dropPractice=false;return value;},
  async handle(url:URL):Promise<unknown|undefined>{
   if(url.pathname==='/__reset'){offline=false;await repo.deleteOwnerData(owner);return {};}
   if(url.pathname==='/__offline'){offline=url.searchParams.get('value')!=='0';return {};}
   if(url.pathname==='/__online'){offline=false;return {};}
   if(url.pathname==='/__health')return {ok:true,offline};
   if(url.pathname==='/__core-records')return records.list(owner,{});
   if(url.pathname==='/__conflict'){
    const rows=await repo.listRecords(owner),row=rows.find(r=>r.id===url.searchParams.get('id'))??rows[0];
    if(!row)throw Error('Missing synthetic record');
    const {raw_text,record_date,prompt_kind,guided_answers,tags}=row.payload;
    await records.mutate(owner,row.id,'save',{raw_text:raw_text+' remote conflict',record_date,prompt_kind,guided_answers,tags,base_version:row.version},'core-conflict-'+Date.now());return {};
   }
   if(url.pathname==='/__core_learning_seed'||url.pathname==='/__practice_seed'){
    offline=false;await repo.deleteOwnerData(owner);lessonId=url.pathname==='/__practice_seed'?'lesson-practice-ui':'lesson-core-shared';
    const authority=await learning.authority(owner);
    if(authority&&!(authority.readingEnabled&&authority.privateEnabled))await learning.consent(owner,{base_revision:authority.revision,reading_enabled:true,private_enabled:true},'core-consent-'+Date.now());
    await learning.saveCollection(owner,'core-shared',{base_revision:0,title:'Core published learning',archived:false},'core-collection');
    const publication=await learning.publish(owner,lessonId,{base_revision:0,collection_id:'core-shared',number:1,title:'Core published lesson',content:'# Core lesson\n\nA published source.\n\n## 思考题\n- What evidence supports this?',references:'',source_url:''},'core-publication');
    oldVersion=publication.content_version;
    await learning.privateCommand(owner,lessonId,{action:'save',content_version:oldVersion,base_revision:0,notes:'Core v1 note',answers:[{id:'q1',prompt:'What evidence supports this?',answer:'Core v1 answer'}],draft_version:oldVersion},'core-note');
    await learning.privateCommand(owner,lessonId,{action:'position',content_version:oldVersion,base_revision:0,position:3},'core-position');
    await learning.privateCommand(owner,lessonId,{action:'complete',content_version:oldVersion,base_revision:0},'core-completed');
    return {id:lessonId,title:'Core published lesson',content_version:oldVersion};
   }
   if(url.pathname==='/__core_learning_state'){
    if(!oldVersion){const op=await repo.getOperation(owner,'learning:core-publication');oldVersion=String(op?.resultPayload?.content_version??'');}
    const publication=await learning.publication(owner,lessonId).catch(()=>undefined);
    return {id:lessonId,old_version:oldVersion,authority:await learning.authority(owner),publication,
     old_private:await learning.privateState(owner,lessonId,oldVersion).catch(()=>null),
     current_private:publication ? await learning.privateState(owner,lessonId,publication.lesson.publishedVersion!).catch(()=>null) : null};
   }
   if(url.pathname==='/__core_learning_publish_next'){
    const current=await learning.publication(owner,lessonId);
    return learning.publish(owner,lessonId,{base_revision:current.lesson.revision,collection_id:'core-shared',number:1,title:'Core published lesson',content:'# Revised Core lesson\n\n## 思考题\n- What changed?',references:'',source_url:''},'core-publication-next');
   }
   if(url.pathname==='/__core_learning_revoke'||url.pathname==='/__core_learning_regrant'){
    const a=(await learning.authority(owner))!;
    const enabled=url.pathname.endsWith('regrant');
    return learning.consent(owner,{base_revision:a.revision,reading_enabled:enabled,private_enabled:enabled},'core-consent-'+a.revision+'-'+enabled);
   }
   if(url.pathname==='/__actions_snapshot')return app.services.lighttickRuntime.actions.request(owner,'GET','');
   if(url.pathname==='/__practice_drop_next'){dropPractice=true;return {};}
   return undefined;
  }
 };
}
