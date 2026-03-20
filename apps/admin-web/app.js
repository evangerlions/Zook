const runtimeConfig = window.__ADMIN_RUNTIME_CONFIG__ ?? {};
const STORAGE_KEYS = {
  session: "zook.admin.session",
  workspace: "zook.admin.workspace",
};

const appRoot = document.getElementById("app");

const state = {
  busy: false,
  notice: null,
  pendingPath: "",
  workspace: loadWorkspace(),
  session: loadSession(),
  metricsOverview: null,
  pageMetrics: null,
  filters: {
    overview: createDefaultRange(6),
    pages: createDefaultRange(6),
  },
  health: null,
};

window.addEventListener("popstate", () => {
  render().catch(handleUnexpectedError);
});

appRoot.addEventListener("click", (event) => {
  const target = event.target.closest("[data-link], [data-action]");
  if (!target) {
    return;
  }

  if (target.dataset.link) {
    event.preventDefault();
    navigate(target.dataset.link);
    return;
  }

  if (target.dataset.action) {
    event.preventDefault();
    handleAction(target.dataset.action).catch(handleUnexpectedError);
  }
});

appRoot.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();
  handleFormSubmit(form).catch(handleUnexpectedError);
});

boot().catch(handleUnexpectedError);

async function boot() {
  await render();
}

function loadWorkspace() {
  const stored = safeParse(localStorage.getItem(STORAGE_KEYS.workspace));
  if (stored && typeof stored.appId === "string") {
    return {
      appId: stored.appId,
      workspaceName: typeof stored.workspaceName === "string" ? stored.workspaceName : "",
      lastAccount: typeof stored.lastAccount === "string" ? stored.lastAccount : "",
    };
  }

  return {
    appId: typeof runtimeConfig.defaultAppId === "string" ? runtimeConfig.defaultAppId : "",
    workspaceName: "",
    lastAccount: "",
  };
}

function saveWorkspace(nextWorkspace) {
  state.workspace = {
    appId: nextWorkspace.appId.trim(),
    workspaceName: nextWorkspace.workspaceName.trim(),
    lastAccount: nextWorkspace.lastAccount?.trim?.() ?? state.workspace.lastAccount ?? "",
  };
  localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify(state.workspace));
}

function loadSession() {
  const stored = safeParse(sessionStorage.getItem(STORAGE_KEYS.session));
  if (!stored || typeof stored.accessToken !== "string") {
    return {
      accessToken: "",
      expiresIn: 0,
      issuedAt: "",
    };
  }

  return {
    accessToken: stored.accessToken,
    expiresIn: typeof stored.expiresIn === "number" ? stored.expiresIn : 0,
    issuedAt: typeof stored.issuedAt === "string" ? stored.issuedAt : "",
  };
}

function saveSession(nextSession) {
  state.session = nextSession;
  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(nextSession));
}

function clearSession() {
  state.session = {
    accessToken: "",
    expiresIn: 0,
    issuedAt: "",
  };
  sessionStorage.removeItem(STORAGE_KEYS.session);
}

function safeParse(rawValue) {
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue);
  } catch {
    return null;
  }
}

function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function navigate(path) {
  if (currentPath() === path) {
    render().catch(handleUnexpectedError);
    return;
  }

  window.history.pushState({}, "", path);
  render().catch(handleUnexpectedError);
}

function setNotice(tone, text) {
  state.notice = {
    tone,
    text,
  };
}

function clearNotice() {
  state.notice = null;
}

function handleUnexpectedError(error) {
  console.error(error);
  setNotice("error", formatError(error));
  render().catch(console.error);
}

function createDefaultRange(offsetDays) {
  return {
    dateFrom: formatDate(addDays(new Date(), -offsetDays)),
    dateTo: formatDate(new Date()),
  };
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isConsoleRoute(path) {
  return path.startsWith("/console");
}

function requiresBusinessSession(path) {
  return path === "/console/metrics" || path === "/console/pages";
}

function defaultEntryPath() {
  return state.workspace.appId ? "/console/workspace" : "/setup";
}

function queueBusinessLogin(path, message) {
  state.pendingPath = requiresBusinessSession(path) ? path : "/console";
  setNotice("info", message || "当前页面会读取受保护的业务接口，请先接管当前 app 的业务账号。");
  navigate("/login");
}

function workspaceLabel() {
  return state.workspace.workspaceName || state.workspace.appId || "未命名工作区";
}

async function render() {
  const path = currentPath();
  syncDocumentTitle(path);

  if (!state.workspace.appId && path !== "/setup") {
    navigate("/setup");
    return;
  }

  if (path === "/") {
    navigate(defaultEntryPath());
    return;
  }

  if (requiresBusinessSession(path) && !state.session.accessToken) {
    const restored = await tryRestoreSession();
    if (!restored) {
      queueBusinessLogin(path, "读取指标前，需要先接管当前工作区的业务账号。");
      return;
    }
  }

  if (path === "/login") {
    appRoot.innerHTML = renderAuthScreen("login");
    return;
  }

  if (path === "/setup") {
    appRoot.innerHTML = renderAuthScreen("setup");
    return;
  }

  if (path === "/console" || path === "/console/") {
    state.health = state.health ?? { loading: true };
    appRoot.innerHTML = renderConsoleScreen("home");
    if (!state.health.status || state.health.loading) {
      void refreshHealth();
    }
    return;
  }

  if (path === "/console/metrics") {
    appRoot.innerHTML = renderConsoleScreen("metrics");
    if (!state.metricsOverview || state.metricsOverview.loading) {
      void loadOverviewMetrics();
    }
    return;
  }

  if (path === "/console/pages") {
    appRoot.innerHTML = renderConsoleScreen("pages");
    if (!state.pageMetrics || state.pageMetrics.loading) {
      void loadPageMetrics();
    }
    return;
  }

  if (path === "/console/workspace") {
    appRoot.innerHTML = renderConsoleScreen("workspace");
    return;
  }

  navigate(defaultEntryPath());
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  const tone = state.notice.tone || "info";
  const role = tone === "error" ? "alert" : "status";
  const title =
    tone === "error" ? "请求失败" : tone === "success" ? "已完成" : "系统提示";

  return `
    <section class="notice" data-tone="${escapeHtml(tone)}" role="${role}" aria-live="${
      tone === "error" ? "assertive" : "polite"
    }">
      <span class="eyebrow">Notice</span>
      <p class="panel-title">${escapeHtml(title)}</p>
      <p class="section-subtitle">${escapeHtml(state.notice.text)}</p>
    </section>
  `;
}

function renderAuthScreen(mode) {
  const isSetup = mode === "setup";
  const title = isSetup ? "先设定工作区" : "按需接管业务账号";
  const description = isSetup
    ? "先录入一个默认 appId。后续所有后台请求都会以这个工作区作为作用域。"
    : "你已经通过超级管理员入口。只有访问受保护的业务接口时，才需要为当前工作区接入一个 app 内账号。";
  const activeAppId = state.workspace.appId || runtimeConfig.defaultAppId || "未设置";

  return `
    <div class="stage-shell">
      <div class="auth-layout">
        <aside class="story-panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Admin Control Surface</span>
              <h1 class="hero-title">${escapeHtml(runtimeConfig.brandName || "Zook Control Room")}</h1>
              <p class="hero-copy">
                面向同仓多服务部署的后台前端。页面先强调工作区作用域和心跳状态，让操作入口更像一个可读的控制面板，而不是一堆散的表单。
              </p>
            </div>

            <div class="summary-grid">
              ${renderStatCard("默认工作区", activeAppId, "当前后台的 app 作用域入口。", "primary")}
              ${renderStatCard("健康检查", runtimeConfig.healthPath || "/api/health", "部署、Caddy 和容器探活统一使用。", "accent")}
              ${renderStatCard("入口门禁", "超级管理员", "进入 admin-web 后可直接维护工作区配置。", "success")}
            </div>

            <section class="panel note-card">
              <span class="eyebrow">接入原则</span>
              <ul class="bullet-list">
                <li>所有 API 统一走 <code>/api/v1</code> 前缀，心跳单独走 <code>/api/health</code>。</li>
                <li>超级管理员进入后台后，可以先维护当前工作区配置，不必先接业务账号。</li>
                <li>切换 <code>appId</code> 后会断开业务账号接管，避免把管理动作误打到错误 app。</li>
              </ul>
            </section>
          </div>
        </aside>

        <main id="main-content" class="auth-panel">
          <div class="stack">
            <header class="panel-header">
              <div class="stack-tight">
                <span class="eyebrow">${isSetup ? "Workspace Setup" : "Authentication"}</span>
                <h2 class="panel-title">${title}</h2>
                <p class="section-subtitle">${description}</p>
              </div>
            </header>

            ${renderNotice()}

            ${
              isSetup
                ? `
                  <form class="form-grid" data-form="setup">
                    <div class="field">
                      <label for="setup-app-id">默认 appId</label>
                      <input
                        id="setup-app-id"
                        name="appId"
                        placeholder="例如 app_a"
                        value="${escapeHtml(state.workspace.appId || runtimeConfig.defaultAppId || "")}"
                        spellcheck="false"
                        required
                      />
                      <p class="field-hint">这个值会被后台页面自动带入作用域相关的 API 请求。</p>
                    </div>
                    <div class="field">
                      <label for="setup-workspace-name">工作区名称</label>
                      <input
                        id="setup-workspace-name"
                        name="workspaceName"
                        placeholder="例如 数据运营后台"
                        value="${escapeHtml(state.workspace.workspaceName || "")}"
                      />
                      <p class="field-hint">只影响后台前端显示，不会写入后端配置。</p>
                    </div>
                    <div class="footer-actions">
                      <button class="button button-primary" type="submit">${state.busy ? "保存中..." : "保存并进入控制台"}</button>
                      ${
                        state.workspace.appId
                          ? '<button class="button button-secondary" type="button" data-link="/console/workspace">已有配置，直接进控制台</button>'
                          : ""
                      }
                    </div>
                  </form>
                `
                : `
                  <form class="form-grid" data-form="login">
                    <section class="panel note-card">
                      <span class="eyebrow">Scope</span>
                      <div class="info-grid">
                        ${renderInfoLine("当前工作区", state.workspace.appId)}
                        ${renderInfoLine("接入类型", "业务账号")}
                        ${renderInfoLine("使用时机", "读取受保护接口时")}
                      </div>
                    </section>
                    <div class="field">
                      <label for="login-account">账号</label>
                      <input
                        id="login-account"
                        name="account"
                        placeholder="邮箱或账号"
                        value="${escapeHtml(state.workspace.lastAccount || "")}"
                        autocomplete="username"
                        spellcheck="false"
                        required
                      />
                    </div>
                    <div class="field">
                      <label for="login-password">密码</label>
                      <input
                        id="login-password"
                        name="password"
                        type="password"
                        placeholder="输入密码"
                        autocomplete="current-password"
                        required
                      />
                      <p class="field-hint">超级管理员入口已经通过，这里只是在需要时接管 app 内的业务账号。</p>
                    </div>
                    <div class="footer-actions">
                      <button class="button button-primary" type="submit">${state.busy ? "连接中..." : "连接业务账号"}</button>
                      <button class="button button-secondary" type="button" data-link="/console/workspace">返回工作区配置</button>
                    </div>
                  </form>
                `
            }
          </div>
        </main>
      </div>
    </div>
  `;
}

function renderConsoleScreen(activeView) {
  const meta = getConsoleMeta(activeView);
  const health = getHealthState();

  return `
    <div class="stage-shell">
      <div class="console-layout">
        <aside class="console-sidebar">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Admin Web</span>
              <h1 class="sidebar-title">${escapeHtml(runtimeConfig.brandName || "Zook Control Room")}</h1>
              <p class="sidebar-copy">当前工作区：${escapeHtml(workspaceLabel())}</p>
            </div>

            <section class="scope-card">
              <div class="inline-actions">
                <span class="pill">Scoped</span>
                ${renderStatusBadge(health.tone, health.label)}
              </div>
              <p class="scope-value">${escapeHtml(state.workspace.appId)}</p>
              <p class="section-subtitle">所有带作用域的后台请求都会自动使用这个 appId。</p>
            </section>
          </div>

          <nav class="nav-stack" aria-label="后台导航">
            ${renderNavLink("/console", "总览", "看工作区、心跳和登录状态", activeView === "home")}
            ${renderNavLink("/console/metrics", "概览指标", "按日期查看 DAU 与新增趋势", activeView === "metrics")}
            ${renderNavLink("/console/pages", "页面指标", "按 pageKey 与 platform 聚合分析", activeView === "pages")}
            ${renderNavLink("/console/workspace", "工作区配置", "维护默认 appId 和展示名称", activeView === "workspace")}
          </nav>

          <section class="panel sidebar-note">
            <p class="meta-label">当前会话</p>
            <div class="info-grid">
              ${renderInfoLine("入口门禁", "已通过")}
              ${renderInfoLine("业务账号", state.session.accessToken ? "已接管" : "按需连接")}
              ${renderInfoLine("健康检查", runtimeConfig.healthPath || "/api/health")}
            </div>
          </section>

          <div class="footer-actions">
            ${
              state.session.accessToken
                ? `
                  <button class="button button-secondary" type="button" data-link="/login">切换业务账号</button>
                  <button class="button button-danger" type="button" data-action="logout">断开业务账号</button>
                `
                : `
                  <button class="button button-secondary" type="button" data-link="/login">连接业务账号</button>
                  <button class="button button-secondary" type="button" data-link="/console/workspace">修改工作区</button>
                `
            }
          </div>
        </aside>

        <main id="main-content" class="console-stage">
          <header class="stage-header">
            <div class="stack-tight">
              <span class="eyebrow">${escapeHtml(meta.eyebrow)}</span>
              <h2 class="panel-title">${escapeHtml(meta.title)}</h2>
              <p class="section-subtitle">${escapeHtml(meta.description)}</p>
            </div>
            <div class="stage-meta" aria-label="当前上下文">
              <span class="meta-chip">appId · ${escapeHtml(state.workspace.appId)}</span>
              <span class="meta-chip">API · /api/v1</span>
              ${renderStatusBadge(health.tone, health.label)}
            </div>
          </header>

          ${renderNotice()}
          ${renderConsoleContent(activeView)}
        </main>
      </div>
    </div>
  `;
}

function renderNavLink(path, label, description, active) {
  const current = active ? ' aria-current="page"' : "";
  return `
    <a class="nav-card" data-link="${path}" data-active="${active ? "true" : "false"}" href="${path}"${current}>
      <span class="nav-label">${escapeHtml(label)}</span>
      <span class="nav-description">${escapeHtml(description)}</span>
    </a>
  `;
}

function renderConsoleContent(activeView) {
  if (activeView === "home") {
    return renderHomeView();
  }

  if (activeView === "metrics") {
    return renderMetricsView();
  }

  if (activeView === "pages") {
    return renderPagesView();
  }

  return renderWorkspaceView();
}

function renderHomeView() {
  const health = getHealthState();
  const sessionState = state.session.accessToken ? "已接管业务账号" : "超级管理员直达";

  return `
    <section class="view-stack">
      <section class="hero-slab">
        <div class="stack">
          <div class="stack-tight">
            <span class="eyebrow">Mission Snapshot</span>
            <h3 class="panel-title">先确认工作区和 API，再决定要不要接管业务账号。</h3>
            <p class="section-subtitle">
              你已经通过超级管理员门禁，所以默认先进入控制台。工作区配置和 API 连通性可以直接看，只有受保护的指标接口才需要业务账号。
            </p>
          </div>
          <div class="inline-actions">
            <button class="button button-primary" type="button" data-link="/console/workspace">修改工作区配置</button>
            <button class="button button-secondary" type="button" data-link="${state.session.accessToken ? "/console/metrics" : "/login"}">${
              state.session.accessToken ? "查看概览指标" : "连接业务账号"
            }</button>
            <button class="button button-secondary" type="button" data-action="refresh-health">刷新 API 状态</button>
          </div>
        </div>

        <section class="panel hero-aside ${state.health?.loading ? "loading" : ""}">
          <span class="eyebrow">Runtime</span>
          <div class="info-grid">
            ${renderInfoLine("API 状态", health.label)}
            ${renderInfoLine("工作区", state.workspace.appId)}
            ${renderInfoLine("会话", sessionState)}
            ${renderInfoLine("心跳路径", runtimeConfig.healthPath || "/api/health")}
          </div>
        </section>
      </section>

      <div class="summary-grid">
        ${renderStatCard("API 状态", health.label, runtimeConfig.healthPath || "/api/health", health.tone)}
        ${renderStatCard("当前工作区", state.workspace.appId, workspaceLabel(), "primary")}
        ${renderStatCard("会话状态", sessionState, "Refresh Token 通过同域 Cookie 自动续期。", state.session.accessToken ? "success" : "accent")}
      </div>

      <div class="content-grid">
        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Ready Checks</span>
              <h3 class="panel-title">进入操作前，先看这 3 件事</h3>
            </div>
            <div class="check-list">
              ${renderCheckItem("超级管理员入口已通过", "你可以直接进入工作区配置，不必先登录业务账号。", "success")}
              ${renderCheckItem("作用域已锁定", `当前后台默认操作 ${state.workspace.appId}`, "primary")}
              ${renderCheckItem("API 心跳可见", `健康检查路径 ${runtimeConfig.healthPath || "/api/health"}`, health.tone)}
            </div>
          </div>
        </section>

        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Quick Actions</span>
              <h3 class="panel-title">从这里进入最常用的管理任务</h3>
            </div>
            <div class="quick-grid">
              <article class="quick-card">
                <p class="quick-kicker">Workspace Control</p>
                <h4 class="quick-title">先改当前工作区配置</h4>
                <p class="quick-copy">先确认 <code>appId</code>、名称和 API 连通性，这一步不需要接业务账号。</p>
                <button class="button button-primary" type="button" data-link="/console/workspace">打开工作区配置</button>
              </article>
              <article class="quick-card">
                <p class="quick-kicker">Protected Metrics</p>
                <h4 class="quick-title">${state.session.accessToken ? "进入受保护指标页" : "按需接管业务账号"}</h4>
                <p class="quick-copy">${
                  state.session.accessToken
                    ? "当前已经接管业务账号，可以直接进入概览指标或页面分析。"
                    : "概览指标和页面分析会读取受保护 API，只有在需要这些视图时才需要接业务账号。"
                }</p>
                <button class="button button-secondary" type="button" data-link="${
                  state.session.accessToken ? "/console/metrics" : "/login"
                }">${state.session.accessToken ? "进入概览指标" : "连接业务账号"}</button>
              </article>
            </div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderMetricsView() {
  const items = state.metricsOverview?.items ?? [];
  const summary = getOverviewSummary(items);

  return `
    <section class="view-stack">
      <div class="summary-grid">
        ${renderStatCard("最新 DAU", summary.latestDau, summary.latestCaption, "primary")}
        ${renderStatCard("峰值 DAU", summary.peakDau, summary.peakCaption, "accent")}
        ${renderStatCard("新增总量", summary.totalNewUsers, summary.totalCaption, "success")}
        ${renderStatCard("返回时区", state.metricsOverview?.timezone || "未返回", `${state.filters.overview.dateFrom} - ${state.filters.overview.dateTo}`, "neutral")}
      </div>

      <div class="content-grid">
        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Query Window</span>
              <h3 class="panel-title">调整概览指标时间范围</h3>
              <p class="section-subtitle">读取 app 维度的日活与新增趋势，适合先看整体波动。</p>
            </div>
            <form class="form-grid" data-form="overview-filter">
              <div class="field-row">
                <div class="field">
                  <label for="overview-date-from">开始日期</label>
                  <input id="overview-date-from" name="dateFrom" type="date" value="${escapeHtml(state.filters.overview.dateFrom)}" required />
                </div>
                <div class="field">
                  <label for="overview-date-to">结束日期</label>
                  <input id="overview-date-to" name="dateTo" type="date" value="${escapeHtml(state.filters.overview.dateTo)}" required />
                </div>
              </div>
              <div class="footer-actions">
                <button class="button button-primary" type="submit">${state.metricsOverview?.loading ? "读取中..." : "刷新概览数据"}</button>
              </div>
            </form>
          </div>
        </section>

        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Pulse</span>
              <h3 class="panel-title">最近 7 天日活脉冲</h3>
            </div>
            ${
              items.length === 0 && !state.metricsOverview?.loading
                ? '<div class="empty-state">当前日期范围内还没有概览数据。</div>'
                : renderOverviewTrend(items)
            }
          </div>
        </section>
      </div>

      <section class="panel table-panel ${state.metricsOverview?.loading ? "loading" : ""}">
        <div class="panel-header">
          <div class="stack-tight">
            <span class="eyebrow">Timeline Table</span>
            <h3 class="panel-title">按日期展开原始返回结果</h3>
          </div>
          <div class="stage-meta">
            <span class="meta-chip">${escapeHtml(summary.rangeLabel)}</span>
          </div>
        </div>
        ${
          items.length === 0 && !state.metricsOverview?.loading
            ? '<div class="empty-state">当前日期范围内还没有概览数据。</div>'
            : `
              <div class="table-scroll">
                <table class="table">
                  <thead>
                    <tr>
                      <th>日期</th>
                      <th>DAU</th>
                      <th>新增用户</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items
                      .map(
                        (item) => `
                          <tr>
                            <td>${escapeHtml(item.date)}</td>
                            <td>${escapeHtml(formatCount(item.dau))}</td>
                            <td>${escapeHtml(formatCount(item.newUsers))}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </section>
  `;
}

function renderPagesView() {
  const items = state.pageMetrics?.items ?? [];
  const summary = getPageSummary(items);

  return `
    <section class="view-stack">
      <div class="summary-grid">
        ${renderStatCard("总 UV", summary.totalUv, summary.totalUvCaption, "primary")}
        ${renderStatCard("总 Session", summary.totalSessions, summary.totalSessionsCaption, "accent")}
        ${renderStatCard("Top 页面", summary.topPage, summary.topPageCaption, "success")}
        ${renderStatCard("平均停留", summary.avgDuration, summary.avgDurationCaption, "neutral")}
      </div>

      <div class="content-grid">
        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Page Range</span>
              <h3 class="panel-title">调整页面指标时间范围</h3>
              <p class="section-subtitle">按 <code>pageKey + platform</code> 聚合展示访问和停留表现。</p>
            </div>
            <form class="form-grid" data-form="pages-filter">
              <div class="field-row">
                <div class="field">
                  <label for="pages-date-from">开始日期</label>
                  <input id="pages-date-from" name="dateFrom" type="date" value="${escapeHtml(state.filters.pages.dateFrom)}" required />
                </div>
                <div class="field">
                  <label for="pages-date-to">结束日期</label>
                  <input id="pages-date-to" name="dateTo" type="date" value="${escapeHtml(state.filters.pages.dateTo)}" required />
                </div>
              </div>
              <div class="footer-actions">
                <button class="button button-primary" type="submit">${state.pageMetrics?.loading ? "读取中..." : "刷新页面指标"}</button>
              </div>
            </form>
          </div>
        </section>

        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Leaderboard</span>
              <h3 class="panel-title">按 UV 排序的页面表现</h3>
            </div>
            ${
              items.length === 0 && !state.pageMetrics?.loading
                ? '<div class="empty-state">当前日期范围内还没有页面指标。</div>'
                : renderPageLeaderboard(items)
            }
          </div>
        </section>
      </div>

      <section class="panel table-panel ${state.pageMetrics?.loading ? "loading" : ""}">
        <div class="panel-header">
          <div class="stack-tight">
            <span class="eyebrow">Detailed Table</span>
            <h3 class="panel-title">展开每个页面和平台的原始指标</h3>
          </div>
          <div class="stage-meta">
            <span class="meta-chip">${escapeHtml(summary.rangeLabel)}</span>
          </div>
        </div>
        ${
          items.length === 0 && !state.pageMetrics?.loading
            ? '<div class="empty-state">当前日期范围内还没有页面指标。</div>'
            : `
              <div class="table-scroll">
                <table class="table">
                  <thead>
                    <tr>
                      <th>页面</th>
                      <th>平台</th>
                      <th>UV</th>
                      <th>Session</th>
                      <th>总停留时长</th>
                      <th>平均停留时长</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${items
                      .map(
                        (item) => `
                          <tr>
                            <td>${escapeHtml(item.pageKey)}</td>
                            <td>${escapeHtml(item.platform)}</td>
                            <td>${escapeHtml(formatCount(item.uv))}</td>
                            <td>${escapeHtml(formatCount(item.sessionCount))}</td>
                            <td>${escapeHtml(formatDuration(item.totalDurationMs))}</td>
                            <td>${escapeHtml(formatDuration(item.avgDurationMs))}</td>
                          </tr>
                        `,
                      )
                      .join("")}
                  </tbody>
                </table>
              </div>
            `
        }
      </section>
    </section>
  `;
}

function renderWorkspaceView() {
  return `
    <section class="view-stack">
      <div class="summary-grid">
        ${renderStatCard("默认 appId", state.workspace.appId, "切换后如已接管业务账号，会自动断开。", "primary")}
        ${renderStatCard("工作区名称", state.workspace.workspaceName || "未命名", "只影响后台展示文案。", "accent")}
        ${renderStatCard("业务账号", state.session.accessToken ? "已接管" : "按需连接", "只有读取受保护接口时才需要。", "success")}
      </div>

      <div class="content-grid">
        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Workspace Settings</span>
              <h3 class="panel-title">维护当前后台默认工作区</h3>
              <p class="section-subtitle">你已经通过超级管理员门禁，所以这里可以直接维护当前工作区；业务账号只在读取受保护接口时再接入。</p>
            </div>
            <form class="form-grid" data-form="workspace">
              <div class="field">
                <label for="workspace-app-id">默认 appId</label>
                <input id="workspace-app-id" name="appId" value="${escapeHtml(state.workspace.appId)}" spellcheck="false" required />
                <p class="field-hint">保存后，后台页面会自动把它带入需要作用域的请求。</p>
              </div>
              <div class="field">
                <label for="workspace-name">工作区名称</label>
                <input
                  id="workspace-name"
                  name="workspaceName"
                  value="${escapeHtml(state.workspace.workspaceName)}"
                  placeholder="例如 增长运营后台"
                />
                <p class="field-hint">建议填业务名或团队名，方便区分多个 app 工作区。</p>
              </div>
              <div class="footer-actions">
                <button class="button button-primary" type="submit">${state.busy ? "保存中..." : "保存工作区"}</button>
                <button class="button button-secondary" type="button" data-link="/login">${
                  state.session.accessToken ? "切换业务账号" : "连接业务账号"
                }</button>
              </div>
            </form>
          </div>
        </section>

        <section class="panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="eyebrow">Request Rules</span>
              <h3 class="panel-title">这套后台怎么和 API 对齐</h3>
            </div>
            <div class="info-grid">
              ${renderInfoLine("健康检查", runtimeConfig.healthPath || "/api/health")}
              ${renderInfoLine("业务前缀", "/api/v1")}
              ${renderInfoLine("代理方式", "同域 /api/*")}
            </div>
            <ul class="bullet-list bullet-list-compact">
              <li>超级管理员进入后台后，可以先在这里改工作区配置，不必先接业务账号。</li>
              <li>切换 <code>appId</code> 后会断开当前业务账号接管，防止跨 app 误操作。</li>
              <li>浏览器只访问当前域名，跨域和 Cookie 由同域代理统一收口。</li>
              <li>如果要检查部署链路，先看 <code>/api/health</code>；只有指标接口才需要继续接业务账号。</li>
            </ul>
            <div class="footer-actions">
              <button class="button button-secondary" type="button" data-action="refresh-health">检测 API 连通性</button>
              <button class="button button-danger" type="button" data-action="reset-workspace">清空工作区</button>
            </div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function syncDocumentTitle(path) {
  const base = runtimeConfig.brandName || "Zook Control Room";
  const map = {
    "/": "工作区配置",
    "/login": "业务账号接管",
    "/setup": "工作区设置",
    "/console": "控制台总览",
    "/console/metrics": "概览指标",
    "/console/pages": "页面指标",
    "/console/workspace": "工作区配置",
  };

  document.title = `${map[path] || "管理后台"} | ${base}`;
}

function getConsoleMeta(activeView) {
  if (activeView === "metrics") {
    return {
      eyebrow: "Overview Metrics",
      title: "概览指标",
      description: "读取 app 维度的 DAU 与新增趋势，用来判断整体波动。",
    };
  }

  if (activeView === "pages") {
    return {
      eyebrow: "Page Analytics",
      title: "页面指标",
      description: "按页面和平台拆分 UV、Session 与停留表现。",
    };
  }

  if (activeView === "workspace") {
    return {
      eyebrow: "Workspace Configuration",
      title: "工作区配置",
      description: "超级管理员可直接维护默认 appId；只有读取受保护接口时才需要接业务账号。",
    };
  }

  return {
    eyebrow: "Mission Control",
    title: "控制台总览",
    description: "先确认工作区和健康状态，再决定是否需要接管业务账号。",
  };
}

function getHealthState() {
  if (state.health?.status === "ok") {
    return {
      tone: "success",
      label: "已连通",
    };
  }

  if (state.health?.status === "error") {
    return {
      tone: "danger",
      label: "连接失败",
    };
  }

  return {
    tone: "warning",
    label: "检测中",
  };
}

function renderStatusBadge(tone, label) {
  return `<span class="status-badge" data-tone="${escapeHtml(tone)}">${escapeHtml(label)}</span>`;
}

function renderStatCard(label, value, caption, tone = "neutral") {
  const kind = String(value ?? "").includes("/") ? "path" : "default";
  return `
    <article class="stat-card" data-tone="${escapeHtml(tone)}">
      <p class="meta-label">${escapeHtml(label)}</p>
      <p class="stat-value" data-kind="${kind}">${escapeHtml(value)}</p>
      <p class="stat-caption">${escapeHtml(caption)}</p>
    </article>
  `;
}

function renderInfoLine(label, value) {
  return `
    <div class="info-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderCheckItem(title, detail, tone = "primary") {
  return `
    <article class="check-item">
      <span class="check-icon" data-tone="${escapeHtml(tone)}"></span>
      <div class="stack-tight">
        <p class="meta-label">${escapeHtml(title)}</p>
        <p class="section-subtitle">${escapeHtml(detail)}</p>
      </div>
    </article>
  `;
}

function renderOverviewTrend(items) {
  const recent = items.slice(-7);
  const maxValue = Math.max(1, ...recent.map((item) => Number(item.dau) || 0));

  return `
    <div class="bar-list">
      ${recent
        .map((item) => {
          const value = Number(item.dau) || 0;
          const width = Math.max(10, Math.round((value / maxValue) * 100));

          return `
            <div class="bar-row">
              <span class="bar-label">${escapeHtml(formatShortDate(item.date))}</span>
              <div class="bar-track">
                <span class="bar-fill" data-tone="primary" style="width: ${width}%"></span>
              </div>
              <strong class="bar-number">${escapeHtml(formatCount(value))}</strong>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderPageLeaderboard(items) {
  const topItems = [...items]
    .sort((left, right) => (Number(right.uv) || 0) - (Number(left.uv) || 0))
    .slice(0, 5);

  return `
    <div class="leaderboard">
      ${topItems
        .map(
          (item, index) => `
            <div class="leaderboard-row">
              <div class="leaderboard-rank">${index + 1}</div>
              <div class="leaderboard-main">
                <span class="leaderboard-label">${escapeHtml(item.pageKey)}</span>
                <span class="leaderboard-sub">${escapeHtml(item.platform)} · ${escapeHtml(formatCount(item.sessionCount))} sessions</span>
              </div>
              <div class="leaderboard-value">${escapeHtml(formatCount(item.uv))}</div>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

function getOverviewSummary(items) {
  const latest = items.at(-1);
  const peak = [...items].sort((left, right) => (Number(right.dau) || 0) - (Number(left.dau) || 0))[0];
  const totalNewUsers = items.reduce((sum, item) => sum + (Number(item.newUsers) || 0), 0);

  return {
    latestDau: latest ? formatCount(latest.dau) : "—",
    latestCaption: latest ? `统计日期 ${latest.date}` : "等待数据返回",
    peakDau: peak ? formatCount(peak.dau) : "—",
    peakCaption: peak ? `峰值日期 ${peak.date}` : "当前没有峰值数据",
    totalNewUsers: items.length > 0 ? formatCount(totalNewUsers) : "—",
    totalCaption: items.length > 0 ? `${items.length} 天累计新增` : "当前没有新增汇总",
    rangeLabel: `${state.filters.overview.dateFrom} - ${state.filters.overview.dateTo}`,
  };
}

function getPageSummary(items) {
  const totalUv = items.reduce((sum, item) => sum + (Number(item.uv) || 0), 0);
  const totalSessions = items.reduce((sum, item) => sum + (Number(item.sessionCount) || 0), 0);
  const totalDuration = items.reduce((sum, item) => sum + (Number(item.totalDurationMs) || 0), 0);
  const topPage = [...items].sort((left, right) => (Number(right.uv) || 0) - (Number(left.uv) || 0))[0];
  const avgDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

  return {
    totalUv: items.length > 0 ? formatCount(totalUv) : "—",
    totalUvCaption: items.length > 0 ? `${items.length} 条页面记录` : "当前没有页面数据",
    totalSessions: items.length > 0 ? formatCount(totalSessions) : "—",
    totalSessionsCaption: items.length > 0 ? "当前筛选区间内的总会话量" : "等待页面数据返回",
    topPage: topPage ? topPage.pageKey : "—",
    topPageCaption: topPage ? `${topPage.platform} · ${formatCount(topPage.uv)} UV` : "当前没有 Top 页面",
    avgDuration: items.length > 0 ? formatDuration(avgDuration) : "—",
    avgDurationCaption: totalSessions > 0 ? "按总停留 / 总 session 估算" : "当前没有停留时长数据",
    rangeLabel: `${state.filters.pages.dateFrom} - ${state.filters.pages.dateTo}`,
  };
}

function formatCount(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return "0";
  }

  return new Intl.NumberFormat("zh-CN").format(numericValue);
}

function formatShortDate(value) {
  if (typeof value !== "string" || value.length < 10) {
    return value || "—";
  }

  return value.slice(5).replace("-", ".");
}

async function handleFormSubmit(form) {
  const formType = form.dataset.form;
  const data = new FormData(form);

  if (formType === "setup") {
    state.busy = true;
    clearNotice();
    saveWorkspace({
      appId: String(data.get("appId") ?? ""),
      workspaceName: String(data.get("workspaceName") ?? ""),
      lastAccount: state.workspace.lastAccount,
    });
    state.busy = false;
    setNotice("success", "工作区已保存。你现在可以直接维护配置，需要受保护接口时再连接业务账号。");
    navigate("/console/workspace");
    return;
  }

  if (formType === "login") {
    state.busy = true;
    clearNotice();
    await render();

    try {
      const account = String(data.get("account") ?? "").trim();
      const password = String(data.get("password") ?? "");
      const appId = state.workspace.appId;

      saveWorkspace({
        appId,
        workspaceName: state.workspace.workspaceName,
        lastAccount: account,
      });

      const payload = await requestJson("/api/v1/auth/login", {
        method: "POST",
        body: {
          appId,
          account,
          password,
          clientType: "web",
        },
        auth: false,
        retryOnUnauthorized: false,
      });

      saveSession({
        accessToken: payload.data.accessToken,
        expiresIn: payload.data.expiresIn,
        issuedAt: new Date().toISOString(),
      });

      const nextPath = state.pendingPath || "/console";
      state.pendingPath = "";
      setNotice("success", "业务账号已接管。现在可以继续访问受保护接口。");
      navigate(nextPath);
    } catch (error) {
      state.busy = false;
      setNotice("error", formatError(error));
      await render();
    } finally {
      state.busy = false;
    }
    return;
  }

  if (formType === "workspace") {
    const nextAppId = String(data.get("appId") ?? "").trim();
    const nextWorkspaceName = String(data.get("workspaceName") ?? "").trim();
    const appChanged = nextAppId !== state.workspace.appId;

    saveWorkspace({
      appId: nextAppId,
      workspaceName: nextWorkspaceName,
      lastAccount: state.workspace.lastAccount,
    });

    if (appChanged) {
      clearSession();
      state.pendingPath = "";
      setNotice("info", "工作区已切换，业务账号接管已断开；需要受保护接口时再重新连接。");
      navigate("/console/workspace");
      return;
    }

    setNotice("success", "工作区配置已更新。");
    await render();
    return;
  }

  if (formType === "overview-filter") {
    state.filters.overview = {
      dateFrom: String(data.get("dateFrom") ?? ""),
      dateTo: String(data.get("dateTo") ?? ""),
    };
    await loadOverviewMetrics();
    return;
  }

  if (formType === "pages-filter") {
    state.filters.pages = {
      dateFrom: String(data.get("dateFrom") ?? ""),
      dateTo: String(data.get("dateTo") ?? ""),
    };
    await loadPageMetrics();
  }
}

async function handleAction(action) {
  if (action === "refresh-health") {
    await refreshHealth();
    return;
  }

  if (action === "logout") {
    try {
      if (state.session.accessToken) {
        await requestJson("/api/v1/auth/logout", {
          method: "POST",
          body: {
            appId: state.workspace.appId,
            scope: "current",
          },
        });
      }
    } catch (error) {
      console.warn("logout failed", error);
    }

    clearSession();
    state.pendingPath = "";
    setNotice("success", "已断开业务账号，你仍可继续维护当前工作区。");
    navigate("/console/workspace");
    return;
  }

  if (action === "reset-workspace") {
    localStorage.removeItem(STORAGE_KEYS.workspace);
    clearSession();
    state.pendingPath = "";
    state.workspace = loadWorkspace();
    state.health = null;
    setNotice("success", "工作区已清空，请重新配置。");
    navigate("/setup");
  }
}

async function refreshHealth() {
  state.health = {
    loading: true,
  };
  await render();

  try {
    const payload = await requestJson("/api/health", {
      auth: false,
      retryOnUnauthorized: false,
    });
    state.health = {
      loading: false,
      status: payload.data.status,
    };
    setNotice("success", "API 健康状态已刷新。");
  } catch (error) {
    state.health = {
      loading: false,
      status: "error",
    };
    setNotice("error", formatError(error));
  }

  await render();
}

async function loadOverviewMetrics() {
  state.metricsOverview = {
    loading: true,
    items: state.metricsOverview?.items ?? [],
  };
  await render();

  try {
    const { dateFrom, dateTo } = state.filters.overview;
    const payload = await requestJson(
      `/api/v1/admin/metrics/overview?appId=${encodeURIComponent(state.workspace.appId)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
    );
    state.metricsOverview = {
      loading: false,
      items: payload.data.items ?? [],
      timezone: payload.data.timezone,
    };
    clearNotice();
  } catch (error) {
    if (error?.statusCode === 401) {
      clearSession();
      state.metricsOverview = {
        loading: false,
        items: [],
      };
      queueBusinessLogin("/console/metrics", "概览指标会读取受保护接口，请先连接业务账号。");
      return;
    }
    state.metricsOverview = {
      loading: false,
      items: [],
    };
    setNotice("error", formatError(error));
  }

  await render();
}

async function loadPageMetrics() {
  state.pageMetrics = {
    loading: true,
    items: state.pageMetrics?.items ?? [],
  };
  await render();

  try {
    const { dateFrom, dateTo } = state.filters.pages;
    const payload = await requestJson(
      `/api/v1/admin/metrics/pages?appId=${encodeURIComponent(state.workspace.appId)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`,
    );
    state.pageMetrics = {
      loading: false,
      items: payload.data.items ?? [],
    };
    clearNotice();
  } catch (error) {
    if (error?.statusCode === 401) {
      clearSession();
      state.pageMetrics = {
        loading: false,
        items: [],
      };
      queueBusinessLogin("/console/pages", "页面指标会读取受保护接口，请先连接业务账号。");
      return;
    }
    state.pageMetrics = {
      loading: false,
      items: [],
    };
    setNotice("error", formatError(error));
  }

  await render();
}

async function tryRestoreSession() {
  if (!state.workspace.appId) {
    return false;
  }

  try {
    const payload = await requestJson("/api/v1/auth/refresh", {
      method: "POST",
      body: {
        appId: state.workspace.appId,
        clientType: "web",
      },
      auth: false,
      retryOnUnauthorized: false,
    });

    saveSession({
      accessToken: payload.data.accessToken,
      expiresIn: payload.data.expiresIn,
      issuedAt: new Date().toISOString(),
    });
    return true;
  } catch {
    clearSession();
    return false;
  }
}

async function requestJson(
  path,
  {
    method = "GET",
    body,
    auth = true,
    retryOnUnauthorized = true,
  } = {},
) {
  const headers = new Headers({
    Accept: "application/json",
  });

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  if (auth && state.session.accessToken) {
    headers.set("Authorization", `Bearer ${state.session.accessToken}`);
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponsePayload(response);

  if (response.status === 401 && auth && retryOnUnauthorized) {
    const restored = await tryRestoreSession();
    if (restored) {
      return requestJson(path, {
        method,
        body,
        auth,
        retryOnUnauthorized: false,
      });
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed with status ${response.status}`);
    error.statusCode = response.status;
    error.code = payload?.code;
    throw error;
  }

  return payload;
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return {
    code: response.ok ? "OK" : "HTTP_ERROR",
    message: await response.text(),
    data: null,
    requestId: "admin_plain_text",
  };
}

function formatError(error) {
  if (!error) {
    return "发生了未知错误。";
  }

  if (error.code && error.message) {
    return `${error.code}: ${error.message}`;
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

function formatDuration(durationMs) {
  const seconds = Math.round(durationMs / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainSeconds = seconds % 60;
  return `${minutes}m ${remainSeconds}s`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
