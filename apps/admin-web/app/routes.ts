import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  layout("routes/console-layout.tsx", [
    index("routes/home.tsx"),
    route("apps", "routes/apps.tsx"),
    route("auth-rate-limits", "routes/auth-rate-limits.tsx"),
    route("config", "routes/config.tsx"),
    route("ai-routing", "routes/ai-routing.tsx"),
    route("remote-log-pull", "routes/remote-log-pull.tsx"),
    route("remote-log-pull/tasks/:taskId", "routes/remote-log-pull-task.tsx"),
    route("mail", "routes/mail.tsx"),
    route("sms", "routes/sms.tsx"),
    route("passwords", "routes/passwords.tsx"),
    route("llm", "routes/llm.tsx"),
  ]),
] satisfies RouteConfig;
