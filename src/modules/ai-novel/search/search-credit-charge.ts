import { createHash } from "node:crypto";
import type { FixedCreditCharge } from "../credits/fixed-credit-charge.ts";
import { CREDIT_MICROS } from "../credits/ai-novel-credits-model.ts";
import type { SearchInput } from "./search-types.ts";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function searchCreditCharge(input: SearchInput, points: number): FixedCreditCharge {
  return { id: digest(input.toolCallId), source: "web_search", pointMicros: String(BigInt(points) * CREDIT_MICROS),
    inputHash: digest(JSON.stringify([input.sceneKey, input.query, input.limit, input.originalQuestion ?? null])) };
}
