import { createHash } from "node:crypto";

const ROUTING_SUFFIX_LENGTH = 3;
const ROUTING_BUCKET_COUNT = 1_000;

export function resolveLlmRoutingUnit(
  did: string | undefined,
  uid: string | undefined,
): number {
  const didPart = parseRoutingSuffix(did) ?? randomRoutingPart();
  const uidPart = parseRoutingSuffix(uid) ?? randomRoutingPart();
  const bucket = (didPart + uidPart) % ROUTING_BUCKET_COUNT;
  return bucket / ROUTING_BUCKET_COUNT;
}

export function resolveAiNovelModelRoutingUnit(
  did: string | undefined,
  uid: string | undefined,
): number {
  const didPart = parseRoutingSuffix(did) ?? randomRoutingPart();
  const uidPart = parseRoutingSuffix(uid) ?? randomRoutingPart();
  const digest = createHash("sha256")
    .update(`ai-novel:model:${didPart}:${uidPart}`)
    .digest();
  return digest.readUInt32BE(0) / 0x1_0000_0000;
}

export function hasStableLlmRoutingInputs(
  did: string | undefined,
  uid: string | undefined,
): boolean {
  return parseRoutingSuffix(did) !== undefined &&
    parseRoutingSuffix(uid) !== undefined;
}

function parseRoutingSuffix(value: string | undefined): number | undefined {
  const normalized =
    value?.trim().toLowerCase().replace(/[^a-z0-9]/g, "") ?? "";
  if (normalized.length < ROUTING_SUFFIX_LENGTH) {
    return undefined;
  }
  const suffix = normalized.slice(-ROUTING_SUFFIX_LENGTH);
  const parsed = Number.parseInt(suffix, 36);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function randomRoutingPart(): number {
  return Math.floor(Math.random() * ROUTING_BUCKET_COUNT);
}
