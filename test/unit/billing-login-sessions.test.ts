import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { SessionVault } from "../../src/modules/billing-accounts/manual/session-vault.ts";
import { ManualLoginSessions } from "../../src/modules/billing-accounts/manual/login-sessions.ts";
import type { OpenLoginSession } from "../../src/modules/billing-accounts/manual/browser-launcher.ts";
async function fixture(open: OpenLoginSession) {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); const store = new AccountStore(kv, ["key"]); const ids: string[] = [];
 for (let n = 0; n < 4; n++) ids.push((await store.save({ name: `Manual${n}`, type: "geyan", providers: [], alerts: false, warning: 1, critical: 0 })).id);
 const vault = new SessionVault(kv, ["key"]);
 return { kv, store, ids, vault, sessions: new ManualLoginSessions(kv, store, { recordManual: async (_id: string, result: unknown) => result } as any, vault, open) };
}
function opener(options: { viewFails?: boolean; beforeOpen?: () => Promise<void>; onClose?: () => void; beforeRead?: () => Promise<void> } = {}): OpenLoginSession {
 return async (id, accountId, owner, provider) => {
  await options.beforeOpen?.();
  let readCount = 0;
  return { id, accountId, owner, provider, exclusive: async fn => fn(), view: async () => { if (options.viewFails) throw Error("screenshot failed"); return { sessionId: id, image: "data:image/jpeg;base64,", width: 1120, height: 760, expiresAt: "2030-01-01" }; },
    input: async () => {}, resetLogin: async () => {}, read: async () => { if (options.beforeRead && readCount++ > 0) await options.beforeRead(); return { status: "error", metrics: [] }; }, state: async () => "{\"cookies\":[]}", close: async () => options.onClose?.() };
 };
}
test("failed first screenshots free capacity and account lease", async () => {
 let closed = 0; const { sessions, ids, kv } = await fixture(opener({ viewFails: true, onClose: () => closed++ }));
 try { for (let i = 0; i < 4; i++) await assert.rejects(sessions.start(ids[0], "admin")); assert.equal(closed, 4); assert.equal(await kv.getString("billing-login-lock", ids[0]), "released"); }
 finally { await sessions.close(); }
});
test("concurrent pending browser starts reserve the three available slots", async () => {
 let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
 const { sessions, ids } = await fixture(opener({ beforeOpen: () => gate }));
 const pending = ids.slice(0,3).map(id => sessions.start(id, "admin"));
 try { await assert.rejects(sessions.start(ids[3], "admin"), (e: any) => e.statusCode === 429 || e.message.includes("Close another")); release(); await Promise.all(pending); }
 finally { release(); await sessions.close(); }
});
test("sessions bind account and actor; close allows immediate reopening and clear cannot race active login", async () => {
 let closed = 0; const { sessions, ids, vault } = await fixture(opener({ onClose: () => closed++ }));
 try {
  const view = await sessions.start(ids[0], "admin-a");
  await assert.rejects(sessions.operate(ids[0], view.sessionId, "admin-b", "view"));
  await assert.rejects(sessions.operate(ids[1], view.sessionId, "admin-a", "view"));
  await assert.rejects(sessions.clearState(ids[0]));
  await sessions.operate(ids[0], view.sessionId, "admin-a", "close");
  const reopened = await sessions.start(ids[0], "admin-a"); assert.equal(closed, 1);
  await sessions.operate(ids[0], reopened.sessionId, "admin-a", "close");
  await vault.save(ids[0], "state"); await sessions.clearState(ids[0]); assert.equal(await vault.load(ids[0]), undefined);
 } finally { await sessions.close(); }
});
test("closing cancels the browser resource even while a read is pending", async () => {
 let release!: () => void, closed = 0; const gate = new Promise<void>(resolve => { release = resolve; });
 const { sessions, ids } = await fixture(opener({ beforeRead: () => gate, onClose: () => closed++ }));
 try {
  const view = await sessions.start(ids[0], "admin"); const read = sessions.operate(ids[0], view.sessionId, "admin", "read");
  await sessions.operate(ids[0], view.sessionId, "admin", "close"); assert.equal(closed, 1);
  release(); await assert.rejects(read);
  await sessions.start(ids[0], "admin");
 } finally { release(); await sessions.close(); }
});

test("same operator replaces an existing window; delayed close of the old ID cannot close its replacement", async () => {
 let closed=0; const {sessions,ids}=await fixture(opener({onClose:()=>closed++}));
 try {
  const first=await sessions.start(ids[0],"admin");
  await assert.rejects(sessions.start(ids[0],"other-admin"));
  const second=await sessions.start(ids[0],"admin");
  assert.notEqual(first.sessionId,second.sessionId);assert.equal(closed,1);
  await assert.rejects(sessions.operate(ids[0],first.sessionId,"admin","close"));
  assert.equal((await sessions.operate(ids[0],second.sessionId,"admin","view") as any).sessionId,second.sessionId);
 }finally{await sessions.close();}
});
test("concurrent same-owner opens serialize, replacing rather than blocking the second window", async () => {
 let opens=0,closed=0; const {sessions,ids}=await fixture(opener({beforeOpen:async()=>{opens++;},onClose:()=>closed++}));
 try {
  const [first,second]=await Promise.all([sessions.start(ids[0],"admin"),sessions.start(ids[0],"admin")]);
  assert.notEqual(first.sessionId,second.sessionId);assert.equal(opens,2);assert.equal(closed,1);
  assert.equal((await sessions.operate(ids[0],second.sessionId,"admin","view") as any).sessionId,second.sessionId);
 }finally{await sessions.close();}
});
