import { CalendarService } from "../modules/lighttick/calendar/calendar.service.ts";
import { taskData } from "./lighttick-route-mappers.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import {
  LightTickSearchService,
  type LightTickSearchScope,
} from "../modules/lighttick/lighttick-search.service.ts";

function parseScope(value: unknown): LightTickSearchScope[] | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String) as LightTickSearchScope[];
  if (typeof value === "string")
    return value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean) as LightTickSearchScope[];
  return undefined;
}

export async function handleSearchRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
  actionsEnabled = false,
): Promise<unknown | undefined> {
  if (request.path === "/api/v1/lighttick/calendar") {
    if (request.method !== "GET")
      throw new ApplicationError(
        405,
        "REQ_METHOD_NOT_ALLOWED",
        "Use GET for the activity calendar.",
      );
    return new CalendarService(repository, undefined, actionsEnabled).read(owner, request.query ?? {});
  }
  const service = new LightTickSearchService(repository);
  const prefix = "/api/v1/lighttick";
  const taskDetail = /^\/api\/v1\/lighttick\/tasks\/([^/]+)$/.exec(
    request.path,
  );
  if (taskDetail && request.method === "GET")
    return repository.transaction(owner, async () => {
      const task = await repository.getTask(owner, taskDetail[1]!);
      if (!task)
        throw new ApplicationError(
          404,
          "LIGHTTICK_RESOURCE_NOT_FOUND",
          "Task was not found.",
        );
      return taskData(task, await repository.listTaskSteps(owner, task.id));
    });
  if (request.path === `${prefix}/search` && request.method === "GET") {
    const query = (request.query ?? {}) as Record<
      string,
      string | string[] | undefined
    >;
    return service.search(owner, {
      q: typeof query.q === "string" ? query.q : "",
      scope: parseScope(query.scope),
      limit: query.limit === undefined ? undefined : Number(query.limit),
    });
  }
  if (request.path === `${prefix}/timeline` && request.method === "GET") {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    return service.timeline(owner, {
      limit: query.limit === undefined ? undefined : Number(query.limit),
      cursor: query.cursor,
    });
  }
  return undefined;
}
