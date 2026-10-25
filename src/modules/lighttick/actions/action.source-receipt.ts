import type {ActionLink,ActionContentEvent,ActionWorkspace} from './action.types.ts';
/** Identical receipt projection for live delivery and trusted handoff inventory. */
export function sourceReceipt(link:ActionLink,event:ActionContentEvent,w:ActionWorkspace){
 const fact=w.records.find(r=>r.source_event_id===event.event_id&&r.record_kind==='completion');
 return {accepted:true,binding_id:link.binding_id,target_user_id:link.userId,event_id:event.event_id,payload_hash:event.delivery_hash,
  status:event.consumed_by?'completed':'pending',completed_arrangements:event.consumed_by?[event.consumed_by]:[],record_id:fact?.id??null,reason:event.delivery_reason??null};
}
export function handoffEventPayload(event:ActionContentEvent){
 return {event_id:event.event_id,normalized_target:event.normalized_target,confirmed_at:event.confirmed_at,origin_action_id:event.origin_action_id??null,
  source_proof:{version:1,confirmation:event.normalized_target.kind==='article'?'article_read':'lesson_completed'}};
}
