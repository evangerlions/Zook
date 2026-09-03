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
