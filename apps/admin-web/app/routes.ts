import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  route("login", "routes/login.tsx"),
  layout("routes/console-layout.tsx", [
    index("routes/home.tsx"),
    route("apps", "routes/apps.tsx"),
    route("config", "routes/config.tsx"),
    route("mail", "routes/mail.tsx"),
    route("passwords", "routes/passwords.tsx"),
    route("llm", "routes/llm.tsx"),
  ]),
] satisfies RouteConfig;
