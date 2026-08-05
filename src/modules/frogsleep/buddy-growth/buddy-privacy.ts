const SAFE_ROUTE_KEYS = new Set([
  "type", "domain", "invitation_id", "notification_id", "relationship_id",
  "goal_id", "milestone_id", "report_id", "interaction_id",
]);

/** Keeps only opaque identifiers and routing enums for notifications and operational events. */
export function sanitizeBuddySafeRoute(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(input).filter(([key, value]) =>
    SAFE_ROUTE_KEYS.has(key) && typeof value === "string" && value.length > 0));
}

/** Removes protected values before buddy metadata reaches analytics or diagnostics. */
export function sanitizeBuddyOperationalMetadata(input: Record<string, unknown>): Record<string, unknown> {
  return sanitizeBuddySafeRoute(input);
}
