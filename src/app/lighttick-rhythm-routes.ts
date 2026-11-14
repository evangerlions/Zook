import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { LightTickRhythmWeeklyService } from "../modules/lighttick/lighttick-rhythm-weekly.service.ts";
import { LightTickNotificationService } from "../modules/lighttick/lighttick-notifications.ts";
import { LightTickReflectionService } from "../modules/lighttick/lighttick-reflection.service.ts";

function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} is required.`);
  return value.trim();
}

export async function handleRhythmRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const prefix = "/api/v1/lighttick";

  // GET /api/v1/lighttick/rhythm/weekly?week_start=2026-11-10
  if (request.method === "GET" && request.path === `${prefix}/rhythm/weekly`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const weekStart = query.week_start;
    if (!weekStart) throw new Error("week_start is required.");
    const service = new LightTickRhythmWeeklyService(repository);
    return await service.get(owner, weekStart);
  }

  // POST /api/v1/lighttick/rhythm/weekly?week_start=2026-11-10 (confirm)
  if (request.method === "POST" && request.path === `${prefix}/rhythm/weekly`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const weekStart = query.week_start;
    if (!weekStart) throw new Error("week_start is required.");
    // For now, confirm just returns the view (snapshot is server-authoritative)
    const service = new LightTickRhythmWeeklyService(repository);
    return await service.get(owner, weekStart);
  }

  // POST /api/v1/lighttick/notifications/subscribe
  if (request.method === "POST" && request.path === `${prefix}/notifications/subscribe`) {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    const type = stringOf(body.type, "type");
    const allowed = ["weekly_review", "daily_tasks", "review_ready"];
    if (!allowed.includes(type)) throw new Error(`Subscription type must be one of: ${allowed.join(", ")}`);
    // Store preference in profile notification_preferences
    const profile = await repository.getProfile(owner);
    const prefs = profile?.notificationPreferences ?? {};
    prefs[type] = true;
    // Save updated profile
    if (profile) {
      await repository.saveProfile({ ...profile, notificationPreferences: prefs, updatedAt: new Date().toISOString() }, profile.version);
    }
    return { subscribed: true, type };
  }

  // GET /api/v1/lighttick/notifications/subscriptions
  if (request.method === "GET" && request.path === `${prefix}/notifications/subscriptions`) {
    const profile = await repository.getProfile(owner);
    const prefs = profile?.notificationPreferences ?? {};
    const subscriptions: string[] = [];
    for (const key of ["weekly_review", "daily_tasks", "review_ready"]) {
      if (prefs[key]) subscriptions.push(key);
    }
    return { subscriptions };
  }

  return undefined;
}

export async function handleLearningContinuationRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
): Promise<unknown | undefined> {
  const prefix = "/api/v1/lighttick";

  // GET /api/v1/lighttick/learning/continuation?collection_id=xxx
  if (request.method === "GET" && request.path === `${prefix}/learning/continuation`) {
    const query = (request.query ?? {}) as Record<string, string | undefined>;
    const collectionId = query.collection_id;

    // Get all active routes
    const routes = await repository.learningRoutes.listLearningRoutes(owner, "", 101, true);
    if (!routes.length) {
      return { collection_id: collectionId ?? null, lesson_id: null, position: 0, completed: false };
    }

    // Find the route matching the collection_id, or use the first active route
    let targetRoute = collectionId
      ? routes.find(r => r.id === collectionId)
      : routes[0];

    if (!targetRoute) {
      return { collection_id: collectionId ?? null, lesson_id: null, position: 0, completed: false };
    }

    // Get progress facts to find the last completed lesson
    const facts = await repository.learningRoutes.readRouteProgressFacts(owner, targetRoute.id);
    if (!facts.length) {
      return {
        collection_id: targetRoute.id,
        lesson_id: null,
        position: 0,
        completed: false,
      };
    }

    // Find the last completed lesson (highest number with completed=true)
    const completedFacts = facts.filter(f => f.completed).sort((a, b) => b.number - a.number);
    const lastCompleted = completedFacts[0];

    if (lastCompleted) {
      // Return the next lesson after the last completed one
      const nextLesson = facts.find(f => f.number === lastCompleted.number + 1);
      return {
        collection_id: targetRoute.id,
        lesson_id: nextLesson?.lessonId ?? lastCompleted.lessonId,
        position: nextLesson?.number ?? lastCompleted.number,
        completed: nextLesson ? false : true,
      };
    }

    // No completed lessons, return the first lesson
    const firstLesson = facts.sort((a, b) => a.number - b.number)[0];
    return {
      collection_id: targetRoute.id,
      lesson_id: firstLesson?.lessonId ?? null,
      position: firstLesson?.number ?? 0,
      completed: false,
    };
  }

  // POST /api/v1/lighttick/learning/checkins
  if (request.method === "POST" && request.path === `${prefix}/learning/checkins`) {
    if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
      throw new Error("Request body must be an object.");
    const body = request.body as Record<string, unknown>;
    const lessonId = stringOf(body.lesson_id, "lesson_id");
    const difficulty = body.difficulty ? stringOf(body.difficulty, "difficulty") : undefined;
    const takeaway = body.takeaway ? stringOf(body.takeaway, "takeaway") : undefined;
    const nextStep = body.next_step ? stringOf(body.next_step, "next_step") : undefined;

    // Validate difficulty enum
    if (difficulty && !["easy", "moderate", "hard"].includes(difficulty))
      throw new Error("difficulty must be one of: easy, moderate, hard");

    // Save as a reflection tied to the learning route
    const reflectionService = new LightTickReflectionService(repository);
    const checkinId = `checkin-${lessonId}-${Date.now().toString(36)}`;
    const content = [
      difficulty ? `难度: ${difficulty}` : "",
      takeaway ? `收获: ${takeaway}` : "",
      nextStep ? `下一步: ${nextStep}` : "",
    ].filter(Boolean).join("\n") || "完成学习";

    // Find a learning-related goal, or use the first active goal
    const goals = await repository.listGoals(owner);
    const learningGoal = goals.find(g =>
      g.title.toLowerCase().includes("学习") ||
      g.title.toLowerCase().includes("learning") ||
      g.constraints?.domain === "learning"
    ) ?? goals.find(g => g.status === "active") ?? goals[0];

    if (!learningGoal) {
      throw new Error("No goal found for check-in. Please create a goal first.");
    }

    await reflectionService.save(owner, checkinId, {
      goal_id: learningGoal.id,
      period_start: new Date().toISOString().slice(0, 10),
      period_end: new Date().toISOString().slice(0, 10),
      content,
      next_action: nextStep ?? "",
      base_version: 0,
    });

    return { checkin_id: checkinId, created: true };
  }

  return undefined;
}
