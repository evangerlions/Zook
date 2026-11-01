import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";

test("retention operations reports aggregate authoritative grants and require an admin session",async()=>{
 const runtime=await createApplication({adminBasicAuth:{username:"reviewer",password:"ReviewPass123!"}});
 const stores=resolveBodyLogStores(runtime.database);
 await stores.retention.save({id:"qa-grant",kind:"grant",userId:"private-user",data:{source:"invitation",type:"premium",startsAt:new Date(Date.now()-1000).toISOString(),endsAt:new Date(Date.now()+86400000).toISOString()}});
 const path="/api/v1/admin/apps/bodylog/retention/metrics";
 assert.equal((await runtime.app.handle({method:"GET",path,headers:{}})).statusCode,401);
 const login=await runtime.app.handle({method:"POST",path:"/api/v1/admin/auth/login",headers:{},body:{username:"reviewer",password:"ReviewPass123!"}});
 const cookie=login.headers!["Set-Cookie"]!.split(";")[0]!;
 const response=await runtime.app.handle({method:"GET",path,headers:{cookie}});
 assert.equal(response.statusCode,200);
 assert.deepEqual(response.body.data.rewards,[{source:"invitation",type:"premium",state:"active",count:1}]);
 assert.equal(response.body.data.invitationBusiness.attributed,0);
 assert.ok(!JSON.stringify(response.body.data).includes("private-user"));
 assert.equal((await stores.retention.list("grant","private-user")).length,1,"Reading reports never issues new rewards.");
});
