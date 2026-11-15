import { openLoginSession, type OpenLoginSession, type LoginSessionResource } from "./browser-launcher.ts";
import { randomUUID } from "node:crypto";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { AccountStore } from "../account-store.ts";
import type { AccountMonitor } from "../account-monitor.ts";
import { manualProvider } from "./provider-pages.ts";
import { parseLoginInput } from "./browser-session.ts";
import { SessionVault } from "./session-vault.ts";
/** A browser resource registry. Each entry owns its own authenticated login/session context. */
export class ManualLoginSessions {
  private readonly sessions = new Map<string, { session: LoginSessionResource; timer: NodeJS.Timeout; loginRevision?: string; closing?: Promise<void> }>();
  private readonly starting = new Set<string>();
  private readonly opening = new Map<string, { owner: string; promise: Promise<unknown> }>();
  constructor(private readonly kv: KVManager, private readonly store: AccountStore, private readonly monitor: AccountMonitor,
    private readonly vault: SessionVault, private readonly openSession: OpenLoginSession = openLoginSession, private readonly cleanupFailed: () => void = () => {}) {}
  async start(accountId: string, owner: string) {
    // Serialize resource creation per account; each new window receives a fresh session ID.
    while (this.opening.has(accountId)) {
      const previous = this.opening.get(accountId)!;
      if (previous.owner !== owner) throw new ApplicationError(409, "REQ_INVALID_BODY", "另一位管理员正在打开此账号的登录窗口。");
      await previous.promise.catch(() => {});
    }
    const promise = this.open(accountId, owner);
    const pending = { owner, promise }; this.opening.set(accountId, pending);
    try { return await promise; }
    finally { if (this.opening.get(accountId) === pending) this.opening.delete(accountId); }
  }
  private async open(accountId: string, owner: string) {
    if (!this.vault.ready()) throw new ApplicationError(503, "REQ_INVALID_BODY", "Configure stable API encryption before signing in.");
    const account = await this.store.get(accountId);
    const provider = manualProvider(account.type);
    const existing = [...this.sessions.values()].find(entry => entry.session.accountId === accountId);
    if (existing) {
      if (existing.session.owner !== owner) throw new ApplicationError(409, "REQ_INVALID_BODY", "此账号的登录窗口由另一位管理员使用中。");
      await this.dispose(existing.session.id);
    }
    if (this.sessions.size + this.starting.size >= 3) throw new ApplicationError(429, "REQ_INVALID_BODY", "Close another login session first.");
    const id = randomUUID(); this.starting.add(id);
    let locked = false;
    let opened: LoginSessionResource | undefined;
    try {
      locked = await this.acquire(accountId, id, 660);
      if (!locked) throw new ApplicationError(409, "REQ_INVALID_BODY", "此账号的登录会话仍在释放，请稍后点击重新连接。");
      let state = await this.vault.load(accountId);
      if (state && JSON.parse(state).credentialVersion !== account.loginRevision) state = undefined;
      const session = opened = await this.openSession(id, accountId, owner, provider, state);
      const fenced = await this.kv.applyAtomic("billing-login-lock", { compare: [{ key: accountId, value: id }], set: [{ key: accountId, value: id, ttlSeconds: 660 }] });
      if (!fenced) throw new ApplicationError(409, "REQ_INVALID_BODY", "Login startup lease expired; open the window again.");
      const timer = setTimeout(() => void this.dispose(id).catch(() => this.cleanupFailed()), 10 * 60000); timer.unref();
      this.sessions.set(id, { session, timer, loginRevision: account.loginRevision });
      const view = await session.exclusive(async () => {
        let completed = await this.automaticRead(session);
        let notice: string | undefined;
        if (!completed) {
          const login = await this.store.login(accountId);
          if (login) {
            try { await session.resetLogin(); await session.input({ kind: "credentials", ...login }); completed = await this.automaticRead(session, true); }
            catch (error) { if (error instanceof ApplicationError) notice = error.message; else throw error; }
          }
        }
        return { ...await session.view(), loginConfigured: Boolean((await this.store.get(accountId)).encryptedLogin), completed, notice };
      });
      if (view.completed) await this.dispose(id);
      return view;
    } catch (error) {
      if (this.sessions.has(id)) await this.dispose(id).catch(() => {});
      else { await opened?.close().catch(() => {}); if (locked) await this.release(accountId, id); }
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(503, "REQ_INVALID_BODY", "Unable to open the account login window. Check browser installation and provider connectivity.");
    } finally { this.starting.delete(id); }
  }

  async operate(accountId: string, id: string, owner: string, operation: "view" | "input" | "read" | "close", input?: unknown) {
    const entry = this.sessions.get(id);
    if (!entry || entry.session.accountId !== accountId || entry.session.owner !== owner) throw new ApplicationError(404, "REQ_ROUTE_NOT_FOUND", "Login session not found or expired.");
    const { session } = entry;
    if (operation === "close") { await this.dispose(id); return { closed: true }; }
    if (entry.closing) throw new ApplicationError(409, "REQ_INVALID_BODY", "登录窗口正在关闭，请重新连接。");
    return session.exclusive(async () => {
      switch (operation) {
        case "view": return session.view();
        case "input": {
          const action = parseLoginInput(input);
          if (action.kind !== "credentials") {
            await session.input(action);
            const completed = await this.automaticRead(session, action.kind === "key" && action.key === "Enter");
            return { ...await session.view(), loginConfigured: Boolean((await this.store.get(accountId)).encryptedLogin), completed };
          }
          const previousLogin = await this.store.login(accountId);
          if (action.username !== undefined || action.password !== undefined) {
            const saved = await this.store.saveLogin(accountId, { ...(action.username !== undefined ? { username: action.username } : {}), ...(action.password !== undefined ? { password: action.password } : {}) });
            entry.loginRevision = saved.loginRevision;
          }
          const login = await this.store.login(accountId);
          if (!login) throw new ApplicationError(400, "REQ_INVALID_BODY", "请先填写账户名称和密码。");
          if (previousLogin && previousLogin.username !== login.username) await session.resetLogin();
          let completed = false, notice: string | undefined;
          try { await session.input({ kind: "credentials", ...login }); completed = await this.automaticRead(session, true); }
          catch (error) { if (error instanceof ApplicationError && error.statusCode === 409) notice = error.message; else throw error; }
          return { ...await session.view(), loginConfigured: true, completed, notice };
        }
        case "read": {
          const result = await session.read();
          if (this.sessions.get(id)?.session !== session || entry.closing) throw new ApplicationError(409, "REQ_INVALID_BODY", "Login window was closed; query cancelled.");
          // Persist login state only after a successful, unambiguous account query.
          if (result.status === "ok") await this.persistState(session);
          return { sample: await this.monitor.recordManual(accountId, result, new Date(), entry.loginRevision) };
        }
        default: { const exhaustive: never = operation; throw new Error(`Unsupported operation ${exhaustive}`); }
      }
    });
  }
  private async persistState(session: LoginSessionResource) {
    const entry = this.sessions.get(session.id);
    const account = await this.store.get(session.accountId);
    if (!entry || entry.closing || entry.loginRevision !== account.loginRevision) throw new ApplicationError(409, "REQ_INVALID_BODY", "Saved credentials changed; reopen the login window.");
    const state = { ...JSON.parse(await session.state()), credentialVersion: entry.loginRevision };
    await this.vault.save(session.accountId, JSON.stringify(state));
  }
  private async automaticRead(session: LoginSessionResource, wait = false) {
    for (let attempt = 0; attempt < (wait ? 3 : 1); attempt++) {
      if (wait) await new Promise(resolve => setTimeout(resolve, 1000));
      let result;
      try { result = await session.read(); } catch (error) { if (!(error instanceof ApplicationError && error.statusCode === 409)) throw error; }
      if (result?.status !== "ok") continue;
      await this.persistState(session);
      await this.monitor.recordManual(session.accountId, result, new Date(), this.sessions.get(session.id)?.loginRevision);
      return true;
    }
    return false;
  }
  async clearState(accountId: string) {
    manualProvider((await this.store.get(accountId)).type);
    const owner = randomUUID();
    if (!await this.acquire(accountId, owner, 30)) throw new ApplicationError(409, "REQ_INVALID_BODY", "Close the login window before clearing its saved session.");
    try { await this.vault.clear(accountId); return { cleared: true }; }
    finally { await this.release(accountId, owner); }
  }

  private async acquire(accountId: string, id: string, ttlSeconds: number) {
    if (await this.kv.setStringIfAbsent("billing-login-lock", accountId, id, ttlSeconds)) return true;
    return this.kv.applyAtomic("billing-login-lock", { compare: [{ key: accountId, value: "released" }], set: [{ key: accountId, value: id, ttlSeconds }] });
  }
  private async release(accountId: string, id: string) {
    await this.kv.applyAtomic("billing-login-lock", { compare: [{ key: accountId, value: id }], set: [{ key: accountId, value: "released", ttlSeconds: 1 }] });
  }
  private async dispose(id: string): Promise<void> {
    const entry = this.sessions.get(id); if (!entry) return;
    if (entry.closing) return entry.closing;
    clearTimeout(entry.timer);
    entry.closing = (async () => {
      try { await entry.session.close(); }
      finally {
        try { await this.release(entry.session.accountId, id); }
        finally { if (this.sessions.get(id) === entry) this.sessions.delete(id); }
      }
    })();
    return entry.closing;
  }
  async close() { const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.dispose(id))); if (results.some(r => r.status === "rejected")) this.cleanupFailed(); }
}
