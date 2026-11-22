import type { CommerceRepository,LightTickOrder } from '../../../modules/lighttick/billing/commerce.types.ts';
import type { LightTickOwner } from '../../../modules/lighttick/lighttick.types.ts';
import type { BillingEnvironment } from '../../../modules/billing/billing-environment.ts';
type Query=(sql:string,args?:unknown[])=>Promise<{rows:Record<string,any>[]} >;
export class PostgresLightTickCommerceStore implements CommerceRepository {
  constructor(private readonly query:Query){}
  async getPaymentOrder(o:LightTickOwner,e:BillingEnvironment,id:string){const r=await this.query('SELECT payload FROM zook_lighttick_payment_orders WHERE app_id=$1 AND user_id=$2 AND environment=$3 AND (id::text=$4 OR request_key=$4) AND payload IS NOT NULL',[o.appId,o.userId,e,id]);return r.rows[0]?.payload as LightTickOrder|undefined;}
  async listPaymentOrders(o:LightTickOwner,e:BillingEnvironment){const r=await this.query("SELECT payload FROM zook_lighttick_payment_orders WHERE app_id=$1 AND user_id=$2 AND environment=$3 AND payload IS NOT NULL ORDER BY COALESCE(payload->>'endsAt',created_at::text) DESC,id DESC LIMIT 1000",[o.appId,o.userId,e]);return r.rows.map(r=>r.payload as LightTickOrder);}
  async findMerchantPaymentOrder(id:string){const r=await this.query("SELECT payload FROM zook_lighttick_payment_orders WHERE app_id='lighttick' AND merchant_order_id=$1 AND payload IS NOT NULL",[id]);return r.rows[0]?.payload as LightTickOrder|undefined;}
  async savePaymentOrder(o:LightTickOrder){await this.query(`INSERT INTO zook_lighttick_payment_orders(id,app_id,user_id,plan_id,amount,currency,payment_method,status,transaction_id,created_at,paid_at,refunded_at,environment,merchant_order_id,request_key,payload)
    VALUES($1,'lighttick',$2,$3,$4,'CNY','alipay',$5,$6,$7,$8,$9,$10,$11,$12,$13)
    ON CONFLICT(id) DO UPDATE SET status=$5,transaction_id=$6,paid_at=$8,refunded_at=$9,payload=$13 WHERE zook_lighttick_payment_orders.app_id='lighttick' AND zook_lighttick_payment_orders.user_id=$2 AND zook_lighttick_payment_orders.environment=$10`,[o.id,o.userId,o.planId,o.amountMinor,o.status,o.transactionId,o.createdAt,o.paidAt,o.refundedAt??null,o.environment,o.merchantOrderId,o.requestKey,o]);}
}
