import {randomUUID} from 'node:crypto';
import {ApplicationError} from '../../../shared/errors.ts';
import type {LightTickRepository} from '../lighttick.repository.ts';
import type {LightTickOwner} from '../lighttick.types.ts';
import type {AlipayOptions} from '../../billing/alipay-models.ts';
import type {BillingEnvironment} from '../../billing/billing-environment.ts';
import {alipayConfigured,parseAlipayMoney,alipayPaidAt,addMembershipPeriod} from '../../billing/alipay-policy.ts';
import {readAlipayFullRefund} from '../../billing/alipay-refund.ts';
import {parseAlipayNotify} from '../../billing/alipay-notify.ts';
import {OfficialAlipayGateway} from '../../../services/ainovel-alipay-gateway.ts';
import {billingPolicy,subscriptionFromOrders} from './commerce-policy.ts';
import type {LightTickOrder,PaidPlan,LightTickPaymentGateway} from './commerce.types.ts';
export type LightTickAlipayOptions=Partial<Record<BillingEnvironment,Omit<AlipayOptions,'gateway'> & {gateway?:LightTickPaymentGateway}>>;
const fail=(status:number,message:string):never=>{throw new ApplicationError(status,status===404?'LIGHTTICK_RESOURCE_NOT_FOUND':status===409?'LIGHTTICK_VERSION_CONFLICT':status===422?'REQ_FIELD_INVALID':'BILLING_PROVIDER_UNAVAILABLE',message);};
export function publicOrder(o:LightTickOrder){const {id,environment,planId,amountMinor,currency,status,createdAt,expiresAt,paidAt,startsAt,endsAt}=o;return {id,environment,planId,amountMinor,currency,status,createdAt,expiresAt,paidAt,startsAt,endsAt};}
export class LightTickCommerceService {
  constructor(private readonly repo:LightTickRepository,private readonly readConfig:()=>Promise<unknown>,
    private readonly options:LightTickAlipayOptions,private readonly accountActive:(id:string)=>Promise<boolean>,private readonly now=()=>new Date(),private readonly authorizeNew=async()=>{}){}
  private gateway(e:BillingEnvironment){const option=this.options[e];if(!option||!alipayConfigured({...option,environment:e,gateway:option.gateway as any}))return fail(503,'支付宝商户尚未配置，请稍后再试。');return option.gateway??new OfficialAlipayGateway({...option,gateway:undefined,environment:e});}
  private configured(e:BillingEnvironment){const o=this.options[e];return !!o&&alipayConfigured({...o,environment:e,gateway:o.gateway as any});}
  async catalog(e:BillingEnvironment){const policy=billingPolicy(await this.readConfig());return {environment:e,plans:(['premium','professional'] as const).map(planId=>({planId,amountMinor:policy.prices[planId]??null,currency:'CNY',period:'month',storageLimit:policy.limits[planId],available:this.configured(e)&&!!policy.prices[planId]}))};}
  async read(o:LightTickOwner,e:BillingEnvironment,id:string){const order=await this.repo.getPaymentOrder(o,e,id);if(!order)return fail(404,'订单不存在。');return order;}
  async create(o:LightTickOwner,e:BillingEnvironment,key:string,planId:PaidPlan,quotedAmount?:number){
    if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key)||!['premium','professional'].includes(planId))return fail(422,'请选择套餐并提供有效请求标识。');
    // Price and merchant identity are frozen before a cashier link is generated.
    const order=await this.repo.transaction(o,async()=>{
      const previous=await this.repo.getPaymentOrder(o,e,key);
      if(previous){if(previous.planId!==planId||(quotedAmount!==undefined&&previous.amountMinor!==quotedAmount))return fail(409,'原购买请求对应另一套餐，请先恢复原订单。');return previous;}
      await this.authorizeNew();
      if(!await this.accountActive(o.userId))return fail(403,'账户不可购买。');
      const price=billingPolicy(await this.readConfig()).prices[planId];if(!price)return fail(503,'套餐暂未销售。');if(quotedAmount!==undefined&&quotedAmount!==price)return fail(409,'套餐价格已变化，请刷新并重新确认价格。');this.gateway(e);
      const pending=(await this.repo.listPaymentOrders(o,e)).filter(r=>r.status==='pending'&&r.expiresAt>this.now().toISOString());
      if(pending.length>=3)return fail(409,'请先核对已有待付款订单。');
      const id=randomUUID(),now=this.now();const value:LightTickOrder={id,userId:o.userId,environment:e,requestKey:key,planId,
        merchantOrderId:'lt_'+id.replaceAll('-',''),merchantAppId:this.options[e]!.appId!,sellerId:this.options[e]!.sellerId??'',amountMinor:price,currency:'CNY',status:'pending',createdAt:now.toISOString(),expiresAt:new Date(+now+30*60000).toISOString(),paidAt:null,transactionId:null,startsAt:null,endsAt:null};
      await this.repo.savePaymentOrder(value);return value;
    });
    return this.checkout(order);
  }
  async checkout(order:LightTickOrder){
    if(order.status!=='pending'||order.expiresAt<=this.now().toISOString())return {order:publicOrder(order),payment:null};
    const current=this.options[order.environment];if(current?.appId!==order.merchantAppId||(current?.sellerId??'')!==order.sellerId)return fail(503,'原订单商户暂不可用，请保留订单并稍后核对。');
    let payment;
    try { payment=await this.gateway(order.environment).checkout({orderId:order.merchantOrderId,amountMinor:order.amountMinor,subject:`LightTick ${order.planId==='premium'?'高级':'专业'}版 · 一个月（不自动续费）`,sellerId:order.sellerId,expiresAt:order.expiresAt,platform:'web',checkoutMode:'desktop_web'}); } catch { return fail(503,'收银台暂不可用，原订单已保留，请稍后恢复。'); }
    return {order:publicOrder(order),payment};
  }
  async sync(o:LightTickOwner,e:BillingEnvironment,id:string){const order=await this.read(o,e,id);
    const current=this.options[e];if(current?.appId!==order.merchantAppId||(current?.sellerId??'')!==order.sellerId)return fail(503,'原订单商户暂不可用。');
    const evidence=await this.gateway(e).query(order.merchantOrderId,AbortSignal.timeout(20000));
    if(evidence.code==='40004'&&evidence.sub_code==='ACQ.TRADE_NOT_EXIST')return publicOrder(order);
    return publicOrder(await this.settle(order,evidence,false));
  }
  async notify(body:unknown){const fields=parseAlipayNotify(body as Buffer);const stored=await this.repo.findMerchantPaymentOrder(fields.out_trade_no??'');
    if(!stored||!await this.gateway(stored.environment).verifyNotify(fields))return fail(422,'无效支付通知。');
    await this.settle(stored,fields,true);
  }
  private async settle(stored:LightTickOrder,v:Record<string,unknown>,notify:boolean){
    if((!notify&&v.code!=='10000')||v.out_trade_no!==stored.merchantOrderId||parseAlipayMoney(v.total_amount)!==stored.amountMinor||
      (notify&&v.app_id!==stored.merchantAppId)||(v.app_id!==undefined&&v.app_id!==stored.merchantAppId)||
      (stored.sellerId&&v.seller_id!==stored.sellerId)||typeof v.trade_no!=='string'||!v.trade_no)return fail(422,'支付核对未通过，权益未变更。');
    const o={appId:'lighttick' as const,userId:stored.userId};
    return this.repo.transaction(o,async()=>{
      const order=await this.read(o,stored.environment,stored.id);
      if(order.transactionId&&order.transactionId!==v.trade_no)return fail(409,'支付交易标识不一致。');
      const now=this.now();const refund=readAlipayFullRefund(v,order.amountMinor,order.paidAt??order.createdAt,now);
      if(refund){order.status='refunded';order.refundedAt=refund.refundedAt;order.transactionId=v.trade_no as string;await this.repo.savePaymentOrder(order);return order;}
      if(order.status==='refunded')return order;
      if(['TRADE_SUCCESS','TRADE_FINISHED'].includes(String(v.trade_status))){
        const paid=alipayPaidAt(v.gmt_payment??v.send_pay_date);
        if(!paid||new Date(Date.parse(paid)+8*3600000).toISOString().slice(0,19).replace('T',' ')!==String(v.gmt_payment??v.send_pay_date)||Date.parse(paid)<Date.parse(order.createdAt)-300000||Date.parse(paid)>+now+300000)return fail(422,'付款时间无法核对。');
        if(order.status!=='paid'){
          order.status='paid';order.paidAt=paid;order.transactionId=v.trade_no as string;
          if(!order.accountDeletedAt&&await this.accountActive(order.userId)){
            const same=(await this.repo.listPaymentOrders(o,order.environment)).filter(r=>r.status==='paid'&&r.planId===order.planId&&r.endsAt).map(r=>r.endsAt!).sort().at(-1);
            order.startsAt=new Date(Math.max(Date.parse(paid),Date.parse(same??paid))).toISOString();order.endsAt=addMembershipPeriod(new Date(order.startsAt),'plus_monthly');
          }
          await this.repo.savePaymentOrder(order);
          const subscription=subscriptionFromOrders(await this.repo.listPaymentOrders(o,order.environment),now);
          if(subscription)await this.repo.saveUserSubscription(subscription);
        }
      } else if(v.trade_status==='TRADE_CLOSED'&&order.status==='pending'){order.status='closed';order.transactionId=v.trade_no as string;await this.repo.savePaymentOrder(order);}
      return order;
    });
  }
}
