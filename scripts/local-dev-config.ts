import { parseEnv } from "node:util";

export function applyLocalDefaults(env: NodeJS.ProcessEnv, contents: string): void {
  for (const [key, value] of Object.entries(parseEnv(contents))) env[key] ??= value;
  env.APP_ENV ??= "local";
}
