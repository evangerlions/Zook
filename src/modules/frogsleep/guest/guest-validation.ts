import { createHash,createHmac,timingSafeEqual } from 'node:crypto';
import { ApplicationError,badRequest } from '../../../shared/errors.ts';
export const guestHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const guestToken=(secret:string,user:string,device:string)=>'fs_upg_'+createHmac('sha256',secret).update(JSON.stringify(['frogsleep-upgrade-v1',user,device])).digest('base64url');
export function sameHash(a:string,b:string) {return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
export function guestString(value:unknown,field:string,min=1,max=200):string {
  if(typeof value!=='string'||value.length<min||value.length>max||value.trim()!==value||value.includes('\0')) badRequest('REQ_INVALID_BODY',`Invalid ${field}.`);
  return value;
}
export function guestKey(value:unknown):string {
  if(typeof value!=='string'||!value.trim()||value.length>200||value.includes('\0')) badRequest('REQ_INVALID_HEADER','Idempotency-Key is required (max 200 characters).');
  return value;
}
export function guestFields(body:Record<string,unknown>,fields:string[]) {if(Object.keys(body).some(k=>!fields.includes(k))) badRequest('REQ_INVALID_BODY','Unknown guest request field.');}
export function guestUnavailable():never {throw new ApplicationError(401,'FROGSLEEP_GUEST_PROOF_INVALID','Guest credentials are invalid or unavailable.');}
