import type { BillingEnvironment } from '../../billing/billing-environment.ts';
import type { AlipayPayment } from '../../billing/alipay-models.ts';
import type { LightTickOwner } from '../lighttick.types.ts';
export type PaidPlan = 'premium'|'professional';
export interface LightTickOrder {
  id:string; userId:string; environment:BillingEnvironment; requestKey:string; planId:PaidPlan;
  merchantOrderId:string; merchantAppId:string; sellerId:string; amountMinor:number; currency:'CNY';
  status:'pending'|'paid'|'closed'|'refunded'; createdAt:string; expiresAt:string; paidAt:string|null;
  accountDeletedAt?:string; refundedAt?:string;
  transactionId:string|null; startsAt:string|null; endsAt:string|null;
}
export interface CheckoutInput {orderId:string;amountMinor:number;subject:string;sellerId:string;expiresAt:string;platform:'web';checkoutMode:'desktop_web'}
export interface LightTickPaymentGateway {
  checkout(input:CheckoutInput):Promise<AlipayPayment>;
  query(orderId:string,signal?:AbortSignal):Promise<Record<string,unknown>>;
  verifyNotify(fields:Record<string,string>):Promise<boolean>;
}
export interface CommerceRepository {
  getPaymentOrder(o:LightTickOwner,environment:BillingEnvironment,id:string):Promise<LightTickOrder|undefined>;
  listPaymentOrders(o:LightTickOwner,environment:BillingEnvironment):Promise<LightTickOrder[]>;
  findMerchantPaymentOrder(id:string):Promise<LightTickOrder|undefined>;
  savePaymentOrder(o:LightTickOrder):Promise<void>;
}
export interface BillingPolicy {limits:Record<'basic'|PaidPlan,number>; prices:Partial<Record<PaidPlan,number>>}
