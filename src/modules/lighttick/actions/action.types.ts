import type { LightTickOwner } from '../lighttick.types.ts';
export type Json = Record<string, any>;
export type ActionPeriod = 'year'|'month'|'week'|'day';
export interface ActionFields {
 title:string; period:ActionPeriod; horizon:'short'|'long'; start_date:string; end_date:string; timezone:string;
 parent_id:string|null; target_minutes:number; minimum_minutes:number; target_count:number; at:string;
 reminder:boolean; reason:string; if_then:string; target:{kind:string;course:string;plan_id:string;lesson_no:number};
}
export interface ActionPlan extends ActionFields {
 id:string; revision:number; status:'active'|'paused'|'completed'|'archived'; created_at:string; updated_at:string; reminder_at:string;
}
export interface ActionExecution {
 id:string;plan_id:string;title:string;started_at:string;ended_at:string|null;variant:'standard'|'minimum';planned_minutes:number;
 actual_minutes:number;outcome:'running'|'completed'|'minimum'|'partial'|'interrupted';note:string;business_date:string;timezone:string;target:ActionFields['target'];
}
export interface ActionWorkspace {
 plans:ActionPlan[]; records:ActionExecution[]; reviews:Json[];reports:Json[];claims:Record<string,string>;
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
