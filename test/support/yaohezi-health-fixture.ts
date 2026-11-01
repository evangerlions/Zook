import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, randomInt } from "node:crypto";
import type { TestContext } from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { readRequestBody } from "../../src/infrastructure/http/request-body.ts";
import { signed, type ClientDevice } from "../../clients/yaohezi-security/client.ts";
import type { DeviceProofCommand, ManagementCommand } from "../../src/modules/yaohezi/security/protocol.ts";

export async function healthFixture(t:TestContext) {
  const databaseUrl=process.env.YAOHEZI_TEST_DATABASE_URL!,redisUrl=process.env.YAOHEZI_TEST_REDIS_URL!;
  if (!databaseUrl || new URL(databaseUrl).hostname!=="127.0.0.1" || !new URL(databaseUrl).pathname.startsWith("/yaohezi_local_")
    || !redisUrl || new URL(redisUrl).hostname!=="127.0.0.1") throw new Error("Isolated local PG/Redis required");
  const kvManager=await KVManager.create({redisUrl});
  t.after(async()=>{await kvManager.disconnect();});
  await kvManager.assertReady();
  const sent:string[]=[];
  const options={smsVerificationSender:{async sendVerificationCode(c:{phoneNumber:string;code:string}) {sent.push(c.code);return {provider:"tencent_sms" as const,phoneNumber:c.phoneNumber};}},databaseUrl,migrationDatabaseUrl:databaseUrl,yaoheziEnabled:true,yaoheziHealthEnabled:true,frogsleepEnabled:false,lighttickEnabled:false,
    kvManager,queueBackend:"memory" as const,accessTokenSecret:"local-m2-synthetic-secret-not-a-deployment-value"};
  let runtime=await createApplication(options);
  t.after(async()=>{await runtime.close();});
  const server=createServer(async(req,res)=>{
    try {
      const url=new URL(req.url!,"http://localhost");
      const result=await runtime.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),
        headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v])),
        body:await readRequestBody(req,req.headers["content-type"]),ipAddress:"127.0.0.1",hostname:"localhost"});
      res.writeHead(result.statusCode,{"content-type":"application/json",...result.headers});res.end(JSON.stringify(result.body));
    } catch {res.writeHead(500);res.end("{}");}
  });
  await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
  t.after(async()=>{await new Promise<void>(r=>server.close(()=>r()));});
  const port=(server.address() as {port:number}).port;
  async function call(path:string,body?:unknown,token?:string,healthToken?:string) {
    const r=await fetch(`http://127.0.0.1:${port}/api/v1/${path}`,{method:body===undefined?"GET":"POST",
      headers:{"content-type":"application/json",...(token?{authorization:`Bearer ${token}`} : {}),...(healthToken?{"x-yaohezi-health-session":healthToken}: {})},
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:r.status,...await r.json()};
  }
  async function loginAccount(appId="yaohezi") {
    const phone=String(15630000000+randomInt(10000000)),base={appId,phone,phoneNa:"+86"};
    assert.equal((await call("auth/login/sms-code",base)).status,200);
    const login=await call("auth/login/sms",{...base,smsCode:sent.at(-1),clientType:"app"});
    assert.equal(login.status,200);return login.data;
  }
  const login=await loginAccount(),token=login.accessToken as string,accountId=login.user.id as string;
  async function health(action:string,body:unknown,healthToken?:string,accountToken=token) {return call("yaohezi/health/"+action,body,accountToken,healthToken);}
  async function challenge(purpose:string,subjectId:string,device:ClientDevice) {
    const r=await health("challenges",{subjectId,purpose,device:device.descriptor});assert.equal(r.status,200,JSON.stringify(r));return r.data;
  }
  function proof(challenge:{subjectId:string;challengeId:string;nonce:string},device:ClientDevice,extras={}) {
    return {version:1 as const,accountId,subjectId:challenge.subjectId,operationId:randomUUID(),challengeId:challenge.challengeId,
      challengeNonce:challenge.nonce,device:device.descriptor,...extras};
  }
  async function session(subjectId:string,device:ClientDevice) {
    const ch=await challenge("sessions",subjectId,device);
    const r=await health("sessions",signed("sessions",proof(ch,device),device.signingPrivateKey));assert.equal(r.status,200,JSON.stringify(r));return r.data;
  }
  function management(subjectId:string,device:ClientDevice,session:{keyEpoch:number;grantVersion:number},extras={}) {
    return {version:1 as const,subjectId,operationId:randomUUID(),actorAccountId:accountId,actorDeviceId:device.descriptor.deviceId,
      grantVersion:session.grantVersion,keyEpoch:session.keyEpoch,expiresAt:Date.now()+240_000,...extras};
  }
  return {origin:`http://127.0.0.1:${port}`,loginAccount,accountId,token,call,health,challenge,proof,session,management,get runtime(){return runtime;},
    async reopen(){await runtime.close();runtime=await createApplication(options);}};
}
