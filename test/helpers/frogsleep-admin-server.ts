import { createServer } from "node:http";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { readRequestBody } from "../../src/infrastructure/http/request-body.ts";
import { PersonalSyncService } from "../../src/modules/frogsleep/personal-sync/personal-sync.service.ts";
import { notificationFixture } from "./frogsleep-notification-fixture.ts";

/** Disposable localhost-only management fixture; it never calls external notification providers. */
export async function createAdminServer(port = 0) {
  process.env.ADMIN_SESSION_COOKIE_SECURE = "false";
  process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = "false";
  process.env.FROGSLEEP_BUDDY_EMAIL_ENABLED = "false";
  const runtime = await createApplication({ frogsleepEnabled: true, kvBackend: new InMemoryKVBackend(), queueBackend: "memory", adminBasicAuth: { username: "sleep-admin", password: "fixture-password" }, databaseFactory: seed => new InMemoryDatabase(seed) });
  await notificationFixture(runtime.database,"admin-browser");
  await new PersonalSyncService(runtime.database.getPersonalSyncRepository()).write("user_alice","sleep_report","browser-report",{ private_report_body: "NEVER_VISIBLE" },false);
  const now=new Date().toISOString();
  for(let i=0;i<60;i++) await runtime.database.upsertFrogSleepDevice({ id:`browser_device_${i}`,appId:"frogsleep",userId:"user_alice",platform:"ios",pushToken:`NEVER_VISIBLE_${i}`,pushEnabled:true,createdAt:now,updatedAt:now });
  await runtime.database.insertNotificationJob({id:"browser-failed",appId:"frogsleep",recipientUserId:"user_alice",channel:"push",payload:{},status:"FAILED",retryCount:2});
  const server=createServer(async (request,response) => {
    const url=new URL(request.url ?? "/","http://127.0.0.1");
    const headers=Object.fromEntries(Object.entries(request.headers).map(([key,value]) => [key,Array.isArray(value)?value.join(","):value]));
    const result=await runtime.app.handle({method:request.method ?? "GET",path:url.pathname,headers,query:Object.fromEntries(url.searchParams),body:await readRequestBody(request,request.headers["content-type"]),ipAddress:"127.0.0.1"});
    response.statusCode=result.statusCode; response.setHeader("Content-Type","application/json");
    for(const [key,value] of Object.entries(result.headers ?? {})) response.setHeader(key,value);
    response.end(JSON.stringify(result.body));
  });
  await new Promise<void>(resolve => server.listen(port,"127.0.0.1",resolve));
  return {server, runtime, close:() => new Promise<void>(resolve => server.close(() => resolve()))};
}
if(process.argv[1]?.endsWith("frogsleep-admin-server.ts")) {
  const fixture=await createAdminServer(3198);
  process.stdout.write("Disposable Sleep admin fixture ready at http://127.0.0.1:3198\n");
  process.once("SIGTERM",() => void fixture.close().then(() => process.exit(0)));
}
