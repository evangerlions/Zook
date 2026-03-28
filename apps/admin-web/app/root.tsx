import { ConfigProvider } from "antd";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, type LinksFunction } from "react-router";

import { AdminSessionProvider } from "./lib/admin-session";
import { buildInlineRuntimeConfigFallbackScript } from "./lib/runtime-config";
import "antd/dist/reset.css";
import "./app.css";

export const links: LinksFunction = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&family=Outfit:wght@500;600;700;800&display=swap",
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta content="width=device-width, initial-scale=1" name="viewport" />
        <meta content="#10212c" name="theme-color" />
        <meta
          content="Zook Admin Web，用于管理工作区、认证状态和运营指标。"
          name="description"
        />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: buildInlineRuntimeConfigFallbackScript(),
          }}
        />
        {!import.meta.env.DEV ? <script src="/_admin/runtime-config.js" /> : null}
      </head>
      <body>
        <a className="skip-link" href="#main-content">跳到主要内容</a>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ConfigProvider
      theme={{
        token: {
          borderRadius: 14,
          colorPrimary: "#2157d5",
          colorText: "#132033",
          colorTextSecondary: "#607187",
          fontFamily: "\"Manrope\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", sans-serif",
        },
      }}
    >
      <AdminSessionProvider>
        <Outlet />
      </AdminSessionProvider>
    </ConfigProvider>
  );
}

export function HydrateFallback() {
  return (
    <main className="page-loading-shell">
      <div className="loading-panel">
        <p>正在加载后台控制台...</p>
      </div>
    </main>
  );
}
