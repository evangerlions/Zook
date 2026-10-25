function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

export function mapRow<T>(row: Record<string, unknown>): T {
  const mapped = Object.fromEntries(Object.entries(row).map(([key, value]) => [
    snakeToCamel(key), value instanceof Date ? value.toISOString() : value,
  ]));
  // pg decodes PostgreSQL DATE as local midnight, not an instant in UTC.
  for (const key of ["period_start", "period_end", "target_date"]) {
    const value = row[key];
    if (value instanceof Date) mapped[snakeToCamel(key)] =
      `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
    else if (typeof value === "string") mapped[snakeToCamel(key)] = value.slice(0, 10);
  }
  if (row.scheduled_business_date) mapped.scheduledFor = String(row.scheduled_business_date);
  delete mapped.scheduledBusinessDate;
  return mapped as T;
}
export function timestampString(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}
