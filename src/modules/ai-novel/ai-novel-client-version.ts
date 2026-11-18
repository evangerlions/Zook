type ClientVersion = readonly [number, number, number];

/** The release-version header contract also permits a numeric Flutter build. */
export function parseAiNovelClientVersion(value: string | undefined): ClientVersion | undefined {
  const match = value?.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\+\d+)?$/);
  if (!match) return undefined;
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

function compareAiNovelClientVersions(left: string | undefined, right: string): number | undefined {
  const version = parseAiNovelClientVersion(left);
  const required = parseAiNovelClientVersion(right);
  if (!version || !required) return undefined;
  for (let index = 0; index < 3; index++) {
    if (version[index] !== required[index]) return version[index]! > required[index]! ? 1 : -1;
  }
  return 0;
}

export function isAiNovelClientVersionAtLeast(value: string | undefined, minimum: string): boolean {
  const comparison = compareAiNovelClientVersions(value, minimum);
  return comparison !== undefined && comparison >= 0;
}

export function isAiNovelClientVersionAtMost(value: string | undefined, maximum: string): boolean {
  const comparison = compareAiNovelClientVersions(value, maximum);
  return comparison !== undefined && comparison <= 0;
}
