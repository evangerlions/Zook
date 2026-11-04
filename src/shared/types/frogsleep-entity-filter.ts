import type { FrogSleepEntityKind } from "./records.ts";

export interface FrogSleepEntityFilter {
  appId: string;
  kind?: FrogSleepEntityKind;
  ownerUserId?: string;
  partnerUserId?: string;
  relationshipId?: string;
  sessionId?: string;
  status?: string;
  code?: string;
  token?: string;
  startsAtFromIso?: string;
  startsAtToIso?: string;
  occurredAtFromIso?: string;
  occurredAtToIso?: string;
  includeDeleted?: boolean;
  limit?: number;
  before?: { t: string; id: string };
}
