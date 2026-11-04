import { badRequest } from '../../../shared/errors.ts';
import { parseIsoTimestamp } from '../frogsleep-validation.ts';
const fail = (field:string):never => badRequest('REQ_INVALID_BODY',`Invalid raw sleep session: ${field}.`);
function validateJson(value: unknown) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const { value: item, depth } = pending.pop()!;
    if (depth > 32 || typeof item === 'number' && !Number.isFinite(item)) fail('JSON depth or non-finite number');
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) pending.push({ value: child, depth: depth + 1 });
    }
  }
}
function timestamp(value:unknown,field:string):string {
  if(typeof value!=='string'||!/^\d{4}-\d\d-\d\d[tT]\d\d:\d\d:\d\d(?:\.\d+)?(?:[zZ]|[+-]\d\d:\d\d)$/.test(value)) fail(field);
  return parseIsoTimestamp(value,field);
}
/** Terminal history only: restored data never resumes device locks or timers. */
export function rawSleepSession(body:Record<string,unknown>):Record<string,unknown> {
  const fields=['session_id','schema_version','status','started_at','ended_at','scheduled_wake_at','sleep_intent','timezone','data','events','user_id','owner_user_id'];
  if(Object.keys(body).some(k=>!fields.includes(k))) fail('unknown field');
  if(typeof body.session_id!=='string'||!body.session_id.trim()||body.session_id.length>200||body.session_id.includes('\0')) fail('session_id');
  if(body.schema_version!=='1') fail('schema_version');
  if(typeof body.status!=='string'||!['completed','cancelled','interrupted'].includes(body.status)) fail('status');
  if(typeof body.sleep_intent!=='string'||!['night_sleep','daytime_nap','catch_up_sleep'].includes(body.sleep_intent)) fail('sleep_intent');
  if(typeof body.timezone!=='string'||body.timezone.length>100) fail('timezone');
  try { new Intl.DateTimeFormat('en',{timeZone:body.timezone as string}); } catch { fail('timezone'); }
  if(!body.data||typeof body.data!=='object'||Array.isArray(body.data)) fail('data');
  validateJson(body);
  if(Buffer.byteLength(JSON.stringify(body))>131072) fail('payload exceeds 128 KiB');
  const started_at=timestamp(body.started_at,'started_at'),ended_at=timestamp(body.ended_at,'ended_at');
  if(ended_at<started_at) fail('ended_at precedes started_at');
  const scheduled_wake_at=body.scheduled_wake_at===undefined?undefined:timestamp(body.scheduled_wake_at,'scheduled_wake_at');
  if(scheduled_wake_at&&scheduled_wake_at<started_at) fail('scheduled_wake_at precedes started_at');
  const events=body.events??[];
  if(!Array.isArray(events)||events.length>512) fail('events');
  const ids=new Set<string>();
  const normalized=events.map(event=>{
    if(!event||typeof event!=='object'||Array.isArray(event)) fail('event');
    if(Object.keys(event).some(k=>!['event_id','type','occurred_at','data'].includes(k))) fail('event field');
    if(typeof event.event_id!=='string'||!event.event_id.trim()||event.event_id.length>200||event.event_id.includes('\0')||ids.has(event.event_id)) fail('event_id');
    ids.add(event.event_id);
    if(typeof event.type!=='string'||!/^[a-z][a-z0-9_]{0,63}$/.test(event.type)) fail('event type');
    if(!event.data||typeof event.data!=='object'||Array.isArray(event.data)) fail('event data');
    const occurred_at=timestamp(event.occurred_at,'occurred_at');
    if(occurred_at<started_at||occurred_at>ended_at) fail('event outside session');
    return {...event,occurred_at};
  });
  return {session_id:body.session_id,schema_version:'1',status:body.status,started_at,ended_at,...(scheduled_wake_at?{scheduled_wake_at}:{}),sleep_intent:body.sleep_intent,timezone:body.timezone,data:body.data,events:normalized};
}
