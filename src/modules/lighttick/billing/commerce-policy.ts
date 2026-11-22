import { ApplicationError } from '../../../shared/errors.ts';
import type { BillingPolicy, LightTickOrder } from './commerce.types.ts';
import type { UserSubscription } from '../learning/native-learning.types.ts';
export const LIGHTTICK_BILLING_DEFAULTS:BillingPolicy={limits:{basic:500*1024**2,premium:5*1024**3,professional:50*1024**3},prices:{premium:2900,professional:9900}};
// Missing prices never fall back to seed prices. The versioned delivery config owns sales.
export function billingPolicy(raw:unknown):BillingPolicy {
  const billing=(raw as any)?.billing;
  const limits={...LIGHTTICK_BILLING_DEFAULTS.limits};const prices:BillingPolicy['prices']={};
  for(const p of ['basic','premium','professional'] as const) {
    const n=billing?.limits?.[p];if(Number.isSafeInteger(n)&&n>0)limits[p]=n;
  }
  for(const p of ['premium','professional'] as const) {
    const n=billing?.prices?.[p];if(Number.isSafeInteger(n)&&n>0&&n<=100000000)prices[p]=n;
  }
  return {limits,prices};
}
export function validateLightTickBilling(appId:string,raw:string) {
  if(appId!=='lighttick')return;const b=JSON.parse(raw)?.billing;if(b===undefined)return;
  if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!['limits','prices'].includes(k)))throw new ApplicationError(422,'REQ_FIELD_INVALID','Invalid LightTick billing configuration.');
  for(const [field,allowed] of [['limits',['basic','premium','professional']],['prices',['premium','professional']]] as const) {
    const values=b[field];if(values===undefined)continue;
    if(!values||typeof values!=='object'||Array.isArray(values)||Object.entries(values).some(([k,v])=>!allowed.includes(k as never)||!Number.isSafeInteger(v)||Number(v)<=0||Number(v)>(field==='prices'?100000000:Number.MAX_SAFE_INTEGER)))throw new ApplicationError(422,'REQ_FIELD_INVALID','Billing amounts and limits must be positive integer minor units/bytes.');
  }
}
export function storageLimit(policy:BillingPolicy,sub:UserSubscription|undefined,now=new Date()):number {
  const active=sub?.status==='active'&&Date.parse(sub.currentPeriodStart)<=+now&&Date.parse(sub.currentPeriodEnd)>+now;
  const plan=active&&sub?.planId in policy.limits?sub!.planId as keyof BillingPolicy['limits']:'basic';return policy.limits[plan];
}
export function subscriptionFromOrders(orders:LightTickOrder[],now=new Date()):UserSubscription|undefined {
  const active=orders.filter(o=>o.status==='paid'&&!o.accountDeletedAt&&o.startsAt&&o.endsAt&&Date.parse(o.startsAt)<=+now&&Date.parse(o.endsAt)>+now).sort((a,b)=>(b.planId==='professional'?2:1)-(a.planId==='professional'?2:1)||b.endsAt!.localeCompare(a.endsAt!));
  const o=active[0];return o?{userId:o.userId,environment:o.environment,planId:o.planId,status:'active',currentPeriodStart:o.startsAt!,currentPeriodEnd:o.endsAt!,cancelAtPeriodEnd:true,paymentMethod:{type:'alipay'},createdAt:o.createdAt,updatedAt:o.paidAt!}:undefined;
}
export function assertStorageCapacity(used:number,limit:number,additional:number) {
  if(additional>0&&used+additional>limit)throw new ApplicationError(402,'LIGHTTICK_STORAGE_QUOTA_EXCEEDED','存储容量不足，请升级套餐后重试；原有内容和本地草稿已保留。',{used_bytes:used,limit_bytes:limit,additional_bytes:additional,settings_path:'/grow/settings'});
}
