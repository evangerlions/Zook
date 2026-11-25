import { readArkAgentPlanQuota } from "./ark-agent-plan-page-query.ts";
import { readGeyanBalance } from "./geyan-page-query.ts";
import { loginPatch } from "../account-login-secret.ts";
import { submitCredentials } from "./credential-form.ts";
import type { Browser, BrowserContext, Page } from "playwright";
import { ApplicationError } from "../../../shared/errors.ts";
import { strictObject } from "../../../shared/strict-object.ts";
import { allowedProviderUrl, isBalancePage, providerPages, type ManualProvider } from "./provider-pages.ts";
import { readConsoleFields, type ConsoleField } from "./console-reader.ts";
export const loginViewport = { width: 1120, height: 760 };
export type LoginInput = { kind: "credentials"; username?: string; password?: string } | { kind: "text"; text: string } | { kind: "key"; key: string } | { kind: "pointer"; points: { x: number; y: number }[] } | { kind: "scroll"; deltaY: number };
export function parseLoginInput(input: unknown): LoginInput {
  const b = strictObject(input, ["kind", "text", "key", "points", "deltaY", "username", "password"]);
  if (b.kind === "credentials") return { kind: "credentials", ...loginPatch({ ...(b.username !== undefined ? { username: b.username } : {}), ...(b.password !== undefined ? { password: b.password } : {}) }) };
  if (b.kind === "text" && typeof b.text === "string" && b.text.length > 0 && b.text.length <= 1000) return { kind: "text", text: b.text };
  if (b.kind === "key" && typeof b.key === "string" && ["Tab", "Shift+Tab", "Enter", "Backspace", "ControlOrMeta+A", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "Delete"].includes(b.key)) return { kind: "key", key: b.key };
  if (b.kind === "scroll" && typeof b.deltaY === "number" && Number.isFinite(b.deltaY) && Math.abs(b.deltaY) <= 760) return { kind: "scroll", deltaY: b.deltaY };
  if (b.kind === "pointer" && Array.isArray(b.points) && b.points.length > 0 && b.points.length <= 80 && b.points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < loginViewport.width && p.y < loginViewport.height)) return { kind: "pointer", points: b.points.map(p => ({ x: p.x, y: p.y })) };
  throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid browser input.");
}
/** Runtime state belongs to this bounded login session, never to a shared account adapter. */
export class BrowserLoginSession {
  private busy = false;
  private closed = false;
  private settled: Promise<void> = Promise.resolve();
  constructor(readonly id: string, readonly accountId: string, readonly owner: string, readonly provider: ManualProvider,
    private readonly browser: Browser, private context: BrowserContext, private page: Page, readonly expiresAt: number) {}
  static async open(id: string, accountId: string, owner: string, provider: ManualProvider, browser: Browser, state?: string) {
    const saved = state ? JSON.parse(state) as { storageState: Awaited<ReturnType<BrowserContext["storageState"]>>; sessionStorage: Record<string, Record<string, string>>; pageUrl?: string } : undefined;
    const context = await browser.newContext({ viewport: loginViewport, storageState: saved?.storageState, acceptDownloads: false, serviceWorkers: "block" });
    if (saved) await context.addInitScript(storage => {
      const entries = storage[location.origin];
      if (entries) for (const [key, value] of Object.entries(entries)) sessionStorage.setItem(key, value);
    }, saved.sessionStorage);
    await context.route("**/*", route => allowedProviderUrl(provider, route.request().url()) ? route.continue() : route.abort());
    await context.routeWebSocket(/.*/, socket => socket.close());
    const page = await context.newPage(); page.setDefaultTimeout(10000);
    context.on("page", popup => { if (popup !== page) void popup.close(); });
    page.on("dialog", dialog => void dialog.dismiss());
    page.on("download", download => void download.cancel());
    try {
      await page.goto(saved?.pageUrl && isBalancePage(provider, saved.pageUrl) ? saved.pageUrl : providerPages[provider].url, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.locator("input,button,a,canvas,img").first().waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    }
    catch (error) { await context.close(); throw error; }
    return new BrowserLoginSession(id, accountId, owner, provider, browser, context, page, Date.now() + 10 * 60000);
  }
  async exclusive<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed || Date.now() >= this.expiresAt) throw new ApplicationError(409, "REQ_INVALID_BODY", "Login session expired; open it again.");
    if (this.busy) throw new ApplicationError(409, "REQ_INVALID_BODY", "Browser action is still running.");
    this.busy = true;
    let finish!: () => void; this.settled = new Promise<void>(resolve => { finish = resolve; });
    try { return await operation(); } catch (error) {
      if (error instanceof ApplicationError) throw error;
      throw new ApplicationError(502, "REQ_INVALID_BODY", "Browser action failed. Refresh the login window or open it again.");
    } finally { this.busy = false; finish(); }
  }
  async view() {
    return { sessionId: this.id, expiresAt: new Date(this.expiresAt).toISOString(), ...loginViewport,
      image: `data:image/jpeg;base64,${(await this.page.screenshot({ type: "jpeg", quality: 75, timeout: 10000 })).toString("base64")}` };
  }
  async input(action: LoginInput) {
    switch (action.kind) {
      case "credentials": {
        if (!action.username || !action.password) throw new ApplicationError(400, "REQ_INVALID_BODY", "Saved login credentials are incomplete.");
        await submitCredentials(this.page, this.provider, action.username, action.password); break;
      }
      case "text": await this.page.keyboard.insertText(action.text); break;
      case "key": await this.page.keyboard.press(action.key); break;
      case "scroll": await this.page.mouse.wheel(0, action.deltaY); break;
      case "pointer": {
        const [first, ...rest] = action.points; await this.page.mouse.move(first.x, first.y); await this.page.mouse.down();
        try { for (const point of rest) await this.page.mouse.move(point.x, point.y); }
        finally { await this.page.mouse.up(); } break;
      }
      default: { const exhaustive: never = action; throw new Error(`Unsupported action ${exhaustive}`); }
    }
  }
  async resetLogin() {
    const previous = this.context;
    const fresh = await BrowserLoginSession.open(this.id, this.accountId, this.owner, this.provider, this.browser);
    this.context = fresh.context; this.page = fresh.page;
    await previous.close();
  }
  async read() {
    if (this.provider === "geyan") return readGeyanBalance(this.page);
    if (this.provider === "agent-plan") return readArkAgentPlanQuota(this.page);
    if (!isBalancePage(this.provider, this.page.url())) throw new ApplicationError(409, "REQ_INVALID_BODY", "Open the official account usage page before reading.");
    const fields: ConsoleField[] = await this.page.evaluate(labels => {
      const fields: { label: string; value: string }[] = [];
      for (const element of document.querySelectorAll("body *")) {
        if (!(element instanceof HTMLElement) || element.offsetWidth === 0 || element.offsetHeight === 0) continue;
        const label = element.innerText.trim(); if (!labels.includes(label)) continue;
        // Leaf-most label only, so nested wrappers do not duplicate one card.
        if (Array.from(element.children).some(child => (child.textContent ?? "").trim() === label)) continue;
        const sibling = element.nextElementSibling;
        const value = (sibling?.textContent ?? element.parentElement?.innerText.replace(label, "") ?? "").trim();
        if (value.length <= 100) fields.push({ label, value });
      }
      return fields;
    }, providerPages[this.provider].labels);
    return readConsoleFields(this.provider, fields);
  }
  async state() {
    const storage: Record<string, Record<string, string>> = {};
    for (const frame of this.page.frames()) {
      if (!allowedProviderUrl(this.provider, frame.url())) continue;
      const result = await frame.evaluate(() => ({ origin: location.origin, values: Object.fromEntries(Object.keys(sessionStorage).map(key => [key, sessionStorage.getItem(key)!])) }));
      storage[result.origin] = result.values;
    }
    return JSON.stringify({ pageUrl: this.page.url(), storageState: await this.context.storageState({ indexedDB: true }), sessionStorage: storage });
  }
  async close() { this.closed = true; try { await this.browser.close(); } finally { await this.settled; } }
}
