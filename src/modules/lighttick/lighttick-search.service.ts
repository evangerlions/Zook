import type { LightTickOwner } from "./lighttick.types.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import { ApplicationError } from "../../shared/errors.ts";
import type { LightTickSearchHit, LightTickTimelineItem, TimelineCursor } from "../../infrastructure/database/postgres/postgres-lighttick-search-store.ts";

export type LightTickSearchScope = 'record' | 'goal' | 'task';

export interface LightTickSearchQuery {
  q: string;
  scope?: LightTickSearchScope[];
  limit?: number;
}

export interface LightTickSearchResult {
  items: LightTickSearchHit[];
  has_more: boolean;
}

export interface LightTickTimelineQuery {
  limit?: number;
  cursor?: string;
}

export interface LightTickTimelinePage {
  items: LightTickTimelineItem[];
  next_cursor?: string;
}

const VALID_SCOPES: ReadonlySet<LightTickSearchScope> = new Set(['record', 'goal', 'task']);
const SCopes = ['record', 'goal', 'task'] as const;

export class LightTickSearchService {
  constructor(private readonly repository: LightTickRepository) {}

  async search(owner: LightTickOwner, query: LightTickSearchQuery): Promise<LightTickSearchResult> {
    const q = typeof query.q === 'string' ? query.q.trim() : '';
    if (!q || q.length > 200)
      throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'q must be 1-200 characters.');

    let scope: LightTickSearchScope[] = ['record', 'goal', 'task'];
    if (query.scope !== undefined) {
      if (!Array.isArray(query.scope))
        throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'scope must be an array.');
      scope = [];
      for (const entry of query.scope) {
        const raw = String(entry).trim();
        if (!VALID_SCOPES.has(raw as LightTickSearchScope))
          throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'scope contains invalid kind.');
        if (!scope.includes(raw as LightTickSearchScope)) scope.push(raw as LightTickSearchScope);
      }
      if (scope.length === 0)
        throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'scope must not be empty.');
    }

    const limit = query.limit === undefined ? 20 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 50)
      throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'limit must be 1-50.');

    const perKindLimit = limit + 1; // fetch one extra per kind to detect has_more accurately after merge
    const hits: LightTickSearchHit[] = [];
    const calls: Promise<LightTickSearchHit[]>[] = [];
    if (scope.includes('record')) calls.push(this.repository.searchRecords(owner, q, perKindLimit));
    if (scope.includes('goal')) calls.push(this.repository.searchGoals(owner, q, perKindLimit));
    if (scope.includes('task')) calls.push(this.repository.searchTasks(owner, q, perKindLimit));

    const settled = await Promise.all(calls);
    for (const batch of settled) hits.push(...batch);
    hits.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));

    const slice = hits.slice(0, limit);
    return { items: slice, has_more: hits.length > limit };
  }

  async timeline(owner: LightTickOwner, query: LightTickTimelineQuery): Promise<LightTickTimelinePage> {
    const limit = query.limit === undefined ? 30 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'limit must be 1-100.');

    let cursor: TimelineCursor | undefined;
    if (query.cursor !== undefined && query.cursor !== '') {
      cursor = decodeCursor(query.cursor);
    }

    const rows = await this.repository.listTimeline(owner, limit + 1, cursor);
    const items = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const next_cursor = hasMore && items.length > 0
      ? encodeCursor({ occurred_at: items[items.length - 1].occurred_at, kind: items[items.length - 1].kind, id: items[items.length - 1].id })
      : undefined;
    return { items, next_cursor };
  }
}

export function encodeCursor(cursor: TimelineCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

export function decodeCursor(value: string): TimelineCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString()) as Partial<TimelineCursor>;
    if (
      typeof parsed !== 'object' || parsed === null ||
      typeof parsed.occurred_at !== 'string' || !Number.isFinite(Date.parse(parsed.occurred_at)) ||
      typeof parsed.id !== 'string' || !parsed.id ||
      !SCopes.includes(parsed.kind as typeof SCopes[number])
    ) {
      throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'cursor is malformed.');
    }
    return { occurred_at: parsed.occurred_at, kind: parsed.kind as TimelineCursor['kind'], id: parsed.id };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    throw new ApplicationError(400, 'REQ_FIELD_INVALID', 'cursor is malformed.');
  }
}
