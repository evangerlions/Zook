import { existsSync } from "node:fs";
import { chromium } from "playwright";
import { BrowserLoginSession } from "./browser-session.ts";
import type { ManualProvider } from "./provider-pages.ts";
export type LoginSessionResource = Pick<BrowserLoginSession, "id" | "accountId" | "owner" | "provider" | "exclusive" | "view" | "input" | "resetLogin" | "read" | "state" | "close">;
export type OpenLoginSession = (id: string, accountId: string, owner: string, provider: ManualProvider, state?: string) => Promise<LoginSessionResource>;
export const openLoginSession: OpenLoginSession = async (id, accountId, owner, provider, state) => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, channel: "chromium",
    ...(process.platform === "linux" && existsSync("/usr/bin/chromium-browser") ? { executablePath: "/usr/bin/chromium-browser" } : {}) });
  try { return await BrowserLoginSession.open(id, accountId, owner, provider, browser, state); }
  catch (error) { await browser.close(); throw error; }
};
