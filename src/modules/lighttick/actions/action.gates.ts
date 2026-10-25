import type {HttpResponse} from '../../../shared/types.ts';
import {ApplicationError} from '../../../shared/errors.ts';
import {reject} from './action.validation.ts';

export const actionErrorCodes=new Set(['LIGHTTICK_RESOURCE_NOT_FOUND','VALIDATION_ERROR','REVISION_CONFLICT','STATE_CONFLICT','RUNNING_CONFLICT',
 'DUPLICATE_SCHEDULE','FUTURE_ACTION','UNSCHEDULED_ACTION','COMPLETION_EVIDENCE_MISSING','CONTRACT_UPGRADE_REQUIRED','SOURCE_EVENT_CONFLICT','SOURCE_PROOF_INVALID','SOURCE_DELIVERY_UNAVAILABLE']);

export function requireActionSchema(value:unknown) {
 if(value!==2&&value!=='2')reject(409,'行动合同版本需升级。','CONTRACT_UPGRADE_REQUIRED',{reason:'CONTRACT_SCHEMA_VERSION'});
}

/** A separate opt-in preserves the default closed behavior of earlier P0 releases. */
export function rejectConnectionWrite(enabled=false):void {
 if(!enabled)reject(409,'P0连接写入尚未开放，输入已保留。','CONTRACT_UPGRADE_REQUIRED',{reason:'CONNECTION_WRITES_DISABLED'});
}

export function actionErrorResponse(error:unknown,requestId:string):HttpResponse<unknown>|undefined {
 if(!(error instanceof ApplicationError)||!actionErrorCodes.has(error.code))return;
 const details=error.details as Record<string,unknown>|undefined,data:Record<string,unknown>={retryable:error.statusCode>=500};
 if(details){
  if(typeof details.reason==='string')data.reason=details.reason;
  if(typeof details.existing_plan_id==='string')data.existing_plan_id=details.existing_plan_id;
  if(Number.isInteger(details.current_revision))data.current_revision=details.current_revision;
 }
 return {statusCode:error.statusCode,headers:{'Cache-Control':'no-store'},body:{code:error.code,message:error.message,
  data:Object.keys(data).length?data:null,requestId}};
}
