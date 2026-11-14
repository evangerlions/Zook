import type { HttpRequest } from '../shared/types.ts';
import type { LightTickOwner } from '../modules/lighttick/lighttick.types.ts';
import type { LightTickRepository } from '../modules/lighttick/lighttick.repository.ts';
import { LightTickSearchService, type LightTickSearchScope } from '../modules/lighttick/lighttick-search.service.ts';

function parseScope(value: unknown): LightTickSearchScope[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String) as LightTickSearchScope[];
  if (typeof value === 'string') return value.split(',').map(s => s.trim()).filter(Boolean) as LightTickSearchScope[];
  return undefined;
}

export async function handleSearchRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const service = new LightTickSearchService(repository);
  const prefix = '/api/v1/lighttick';
  if (request.path === `${prefix}/search` && request.method === 'GET') {
    const query = (request.query ?? {}) as Record<string, string | string[] | undefined>;
    return service.search(owner, {
      q: typeof query.q === 'string' ? query.q : '',
      scope: parseScope(query.scope),
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
  }
  if (request.path === `${prefix}/timeline` && request.method === 'GET') {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return service.timeline(owner, {
      limit: query.limit === undefined ? undefined : Number(query.limit),
      cursor: query.cursor,
    });
  }
  return undefined;
}
