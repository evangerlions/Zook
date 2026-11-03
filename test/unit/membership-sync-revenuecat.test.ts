import assert from 'node:assert/strict';
import test from 'node:test';
import { syncRevenueCatMembership } from '../../src/services/ainovel-revenuecat-membership-sync.ts';
import { RevenueCatV2ReadSession } from '../../src/services/ainovel-revenuecat-read-session.ts';
import { StructuredLogger } from '../../src/infrastructure/logging/pino-logger.module.ts';
import { buildEmptyMembershipInfo } from '../../src/modules/billing/billing-membership.ts';
import type { NormalizedRevenueCatSnapshot } from '../../src/modules/billing/ainovel-revenuecat-normalizer.ts';
test('complete old RC access is not proof of a new purchase; exact verified store transaction is required',async()=>{
 const membership={...buildEmptyMembershipInfo(),active:true,source:'app_store' as const,tier:'plus' as const,planKey:'plus_monthly',managementUrl:null,expiresAt:'2027-01-01T00:00:00Z'};
 const snapshot:NormalizedRevenueCatSnapshot={membership:{...membership,appId:'ai_novel',userId:'alice',lastSyncedAt:'2026-10-26T00:00:00Z',accountDeletedAt:null},transactions:[],purchaseEntitlements:[],ignoredProductCount:0,ignoredEntitlementCount:0,hasActiveUnverifiedEnvironmentEntitlement:false};
 const d={logger:new StructuredLogger('test'),fetchSnapshot:async()=>snapshot,persistSnapshot:async(s:NormalizedRevenueCatSnapshot,id?:string)=>{const transaction=s.transactions.find(t=>t.providerTransactionId===id);return transaction?{transaction,accessSnapshotCurrent:true}:undefined;},getMembership:async()=>membership,now:()=>new Date('2026-10-26T00:00:00Z')};
 const input={userId:'alice',provider:'revenuecat' as const,requestId:'test',purchaseReference:{kind:'store_transaction' as const,id:'new-id'}};
 assert.equal((await syncRevenueCatMembership(input,d)).targetPurchase?.status,'pending');
 snapshot.transactions.push({appId:'ai_novel',userId:'alice',provider:'revenuecat',providerTransactionId:'new-id',productId:'plus_monthly',productKey:'plus_monthly',source:'app_store',platform:'ios',status:'provider_paid',purchasedAt:'2026-10-26T00:00:00Z',originalPurchaseDate:null,expiresAt:membership.expiresAt,refundedAt:null,autoRenew:true,isSandbox:false,amountMinor:3800,refundAmountMinor:null,currency:'CNY',observedAt:'2026-10-26T00:00:00Z',accountDeletedAt:null});
 snapshot.purchaseEntitlements.push({transactionId:'new-id',source:'app_store',state:'active'});
 assert.equal((await syncRevenueCatMembership(input,d)).targetPurchase?.entitlementStatus,'applied');
});
test('RC each HTTP has its own deadline, so a paged lookup may exceed one deadline',async()=>{
 let calls=0;const fetcher:typeof fetch=async()=>{await new Promise(resolve=>setTimeout(resolve,8));calls++;return Response.json({object:'list',items:[],next_page:calls===1?'/v2/projects/project/customers/alice/subscriptions?starting_after=first':null});};
 const session=new RevenueCatV2ReadSession('project','key',fetcher,new AbortController().signal,12);
 assert.deepEqual(await session.list('/customers/alice/subscriptions'),[]);assert.equal(calls,2);
});
