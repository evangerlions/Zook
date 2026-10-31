import type {LightTickOwner} from '../lighttick.types.ts';
import type {LightTickRecord,LightTickRecordRow} from '../lighttick-record.service.ts';
export interface RecordSource {instance:string;subject:string;}
export interface RecordTransferRow extends LightTickOwner {
 sourceKey:string;binding_id:string;source:RecordSource;operation_id:string;
 phase:'prepared'|'staged'|'active'|'readonly'|'cancelled';snapshot_hash?:string;snapshot?:RecordPackage;receipt?:Record<string,unknown>;
}
export interface RecordTransferTicket extends LightTickOwner {hash:string;expires_at:string;claimed_source?:string;operation_id?:string;}
export interface RecordPackage {
 format_version:1;source_instance:string;source_subject:string;operation_id:string;
 entries:{source_id:string;record:LightTickRecord;versions:LightTickRecord[];private_history:Record<string,unknown>;missing_versions?:number[]}[];
}
export interface RecordTransferRepository {
 lockRecordSource(sourceKey:string):Promise<void>;
 getRecordTransfer(sourceKey:string):Promise<RecordTransferRow|undefined>;
 getOwnerRecordTransfer(owner:LightTickOwner):Promise<RecordTransferRow|undefined>;
 saveRecordTransfer(row:RecordTransferRow):Promise<void>;
 getRecordTransferTicket(hash:string):Promise<RecordTransferTicket|undefined>;
 saveRecordTransferTicket(row:RecordTransferTicket):Promise<void>;
 importRecord(row:LightTickRecordRow,versions:LightTickRecord[],sourceHistory:Record<string,unknown>):Promise<void>;
 recordSourceHistory(owner:LightTickOwner,id:string):Promise<Record<string,unknown>|undefined>;
}
