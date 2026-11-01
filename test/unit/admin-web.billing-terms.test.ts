import assert from 'node:assert/strict';
import test from 'node:test';
import { BILLING_TERMS, billingTermValue } from '../../apps/admin-web/app/lib/billing-terms.ts';

test('billing concepts have distinct names, canonical wire values and consistent display labels',()=>{
  assert.equal(BILLING_TERMS.provider.label,'支付服务商');
  assert.equal(BILLING_TERMS.source.label,'支付来源');
  assert.equal(BILLING_TERMS.platform.label,'运行平台');
  assert.equal(BILLING_TERMS.distribution.label,'分发类型');
  assert.equal(BILLING_TERMS.environment.label,'支付环境');
  assert.equal(billingTermValue('source','play_store'),'Google Play');
  assert.equal(billingTermValue('distribution','google_play'),'Google Play');
  assert.equal(billingTermValue('source','app_store'),'App Store');
  assert.equal(billingTermValue('provider','revenuecat'),'RevenueCat');
  assert.equal(billingTermValue('source','alipay'),billingTermValue('provider','alipay'));
  assert.equal(billingTermValue('platform','ios'),'iOS');
  assert.equal(billingTermValue('platform','macos'),'macOS');
  assert.equal(billingTermValue('tier','plus'),'Plus');
  assert.equal(billingTermValue('environment','sandbox'),'沙箱环境');
  assert.equal(billingTermValue('environment','SANDBOX'),'沙箱环境');
  assert.equal(billingTermValue('environment','PRODUCTION'),'正式环境');
  for(const term of Object.values(BILLING_TERMS)){
    assert.equal(new Set(term.options.map(option=>option.value)).size,term.options.length);
    assert.notEqual(term.label,'渠道');
  }
});

test('unknown billing values retain diagnostic identity without becoming another provider or market',()=>{
  assert.equal(billingTermValue('provider',null),'—');
  assert.equal(billingTermValue('provider',undefined),'—');
  assert.equal(billingTermValue('provider','unexpected'),'未知（unexpected）');
  assert.equal(billingTermValue('distribution','xiaomi'),'未知（xiaomi）');
  assert.equal(billingTermValue('market','xiaomi'),'小米');
  assert.equal(billingTermValue('market','vivo'),'vivo');
  assert.equal(billingTermValue('market',null),'未知渠道');
});
