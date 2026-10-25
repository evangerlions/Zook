import { readFile } from "node:fs/promises";
import { supportObservation } from "../src/modules/frogsleep/buddy-support/buddy-support-observation.ts";
const path = process.argv[2];
if (!path) throw new Error("Provide an aggregate-only JSON input file; no raw notes or credentials.");
const result = supportObservation(JSON.parse(await readFile(path, "utf8")));
console.log(JSON.stringify(result, null, 2));
process.exitCode = result.status === "review" ? 0 : result.status === "stop" ? 3 : 2;
