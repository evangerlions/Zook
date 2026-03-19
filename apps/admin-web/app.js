const runtimeConfig = window.__ADMIN_RUNTIME_CONFIG__ ?? {};
const STORAGE_KEYS = {
  session: "zook.admin.session",
  workspace: "zook.admin.workspace",
};

const appRoot = document.getElementById("app");

const state = {
  busy: false,
  notice: null,
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
  if (state.workspace.appId && !state.session.accessToken && isConsoleRoute(currentPath())) {
    await tryRestoreSession();
  }

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

function workspaceLabel() {
  return state.workspace.workspaceName || state.workspace.appId || "未命名工作区";
}

async function render() {
  const path = currentPath();

  if (!state.workspace.appId && path !== "/setup") {
    navigate("/setup");
    return;
  }

  if (isConsoleRoute(path) && !state.session.accessToken) {
    const restored = await tryRestoreSession();
    if (!restored) {
      navigate("/login");
      return;
    }
  }

  if (path === "/" || path === "/login") {
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

  navigate("/console");
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `<div class="banner" data-tone="${escapeHtml(state.notice.tone)}">${escapeHtml(state.notice.text)}</div>`;
}

function renderAuthScreen(mode) {
  const isSetup = mode === "setup";
  const title = isSetup ? "先设定工作区" : "登录到管理后台";
  const description = isSetup
    ? "先录入一个默认 appId。后续所有后台请求都会以这个工作区作为作用域。"
    : "当前后台会通过同域代理访问 API，你只需要选择 appId 并使用现有账号登录。";

  return `
    <div class="app-shell">
      <div class="split-screen">
        <aside class="brand-panel">
          <div class="stack">
            <span class="brand-badge">Control Surface</span>
            <div class="stack-tight">
              <h1 class="display-title">${escapeHtml(runtimeConfig.brandName || "Zook Control Room")}</h1>
              <p class="lead">
                后台前端作为独立服务运行，但和现有 API 共用同一个仓库与部署链路。
                工作区配置只负责告诉后台当前操作的是哪个 app。
              </p>
            </div>
          </div>

          <div class="helper-grid">
            <section class="card">
              <p class="meta">健康检查</p>
              <p class="metric-value">${escapeHtml(runtimeConfig.healthPath || "/api/health")}</p>
            </section>
            <section class="card">
              <p class="meta">默认工作区</p>
              <p class="metric-value">${escapeHtml(state.workspace.appId || runtimeConfig.defaultAppId || "未设置")}</p>
            </section>
          </div>
        </aside>

        <main class="content-panel">
          <div class="stack">
            <div class="stack-tight">
              <span class="pill">${isSetup ? "Workspace Setup" : "Authentication"}</span>
              <h2 class="section-title">${title}</h2>
              <p class="section-subtitle">${description}</p>
            </div>

            ${renderNotice()}

            ${
              isSetup
                ? `
                  <form class="form-grid" data-form="setup">
                    <div class="field">
                      <label for="setup-app-id">默认 appId</label>
                      <input id="setup-app-id" name="appId" placeholder="例如 app_a" value="${escapeHtml(
                        state.workspace.appId || runtimeConfig.defaultAppId || "",
                      )}" />
                    </div>
                    <div class="field">
                      <label for="setup-workspace-name">工作区名称</label>
                      <input id="setup-workspace-name" name="workspaceName" placeholder="例如 数据运营后台" value="${escapeHtml(
                        state.workspace.workspaceName || "",
                      )}" />
                    </div>
                    <div class="footer-actions">
                      <button class="button button-primary" type="submit">${
                        state.busy ? "保存中..." : "保存并进入登录"
                      }</button>
                    </div>
                  </form>
                `
                : `
                  <form class="form-grid" data-form="login">
                    <div class="field">
                      <label for="login-app-id">当前 appId</label>
                      <input id="login-app-id" name="appId" value="${escapeHtml(
                        state.workspace.appId,
                      )}" />
                    </div>
                    <div class="field">
                      <label for="login-account">账号</label>
                      <input id="login-account" name="account" placeholder="邮箱或账号" value="${escapeHtml(
                        state.workspace.lastAccount || "",
                      )}" />
                    </div>
                    <div class="field">
                      <label for="login-password">密码</label>
                      <input id="login-password" name="password" type="password" placeholder="输入密码" />
                    </div>
                    <div class="footer-actions">
                      <button class="button button-primary" type="submit">${
                        state.busy ? "登录中..." : "登录后台"
                      }</button>
                      <button class="button button-secondary" type="button" data-link="/setup">调整工作区</button>
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
  return `
    <div class="console-layout">
      <aside class="console-sidebar">
        <div class="stack">
          <span class="brand-badge">Admin Web</span>
          <div class="stack-tight">
            <h1 class="section-title">${escapeHtml(runtimeConfig.brandName || "Zook Control Room")}</h1>
            <p class="section-subtitle">当前工作区：${escapeHtml(workspaceLabel())}</p>
          </div>
        </div>

        <nav class="stack-tight nav-links">
          ${renderNavLink("/console", "总览", activeView === "home")}
          ${renderNavLink("/console/metrics", "概览指标", activeView === "metrics")}
          ${renderNavLink("/console/pages", "页面指标", activeView === "pages")}
          ${renderNavLink("/console/workspace", "工作区配置", activeView === "workspace")}
        </nav>

        <div class="workspace-stack stack-tight">
          <span class="pill">Scope</span>
          <p class="meta">appId</p>
          <h2 class="section-title">${escapeHtml(state.workspace.appId)}</h2>
          <p class="section-subtitle">
            当前后台所有带作用域的请求都会自动使用这个 appId。
          </p>
        </div>

        <div class="footer-actions">
          <button class="button button-secondary" data-link="/login">重新登录</button>
          <button class="button button-danger" data-action="logout">退出</button>
        </div>
      </aside>

      <main class="console-main">
        ${renderNotice()}
        ${renderConsoleContent(activeView)}
      </main>
    </div>
  `;
}

function renderNavLink(path, label, active) {
  return `<a class="nav-link" data-link="${path}" data-active="${active ? "true" : "false"}" href="${path}">${label}</a>`;
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
  const healthTone =
    state.health?.status === "ok" ? "success" : state.health?.status === "error" ? "danger" : "warning";
  const healthLabel =
    state.health?.status === "ok"
      ? "已连通"
      : state.health?.status === "error"
        ? "连接失败"
        : "检测中";

  return `
    <section class="app-frame">
      <header class="app-header">
        <div class="stack-tight">
          <span class="pill">Overview</span>
          <h2 class="section-title">控制台总览</h2>
          <p class="section-subtitle">先确认工作区、登录态和 API 健康状态，再进入具体管理页。</p>
        </div>
        <div class="header-actions">
          <button class="button button-secondary" data-action="refresh-health">刷新 API 状态</button>
        </div>
      </header>

      <div class="metric-grid">
        <section class="metric-card ${state.health?.loading ? "loading" : ""}">
          <p class="meta">API 健康状态</p>
          <p class="metric-value">${escapeHtml(healthLabel)}</p>
          <span class="status-badge" data-tone="${healthTone === "success" ? "success" : healthTone === "danger" ? "danger" : "warning"}">
            ${escapeHtml(runtimeConfig.healthPath || "/api/health")}
          </span>
        </section>

        <section class="metric-card">
          <p class="meta">当前工作区</p>
          <p class="metric-value">${escapeHtml(state.workspace.appId)}</p>
          <p class="section-subtitle">${escapeHtml(workspaceLabel())}</p>
        </section>

        <section class="metric-card">
          <p class="meta">会话状态</p>
          <p class="metric-value">${state.session.accessToken ? "已登录" : "未登录"}</p>
          <p class="section-subtitle">Refresh Token 通过同域 Cookie 自动续期。</p>
        </section>
      </div>

      <div class="helper-grid">
        <section class="card">
          <p class="meta">快速入口</p>
          <h3 class="section-title">看概览指标</h3>
          <p class="section-subtitle">直接读取 `/api/v1/admin/metrics/overview`，适合确认当前 app 的整体趋势。</p>
          <div class="footer-actions">
            <button class="button button-primary" data-link="/console/metrics">进入概览页</button>
          </div>
        </section>

        <section class="card">
          <p class="meta">快速入口</p>
          <h3 class="section-title">看页面表现</h3>
          <p class="section-subtitle">按页面和平台拆分，快速确认 UV、Session 和停留时长。</p>
          <div class="footer-actions">
            <button class="button button-primary" data-link="/console/pages">进入页面指标</button>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderMetricsView() {
  const items = state.metricsOverview?.items ?? [];

  return `
    <section class="app-frame">
      <header class="app-header">
        <div class="stack-tight">
          <span class="pill">Metrics</span>
          <h2 class="section-title">概览指标</h2>
          <p class="section-subtitle">读取 app 维度的日活与新增用户趋势。</p>
        </div>
      </header>

      <section class="card">
        <form class="form-grid" data-form="overview-filter">
          <div class="workspace-grid">
            <div class="field">
              <label for="overview-date-from">开始日期</label>
              <input id="overview-date-from" name="dateFrom" type="date" value="${escapeHtml(
                state.filters.overview.dateFrom,
              )}" />
            </div>
            <div class="field">
              <label for="overview-date-to">结束日期</label>
              <input id="overview-date-to" name="dateTo" type="date" value="${escapeHtml(
                state.filters.overview.dateTo,
              )}" />
            </div>
          </div>
          <div class="footer-actions">
            <button class="button button-primary" type="submit">${state.metricsOverview?.loading ? "加载中..." : "刷新数据"}</button>
          </div>
        </form>
      </section>

      <section class="table-shell ${state.metricsOverview?.loading ? "loading" : ""}">
        ${
          items.length === 0 && !state.metricsOverview?.loading
            ? `<div class="empty-state">当前日期范围内还没有概览数据。</div>`
            : `
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
                          <td>${escapeHtml(String(item.dau))}</td>
                          <td>${escapeHtml(String(item.newUsers))}</td>
                        </tr>
                      `,
                    )
                    .join("")}
                </tbody>
              </table>
            `
        }
      </section>
    </section>
  `;
}

function renderPagesView() {
  const items = state.pageMetrics?.items ?? [];

  return `
    <section class="app-frame">
      <header class="app-header">
        <div class="stack-tight">
          <span class="pill">Pages</span>
          <h2 class="section-title">页面指标</h2>
          <p class="section-subtitle">读取按 <code>pageKey + platform</code> 聚合的访问和停留表现。</p>
        </div>
      </header>

      <section class="card">
        <form class="form-grid" data-form="pages-filter">
          <div class="workspace-grid">
            <div class="field">
              <label for="pages-date-from">开始日期</label>
              <input id="pages-date-from" name="dateFrom" type="date" value="${escapeHtml(
                state.filters.pages.dateFrom,
              )}" />
            </div>
            <div class="field">
              <label for="pages-date-to">结束日期</label>
              <input id="pages-date-to" name="dateTo" type="date" value="${escapeHtml(
                state.filters.pages.dateTo,
              )}" />
            </div>
          </div>
          <div class="footer-actions">
            <button class="button button-primary" type="submit">${state.pageMetrics?.loading ? "加载中..." : "刷新页面指标"}</button>
          </div>
        </form>
      </section>

      <section class="table-shell ${state.pageMetrics?.loading ? "loading" : ""}">
        ${
          items.length === 0 && !state.pageMetrics?.loading
            ? `<div class="empty-state">当前日期范围内还没有页面指标。</div>`
            : `
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
                          <td>${escapeHtml(String(item.uv))}</td>
                          <td>${escapeHtml(String(item.sessionCount))}</td>
                          <td>${escapeHtml(formatDuration(item.totalDurationMs))}</td>
                          <td>${escapeHtml(formatDuration(item.avgDurationMs))}</td>
                        </tr>
                      `,
                    )
                    .join("")}
                </tbody>
              </table>
            `
        }
      </section>
    </section>
  `;
}

function renderWorkspaceView() {
  return `
    <section class="app-frame">
      <header class="app-header">
        <div class="stack-tight">
          <span class="pill">Workspace</span>
          <h2 class="section-title">工作区配置</h2>
          <p class="section-subtitle">这里维护当前后台默认操作的 appId，不需要在每个页面重复输入。</p>
        </div>
      </header>

      <div class="workspace-grid">
        <section class="card">
          <form class="form-grid" data-form="workspace">
            <div class="field">
              <label for="workspace-app-id">默认 appId</label>
              <input id="workspace-app-id" name="appId" value="${escapeHtml(state.workspace.appId)}" />
            </div>
            <div class="field">
              <label for="workspace-name">工作区名称</label>
              <input id="workspace-name" name="workspaceName" value="${escapeHtml(
                state.workspace.workspaceName,
              )}" placeholder="例如 增长运营后台" />
            </div>
            <div class="footer-actions">
              <button class="button button-primary" type="submit">${state.busy ? "保存中..." : "保存工作区"}</button>
            </div>
          </form>
        </section>

        <section class="workspace-stack stack">
          <div class="stack-tight">
            <p class="meta">连接方式</p>
            <h3 class="section-title">同域代理到 API</h3>
            <p class="section-subtitle">
              后台前端会把 <code>/api/*</code> 请求代理到后端服务，所以浏览器不需要直接面对跨域问题。
            </p>
          </div>
          <div class="footer-actions">
            <button class="button button-secondary" data-action="refresh-health">检测 API 连通性</button>
            <button class="button button-danger" data-action="reset-workspace">清空工作区</button>
          </div>
        </section>
      </div>
    </section>
  `;
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
    setNotice("success", "工作区已保存。现在可以直接登录后台。");
    navigate("/login");
    return;
  }

  if (formType === "login") {
    state.busy = true;
    clearNotice();
    await render();

    try {
      const appId = String(data.get("appId") ?? "").trim();
      const account = String(data.get("account") ?? "").trim();
      const password = String(data.get("password") ?? "");

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

      setNotice("success", "登录成功，已进入后台控制台。");
      navigate("/console");
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
      setNotice("info", "工作区已切换，登录态已清空，请重新登录。");
      navigate("/login");
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
    setNotice("success", "已退出后台登录。");
    navigate("/login");
    return;
  }

  if (action === "reset-workspace") {
    localStorage.removeItem(STORAGE_KEYS.workspace);
    clearSession();
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
