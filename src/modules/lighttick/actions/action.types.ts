import type { LightTickOwner } from '../lighttick.types.ts';
export type Json = Record<string, any>;
export type ActionPeriod = 'year'|'month'|'week'|'day';
export type ActionMode = 'time'|'content'|'check';
export interface ActionTarget {kind:string;course?:string;plan_id?:string;lesson_no?:number;}
export interface ActionFields {
 title:string; period:ActionPeriod; horizon:'short'|'long'; start_date:string|null; end_date:string|null; timezone:string;
 parent_id:string|null; target_minutes:number|null; minimum_minutes:number|null; target_count:number; at:string|null;
 reminder:boolean; reason:string; if_then:string; target:ActionTarget|null; completion_mode:ActionMode; estimated_minutes:number|null;
}
export interface ActionPlan extends ActionFields {
 id:string; revision:number; status:'active'|'paused'|'completed'|'archived'; created_at:string; updated_at:string; reminder_at:string|null;
 schema_version:1|2; completed_at:string|null; completion_record_id:string|null;
}
export interface ActionExecution {
 id:string;plan_id:string;title:string;started_at:string;ended_at:string|null;variant:'standard'|'minimum';planned_minutes:number|null;
 actual_minutes:number;outcome:'running'|'completed'|'minimum'|'partial'|'interrupted'|'recorded'|'reopened';note:string;business_date:string;timezone:string;target:ActionFields['target'];
 schema_version:1|2;record_kind:'session'|'completion'|'reversal';completion_mode:ActionMode;completion_effect:'none'|'complete'|'reopen';
 planned_date:string|null;date_basis:'legacy_planned'|'actual_start'|'actual_confirmation';
 reverses_record_id?:string;source_event_id?:string;recorded_at?:string;
}
/** Private inventory populated by the verified source bridge; never a raw client input. */
export interface ActionContentEvent {
 event_id:string;owner_id:string;normalized_target:ActionTarget;confirmed_at:string;origin_action_id?:string|null;
 planned_date_at_confirmation?:string|null;timezone_at_confirmation?:string;consumed_by?:string;
 delivery_hash?:string;binding_id?:string;delivery_reason?:string;
 handoff_source?:{account_id:string;request_key:string;request_hash:string};
}
export interface ActionWorkspace {
 plans:ActionPlan[]; records:ActionExecution[]; reviews:Json[];reports:Json[];claims:Record<string,string>;
 content_sources?:ActionTarget[];content_events?:ActionContentEvent[];
 legacy_operations?:Record<string,{hash:string;result:Json}>;
}
export interface ActionWorkspaceRow extends LightTickOwner { data:ActionWorkspace;version:number; }
export interface ActionTicket extends LightTickOwner { hash:string;expires_at:string;source_account_id?:string; }
export interface ActionLink extends LightTickOwner { source_account_id:string;binding_id:string;phase:'staged'|'active';import_hash?:string;receipt?:Json; }
export interface ActionRepository {
 lockActionOwner(owner:LightTickOwner):Promise<void>;
 getActionWorkspace(owner:LightTickOwner):Promise<ActionWorkspaceRow|undefined>;
 saveActionWorkspace(row:ActionWorkspaceRow):Promise<void>;
 getActionTicket(hash:string):Promise<ActionTicket|undefined>;
 saveActionTicket(ticket:ActionTicket):Promise<void>;
 getActionLink(sourceAccountId:string):Promise<ActionLink|undefined>;
 getOwnerActionLink(owner:LightTickOwner):Promise<ActionLink|undefined>;
 saveActionLink(link:ActionLink):Promise<void>;
}
export const emptyWorkspace=():ActionWorkspace=>({plans:[],records:[],reviews:[],reports:[],claims:{}});
