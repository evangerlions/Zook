import { existsSync, readFileSync } from "node:fs";
import { applyLocalDefaults } from "./local-dev-config.ts";

const localDefaults = "deploy_configs/local.env";
applyLocalDefaults(process.env, existsSync(localDefaults) ? readFileSync(localDefaults, "utf8") : "");
await import("../src/main.ts");
