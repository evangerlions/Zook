import assert from 'node:assert/strict';
import test from 'node:test';
import { billingMarket, validateAlipayMarket } from '../../src/modules/billing/billing-market.ts';
import { parseAlipayCreate } from '../../src/modules/billing/alipay-policy.ts';

test('market uses exact store/build provenance and never guesses Xiaomi/vivo from Alipay or Android',()=>{
  assert.equal(billingMarket({source:'alipay',distribution:'china_android_store'}),null);
  assert.equal(billingMarket({source:'alipay',distribution:'china_android_store',market:'vivo'}),'vivo');
  assert.equal(billingMarket({source:'app_store'}),'app_store');
  assert.equal(billingMarket({source:'play_store'}),'google_play');
  assert.equal(billingMarket({distribution:'web'}),'direct');
  assert.throws(()=>validateAlipayMarket('xiaomi','web'));
  assert.throws(()=>validateAlipayMarket('app_store','china_android_store'));
  assert.throws(()=>validateAlipayMarket('invented','china_android_store'));
  const input={productKey:'plus_yearly',platform:'android',distribution:'china_android_store',idempotencyKey:'market_test_123',market:'xiaomi'};
  assert.equal(parseAlipayCreate(input).market,'xiaomi');
  assert.equal(parseAlipayCreate({...input,market:null}).market,null);
});
