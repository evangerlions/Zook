import { randomUUID } from "node:crypto";
export async function seedTodayFocus(runtime: any) {
  const owner = { appId: "lighttick" as const, userId: "user_alice" };
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    key = randomUUID(),
    user = "user_alice",
  ) =>
    runtime.app.handle({
      method,
      path: "/api/v1/lighttick/" + path,
      body,
      headers: {
        authorization:
          "Bearer " +
          runtime.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick",
        "x-lighttick-task-schema": "2",
        "idempotency-key": key,
      },
    });
  const ok = async (method: string, path: string, body?: unknown) => {
    const r = await call(method, path, body);
    if (r.statusCode >= 400) throw Error(JSON.stringify(r.body));
    return r.body.data;
  };
  const today = await ok("GET", "today"),
    goal = await ok("POST", "goals", {
      title: "今日焦点验收",
      description: "",
      source_type: "user_input",
    });
  const plan = await ok("POST", "manual-plans", {
    goal_id: goal.id,
    title: "焦点选择计划",
    completion_criteria: "完成小行动",
    period_start: today.business_date,
    period_end: today.business_date,
    tasks: [
      {
        id: randomUUID(),
        title: "整理提纲",
        scheduled_for: today.business_date,
        estimated_minutes: 10,
        completion_criteria: "写出三个要点",
        guidance: "先写标题",
      },
      {
        id: randomUUID(),
        title: "练习表达",
        scheduled_for: today.business_date,
        estimated_minutes: 15,
        completion_criteria: "完成一段练习",
        guidance: "打开草稿",
      },
    ],
  });
  await ok("POST", `manual-plans/${plan.id}/confirm`, {
    base_version: plan.version,
    goal_base_version: plan.goal_version,
  });
  const tasks = (await ok("GET", "today")).tasks;
  return { owner, call, ok, tasks, today };
}
