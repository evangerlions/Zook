import { Avatar, Button, Dropdown, Select, type MenuProps } from "antd";
import { useMemo, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { NoticeBanner } from "./notice-banner";
import { useAdminSession } from "../lib/admin-session";
import { loadSidebarCollapsed, saveSidebarCollapsed } from "../lib/storage";
import type { AdminAppSummary } from "../lib/types";

const SERVER_WORKSPACES = [
  { to: "/apps", label: "应用", code: "APP", description: "管理项目空间与接入状态" },
  { to: "/mail", label: "邮件服务", code: "MAIL", description: "统一维护公共邮件配置" },
  { to: "/passwords", label: "PASSWORDS", code: "PWD", description: "维护公共密钥与密码项" },
  { to: "/llm", label: "LLM", code: "LLM", description: "配置模型、路由与监控能力" },
];

const APP_WORKSPACES = [
  { to: "/config", label: "配置", code: "CFG", description: "编辑当前 App 的 JSON 配置" },
  { to: "/remote-log-pull", label: "Remote Log Pull", code: "RLP", description: "管理当前 App 的日志回捞设置与任务" },
];

function formatAdminVersion(rawVersion: string): string {
  const normalized = rawVersion.trim();
  if (!normalized) {
    return "v0.1.0";
  }

  const semverMatch = normalized.match(/\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?/);
  if (semverMatch) {
    return `v${semverMatch[0]}`;
  }

  const releaseMatch = normalized.match(/(\d{8}_\d{3}).*?-([0-9a-f]{6,8})(?:-|$)/i);
  if (releaseMatch) {
    return `${releaseMatch[1]} · ${releaseMatch[2].slice(0, 6)}`;
  }

  const shortHashMatch = normalized.match(/([0-9a-f]{6,8})(?:-|$)/i);
  if (shortHashMatch) {
    return shortHashMatch[1].slice(0, 6);
  }

  return normalized.length > 18 ? `${normalized.slice(0, 18)}…` : normalized;
}

function isAppProjectSpace(pathname: string) {
  return pathname === "/config" || pathname === "/remote-log-pull";
}

function describeProjectSpace(app: AdminAppSummary | null, pathname: string) {
  if (!isAppProjectSpace(pathname)) {
    return {
      title: "Server",
      meta: "",
    };
  }

  return {
    title: app?.appName ?? "项目空间",
    meta: app?.appId ?? "未选择 App",
  };
}

export function AppShell() {
  const navigate = useNavigate();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => loadSidebarCollapsed());
  const {
    adminUser,
    apps,
    selectedAppId,
    setSelectedAppId,
    beginWorkspaceTransition,
    workspaceTransitionLabel,
    runtimeConfig,
    notice,
    clearNotice,
    logout,
  } = useAdminSession();

  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? apps[0] ?? null;
  const appProjectSpace = isAppProjectSpace(location.pathname);
  const currentProjectSpace = describeProjectSpace(selectedApp, location.pathname);
  const workspaceItems = appProjectSpace ? APP_WORKSPACES : SERVER_WORKSPACES;
  const currentProjectSpaceValue = appProjectSpace && selectedApp ? `app:${selectedApp.appId}` : "server";
  const projectSpaceOptions = useMemo(
    () => [
      { label: "Server", value: "server" },
      ...apps.map((item) => ({
        label: `${item.appName} · ${item.appId}`,
        value: `app:${item.appId}`,
      })),
    ],
    [apps],
  );
  const userMenuItems: MenuProps["items"] = [
    {
      key: "logout",
      label: "退出登录",
    },
  ];
  const userInitial = adminUser.trim().slice(0, 1).toUpperCase() || "A";
  const adminVersion = formatAdminVersion(runtimeConfig.version);

  function handleToggleSidebar() {
    setSidebarCollapsed((current) => {
      const nextValue = !current;
      saveSidebarCollapsed(nextValue);
      return nextValue;
    });
  }

  function openServerSpace() {
    if (location.pathname === "/apps") {
      return;
    }

    beginWorkspaceTransition("正在切换到 Server 工作区");
    void navigate("/apps");
  }

  function openAppSpace(app: AdminAppSummary) {
    if (appProjectSpace && selectedAppId === app.appId) {
      return;
    }

    beginWorkspaceTransition(`正在切换到 ${app.appName}`);
    setSelectedAppId(app.appId);
    void navigate(appProjectSpace ? location.pathname : "/config");
  }

  function handleProjectSpaceChange(value: string) {
    if (value === "server") {
      openServerSpace();
      return;
    }

    const appId = value.replace(/^app:/, "");
    const app = apps.find((item) => item.appId === appId);
    if (app) {
      openAppSpace(app);
    }
  }

  return (
    <div className={`console-shell${sidebarCollapsed ? " is-sidebar-collapsed" : ""}`}>
      <aside className={`sidebar${sidebarCollapsed ? " is-collapsed" : ""}`}>
        <div className="sidebar-head">
          <div className="brand-block">
            <span>Control Room</span>
            <strong>{runtimeConfig.brandName}</strong>
          </div>
          <Button
            aria-expanded={!sidebarCollapsed}
            aria-label={sidebarCollapsed ? "展开工作区侧栏" : "折叠工作区侧栏"}
            className="sidebar-toggle"
            onClick={handleToggleSidebar}
            type="text"
          >
            <span aria-hidden="true">{sidebarCollapsed ? "»" : "«"}</span>
            <span>{sidebarCollapsed ? "展开" : "折叠"}</span>
          </Button>
        </div>

        <div className="workspace-panel">
          <span>工作区</span>
          <strong>{currentProjectSpace.title}</strong>
          {currentProjectSpace.meta ? <small>{currentProjectSpace.meta}</small> : null}
        </div>

        <nav className="sidebar-nav" aria-label="工作区导航">
          {workspaceItems.map((item) => (
            <NavLink
              className={({ isActive }) => `nav-link${isActive ? " is-active" : ""}`}
              end
              key={item.to}
              title={sidebarCollapsed ? `${item.label} · ${item.description}` : undefined}
              to={item.to}
            >
              <span aria-hidden="true" className="nav-code">
                {item.code}
              </span>
              <span className="nav-copy">
                <strong>{item.label}</strong>
                <small>{item.description}</small>
              </span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-footer">
          <span>版本</span>
          <strong>{adminVersion}</strong>
        </div>
      </aside>

      <div className="console-main">
        <header className="topbar">
          <div className="topbar-primary">
            <div className="topbar-select-group">
              <span className="topbar-label">项目空间</span>
              <Select
                aria-label="项目空间"
                className="project-space-select"
                onChange={handleProjectSpaceChange}
                options={projectSpaceOptions}
                popupMatchSelectWidth={false}
                size="large"
                value={currentProjectSpaceValue}
              />
            </div>
          </div>

          <div className="topbar-links">
            <a href={runtimeConfig.analyticsUrl} rel="noreferrer" target="_blank">
              Analytics
            </a>
            <a href={runtimeConfig.logsUrl} rel="noreferrer" target="_blank">
              Logs
            </a>
            <Dropdown
              arrow
              menu={{
                items: userMenuItems,
                onClick: ({ key }) => {
                  if (key === "logout") {
                    void logout();
                  }
                },
              }}
              placement="bottomRight"
              trigger={["click"]}
            >
              <Button aria-label="打开用户菜单" className="user-menu-trigger" shape="circle" type="text">
                <Avatar className="user-avatar" size={36}>
                  {userInitial}
                </Avatar>
              </Button>
            </Dropdown>
          </div>
        </header>

        <main className={`page-shell${workspaceTransitionLabel ? " has-workspace-overlay" : ""}`}>
          <NoticeBanner notice={notice} onDismiss={clearNotice} />
          <Outlet />
          {workspaceTransitionLabel ? (
            <div aria-live="polite" className="workspace-transition-overlay" role="status">
              <div className="workspace-transition-panel">
                <span aria-hidden="true" className="workspace-transition-spinner" />
                <strong>正在切换工作区</strong>
                <p>{workspaceTransitionLabel}</p>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
