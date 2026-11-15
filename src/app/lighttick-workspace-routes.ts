import {billingRequestEnvironment} from "../modules/billing/billing-environment.ts";
import {publicOrder} from "../modules/lighttick/billing/commerce.service.ts";
import { randomUUID } from "node:crypto";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import { ApplicationError } from "../shared/errors.ts";
import { object, keys, integer, text, identity } from "../modules/lighttick/learning/native-learning.validation.ts";
import { LearningContentSyncService } from "../modules/lighttick/learning/content-sync.service.ts";
import { GitHubContentService } from "../modules/lighttick/learning/github-content.service.ts";

const root = "/api/v1/lighttick/";
const unavailable = () => { throw new ApplicationError(503, "LIGHTTICK_CAPABILITY_UNAVAILABLE", "Payment is not available; your subscription was not changed."); };
export async function tryHandleLightTickWorkspaceRoutes(context: BackendRouteContext, enabled: boolean,
  runtime: LightTickRuntime | undefined, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const path = request.path.slice(root.length);
  const sourceMatch = /^learning\/modules\/([a-z][a-z0-9-]{0,79})\/(source|sync|sync-status)$/.exec(path);
  if (!request.path.startsWith(root) || !(path.startsWith("billing/") || path === "storage" || path.startsWith("storage/") || sourceMatch)) return;
  if (!runtime) throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "LightTick is not enabled.");
  if(path==="billing/webhooks/alipay"&&request.method==="POST") {
    if(!runtime.commerce)unavailable();
    if(request.headers["content-type"]?.split(";")[0]?.trim().toLowerCase()!=="application/x-www-form-urlencoded")throw new ApplicationError(415,"BILLING_NOTIFY_INVALID","Alipay requires a form notification.");
    await runtime.commerce!.notify(request.body);
    return {statusCode:200,contentType:"text/plain; charset=utf-8",body:context.ok({received:true},request.requestId!).body,rawBody:"success"};
  }
  if(!enabled)throw new ApplicationError(503,"LIGHTTICK_APP_DISABLED","LightTick is not enabled.");
  const auth = await context.authenticateProductRequest(request, "lighttick");
  const owner = { appId: "lighttick" as const, userId: auth.userId };
  if (await runtime.guestIdentity?.getActive(auth.userId)) throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Registered membership required.");
  await runtime.scopePolicy.assertRequest(request);
  const repo = runtime.repository;
  const reply = (data: unknown) => context.ok(data, request.requestId as string);
  const environment=path.startsWith("billing/")?billingRequestEnvironment(request,runtime.billingDeployment):"production";
  const commerce=runtime.commerce;
  if(path==="billing/catalog"&&request.method==="GET")return reply(commerce?await commerce.catalog(environment):{environment,plans:[]});
  if(path==="billing/orders"&&request.method==="GET")return reply({orders:(await repo.listPaymentOrders(owner,environment)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id)).slice(0,100).map(publicOrder)});
  if(path==="billing/orders"&&request.method==="POST") {
    if(!commerce)unavailable();
    const body=object(request.body);keys(body,["plan_id","amount_minor"]);
    const quote=integer(body.amount_minor,1,100000000);
    if(await context.resolveAccountRegion(request,"lighttick",auth.userId)!=="CN")throw new ApplicationError(403,"APP_SCOPE_FORBIDDEN","支付宝购买仅支持中国大陆账户。");
    return reply(await commerce!.create(owner,environment,request.headers["idempotency-key"]??"",body.plan_id as any,quote));
  }
  const orderMatch=/^billing\/orders\/([a-zA-Z0-9_-]{16,128})(?:\/(sync|checkout))?$/.exec(path);
  if(orderMatch) {
    if(!commerce)unavailable();
    if(request.method==="GET"&&!orderMatch[2])return reply({order:publicOrder(await commerce!.read(owner,environment,orderMatch[1]!))});
    if(request.method==="GET"&&orderMatch[2]==="checkout")return reply(await commerce!.checkout(await commerce!.read(owner,environment,orderMatch[1]!)));
    if(request.method==="POST"&&orderMatch[2]==="sync"){keys(object(request.body??{}),[]);return reply({order:await commerce!.sync(owner,environment,orderMatch[1]!)});}
  }
  if (request.method === "GET" && ["billing/subscription", "billing/storage-usage"].includes(path)) {
    const [subscription, usage] = await Promise.all([repo.getUserSubscription(owner,environment), repo.getStorageUsage(owner)]);
    return reply({ subscription: subscription ? { userId: subscription.userId, planId: subscription.planId, status: subscription.status, currentPeriodStart: subscription.currentPeriodStart, currentPeriodEnd: subscription.currentPeriodEnd, cancelAtPeriodEnd: subscription.cancelAtPeriodEnd, createdAt: subscription.createdAt, updatedAt: subscription.updatedAt } : null, usage, purchase_available: commerce ? (await commerce.catalog(environment)).plans.some(p=>p.available):false, environment,
      quota_scope: "学习模块正文与发布版本", quota_enforced: true });
  }
  if (["billing/upgrade", "billing/cancel"].includes(path) && request.method === "POST") return unavailable();
  if (path === "storage" && request.method === "GET") return reply({ storage: await repo.listUserStorage(owner) });
  const storageMatch = /^storage\/([a-f0-9-]{36})(?:\/(test))?$/.exec(path);
  if (storageMatch && request.method === "GET") {
    const storage = await repo.getUserStorage(owner, storageMatch[1]!);
    if (!storage) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Storage not found.");
    return reply({ storage });
  }
  if (path.startsWith("billing/")) throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Route not found.");
  if (request.method !== "GET") await runtime.scopePolicy.assertFull();
  const authorize = async () => {
    await context.authenticateProductRequest(request, "lighttick");
    await runtime.scopePolicy.assertFull();
  };
  async function credentials() {
    if (!runtime!.github) throw new ApplicationError(503, "LIGHTTICK_CAPABILITY_UNAVAILABLE", "GitHub configuration service is unavailable.");
    const summary = await runtime!.github.summary(owner);
    if (summary.mode !== "custom" || !summary.configured) throw new ApplicationError(422, "REQ_FIELD_INVALID", "Save and test your GitHub settings first.");
    return { value: await runtime!.github.credentials(owner, { mode: "custom", revision: summary.revision }), revision: summary.revision };
  }
  const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"] ?? "";
  const body = request.method === "GET" ? {} : object(request.body ?? {});
  if (request.method !== "GET" && !storageMatch?.[2]) identity(key);
  const perform = <T>(kind: string, id: string, fn: () => Promise<T>) =>
    runtime!.nativeLearning.command(owner, key, kind, id, body, fn, authorize);
  const replayKind = path === "storage" && request.method === "POST" ? "storage:save"
    : storageMatch && request.method === "DELETE" ? "storage:delete"
    : sourceMatch && request.method === "PUT" ? "module:source"
    : sourceMatch && request.method === "POST" ? "module:sync" : null;
  if (replayKind && await repo.getOperation(owner, "learning:" + key))
    return reply(await perform(replayKind, path === "storage" ? "github" : storageMatch?.[1] ?? sourceMatch![1]!, async () => { throw new Error("Unreachable receipt branch"); }));
  if (storageMatch?.[2] === "test" && request.method === "POST") {
    const storage = await repo.getUserStorage(owner, storageMatch[1]!);
    if (!storage?.github) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "GitHub storage not found.");
    const selected = await credentials();
    if (storage.github.repository !== selected.value.repository || storage.github.branch !== selected.value.branch)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "GitHub settings changed; reconnect storage.");
    await new GitHubContentService({ ...selected.value, prefix: storage.github.prefix }).listFiles();
    await authorize();
    await runtime.github!.assertCurrent(owner, { mode: "custom", revision: selected.revision });
    if ((await repo.getUserStorage(owner, storageMatch[1]!))?.revision !== storage.revision)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Storage changed during the connection test.");
    return reply({ status: "success", testedAt: new Date().toISOString() });
  }
  if (path === "storage" && request.method === "POST") {
    keys(body, ["type", "prefix", "base_revision"]);
    if (body.type !== "github") throw new ApplicationError(422, "REQ_FIELD_INVALID", "Only GitHub content storage is supported. Web cannot configure a local server directory.");
    const prefix = text(body.prefix ?? "", 300);
    if (prefix && !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*$/.test(prefix)) throw new ApplicationError(422, "REQ_FIELD_INVALID", "Use a relative directory without dot segments.");
    const base = integer(body.base_revision, 0, 2147483646);
    const selected = await credentials();
    return reply(await perform("storage:save", "github", async () => {
      await runtime!.github!.assertCurrent(owner, { mode: "custom", revision: selected.revision });
      const old = (await repo.listUserStorage(owner)).find(s => s.type === "github");
      if ((old?.revision ?? 0) !== base) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Storage changed; reload before saving.");
      const storage = { id: old?.id ?? randomUUID(), userId: owner.userId, revision: base + 1,
        type: "github" as const, github: { repository: selected.value.repository, branch: selected.value.branch, prefix },
        isDefault: true, status: "active", createdAt: old?.createdAt ?? new Date().toISOString() };
      await repo.saveUserStorage(storage);
      return { storage };
    }));
  }
  if (storageMatch && request.method === "DELETE") {
    keys(body, ["base_revision"]);
    return reply(await perform("storage:delete", storageMatch[1]!, async () => {
      const old = await repo.getUserStorage(owner, storageMatch[1]!);
      if (!old || old.revision !== integer(body.base_revision, 1, 2147483646)) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Storage changed; reload before deleting.");
      await repo.deleteUserStorage(owner, storageMatch[1]!);
      return { status: "deleted" };
    }));
  }
  if (sourceMatch) {
    const [, id, action] = sourceMatch;
    const module = await repo.getLearningModule(owner, id!);
    if (request.method === "GET" && action === "sync-status") return reply({ module: module ? {
      id: module.id, revision: module.revision, sourceType: module.sourceType, sourceConfig: module.sourceConfig ? { github: module.sourceConfig.github ? { ...module.sourceConfig.github, token: undefined } : undefined } : null,
      syncStatus: module.syncStatus, lastSyncedAt: module.lastSyncedAt } : null });
    if (request.method === "PUT" && action === "source") {
      keys(body, ["storage_id", "base_revision", "title"]);
      const base = integer(body.base_revision, 0, 2147483646);
      return reply(await perform("module:source", id!, async () => {
        const storage = await repo.getUserStorage(owner, text(body.storage_id, 36, true));
        if (!storage?.github) throw new ApplicationError(422, "REQ_FIELD_INVALID", "Choose saved GitHub storage.");
        const current = await repo.getLearningModule(owner, id!);
        if ((current?.revision ?? 0) !== base) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Module changed; reload first.");
        const now = new Date().toISOString();
        const next = { ...owner, ...current, id: id!, title: text(body.title, 200, true), description: current?.description ?? "", enabled: true,
          sourceType: "github" as const, sourceUrl: `https://github.com/${storage.github.repository}`,
          sourcePath: storage.github.prefix, revision: base + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
          sourceConfig: { github: { repository: storage.github.repository, branch: storage.github.branch, prefix: storage.github.prefix, syncInterval: "manual" as const } } };
        await repo.saveLearningModule(next, base);
        return { id: id!, revision: next.revision };
      }));
    }
    if (request.method === "POST" && action === "sync") {
      keys(body, ["force"]);
      if (body.force !== undefined && typeof body.force !== "boolean") throw new ApplicationError(422, "REQ_FIELD_INVALID", "force must be boolean.");
      // Replayed receipts never re-fetch GitHub, including after a settings change.
      const prior = await repo.getOperation(owner, "learning:" + key);
      if (prior) return reply(await perform("module:sync", id!, async () => { throw new Error("Invalid replay"); }));
      const selected = await credentials();
      return reply(await new LearningContentSyncService(repo).sync(owner, id!, body.force === true, selected.value,
        fn => perform("module:sync", id!, fn), async () => {
          await authorize();
          await runtime!.github!.assertCurrent(owner, { mode: "custom", revision: selected.revision });
        }));
    }
  }
  throw new ApplicationError(405, "VALIDATION_ERROR", "Method not supported.");
}
