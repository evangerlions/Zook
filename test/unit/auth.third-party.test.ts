import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign } from 'node:crypto';
import { createApplication } from '../support/create-test-application.ts';
import { supportsThirdParty } from '../../src/modules/auth/third-party/third-party-models.ts';
import { GoogleIdentityVerifier } from '../../src/modules/auth/third-party/google-identity-verifier.ts';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const key = { ...publicKey.export({format:'jwk'}), kid:'test-key', alg:'RS256', use:'sig' };
const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
function token(nonce: string, overrides = {}) {
  const now = Math.floor(Date.now()/1000);
  const message = `${enc({alg:'RS256',kid:'test-key'})}.${enc({iss:'https://accounts.google.com',aud:'test-client',
    sub:'provider-subject',iat:now,exp:now+300,nonce,...overrides})}`;
  return `${message}.${sign('RSA-SHA256',Buffer.from(message),privateKey).toString('base64url')}`;
}
const clients = { async get() { return {clientId:'test-client',secretKey:'provider-secret',teamId:'team',keyId:'key'}; }, async readSecret() { return 'private'; } };
const keys = async () => new Response(JSON.stringify({keys:[key]}), {status:200});
type Runtime = Awaited<ReturnType<typeof createApplication>>;
function call(runtime: Runtime, path: string, body: object, platform='ios', region='GLOBAL', accessToken?: string) {
  return runtime.app.handle({method:'POST',path:`/api/v1/${path}`,headers:{'x-app-id':'ai_novel','x-platform':platform,
    'x-app-region':region,...(accessToken ? {authorization:`Bearer ${accessToken}`} : {})},body:{appId:'ai_novel',...body},ipAddress:'192.0.2.40'});
}
async function authorization(runtime: Runtime, provider='google', platform='ios', region='GLOBAL', extra={}) {
  return call(runtime,'auth/third-party/authorizations',{provider,purpose:'login',clientType:platform==='web'?'web':'app',...extra},platform,region);
}

test('support matrix is explicit for every platform and region', () => {
  const expected = {ios:{CN:['wechat','apple'],GLOBAL:['google','apple']},android:{CN:['wechat'],GLOBAL:['google']},
    ohos:{CN:['wechat'],GLOBAL:[]},macos:{CN:['apple'],GLOBAL:['google','apple']},windows:{CN:[],GLOBAL:['google']},web:{CN:[],GLOBAL:['google']}};
  for (const [platform,regions] of Object.entries(expected)) for (const [region,providers] of Object.entries(regions))
    for (const provider of ['wechat','google','apple']) assert.equal(supportsThirdParty(platform as any,region as any,provider as any),providers.includes(provider),`${platform}:${region}:${provider}`);
});

test('unconfigured providers are unavailable and public config preserves existing auth properties', async () => {
  const runtime = await createApplication({identityAuth:{clients:{
    async get(){return undefined;}, async readSecret(){return undefined;},
  }}});
  const denied = await authorization(runtime);
  assert.equal(denied.statusCode,503);
  const config = await runtime.app.handle({method:'GET',path:'/api/v1/ai_novel/public/config',headers:{'x-app-id':'ai_novel'}});
  assert.equal(config.statusCode,200);
  assert.deepEqual(config.body.data.config.auth.thirdPartyProviders,[]);
  // The server derives readiness without changing existing config fields.
  const original = await runtime.services.adminConsoleService.getPublicConfig("ai_novel");
  assert.deepEqual({...config.body.data.config.auth,thirdPartyProviders:undefined},
    {...(original.config.auth as object || {}),thirdPartyProviders:undefined});
});

test('OrangeWrite mobile WeChat registration requires the managed AppSecret', async () => {
  const runtime = await createApplication();
  try {
    const appId = 'wx55ada0a7ff21dd96';
    const secret = 'wechat-fixture-app-secret';

    assert.equal((await authorization(runtime, 'wechat', 'ios', 'CN')).statusCode, 503);
    await runtime.services.commonPasswordConfigService.set('ainovel.auth.wechat.app-secret', 'WeChat test secret', secret);
    for (const platform of ['ios', 'android', 'ohos']) {
      const response = await authorization(runtime, 'wechat', platform, 'CN');
      assert.equal(response.statusCode, 200);
      assert.equal(response.body.data.parameters.clientId, appId);
      assert.equal(response.body.data.parameters.transport, 'sdk');
      assert.ok(!JSON.stringify(response.body).includes(secret));
      const global = await authorization(runtime, 'wechat', platform, 'GLOBAL');
      assert.equal(global.statusCode, platform === 'ohos' ? 200 : 503);
    }
  } finally {
    await runtime.close();
  }
});

test('signed Google proof validates nonce/audience/expiry/signature and is single use across attempts', async () => {
  const runtime = await createApplication({identityAuth:{clients,fetcher:keys}});
  const capabilities = await runtime.app.identityAuth!.thirdParty.capabilities('ai_novel');
  assert.deepEqual(capabilities.find(row => row.provider === 'apple')!.platforms, ['ios','macos']);
  assert.deepEqual(capabilities.find(row => row.provider === 'wechat')!.platforms, ['ios','android','ohos']);
  const first = await authorization(runtime);
  assert.equal(first.statusCode,200);
  const attempt = first.body.data;
  const login = (id:string, proof:string) => call(runtime,'auth/login/third-party',{
    authorizationId:id,credential:{type:'id_token',idToken:proof},clientType:'app'});
  for (const proof of [token('wrong'),token(attempt.parameters.nonce,{aud:'wrong'}),token(attempt.parameters.nonce,{exp:0}),token(attempt.parameters.nonce).slice(0,-8)+'invalid0']) {
    const denied = await login(attempt.authorizationId,proof);
    assert.equal(denied.statusCode,400);
    assert.equal(denied.body.code,'AUTH_PROVIDER_PROOF_INVALID');
  }
  const proof = token(attempt.parameters.nonce, {email:"google-test@example.com",email_verified:false});
  const result = await login(attempt.authorizationId,proof);
  assert.equal(result.statusCode,200);
  assert.equal(result.body.data.nextAction,'none');
  assert.equal(result.body.data.user.hasPassword,false);
  const replace = await call(runtime,'auth/identity-changes',{kind:'google',expectedMode:'replace'},'ios','GLOBAL',result.body.data.accessToken);
  assert.equal(replace.statusCode,403);
  assert.equal(replace.body.code,'AUTH_VERIFICATION_REQUIRED');
  const bind = await call(runtime,'auth/identity-changes',{kind:'phone',expectedMode:'bind'},'ios','GLOBAL',result.body.data.accessToken);
  assert.equal(bind.statusCode,200);assert.equal(bind.body.data.nextStep,'verify_target');
  assert.deepEqual(result.body.data.user.accountSecurity.bindings, [{kind:'google'}]);
  assert.equal((await login(attempt.authorizationId,proof)).statusCode,400);
  const second = await authorization(runtime);
  assert.equal((await login(second.body.data.authorizationId,proof)).statusCode,400);
  const email = 'google-test@example.com';
  const secondAttempt = second.body.data;
  const reauthorized = await login(secondAttempt.authorizationId,
    token(secondAttempt.parameters.nonce, {email,email_verified:true}));
  assert.equal(reauthorized.statusCode,200);
  assert.equal(reauthorized.body.data.user.id,result.body.data.user.id);
  assert.equal(reauthorized.body.data.user.accountSecurity.revision,result.body.data.user.accountSecurity.revision);
  assert.deepEqual(reauthorized.body.data.user.accountSecurity.bindings, [{kind:'google',displayName:email}]);
  assert.ok(!reauthorized.body.data.user.email);
  const log = JSON.stringify(runtime.logger.records);
  assert.ok(!log.includes(proof) && !log.includes('provider-subject') && !log.includes(email));
});

test('CN mobile phone prompt is offered once and is scoped to the account', async () => {
  const verifier = {async verify(attempt:any) { return {kind:attempt.provider,subject:'stable-wechat-user'}; }};
  const runtime = await createApplication({identityAuth:{clients,verifiers:{google:verifier,apple:verifier,wechat:verifier}}});
  for (let i=0;i<2;i++) {
    const auth = await authorization(runtime,'wechat','ios','CN');
    const result = await call(runtime,'auth/login/third-party',{authorizationId:auth.body.data.authorizationId,
      credential:{type:'authorization_code',code:`code-${i}`,state:auth.body.data.parameters.state},clientType:'app'},'ios','CN');
    assert.equal(result.statusCode,200);
    assert.equal(result.body.data.nextAction,i===0?'bind_phone':'none');
  }
});

test('policy rejects wrong region/platform and Windows fallback; Windows PKCE URL and callback are bounded', async () => {
  const runtime = await createApplication({identityAuth:{clients,fetcher:keys}});
  for (const [provider,platform,region] of [['google','ios','CN'],['apple','android','GLOBAL'],['apple','web','GLOBAL'],['wechat','windows','CN']])
    assert.equal((await authorization(runtime,provider,platform,region)).statusCode,503);
  assert.equal((await authorization(runtime,'google','windows','GLOBAL',{regionSource:'fallback',redirectUri:'http://127.0.0.1:39999/callback'})).statusCode,503);
  assert.equal((await authorization(runtime,'google','windows','GLOBAL',{regionSource:'deviceRegion',redirectUri:'https://attacker.example/callback'})).statusCode,400);
  const auth = await authorization(runtime,'google','windows','GLOBAL',{regionSource:'deviceRegion',redirectUri:'http://127.0.0.1:39999/callback'});
  assert.equal(auth.statusCode,200);
  const url = new URL(auth.body.data.parameters.authorizationUrl);
  assert.equal(url.searchParams.get('code_challenge_method'),'S256');
  assert.equal(url.searchParams.get('state'),auth.body.data.parameters.state);
  assert.ok(!url.searchParams.has('code_verifier') && !url.searchParams.has('access_token'));
  const verifier = new GoogleIdentityVerifier(clients,keys);
  await assert.rejects(() => verifier.verify({platform:'windows',transport:'browser',state:'correct',codeVerifier:'verifier',redirectUri:'http://127.0.0.1:39999/callback'} as any,
    {type:'authorization_code',code:'code',state:'wrong'},{clientId:'test-client'}),{code:'AUTH_PROVIDER_PROOF_INVALID'});
});

test('Web authorization cannot complete using app token delivery semantics', async () => {
  const runtime = await createApplication({identityAuth:{clients,fetcher:keys}});
  const auth = await authorization(runtime,'google','web','GLOBAL');
  const result = await call(runtime,'auth/login/third-party',{authorizationId:auth.body.data.authorizationId,
    credential:{type:'id_token',idToken:token(auth.body.data.parameters.nonce)},clientType:'app'},'web','GLOBAL');
  assert.equal(result.statusCode,400);
  assert.equal(result.body.code,'REQ_INVALID_BODY');
});
