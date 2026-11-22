import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats, { type FormatsPlugin } from "ajv-formats";
import {
  LightTickLearningScheduleCompletionSchema,
  LightTickLearningScheduleDraftSchema,
  LightTickLearningScheduleStopSchema,
  LightTickManualConfirmSchema,
} from "../generated/openapi/public-contracts.generated.ts";
import { LearningSchedulingService, type LearningScheduleCompletion, type LearningScheduleDraft } from "../modules/lighttick/learning/learning-scheduling.service.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";

const ajv = new Ajv2020({ strict: false });
(addFormats as unknown as FormatsPlugin)(ajv);
const draft = ajv.compile<LearningScheduleDraft>(LightTickLearningScheduleDraftSchema);
const confirm = ajv.compile<{base_version: number; goal_base_version: number}>(LightTickManualConfirmSchema);
const stop = ajv.compile<{base_version: number}>(LightTickLearningScheduleStopSchema);
const complete = ajv.compile<LearningScheduleCompletion>(LightTickLearningScheduleCompletionSchema);

export function handleLearningScheduling(
  runtime: LightTickRuntime, owner: LightTickOwner, path: string, method: string,
  body: Record<string, unknown>, key: string, authorize: () => Promise<void>,
) {
  const schedule = /^\/schedules\/([a-zA-Z0-9_-]{8,128})(?:\/(confirm|stop))?$/.exec(path);
  const task = /^\/scheduled-tasks\/([a-zA-Z0-9_-]{8,128})(\/complete)?$/.exec(path);
  if (path !== "/schedules" && !schedule && !task) return undefined;
  const service = new LearningSchedulingService(runtime.nativeLearning, runtime.tasks, authorize,
    async () => await runtime.learningContinuation?.available() ?? false);
  if (method === "GET" && schedule && !schedule[2]) return service.get(owner, schedule[1]);
  if (method === "GET" && task && !task[2]) return service.lesson(owner, task[1]);
  if (method === "POST") {
    if (path === "/schedules" && draft(body)) return service.draft(owner, key, body);
    if (schedule?.[2] === "confirm" && confirm(body)) return service.confirm(owner, schedule[1], key, body);
    if (schedule?.[2] === "stop" && stop(body)) return service.stop(owner, schedule[1], key, body);
    if (task?.[2] && complete(body)) return service.complete(owner, task[1], key, body);
    throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Check the learning schedule request, dates, minutes and revisions.");
  }
  throw new ApplicationError(405, "VALIDATION_ERROR", "Unsupported schedule request method.");
}
