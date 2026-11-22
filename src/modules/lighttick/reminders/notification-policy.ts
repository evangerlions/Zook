export function isQuietHour(now: Date, timezone: string, preferences: Record<string, unknown>) {
  const start = preferences.quiet_hours_start; const end = preferences.quiet_hours_end;
  if (typeof start !== "string" || typeof end !== "string") return false;
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(now); const value = `${parts.find(part => part.type === "hour")?.value}:${parts.find(part => part.type === "minute")?.value}`;
  return start <= end ? value >= start && value < end : value >= start || value < end;
}
