import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createDecipheriv } from "node:crypto";
import { FEISHU } from "../../src/modules/feishu/feishu-config.ts";

/** Local migration helper; the production service never depends on macOS or lark-cli. */
export function readFeishuCliSecret(): string {
  const config = JSON.parse(readFileSync(join(homedir(), ".lark-cli/config.json"), "utf8"));
  const app = config.apps.find((item: { appId: string }) => item.appId === FEISHU.appId);
  if (app?.appSecret?.source !== "keychain") throw new Error("Feishu CLI Keychain credential is unavailable.");
  let master = execFileSync("/usr/bin/security", ["find-generic-password", "-s", "lark-cli", "-a", "master.key", "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (master.startsWith("go-keyring-base64:")) master = Buffer.from(master.slice(18), "base64").toString("utf8");
  const file = app.appSecret.id.replace(/[^a-zA-Z0-9._-]/g, "_") + ".enc";
  const data = readFileSync(join(homedir(), "Library/Application Support/lark-cli", file));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(master, "base64"), data.subarray(0, 12));
  decipher.setAuthTag(data.subarray(-16));
  return Buffer.concat([decipher.update(data.subarray(12, -16)), decipher.final()]).toString();
}
