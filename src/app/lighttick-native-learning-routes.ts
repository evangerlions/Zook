import { WorkReportPracticeService } from "../modules/lighttick/learning/work-report-practice.ts";
import { publicationQuestions } from "../modules/lighttick/learning/learning-questions.ts";
import { STRUCTURED_THINKING, tutorMaterial, tutorPublication } from "../modules/lighttick/learning/tutor-material.ts";
import { TutorWork } from "../modules/lighttick/learning/tutor-work.ts";
import { TutorObservations } from "../modules/lighttick/learning/tutor-observations.ts";
import { LearningRouteService } from "../modules/lighttick/learning/learning-route.service.ts";
import { handleLearningScheduling } from "./lighttick-learning-scheduling-routes.ts";
import { routeProgress } from "../modules/lighttick/learning/learning-route.progress.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { handleLearningContinuationRequest } from "./lighttick-rhythm-routes.ts";
import {
  object,
  text,
  integer,
  identity,
  collectionIdentity,
  moduleIdentity,
  version,
  privateData,
} from "../modules/lighttick/learning/native-learning.validation.ts";
const root = "/api/v1/lighttick/learning",
  legacy = "/api/v1/lighttick/learning-library";
function decodedCollection(value: string) {
  try {
    return collectionIdentity(decodeURIComponent(value));
  } catch (error) {
    if (error instanceof URIError)
      throw new ApplicationError(
        400,
        "REQ_INVALID_BODY",
        "Malformed collection identifier.",
      );
    throw error;
  }
}
export async function tryHandleNativeLearningRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  runtime: LightTickRuntime | undefined,
  r: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (
    !(
      r.path === root ||
      r.path.startsWith(root + "/") ||
      r.path === legacy ||
      r.path.startsWith(legacy + "/")
    )
  )
    return;
  if (!enabled || !runtime) return;
  const auth = await context.authenticateProductRequest(r, "lighttick");
  const owner = { appId: "lighttick" as const, userId: auth.userId };
  if (
    runtime.guestIdentity &&
    (await runtime.guestIdentity.getActive(auth.userId))
  )
    throw new ApplicationError(
      403,
      "APP_SCOPE_FORBIDDEN",
      "Native learning requires registered membership.",
    );
  const assertActive = async () => {
    await context.authenticateProductRequest(r, "lighttick");
    await runtime.scopePolicy.assertRequest(r);
  };
  await assertActive();
  const service = runtime.nativeLearning;
  const authority = await service.authority(owner);
  let result: unknown;
  if (r.path === legacy || r.path.startsWith(legacy + "/")) {
    if (!authority || authority.phase !== "zook") {
      if (r.method !== "GET") await service.assertLegacyWrite(owner);
      return;
    }
    const part = r.path.slice(legacy.length),
      privateMatch = /^\/(lesson-[a-z0-9-]+)\/private$/.exec(part);
    if (privateMatch) {
      if (r.method === "GET")
        result = await service.legacyPrivate(owner, privateMatch[1]);
      else if (r.method === "POST")
        result = await service.legacy(
          owner,
          privateMatch[1],
          object(r.body),
          assertActive,
        );
      else
        throw new ApplicationError(405, "VALIDATION_ERROR", "Use GET or POST.");
    } else if (r.method === "GET")
      result = await service.legacy(
        owner,
        part ? identity(part.slice(1), "lesson-") : undefined,
      );
    else
      throw new ApplicationError(
        405,
        "VALIDATION_ERROR",
        "Legacy library is read-only.",
      );
  } else {
    const path = r.path.slice(root.length),
      key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
    const body = r.method === "GET" ? {} : object(r.body);
    if (Buffer.byteLength(JSON.stringify(body)) > 256000)
      throw new ApplicationError(
        413,
        "REQ_INVALID_BODY",
        "Learning request is too large.",
      );
    const scheduling = handleLearningScheduling(runtime, owner, path, r.method, body, key, assertActive, r.query);
    if (scheduling) return context.ok(await scheduling, r.requestId ?? "", { "Cache-Control": "no-store" });
    const report = /^\/lessons\/(lesson-[a-z0-9-]+)\/report-practice$/.exec(path);
    const tutor = /^\/lessons\/(lesson-[a-z0-9-]+)\/tutor-work$/.exec(path);
    const observation = /^\/lessons\/(lesson-[a-z0-9-]+)\/tutor-observation$/.exec(path);
    if (path === "/tutor/starter" && r.method === "GET") {
      const material = tutorMaterial(STRUCTURED_THINKING);
      result = {
        topic: material.topic,
        title: material.title,
        source_title: material.source.title,
        source_digest: material.source_digest,
        enabled: service.enabled && authority?.phase === "zook" && authority.readingEnabled &&
          (runtime.learningWork?.tutorEnabled() ?? false),
      };
    } else if (observation) {
      if (!runtime.learningWork)
        throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "Learning work storage is unavailable.");
      const observations = new TutorObservations(runtime.learningWork);
      if (r.method === "GET") result = await observations.read(owner, observation[1]!, version(r.query?.content_version));
      else if (r.method === "POST") result = await observations.command(owner, observation[1]!, body, key, assertActive);
      else throw new ApplicationError(405, "VALIDATION_ERROR", "Use GET or POST.");
    } else if (tutor) {
      if (!runtime.learningWork)
        throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "Learning worker is unavailable.");
      const turns = new TutorWork(runtime.learningWork);
      if (r.method === "GET") result = await turns.read(owner, tutor[1], version(r.query?.content_version));
      else if (r.method === "POST") result = await turns.submit(owner, tutor[1], body, key, assertActive);
      else throw new ApplicationError(405, "VALIDATION_ERROR", "Use GET or POST.");
    } else if(report){
      if(!runtime.learningWork) throw new ApplicationError(503,"LIGHTTICK_APP_DISABLED","Learning worker is unavailable.");
      const reports=new WorkReportPracticeService(runtime.learningWork);
      if(r.method==='GET') result=await reports.read(owner,report[1],String(r.query?.content_version??''));
      else if(r.method==='POST') result=await reports.submit(owner,report[1],body,key,assertActive);
      else throw new ApplicationError(405,"VALIDATION_ERROR","Use GET or POST.");
    }
    else if (path === "/work" || path.startsWith("/work/")) {
      const work = runtime.learningWork;
      if (!work) throw new ApplicationError(503,"LIGHTTICK_APP_DISABLED","Learning worker is unavailable.");
      const match = /^\/work\/(work-[a-zA-Z0-9-]+)(?:\/(cancel|adopt))?$/.exec(path);
      if (path === "/work" && r.method === "POST") result = await work.create(owner,body,key,assertActive);
      else if (path === "/work" && r.method === "GET") result = await work.list(owner,r.query?.cursor??"",r.query?.limit?integer(Number(r.query.limit),1,50):20);
      else if (match && !match[2] && r.method === "GET") result = await work.read(owner,match[1]);
      else if (match && match[2] === "cancel" && r.method === "POST") result = await work.cancel(owner,match[1],body,key,assertActive);
      else if (match && match[2] === "adopt" && r.method === "POST") result = await work.adopt(owner,match[1],body,key,assertActive);
      else throw new ApplicationError(404,"LIGHTTICK_RESOURCE_NOT_FOUND","Learning work route was not found.");
    }
    else if (path === "/routes" || path.startsWith("/routes/")) {
      const routes = new LearningRouteService(service), match = /^\/routes\/(plan-[a-zA-Z0-9-]+)(?:\/(publish|status|progress|versions\/[1-9][0-9]*|lessons\/[1-9][0-9]*\/publish))?$/.exec(path);
      if (path === "/routes" && r.method === "GET") result = await routes.list(owner, r.query?.cursor ?? "", r.query?.limit ? integer(Number(r.query.limit), 1, 100) : 25);
      else if (match) {
        const id = match[1], action = match[2];
        if (!action && r.method === "GET") result = await routes.read(owner, id);
        else if (!action && r.method === "PUT") result = await routes.save(owner, id, body, key, assertActive);
        else if (action === "publish" && r.method === "POST") result = await routes.publish(owner, id, body, key, assertActive);
        else if (action === "status" && r.method === "POST") result = await routes.transition(owner, id, body, key, assertActive);
        else if (action === "progress" && r.method === "GET") result = await routeProgress(service, owner, id);
        else if (action?.startsWith("versions/") && r.method === "GET") result = await routes.read(owner, id, Number(action.split("/")[1]));
        else if (action?.startsWith("lessons/") && r.method === "POST") result = await routes.publishLesson(owner, id, Number(action.split("/")[1]), body, key, assertActive);
        else throw new ApplicationError(405, "VALIDATION_ERROR", "Unsupported course route method.");
      } else throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Course route was not found.");
    }
    else if (r.method === "GET" && path === "/authority")
      result = {
        phase: authority?.phase ?? "unavailable",
        epoch: authority?.epoch ?? 0,
        revision: authority?.revision ?? 0,
        write_enabled: service.enabled && authority?.phase === "zook",
        reading_enabled: authority?.readingEnabled ?? false,
        private_enabled: authority?.privateEnabled ?? false,
        tutor_supported: !!runtime.learningWork,
        tutor_observation_supported: !!runtime.learningWork,
        learning_schedule_adjustment_supported: true,
        scheduling_enabled: service.enabled && authority?.phase === "zook" && authority.readingEnabled &&
          process.env.LIGHTTICK_MANUAL_PLANNING_ENABLED !== "0",
        schedule_ai_enabled: service.enabled && authority?.phase === "zook" && authority.readingEnabled &&
          authority.privateEnabled && (runtime.learningWork?.scheduleSuggestionsEnabled() ?? false),
        learning_continuation_enabled: authority?.phase === "zook" && authority.readingEnabled === true &&
          (await runtime.learningContinuation?.available() ?? false),
      };
    else if (r.method === "POST" && path === "/consent")
      result = await service.consent(owner, body, key, assertActive);
    else if (r.method === "GET" && path === "/modules")
      result = await service.modules(owner);
    else if (r.method === "GET" && path === "/continuation")
      result = await service.repository.transaction(owner, async () => {
        const access = await service.requireActive(owner);
        if (!access.readingEnabled)
          throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Reading consent is required.");
        return handleLearningContinuationRequest(service.repository, owner, r, access.privateEnabled);
      });
    else if (r.method === "GET" && path === "/collections")
      result = await service.collections(
        owner,
        r.query?.cursor ?? "",
        r.query?.limit ? integer(Number(r.query.limit), 1, 100) : 50,
        r.query?.module_id ? moduleIdentity(r.query.module_id) : undefined,
      );
    else if (r.method === "GET" && path === "/lessons")
      result = await service.lessons(
        owner,
        r.query?.cursor ?? "",
        r.query?.limit ? integer(Number(r.query.limit), 1, 100) : 50,
        r.query?.collection_id,
        r.query?.module_id ? moduleIdentity(r.query.module_id) : undefined,
      );
    else {
      const collection = /^\/collections\/([^/]+)$/.exec(path),
        publish = /^\/lessons\/(lesson-[a-z0-9-]+)\/publications$/.exec(path),
        currentLesson = /^\/lessons\/(lesson-[a-z0-9-]+)$/.exec(path),
        content =
          /^\/lessons\/(lesson-[a-z0-9-]+)\/versions\/([a-f0-9]{64})$/.exec(
            path,
          ),
        privateMatch = /^\/lessons\/(lesson-[a-z0-9-]+)\/private$/.exec(path),
        history = /^\/lessons\/(lesson-[a-z0-9-]+)\/private-history$/.exec(
          path,
        );
      if (collection && r.method === "PUT")
        result = await service.saveCollection(
          owner,
          decodedCollection(collection[1]),
          body,
          key,
          assertActive,
        );
      else if (publish && r.method === "PUT")
        result = await service.publish(
          owner,
          publish[1],
          body,
          key,
          assertActive,
        );
      else if ((content || currentLesson) && r.method === "GET") {
        const x = await service.publication(owner, content?.[1] ?? currentLesson![1], content?.[2]);
        const tutor = x.publication.tutorTopic && tutorPublication(x.publication.tutorTopic, x.publication.content);
        result = {
          ...service.lessonData(x.lesson),
          content_version: x.publication.contentVersion,
          content: x.publication.content,
          references: x.publication.references,
          source_url: x.publication.sourceUrl,
          created_at: x.publication.createdAt,
          questions: publicationQuestions(x.publication),
          ...(tutor ? { tutor } : {}),
        };
      } else if (privateMatch && r.method === "GET")
        result = privateData(
          await service.privateState(
            owner,
            privateMatch[1],
            version(r.query?.content_version),
          ),
        );
      else if (privateMatch && r.method === "POST")
        result = await service.privateCommand(
          owner,
          privateMatch[1],
          body,
          key,
          assertActive,
        );
      else if (history && r.method === "GET")
        result = await service.history(
          owner,
          history[1],
          version(r.query?.content_version),
          r.query?.cursor ?? "",
          r.query?.limit ? integer(Number(r.query.limit), 1, 20) : 20,
        );
      else
        throw new ApplicationError(
          404,
          "LIGHTTICK_RESOURCE_NOT_FOUND",
          "Learning route was not found.",
        );
    }
  }
  return context.ok(result, r.requestId ?? "", { "Cache-Control": "no-store" });
}
