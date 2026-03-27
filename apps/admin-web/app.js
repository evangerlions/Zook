const runtimeConfig = window.__ADMIN_RUNTIME_CONFIG__ ?? {};
const STORAGE_KEYS = {
  selectedAppId: "zook.admin.selectedAppId",
};
const SESSION_STORAGE_KEY = "zook.admin.session";

const LOGIN_ROUTE = "/login";
const APPS_ROUTE = "/apps";
const CONFIG_ROUTE = "/config";
const MAIL_ROUTE = "/mail";
const LLM_ROUTE = "/llm";
const PASSWORD_ROUTE = "/passwords";
const COMMON_WORKSPACE_VALUE = "__common__";
const SERVICE_WORKSPACE_LABEL = "服务端配置";
const KNOWN_ROUTES = new Set([LOGIN_ROUTE, APPS_ROUTE, CONFIG_ROUTE, MAIL_ROUTE, LLM_ROUTE, PASSWORD_ROUTE]);
const MAIL_TEMPLATE_LOCALE_OPTIONS = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en-US", label: "English (US)" },
  { value: "zh-TW", label: "繁體中文 (TW)" },
  { value: "zh-HK", label: "繁體中文 (HK)" },
  { value: "ja-JP", label: "日本語" },
  { value: "ko-KR", label: "한국어" },
];
const MAIL_SENDER_REGION_OPTIONS = [
  { value: "ap-guangzhou", label: "中国大陆 / 广州" },
  { value: "ap-hongkong", label: "海外 / 中国香港" },
];

const appRoot = document.getElementById("app");

const state = {
  session: loadAdminSession(),
  booting: true,
  busy: false,
  loginBusy: false,
  creatingApp: false,
  deletingAppId: "",
  savingMail: false,
  savingLlm: false,
  savingPasswords: false,
  loadingBootstrap: false,
  loadingConfig: false,
  loadingMail: false,
  loadingLlm: false,
  loadingPasswords: false,
  loadingLlmMetrics: false,
  notice: null,
  loginError: "",
  adminUser: "",
  apps: [],
  selectedAppId: loadSelectedAppId(),
  configDocument: null,
  emailDocument: null,
  llmDocument: null,
  passwordDocument: null,
  mailTab: "config",
  mailDraft: createDefaultMailConfig(),
  mailExpandedRegions: {},
  mailTestDraft: createDefaultMailTestDraft(),
  sendingMailTest: false,
  mailTestResult: null,
  llmDraft: createDefaultLlmConfig(),
  passwordDraft: createDefaultPasswordConfig(),
  editorValue: "",
  savedValue: "",
  configDesc: "",
  editorError: "",
  restoringRevision: "",
  restoringMailRevision: "",
  restoringLlmRevision: "",
  saveDialog: null,
  llmDialog: null,
  llmTab: "monitor",
  llmMetricsRange: "24h",
  llmMetricsDocument: null,
  llmModelMetricsDocument: null,
  llmSelectedModelKey: "",
  llmCollapsedModelKeys: {},
  runningLlmSmokeTest: false,
  llmSmokeTestDocument: null,
  llmSmokeExpandedKeys: {},
  toasts: [],
};

let toastSeed = 0;

window.addEventListener("popstate", () => {
  syncRouteState(ensureKnownRoute()).then(render).catch(handleUnexpectedError);
});

appRoot.addEventListener("click", (event) => {
  const target = event.target.closest("[data-link], [data-action]");
  if (!target) {
    return;
  }

  if (
    target.dataset.action === "close-save-dialog" &&
    target.classList.contains("modal-backdrop") &&
    event.target.closest("[data-modal-card='true']")
  ) {
    return;
  }

  if (
    target.dataset.action === "close-llm-dialog" &&
    target.classList.contains("modal-backdrop") &&
    event.target.closest("[data-llm-modal-card='true']")
  ) {
    return;
  }

  if (target.dataset.link) {
    event.preventDefault();
    navigate(target.dataset.link).catch(handleUnexpectedError);
    return;
  }

  if (target.dataset.action) {
    event.preventDefault();
    handleAction(target).catch(handleUnexpectedError);
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

appRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (isMailDraftControl(target)) {
    handleMailDraftChange(target);
    return;
  }

  if (isMailTestDraftControl(target)) {
    handleMailTestDraftChange(target);
    render().catch(handleUnexpectedError);
    return;
  }

  if (isPasswordDraftControl(target)) {
    handlePasswordDraftChange(target);
    return;
  }

  if (isLlmDialogControl(target)) {
    handleLlmDialogChange(target);
    return;
  }

  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.name === "workspaceTarget") {
    handleWorkspaceSwitch(target.value).catch(handleUnexpectedError);
    return;
  }
});

appRoot.addEventListener("toggle", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLDetailsElement)) {
    return;
  }

  const region = target.dataset.mailRegion;
  if (!region) {
    return;
  }

  state.mailExpandedRegions[region] = target.open;
});

appRoot.addEventListener("input", (event) => {
  const target = event.target;

  if (target instanceof HTMLTextAreaElement && target.name === "configJson") {
    state.editorValue = target.value;
    try {
      parseConfigText(target.value);
      state.editorError = "";
    } catch (error) {
      state.editorError = error instanceof Error ? error.message : "请输入合法的 JSON。";
    }
    syncDirtyState();
    syncJsonEditorDecorations();
    return;
  }

  if (target instanceof HTMLTextAreaElement && target.name === "saveDialogDesc" && state.saveDialog) {
    state.saveDialog.value = target.value;
    return;
  }

  if (target instanceof HTMLInputElement && target.form?.dataset.form === "llm-editor-dialog") {
    handleLlmDialogChange(target);
    return;
  }

  if (target instanceof HTMLTextAreaElement && target.form?.dataset.form === "llm-editor-dialog") {
    handleLlmDialogChange(target);
    return;
  }

  if (target instanceof HTMLInputElement && target.form?.dataset.form === "login") {
    state.loginError = "";
  }

  if (isMailDraftControl(target)) {
    handleMailDraftChange(target);
    return;
  }

  if (isMailTestDraftControl(target)) {
    handleMailTestDraftChange(target);
    return;
  }

  if (isPasswordDraftControl(target)) {
    handlePasswordDraftChange(target);
    return;
  }

  if (isLlmDraftControl(target)) {
    handleLlmDraftChange(target);
  }
});

appRoot.addEventListener("focusin", (event) => {
  clearMaskedPasswordValue(event.target);
});

appRoot.addEventListener("focusout", (event) => {
  restoreMaskedPasswordValue(event.target);
});

boot().catch(handleUnexpectedError);

async function boot() {
  await render();

  if (!state.session) {
    state.booting = false;
    if (currentPath() !== LOGIN_ROUTE) {
      window.history.replaceState({}, "", LOGIN_ROUTE);
    }
    await render();
    return;
  }

  try {
    await loadBootstrap();
    await syncRouteState(ensureKnownRoute());
  } catch (error) {
    redirectToLogin("登录已失效，请重新登录。");
  } finally {
    state.booting = false;
  }

  await render();
}

function loadSelectedAppId() {
  return localStorage.getItem(STORAGE_KEYS.selectedAppId) ?? "";
}

function saveSelectedAppId(appId) {
  state.selectedAppId = appId;
  if (appId) {
    localStorage.setItem(STORAGE_KEYS.selectedAppId, appId);
    return;
  }

  localStorage.removeItem(STORAGE_KEYS.selectedAppId);
}

function loadAdminSession() {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") {
      return null;
    }

    if (typeof parsed.authorization !== "string" || typeof parsed.username !== "string") {
      return null;
    }

    return {
      authorization: parsed.authorization,
      username: parsed.username,
    };
  } catch {
    return null;
  }
}

function saveAdminSession(session) {
  state.session = session;
  sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

function clearAdminSession() {
  state.session = null;
  state.adminUser = "";
  state.apps = [];
  state.configDocument = null;
  state.emailDocument = null;
  state.llmDocument = null;
  state.passwordDocument = null;
  state.mailDraft = createDefaultMailConfig();
  state.llmDraft = createDefaultLlmConfig();
  state.passwordDraft = createDefaultPasswordConfig();
  state.editorValue = "";
  state.savedValue = "";
  state.editorError = "";
  state.restoringRevision = "";
  state.restoringMailRevision = "";
  state.restoringLlmRevision = "";
  state.saveDialog = null;
  state.llmDialog = null;
  state.loadingPasswords = false;
  state.savingPasswords = false;
  state.llmMetricsDocument = null;
  state.llmModelMetricsDocument = null;
  state.llmSelectedModelKey = "";
  state.llmCollapsedModelKeys = {};
  state.runningLlmSmokeTest = false;
  state.llmSmokeTestDocument = null;
  state.llmSmokeExpandedKeys = {};
  sessionStorage.removeItem(SESSION_STORAGE_KEY);
}

function redirectToLogin(message = "登录已失效，请重新登录。") {
  clearAdminSession();
  clearNotice();
  state.booting = false;
  state.loginError = message;
  if (currentPath() !== LOGIN_ROUTE) {
    window.history.replaceState({}, "", LOGIN_ROUTE);
  }
}

function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function ensureKnownRoute() {
  const path = currentPath();

  if (!state.session) {
    if (path !== LOGIN_ROUTE) {
      window.history.replaceState({}, "", LOGIN_ROUTE);
      return LOGIN_ROUTE;
    }
    return LOGIN_ROUTE;
  }

  if (path === LOGIN_ROUTE) {
    window.history.replaceState({}, "", APPS_ROUTE);
    return APPS_ROUTE;
  }

  if (KNOWN_ROUTES.has(path)) {
    return path;
  }

  window.history.replaceState({}, "", APPS_ROUTE);
  return APPS_ROUTE;
}

async function navigate(path) {
  const fallback = state.session ? APPS_ROUTE : LOGIN_ROUTE;
  const nextPath = KNOWN_ROUTES.has(path) ? path : fallback;
  if (currentPath() !== nextPath) {
    window.history.pushState({}, "", nextPath);
  }

  await syncRouteState(nextPath);
  await render();
}

function setNotice(tone, text) {
  state.notice = { tone, text };
}

function clearNotice() {
  state.notice = null;
}

function pushToast(tone, text) {
  const id = `toast_${Date.now()}_${toastSeed++}`;
  state.toasts = [...state.toasts, { id, tone, text }].slice(-4);
  render().catch(console.error);
  window.setTimeout(() => {
    dismissToast(id);
  }, 3200);
}

function dismissToast(id) {
  const nextToasts = state.toasts.filter((toast) => toast.id !== id);
  if (nextToasts.length === state.toasts.length) {
    return;
  }
  state.toasts = nextToasts;
  render().catch(console.error);
}

function handleUnexpectedError(error) {
  console.error(error);
  setNotice("error", formatError(error));
  pushToast("error", formatError(error));
  render().catch(console.error);
}

function selectedApp() {
  return state.apps.find((item) => item.appId === state.selectedAppId) ?? null;
}

function isViewingHistoricalConfig() {
  return Boolean(state.configDocument && state.configDocument.isLatest === false);
}

function isViewingHistoricalMailConfig() {
  return Boolean(state.emailDocument && state.emailDocument.isLatest === false);
}

function hasUnsavedChanges() {
  return state.editorValue !== state.savedValue;
}

function hasUnsavedMailChanges() {
  try {
    const current = JSON.stringify(serializeMailDraft(ensureMailDraft()));
    const saved = JSON.stringify(serializeMailDraft(cloneMailConfig(state.emailDocument?.config)));
    return current !== saved;
  } catch {
    return true;
  }
}

function syncDirtyState() {
  const editor = appRoot.querySelector('textarea[name="configJson"]');
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }

  const dirty = hasUnsavedChanges() ? "true" : "false";
  editor.dataset.dirty = dirty;
  editor.closest(".json-editor-shell")?.setAttribute("data-dirty", dirty);
}

async function render() {
  const path = ensureKnownRoute();
  syncDocumentTitle(path);
  const shouldRenderConsole = Boolean(state.session) && (state.booting || Boolean(state.adminUser));
  appRoot.innerHTML = shouldRenderConsole ? renderConsole(path) : renderLoginPage();
  syncDirtyState();
  syncJsonEditorDecorations();
}

function renderLoginPage() {
  const brandName = runtimeConfig.brandName || "Zook Admin";
  const feedback = state.loginError
    ? `<p class="editor-error" role="alert">${escapeHtml(state.loginError)}</p>`
    : state.notice
      ? `<p class="login-feedback" data-tone="${escapeHtml(state.notice.tone || "info")}" role="status">${escapeHtml(state.notice.text)}</p>`
      : "";

  return `
    <div class="login-shell">
      <div class="login-panel">
        <section class="login-brand">
          <div class="login-brand-top">
            <div class="brand-mark" aria-hidden="true">YW</div>
            <div class="login-brand-copy">
              <span>Admin Console</span>
              <strong>${escapeHtml(brandName)}</strong>
            </div>
          </div>
          <div class="login-brand-body">
            <p class="login-eyebrow">Console Access</p>
            <h1>登录后台</h1>
            <p class="login-description">使用管理员账号进入配置工作台，统一管理应用与邮件服务。</p>
          </div>
        </section>

        <section class="login-card">
          <div class="login-header">
            <h2>管理员登录</h2>
            <p>输入账号密码后即可进入工作台。</p>
          </div>

          <form class="login-form" data-form="login">
            <label class="field">
              <span>用户名</span>
              <input name="username" type="text" autocomplete="username" placeholder="admin" ${state.loginBusy ? "disabled" : ""} />
            </label>
            <label class="field">
              <span>密码</span>
              <input name="password" type="password" autocomplete="current-password" placeholder="输入密码" ${state.loginBusy ? "disabled" : ""} />
            </label>
            ${feedback}
            <button class="button button-primary button-block" type="submit" ${state.loginBusy ? "disabled" : ""}>
              ${state.loginBusy ? "登录中..." : "进入后台"}
            </button>
          </form>
        </section>
      </div>
    </div>
  `;
}

function renderConsole(path) {
  const brandName = runtimeConfig.brandName || "Zook Admin";

  return `
    <div class="admin-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark" aria-hidden="true">YW</div>
          <div class="brand-copy">
            <strong>${escapeHtml(brandName)}</strong>
            <span>Admin</span>
          </div>
        </div>

        <nav class="sidebar-nav" aria-label="主导航">${renderSidebarNav(path)}</nav>
      </aside>

      <div class="main-shell">
        <header class="topbar">
          <div class="topbar-bar">
            <div class="topbar-left">
              <nav class="topbar-links" aria-label="外部工具">
                <a href="${escapeHtml(runtimeConfig.analyticsUrl || "https://analytics.youwoai.net")}" target="_blank" rel="noreferrer">Analytics</a>
                <a href="${escapeHtml(runtimeConfig.logsUrl || "https://logs.youwoai.net/")}" target="_blank" rel="noreferrer">Logs</a>
              </nav>
            </div>

            <div class="topbar-right">
              ${renderWorkspaceControl(path)}
              ${renderUserMenu()}
            </div>
          </div>
        </header>

        <main class="content-shell">
          ${renderNotice()}
          ${renderContent(path)}
        </main>
      </div>
    </div>
    ${renderSaveDialog()}
    ${renderLlmDialog()}
    ${renderToastStack()}
  `;
}

function renderUserMenu() {
  if (!state.session || !state.adminUser) {
    return `
      <button class="user-chip user-chip-button" type="button" data-action="goto-login">
        <span class="user-avatar" aria-hidden="true">A</span>
        <strong>去登录</strong>
      </button>
    `;
  }

  return `
    <details class="user-menu">
      <summary class="user-chip">
        <span class="user-avatar" aria-hidden="true">${escapeHtml((state.adminUser || "A").slice(0, 1).toUpperCase())}</span>
        <strong>${escapeHtml(state.adminUser || "—")}</strong>
      </summary>
      <div class="user-menu-panel">
        <button class="menu-button" type="button" data-action="logout">退出登录</button>
      </div>
    </details>
  `;
}

function renderToastStack() {
  if (!state.toasts.length) {
    return "";
  }

  return `
    <div class="toast-stack" aria-live="polite" aria-atomic="true">
      ${state.toasts
        .map(
          (toast) => `
            <section class="toast" data-tone="${escapeHtml(toast.tone || "info")}" role="status">
              <p>${escapeHtml(toast.text)}</p>
              <button
                class="toast-close"
                type="button"
                data-action="dismiss-toast"
                data-toast-id="${escapeHtml(toast.id)}"
                aria-label="关闭提示"
              >
                ×
              </button>
            </section>
          `,
        )
        .join("")}
    </div>
  `;
}

function renderWorkspaceControl(path) {
  return `
    <label class="select-inline">
      <span>工作区</span>
      <select name="workspaceTarget" ${state.loadingBootstrap ? "disabled" : ""}>
        ${renderWorkspaceOptions(path)}
      </select>
    </label>
  `;
}

function isCommonWorkspacePath(path) {
  return path === APPS_ROUTE || path === MAIL_ROUTE || path === LLM_ROUTE || path === PASSWORD_ROUTE;
}

function renderSidebarNav(path) {
  if (isCommonWorkspacePath(path)) {
    return `
      ${renderNavItem(APPS_ROUTE, path, "应用")}
      ${renderNavItem(MAIL_ROUTE, path, "邮件服务")}
      ${renderNavItem(LLM_ROUTE, path, "LLM")}
      ${renderNavItem(PASSWORD_ROUTE, path, "PASSWORD")}
    `;
  }

  return renderNavItem(CONFIG_ROUTE, path, "配置");
}

function renderNavItem(route, currentRoute, label) {
  return `
    <a
      class="nav-item"
      data-link="${escapeHtml(route)}"
      data-active="${route === currentRoute ? "true" : "false"}"
      href="${escapeHtml(route)}"
      ${route === currentRoute ? 'aria-current="page"' : ""}
    >
      ${escapeHtml(label)}
    </a>
  `;
}

function renderWorkspaceOptions(path) {
  if (state.loadingBootstrap) {
    return '<option value="">加载中...</option>';
  }

  const inCommonWorkspace = isCommonWorkspacePath(path);
  const commonOption = `
    <option value="${COMMON_WORKSPACE_VALUE}" ${inCommonWorkspace ? "selected" : ""}>
      ${SERVICE_WORKSPACE_LABEL}
    </option>
  `;

  const appOptions = state.apps.length
    ? state.apps
        .map(
          (app) => `
            <option value="${escapeHtml(app.appId)}" ${!inCommonWorkspace && app.appId === state.selectedAppId ? "selected" : ""}>
              ${escapeHtml(`${app.appName} · ${app.appCode}`)}
            </option>
          `,
        )
        .join("")
    : '<option value="" disabled>暂无 App</option>';

  return `${commonOption}${appOptions}`;
}

function renderNotice() {
  if (!state.notice || currentPath() === PASSWORD_ROUTE) {
    return "";
  }

  return `
    <section class="notice" data-tone="${escapeHtml(state.notice.tone || "info")}" role="status" aria-live="polite">
      <p>${escapeHtml(state.notice.text)}</p>
    </section>
  `;
}

function renderContent(path) {
  if (state.booting || state.loadingBootstrap) {
    return `
      <section class="page-shell">
        <div class="page-header">
          <div class="skeleton skeleton-title"></div>
        </div>
        <section class="panel"><div class="skeleton skeleton-block"></div></section>
      </section>
    `;
  }

  if (path === APPS_ROUTE) {
    return renderAppsPage();
  }

  if (path === MAIL_ROUTE) {
    return renderMailPage();
  }

  if (path === LLM_ROUTE) {
    return renderLlmPage();
  }

  if (path === PASSWORD_ROUTE) {
    return renderPasswordsPage();
  }

  return renderConfigPage();
}

function renderAppsPage() {
  return `
    <section class="page-shell">
      <header class="page-header-compact">
        <h1 class="page-title">应用</h1>
      </header>

      <section class="panel">
        <form class="inline-form" data-form="create-app">
          <label class="field">
            <span>App ID</span>
            <input name="appId" type="text" placeholder="app_new" autocomplete="off" ${state.creatingApp ? "disabled" : ""} />
          </label>
          <label class="field">
            <span>名称</span>
            <input name="appName" type="text" placeholder="可选" autocomplete="off" ${state.creatingApp ? "disabled" : ""} />
          </label>
          <button class="button button-primary" type="submit" ${state.creatingApp ? "disabled" : ""}>
            ${state.creatingApp ? "添加中..." : "添加 App"}
          </button>
        </form>
      </section>

      <section class="panel">
        <div class="table-wrap">
          <table class="app-table">
            <thead>
              <tr>
                <th>应用</th>
                <th>状态</th>
                <th>删除</th>
                <th class="align-right">操作</th>
              </tr>
            </thead>
            <tbody>
              ${state.apps.map((app) => renderAppRow(app)).join("")}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderAppRow(app) {
  const isDeleting = state.deletingAppId === app.appId;
  const deleteLabel = app.canDelete ? "可删除" : "需先清空配置";

  return `
    <tr data-current="${app.appId === state.selectedAppId ? "true" : "false"}">
      <td>
        <div class="app-name-cell">
          <strong>${escapeHtml(app.appName)}</strong>
          <span>${escapeHtml(app.appCode)}</span>
        </div>
      </td>
      <td>
        <span class="status-badge">${escapeHtml(app.status)}</span>
      </td>
      <td>
        <span class="delete-hint" data-tone="${app.canDelete ? "success" : "muted"}">${escapeHtml(deleteLabel)}</span>
      </td>
      <td class="align-right">
        <div class="row-actions">
          <button class="button button-secondary" type="button" data-action="open-config" data-app-id="${escapeHtml(app.appId)}">配置</button>
          <button
            class="button button-danger"
            type="button"
            data-action="delete-app"
            data-app-id="${escapeHtml(app.appId)}"
            ${!app.canDelete || isDeleting ? "disabled" : ""}
          >
            ${isDeleting ? "删除中..." : "删除"}
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderConfigPage() {
  if (!state.selectedAppId) {
    return renderNoAppState();
  }

  const app = selectedApp();
  if (!app) {
    return renderNoAppState();
  }

  const updatedAt = state.configDocument?.updatedAt ? formatTimestamp(state.configDocument.updatedAt) : "未保存";
  const currentRevision = state.configDocument?.revision ?? "—";
  const revisions = Array.isArray(state.configDocument?.revisions) ? state.configDocument.revisions : [];
  const readOnly = state.loadingConfig || isViewingHistoricalConfig();
  const latestRevision = revisions[0]?.revision;

  return `
    <section class="page-shell">
      <header class="page-header">
        <div>
          <h1 class="page-title">配置</h1>
          <p class="page-subtitle">${escapeHtml(app.appName)} · ${escapeHtml(app.appCode)}</p>
        </div>
        <div class="page-actions">
          <span class="meta-chip">R${escapeHtml(String(currentRevision))}</span>
          <span class="meta-chip">${escapeHtml(updatedAt)}</span>
          <span class="meta-chip">${isViewingHistoricalConfig() ? "历史版本" : hasUnsavedChanges() ? "未保存" : "已保存"}</span>
        </div>
      </header>

      <div class="config-workspace">
        <section class="panel config-main-panel">
          <div class="panel-header">
            <div class="panel-heading">
              <h2 class="panel-title">最新配置</h2>
              <p class="panel-caption">${isViewingHistoricalConfig() ? "当前正在查看历史版本，只读展示。" : "保存前会弹出更新说明，系统会自动生成变更摘要。"}</p>
            </div>
            <div class="panel-actions">
              ${
                isViewingHistoricalConfig()
                  ? `<button class="button button-secondary" type="button" data-action="view-latest-config" ${state.loadingConfig ? "disabled" : ""}>返回最新</button>`
                  : ""
              }
              <button class="button button-secondary" type="button" data-action="reload-config" ${state.loadingConfig ? "disabled" : ""}>读取</button>
              <button class="button button-secondary" type="button" data-action="validate-json" ${readOnly ? "disabled" : ""}>校验</button>
              <button class="button button-secondary" type="button" data-action="format-json" ${readOnly ? "disabled" : ""}>格式化</button>
            </div>
          </div>

          ${
            isViewingHistoricalConfig()
              ? `
                <div class="revision-banner">
                  <div>
                    <strong>正在查看历史版本 R${escapeHtml(String(currentRevision))}</strong>
                    <p>${escapeHtml(state.configDocument?.desc || "未填写变更说明")}</p>
                  </div>
                  <button
                    class="button button-primary"
                    type="button"
                    data-action="restore-config-revision"
                    data-revision="${escapeHtml(String(currentRevision))}"
                    ${state.restoringRevision === String(currentRevision) ? "disabled" : ""}
                  >
                    ${state.restoringRevision === String(currentRevision) ? "恢复中..." : "恢复到此版本"}
                  </button>
                </div>
              `
              : ""
          }

          ${renderVersionDescription(state.configDocument?.desc)}

          <form class="editor-form" data-form="save-config">
            ${renderJsonEditor({
              value: state.editorValue,
              readOnly,
              compact: false,
              dirty: hasUnsavedChanges(),
            })}
            ${state.editorError ? `<p class="editor-error" role="alert">${escapeHtml(state.editorError)}</p>` : ""}
            <div class="form-footer">
              <button class="button button-ghost" type="button" data-action="reset-config" ${!hasUnsavedChanges() || readOnly ? "disabled" : ""}>恢复</button>
              <button class="button button-primary" type="button" data-action="open-save-config-dialog" ${state.busy || readOnly ? "disabled" : ""}>
                ${state.busy ? "保存中..." : "保存新版本"}
              </button>
            </div>
          </form>
        </section>

        <aside class="panel config-history-panel">
          <div class="panel-header">
            <div class="panel-heading">
              <h2 class="panel-title">历史版本</h2>
              <p class="panel-caption">按时间倒序展示，点击可查看任意版本。</p>
            </div>
          </div>

          <div class="revision-list">
            ${
              revisions.length
                ? revisions.map((item) => renderRevisionItem(item, {
                    action: "view-config-revision",
                    activeRevision: state.configDocument?.revision,
                    latestRevision,
                  })).join("")
                : '<div class="revision-empty">还没有历史版本。</div>'
            }
          </div>
        </aside>
      </div>
    </section>
  `;
}

function renderRevisionItem(item, options) {
  const isActive = Number(item.revision) === Number(options.activeRevision);
  const isLatest = Number(item.revision) === Number(options.latestRevision);

  return `
    <button
      class="revision-item"
      type="button"
      data-action="${escapeHtml(options.action)}"
      data-revision="${escapeHtml(String(item.revision))}"
      data-active="${isActive ? "true" : "false"}"
    >
      <div class="revision-item-top">
        <strong>R${escapeHtml(String(item.revision))}</strong>
        ${isLatest ? '<span class="revision-tag">Latest</span>' : ""}
      </div>
      <p>${escapeHtml(item.desc || "未填写更新说明")}</p>
      <span>${escapeHtml(formatTimestamp(item.createdAt))}</span>
    </button>
  `;
}

function renderMailPage() {
  if (state.loadingMail) {
    return `
      <section class="page-shell">
        <div class="page-header">
          <div class="skeleton skeleton-title"></div>
        </div>
        <section class="panel"><div class="skeleton skeleton-block"></div></section>
      </section>
    `;
  }

  const emailDocument = normalizeMailDocument(state.emailDocument);
  const draft = normalizeMailDraft(state.mailDraft ?? emailDocument.config);
  const updatedAt = emailDocument.updatedAt ? formatTimestamp(emailDocument.updatedAt) : "未保存";
  const currentRevision = emailDocument.revision ?? "—";
  const revisions = Array.isArray(emailDocument.revisions) ? emailDocument.revisions : [];
  const latestRevision = revisions[0]?.revision;
  const readOnly = state.loadingMail || isViewingHistoricalMailConfig();
  const mailTestDraft = ensureMailTestDraft(draft);
  const activeMailStatus = (
    state.mailTab === "config"
      ? (isViewingHistoricalMailConfig() ? "历史版本" : hasUnsavedMailChanges() ? "未保存" : "已保存")
      : (state.sendingMailTest ? "测试中" : "测试面板")
  );

  return `
    <section class="page-shell">
      <header class="page-header">
        <div>
          <h1 class="page-title">邮件服务</h1>
          <p class="page-subtitle">${SERVICE_WORKSPACE_LABEL}</p>
        </div>
        <div class="page-actions">
          <span class="meta-chip">R${escapeHtml(String(currentRevision))}</span>
          <span class="meta-chip">${escapeHtml(updatedAt)}</span>
          <span class="meta-chip">${escapeHtml(activeMailStatus)}</span>
          <span class="meta-chip">${escapeHtml(emailDocument.resolvedRegion || "ap-guangzhou")}</span>
        </div>
      </header>

      <div class="tab-switcher" role="tablist" aria-label="邮件服务页面标签">
        ${renderMailTabButton("config", "配置")}
        ${renderMailTabButton("test", "测试")}
      </div>

      ${
        state.mailTab === "test"
          ? renderMailTestPanel({
              draft,
              mailTestDraft,
              readOnly,
            })
          : renderMailConfigPanel({
              emailDocument,
              draft,
              readOnly,
              revisions,
              latestRevision,
            })
      }
    </section>
  `;
}

function renderMailTabButton(tab, label) {
  return `
    <button
      class="tab-chip"
      type="button"
      data-action="switch-mail-tab"
      data-tab="${escapeHtml(tab)}"
      data-active="${state.mailTab === tab ? "true" : "false"}"
      role="tab"
      aria-selected="${state.mailTab === tab ? "true" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderMailConfigPanel({ emailDocument, draft, readOnly, revisions, latestRevision }) {
  const currentRevision = emailDocument.revision ?? "—";

  return `
    <div class="config-workspace">
      <section class="panel config-main-panel">
        <div class="panel-header">
          <div class="panel-heading">
            <h2 class="panel-title">邮件配置</h2>
            <p class="panel-caption">${isViewingHistoricalMailConfig() ? "当前正在查看历史版本，只读展示。" : "配置 sender、模板和开关。保存前会弹出更新说明，系统会自动生成变更摘要。"}</p>
          </div>
          <div class="panel-actions">
            ${
              isViewingHistoricalMailConfig()
                ? `<button class="button button-secondary" type="button" data-action="view-latest-mail" ${state.loadingMail ? "disabled" : ""}>返回最新</button>`
                : ""
            }
            <button class="button button-secondary" type="button" data-action="reload-mail" ${state.loadingMail ? "disabled" : ""}>刷新</button>
          </div>
        </div>

        ${
          isViewingHistoricalMailConfig()
            ? `
              <div class="revision-banner">
                <div>
                  <strong>正在查看历史版本 R${escapeHtml(String(currentRevision))}</strong>
                  <p>${escapeHtml(emailDocument.desc || "未填写更新说明")}</p>
                </div>
                <button
                  class="button button-primary"
                  type="button"
                  data-action="restore-mail-revision"
                  data-revision="${escapeHtml(String(currentRevision))}"
                  ${state.restoringMailRevision === String(currentRevision) ? "disabled" : ""}
                >
                  ${state.restoringMailRevision === String(currentRevision) ? "恢复中..." : "恢复到此版本"}
                </button>
              </div>
            `
            : ""
        }

        ${renderVersionDescription(emailDocument.desc)}

        <form class="stack-form" data-form="save-mail">
          <div class="form-grid">
            <label class="field field-checkbox">
              <span>启用</span>
              <input
                data-mail-field="enabled"
                type="checkbox"
                ${draft.enabled ? "checked" : ""}
                ${readOnly || state.savingMail ? "disabled" : ""}
              />
            </label>
          </div>

          <section class="mail-section">
            <div class="mail-section-header">
              <div>
                <h3>腾讯云凭据</h3>
                <p>请在密码工作区配置 <code>tencent.secret_id</code> 与 <code>tencent.secret_key</code>。邮件配置按广州 / 香港两个固定地域分组管理。</p>
              </div>
              <button class="button button-secondary" type="button" data-link="${PASSWORD_ROUTE}">前往密码</button>
            </div>
          </section>

          <div class="mail-region-stack">
            ${draft.regions.map((regionConfig, regionIndex) => renderMailRegionSection(regionConfig, regionIndex, readOnly)).join("")}
          </div>

          <details class="version-note">
            <summary>查看当前 JSON</summary>
            <div class="version-note-body">
              ${renderJsonPreview(serializeMailDraftForPreview(draft))}
            </div>
          </details>

          <div class="form-footer">
            <button class="button button-ghost" type="button" data-action="reset-mail" ${readOnly || state.savingMail ? "disabled" : ""}>恢复</button>
            <button class="button button-primary" type="button" data-action="open-save-mail-dialog" ${readOnly || state.savingMail ? "disabled" : ""}>
              ${state.savingMail ? "保存中..." : "保存配置"}
            </button>
          </div>
        </form>
      </section>

      <aside class="panel config-history-panel">
        <div class="panel-header">
          <div class="panel-heading">
            <h2 class="panel-title">历史版本</h2>
            <p class="panel-caption">按时间倒序展示，点击可查看任意版本。</p>
          </div>
        </div>

        <div class="revision-list">
          ${
            revisions.length
              ? revisions.map((item) => renderRevisionItem(item, {
                  action: "view-mail-revision",
                  activeRevision: emailDocument.revision,
                  latestRevision,
                })).join("")
              : '<div class="revision-empty">还没有历史版本。</div>'
          }
        </div>
      </aside>
    </div>
  `;
}

function renderMailTestPanel({ draft, mailTestDraft, readOnly }) {
  const selectedRegionConfig = getMailRegionConfig(draft, mailTestDraft.region);
  const selectedTemplates = Array.isArray(selectedRegionConfig.templates) ? selectedRegionConfig.templates : [];
  const hasSender = Boolean(selectedRegionConfig.sender?.id && selectedRegionConfig.sender?.address);
  const canSendTest = readOnly || state.sendingMailTest || !draft.enabled || !hasSender || !selectedTemplates.length;

  return `
    <section class="panel">
      <div class="panel-header">
        <div class="panel-heading">
          <h2 class="panel-title">测试发送</h2>
          <p class="panel-caption">超级管理员专用。按当前地域选择模板并发送测试邮件，帮助你验证地域路由、sender 和腾讯 SES 配置是否都已就绪。全局 20 秒内只能触发一次。</p>
        </div>
        <div class="panel-actions">
          <span class="meta-chip">${draft.enabled ? "服务已启用" : "服务未启用"}</span>
          ${
            isViewingHistoricalMailConfig()
              ? `<button class="button button-secondary" type="button" data-action="view-latest-mail" ${state.loadingMail ? "disabled" : ""}>返回最新</button>`
              : ""
          }
          <button
            class="button button-primary"
            type="button"
            data-action="send-mail-test"
            ${canSendTest ? "disabled" : ""}
          >
            ${state.sendingMailTest ? "发送中..." : "发送测试邮件"}
          </button>
        </div>
      </div>

      <div class="mail-test-layout">
        <section class="mail-section">
          <div class="mail-section-header">
            <div>
              <h3>测试参数</h3>
              <p>这里不会改动配置本身，只是用当前 sender / template 组合发一封测试邮件，帮助你验证模板、地区路由和腾讯 SES 凭据是否都已就绪。</p>
            </div>
          </div>

          <div class="mail-test-grid">
            <label class="field">
              <span>收件邮箱</span>
              <input
                data-mail-test-field="recipientEmail"
                type="email"
                value="${escapeHtml(mailTestDraft.recipientEmail)}"
                placeholder="tester@example.com"
                autocomplete="off"
                ${readOnly || state.sendingMailTest ? "disabled" : ""}
              />
              <small class="field-hint">测试邮件会直接发送到这里，建议先填你自己的邮箱做联调。</small>
            </label>
            <label class="field">
              <span>客户端地区</span>
              <select
                data-mail-test-field="region"
                ${readOnly || state.sendingMailTest ? "disabled" : ""}
              >
                ${renderMailTestRegionOptions(mailTestDraft.region)}
              </select>
              <small class="field-hint">这里只用于判断是否属于中国大陆地区。中国大陆会映射到 <code>ap-guangzhou</code>，其他地区会映射到 <code>ap-hongkong</code>，不会把你的选择原样透传给腾讯云。</small>
            </label>
            <label class="field">
              <span>模板 ID</span>
              <select
                data-mail-test-field="templateId"
                ${readOnly || state.sendingMailTest ? "disabled" : ""}
              >
                ${renderMailTestTemplateOptions(mailTestDraft.templateId, selectedTemplates)}
              </select>
              <small class="field-hint">这里只展示当前地域下的模板，便于确认广州 / 香港配置是否各自正确。</small>
            </label>
            <label class="field">
              <span>App 名称</span>
              <input
                data-mail-test-field="appName"
                type="text"
                value="${escapeHtml(mailTestDraft.appName)}"
                placeholder="Zook"
                autocomplete="off"
                ${readOnly || state.sendingMailTest ? "disabled" : ""}
              />
              <small class="field-hint">会传给模板变量 <code>{{appName}}</code>。</small>
            </label>
            <label class="field">
              <span>验证码</span>
              <input
                data-mail-test-field="code"
                type="text"
                value="${escapeHtml(mailTestDraft.code)}"
                placeholder="123456"
                autocomplete="off"
                ${readOnly || state.sendingMailTest ? "disabled" : ""}
              />
              <small class="field-hint">会传给模板变量 <code>{{code}}</code>。</small>
            </label>
            <label class="field">
              <span>过期分钟</span>
              <input
                data-mail-test-field="expireMinutes"
                type="number"
                min="1"
                max="120"
                step="1"
                value="${escapeHtml(String(mailTestDraft.expireMinutes))}"
                ${readOnly || state.sendingMailTest ? "disabled" : ""}
              />
              <small class="field-hint">会传给模板变量 <code>{{expireMinutes}}</code>，建议和真实验证码 TTL 保持一致。</small>
            </label>
          </div>
        </section>

        <section class="mail-section mail-test-side">
          <div class="mail-section-header">
            <div>
              <h3>最近一次测试</h3>
              <p>这里会展示最近一次测试真正使用的 sender、template 和模板变量，便于快速核对。</p>
            </div>
          </div>

          ${renderMailTestResult()}
        </section>
      </div>
    </section>
  `;
}

function renderPasswordsPage() {
  if (state.loadingPasswords) {
    return `
      <section class="page-shell password-page-shell">
        <section class="panel"><div class="skeleton skeleton-block"></div></section>
      </section>
    `;
  }

  const document = normalizePasswordDocument(state.passwordDocument);
  const draft = normalizePasswordDraft(state.passwordDraft ?? document.items);
  const updatedAt = document.updatedAt ? formatTimestamp(document.updatedAt) : "未保存";

  return `
    <section class="page-shell password-page-shell">
      <section class="panel password-panel">
        <div class="panel-header">
          <div class="panel-heading">
            <h1 class="page-title password-page-title">PASSWORD</h1>
            <p class="panel-caption">统一保存腾讯云等服务端机密参数，不做版本控制。</p>
          </div>
          <div class="page-header-compact-actions">
            <span class="meta-chip">${escapeHtml(updatedAt)}</span>
            <span class="meta-chip">${hasUnsavedPasswordChanges() ? "未保存" : "已保存"}</span>
          </div>
        </div>

        <div class="panel-header password-toolbar">
          <div class="panel-heading">
            <h2 class="panel-title">机密字段</h2>
          </div>
          <div class="panel-actions">
            <button class="button button-secondary" type="button" data-action="reload-passwords" ${state.loadingPasswords ? "disabled" : ""}>刷新</button>
            <button class="button button-secondary" type="button" data-action="add-password-item" ${state.savingPasswords ? "disabled" : ""}>添加密码</button>
          </div>
        </div>

        <div class="mail-list password-list">
          ${
            draft.length
              ? draft.map((item, index) => renderPasswordItemRow(item, index)).join("")
              : '<div class="mail-empty">还没有密码项。</div>'
          }
        </div>

      </section>
    </section>
  `;
}

function renderPasswordItemRow(item, index) {
  const valueMd5 = typeof item.valueMd5 === "string" ? item.valueMd5.trim() : "";
  const updatedAt = item.updatedAt ? formatTimestamp(item.updatedAt) : "未保存";
  const isNewItem = !String(item.originalKey ?? "").trim();
  const isMaskedValue = !isNewItem && typeof item.value === "string" && item.value.includes("*");
  return `
    <div class="mail-row password-row">
      <div class="mail-row-grid mail-row-grid-password">
        <label class="field">
          <span>Key</span>
          <input
            data-password-field="key"
            data-index="${escapeHtml(String(index))}"
            type="text"
            value="${escapeHtml(item.key)}"
            placeholder="tencent.secret_id"
            autocomplete="off"
            ${state.savingPasswords || !isNewItem ? "disabled" : ""}
          />
        </label>
        <label class="field">
          <span>说明</span>
          <input
            data-password-field="desc"
            data-index="${escapeHtml(String(index))}"
            type="text"
            value="${escapeHtml(item.desc)}"
            placeholder="用途说明"
            autocomplete="off"
            ${state.savingPasswords ? "disabled" : ""}
          />
        </label>
        <label class="field">
          <span>值</span>
          <input
            data-password-field="value"
            data-index="${escapeHtml(String(index))}"
            data-password-masked="${isMaskedValue ? "true" : "false"}"
            data-password-original-value="${escapeHtml(item.value)}"
            type="text"
            value="${escapeHtml(item.value)}"
            placeholder="输入机密值"
            autocomplete="off"
            ${state.savingPasswords ? "disabled" : ""}
          />
        </label>
        <button
          class="button button-primary"
          type="button"
          data-action="save-password-item"
          data-index="${escapeHtml(String(index))}"
          ${state.savingPasswords ? "disabled" : ""}
        >
          ${state.savingPasswords ? "保存中..." : isNewItem ? "添加" : "保存"}
        </button>
        <button
          class="button button-danger mail-row-remove"
          type="button"
          data-action="remove-password-item"
          data-index="${escapeHtml(String(index))}"
          ${state.savingPasswords ? "disabled" : ""}
        >
          删除
        </button>
      </div>
      <div class="password-row-meta">
        <span class="meta-chip password-md5-chip">${escapeHtml(valueMd5 ? `MD5 ${valueMd5}` : "MD5 待生成")}</span>
        <span class="meta-chip">${escapeHtml(updatedAt)}</span>
      </div>
    </div>
  `;
}

function normalizeMailDocument(document) {
  return {
    revision: document?.revision ?? null,
    updatedAt: document?.updatedAt ?? null,
    desc: document?.desc ?? "",
    resolvedRegion: document?.resolvedRegion ?? "ap-guangzhou",
    isLatest: document?.isLatest !== false,
    revisions: Array.isArray(document?.revisions) ? document.revisions : [],
    config: normalizeMailDraft(document?.config),
  };
}

function normalizeMailDraft(config) {
  return cloneMailConfig(config);
}

function normalizeMailTestDraft(draft, config) {
  const preferredRegion = String(draft?.region ?? "").trim();
  const region = MAIL_SENDER_REGION_OPTIONS.some((item) => item.value === preferredRegion)
    ? preferredRegion
    : MAIL_SENDER_REGION_OPTIONS[0].value;
  const regionConfig = getMailRegionConfig(config, region);
  const templates = Array.isArray(regionConfig.templates) ? regionConfig.templates : [];
  const preferredTemplateId = String(draft?.templateId ?? "").trim();
  const hasTemplate = templates.some((item) => String(item.templateId) === preferredTemplateId);

  return {
    recipientEmail: String(draft?.recipientEmail ?? "").trim(),
    region,
    templateId: hasTemplate ? preferredTemplateId : String(templates[0]?.templateId ?? ""),
    appName: String(draft?.appName ?? "Zook"),
    code: String(draft?.code ?? "123456"),
    expireMinutes: String(draft?.expireMinutes ?? "").trim() ? Number(draft.expireMinutes) : 10,
  };
}

function normalizePasswordDocument(document) {
  return {
    updatedAt: document?.updatedAt ?? null,
    items: normalizePasswordDraft(document?.items),
  };
}

function normalizePasswordDraft(items) {
  return clonePasswordConfig(items);
}

function renderLlmPage() {
  if (state.loadingLlm && !state.llmDocument) {
    return `
      <section class="page-shell">
        <div class="page-header">
          <div class="skeleton skeleton-title"></div>
        </div>
        <section class="panel"><div class="skeleton skeleton-block"></div></section>
      </section>
    `;
  }

  const doc = state.llmDocument;
  const draft = state.llmDraft ?? cloneLlmConfig(doc?.config);
  const updatedAt = doc?.updatedAt ? formatTimestamp(doc.updatedAt) : "未保存";
  const currentRevision = doc?.revision ?? "—";
  const revisions = Array.isArray(doc?.revisions) ? doc.revisions : [];
  const latestRevision = revisions[0]?.revision;
  const readOnly = state.loadingLlm || isViewingHistoricalLlmConfig();
  const validation = getLlmDraftValidation(draft);

  return `
    <section class="page-shell">
      <header class="page-header">
        <div>
          <h1 class="page-title">LLM</h1>
          <p class="page-subtitle">${SERVICE_WORKSPACE_LABEL}</p>
        </div>
        <div class="page-actions">
          <span class="meta-chip">R${escapeHtml(String(currentRevision))}</span>
          <span class="meta-chip">${escapeHtml(updatedAt)}</span>
          <span class="meta-chip">${state.llmTab === "config" ? (isViewingHistoricalLlmConfig() ? "历史版本" : hasUnsavedLlmChanges() ? "未保存" : "已保存") : "小时监控"}</span>
        </div>
      </header>

      <div class="tab-switcher" role="tablist" aria-label="LLM 页面标签">
        ${renderLlmTabButton("monitor", "监控")}
        ${renderLlmTabButton("config", "配置")}
      </div>

      ${
        state.llmTab === "monitor"
          ? renderLlmMonitorPanel()
          : renderLlmConfigPanel({
              doc,
              draft,
              readOnly,
              validation,
              latestRevision,
            })
      }
    </section>
  `;
}

function renderLlmTabButton(tab, label) {
  return `
    <button
      class="tab-chip"
      type="button"
      data-action="switch-llm-tab"
      data-tab="${escapeHtml(tab)}"
      data-active="${state.llmTab === tab ? "true" : "false"}"
      role="tab"
      aria-selected="${state.llmTab === tab ? "true" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderLlmMonitorPanel() {
  const metrics = state.llmMetricsDocument;
  const modelDetail = state.llmModelMetricsDocument;
  const summary = metrics?.summary ?? createEmptyLlmSummary();
  const models = Array.isArray(metrics?.models) ? metrics.models : [];

  return `
    <section class="panel">
      ${renderLlmSmokeTestPanel()}

      <div class="panel-header">
        <div class="panel-heading">
          <h2 class="panel-title">小时监控</h2>
          <p class="panel-caption">按 Asia/Shanghai 小时聚合，保留最近 1 年。这里默认展示最近 24 小时的总览、模型对比和模型供应商差异。</p>
        </div>
        <div class="panel-actions">
          ${renderLlmRangeButton("24h", "24h")}
          ${renderLlmRangeButton("7d", "7d")}
          ${renderLlmRangeButton("30d", "30d")}
          <button class="button button-secondary" type="button" data-action="reload-llm-metrics" ${state.loadingLlmMetrics ? "disabled" : ""}>${state.loadingLlmMetrics ? "读取中..." : "刷新"}</button>
        </div>
      </div>

      <div class="metric-card-grid">
        ${renderLlmMetricCard("请求量", String(summary.requestCount), "最近范围内的总请求次数")}
        ${renderLlmMetricCard("成功率", `${summary.successRate}%`, "成功次数 / 请求次数")}
        ${renderLlmMetricCard("平均首字节", `${summary.avgFirstByteLatencyMs} ms`, "从请求发出到收到第一个有效内容块")}
        ${renderLlmMetricCard("平均总耗时", `${summary.avgTotalLatencyMs} ms`, "从请求发出到完整结束")}
      </div>

      <section class="llm-monitor-section">
        <div class="mail-section-header">
          <div>
            <h3>模型对比</h3>
            <p>点击某个模型卡片后，下面会展开该模型按供应商的小时明细。</p>
          </div>
        </div>
        <div class="llm-model-grid">
          ${
            models.length
              ? models.map((model) => renderLlmModelMetricsCard(model)).join("")
              : '<div class="mail-empty">当前还没有可展示的模型小时数据。</div>'
          }
        </div>
      </section>

      <section class="llm-monitor-section">
        <div class="mail-section-header">
          <div>
            <h3>模型供应商详情</h3>
            <p>${modelDetail ? `${escapeHtml(modelDetail.label)} 按供应商对比成功率、首字节延迟和总耗时。` : "先在上方选择一个模型。"}</p>
          </div>
        </div>
        ${
          modelDetail
            ? `
              <div class="metric-card-grid metric-card-grid-tight">
                ${renderLlmMetricCard("模型请求量", String(modelDetail.summary.requestCount), "当前模型在所选时间范围内的请求次数")}
                ${renderLlmMetricCard("模型成功率", `${modelDetail.summary.successRate}%`, "该模型整体成功率")}
                ${renderLlmMetricCard("模型平均首字节", `${modelDetail.summary.avgFirstByteLatencyMs} ms`, "当前模型的平均首字节耗时")}
                ${renderLlmMetricCard("模型平均总耗时", `${modelDetail.summary.avgTotalLatencyMs} ms`, "当前模型的平均总耗时")}
              </div>
              ${modelDetail.routes.map((route) => renderLlmRouteMetricsTable(route)).join("")}
            `
            : '<div class="mail-empty">还没有选择模型，或当前模型暂无供应商数据。</div>'
        }
      </section>
    </section>
  `;
}

function renderLlmSmokeTestPanel() {
  const doc = state.llmSmokeTestDocument;
  const summary = doc?.summary ?? createEmptyLlmSmokeSummary();
  const items = Array.isArray(doc?.items) ? doc.items : [];
  const executedAt = doc?.executedAt ? formatTimestamp(doc.executedAt) : "尚未运行";

  return `
    <section class="llm-monitor-section llm-monitor-section-first">
      <div class="mail-section smoke-panel">
        <div class="panel-header smoke-panel-header">
          <div class="panel-heading">
            <h2 class="panel-title">冒烟测试</h2>
            <p class="panel-caption">会按当前配置把模型与供应商逐一组合，发出最小请求验证连通性、鉴权和供应商适配是否正常。测试结果不会写入小时监控，也不会影响自动分流健康度。</p>
          </div>
          <div class="panel-actions smoke-panel-actions">
            <span class="meta-chip">仅超级管理员</span>
            <span class="meta-chip">全局 10s 冷却</span>
            <span class="meta-chip">上次运行：${escapeHtml(executedAt)}</span>
            <button
              class="button button-primary"
              type="button"
              data-action="run-llm-smoke-test"
              ${state.runningLlmSmokeTest ? "disabled" : ""}
            >
              ${state.runningLlmSmokeTest ? "测试中..." : "运行冒烟测试"}
            </button>
          </div>
        </div>

        ${
          doc
            ? `
              <div class="metric-card-grid smoke-metric-grid">
                ${renderLlmMetricCard("成功", String(summary.successCount), "实际请求成功并返回有效响应的组合数")}
                ${renderLlmMetricCard("失败", String(summary.failureCount), "已发起请求但失败的组合数")}
                ${renderLlmMetricCard("跳过", String(summary.skippedCount), "未配置 route 或已禁用的组合数")}
                ${renderLlmMetricCard("成功率", `${summary.successRate}%`, "仅按实际发起请求的组合计算")}
              </div>
              <div class="smoke-inline-tip">点击每行左侧的 <strong>+</strong> 可展开查看调用参数、模型返回结果和错误详情。</div>
              ${renderLlmSmokeTestTable(items)}
            `
            : `
              <div class="mail-empty">
                还没有执行过冒烟测试。点击右上角按钮后，会按当前模型与供应商矩阵逐项验证。
              </div>
            `
        }
      </div>
    </section>
  `;
}

function renderLlmConfigPanel({ doc, draft, readOnly, validation, latestRevision }) {
  const revisions = Array.isArray(doc?.revisions) ? doc.revisions : [];
  const currentRevision = doc?.revision ?? "—";

  return `
    <div class="config-workspace">
      <section class="panel config-main-panel">
        <div class="panel-header">
          <div class="panel-heading">
            <h2 class="panel-title">LLM 配置</h2>
            <p class="panel-caption">${isViewingHistoricalLlmConfig() ? "当前正在查看历史版本，只读展示。" : "按固定表单管理供应商、模型和路由；保存前会弹出更新说明。字段下方的说明会直接告诉你每一项是什么意思。"}</p>
          </div>
          <div class="panel-actions">
            ${
              isViewingHistoricalLlmConfig()
                ? `<button class="button button-secondary" type="button" data-action="view-latest-llm" ${state.loadingLlm ? "disabled" : ""}>返回最新</button>`
                : ""
            }
            <button class="button button-secondary" type="button" data-action="reload-llm" ${state.loadingLlm ? "disabled" : ""}>读取</button>
          </div>
        </div>

        ${
          isViewingHistoricalLlmConfig()
            ? `
              <div class="revision-banner">
                <div>
                  <strong>正在查看历史版本 R${escapeHtml(String(currentRevision))}</strong>
                  <p>${escapeHtml(doc?.desc || "未填写更新说明")}</p>
                </div>
                <button
                  class="button button-primary"
                  type="button"
                  data-action="restore-llm-revision"
                  data-revision="${escapeHtml(String(currentRevision))}"
                  ${state.restoringLlmRevision === String(currentRevision) ? "disabled" : ""}
                >
                  ${state.restoringLlmRevision === String(currentRevision) ? "恢复中..." : "恢复到此版本"}
                </button>
              </div>
            `
            : ""
        }

        ${renderVersionDescription(doc?.desc)}

        <form class="stack-form" data-form="save-llm">
          <section class="mail-section">
            <div class="mail-section-header">
              <div>
                <h3>全局设置</h3>
                <p>这里控制整个服务端 LLM 配置是否启用，以及默认模型 key。</p>
              </div>
            </div>
            <div class="form-grid">
              <label class="field field-checkbox">
                <span>启用</span>
                <input
                  data-llm-field="enabled"
                  type="checkbox"
                  ${draft.enabled ? "checked" : ""}
                  ${readOnly || state.savingLlm ? "disabled" : ""}
                />
                <small class="field-hint">关闭后，所有模型都不会参与实际路由。</small>
              </label>
              <label class="field">
                <span>默认模型</span>
                <select data-llm-field="defaultModelKey" ${readOnly || state.savingLlm ? "disabled" : ""}>
                  <option value="">请选择</option>
                  ${draft.models
                    .map(
                      (model) => `
                        <option value="${escapeHtml(model.key)}" ${draft.defaultModelKey === model.key ? "selected" : ""}>
                          ${escapeHtml(`${model.label} · ${model.key}`)}
                        </option>
                      `,
                    )
                    .join("")}
                </select>
                <small class="field-hint">业务侧没有显式指定模型时，会优先使用这里的 key。</small>
              </label>
            </div>
          </section>

          <section class="mail-section">
            <div class="mail-section-header">
              <div>
                <h3>供应商</h3>
                <p>配置供应商连接信息。<code>key</code> 是系统内部标识，保存后不要频繁改；<code>baseUrl</code> 是 API 根地址；<code>apiKey</code> 支持直接填写，也支持 <code>{{zook.ps.xxx}}</code> 引用密码工作区。</p>
              </div>
              <button class="button button-secondary" type="button" data-action="add-llm-provider" ${readOnly || state.savingLlm ? "disabled" : ""}>添加供应商</button>
            </div>
            <div class="mail-list">
              ${
                draft.providers.length
                  ? draft.providers.map((provider, index) => renderLlmProviderCard(provider, index, readOnly)).join("")
                  : '<div class="mail-empty">还没有供应商配置。</div>'
              }
            </div>
          </section>

          <section class="mail-section">
            <div class="mail-section-header">
              <div>
                <h3>模型与路由</h3>
                <p><code>strategy</code> 只有两种：<code>auto</code> 会按 weight 和健康分自动分流；<code>fixed</code> 固定走 weight 最大的 route。<code>providerModel</code> 是供应商真实模型名，不一定等于逻辑模型 key。</p>
              </div>
              <button class="button button-secondary" type="button" data-action="add-llm-model" ${readOnly || state.savingLlm ? "disabled" : ""}>添加模型</button>
            </div>
            <div class="mail-list">
              ${
                draft.models.length
                  ? draft.models.map((model, index) => renderLlmModelCard(model, index, readOnly, doc?.runtime)).join("")
                  : '<div class="mail-empty">还没有模型配置。</div>'
              }
            </div>
          </section>

          <details class="version-note">
            <summary>查看当前 JSON</summary>
            <div class="version-note-body">
              ${renderJsonPreview(serializeLlmDraftForPreview(draft))}
            </div>
          </details>

          ${
            validation.errors.length
              ? `<div class="inline-alert inline-alert-error">${validation.errors.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>`
              : ""
          }

          <div class="form-footer">
            <button class="button button-ghost" type="button" data-action="reset-llm" ${readOnly || state.savingLlm ? "disabled" : ""}>恢复</button>
            <button class="button button-primary" type="button" data-action="open-save-llm-dialog" ${readOnly || state.savingLlm || validation.errors.length ? "disabled" : ""}>
              ${state.savingLlm ? "保存中..." : "保存配置"}
            </button>
          </div>
        </form>
      </section>

      <aside class="panel config-history-panel">
        <div class="panel-header">
          <div class="panel-heading">
            <h2 class="panel-title">历史版本</h2>
            <p class="panel-caption">按时间倒序展示，点击可查看任意版本。</p>
          </div>
        </div>

        <div class="revision-list">
          ${
            revisions.length
              ? revisions.map((item) => renderRevisionItem(item, {
                  action: "view-llm-revision",
                  activeRevision: doc?.revision,
                  latestRevision,
                })).join("")
              : '<div class="revision-empty">还没有历史版本。</div>'
          }
        </div>
      </aside>
    </div>
  `;
}

function renderLlmMetricCard(label, value, hint) {
  return `
    <article class="metric-card">
      <span class="metric-card-label">${escapeHtml(label)}</span>
      <strong class="metric-card-value">${escapeHtml(value)}</strong>
      <p class="metric-card-hint">${escapeHtml(hint)}</p>
    </article>
  `;
}

function renderLlmRangeButton(range, label) {
  return `
    <button
      class="button button-secondary"
      type="button"
      data-action="change-llm-metrics-range"
      data-range="${escapeHtml(range)}"
      data-active="${state.llmMetricsRange === range ? "true" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderLlmModelMetricsCard(model) {
  return `
    <button
      class="model-metric-card"
      type="button"
      data-action="select-llm-model-metrics"
      data-model-key="${escapeHtml(model.modelKey)}"
      data-active="${state.llmSelectedModelKey === model.modelKey ? "true" : "false"}"
    >
      <div class="model-metric-card-top">
        <strong>${escapeHtml(model.label)}</strong>
        <span>${escapeHtml(model.modelKey)}</span>
      </div>
      <div class="model-metric-card-metrics">
        <span>成功率 ${escapeHtml(String(model.summary.successRate))}%</span>
        <span>首字节 ${escapeHtml(String(model.summary.avgFirstByteLatencyMs))} ms</span>
        <span>总耗时 ${escapeHtml(String(model.summary.avgTotalLatencyMs))} ms</span>
      </div>
      ${renderLlmMetricsTable(model.items)}
    </button>
  `;
}

function renderLlmRouteMetricsTable(route) {
  return `
    <section class="llm-route-metrics">
      <div class="mail-section-header">
        <div>
          <h3>${escapeHtml(route.provider)}</h3>
          <p>${escapeHtml(route.providerModel)}</p>
        </div>
      </div>
      <div class="metric-card-grid metric-card-grid-tight">
        ${renderLlmMetricCard("请求量", String(route.summary.requestCount), "当前 route 的小时聚合请求数")}
        ${renderLlmMetricCard("成功率", `${route.summary.successRate}%`, "当前 route 的成功率")}
        ${renderLlmMetricCard("平均首字节", `${route.summary.avgFirstByteLatencyMs} ms`, "当前 route 的平均首字节耗时")}
        ${renderLlmMetricCard("平均总耗时", `${route.summary.avgTotalLatencyMs} ms`, "当前 route 的平均总耗时")}
      </div>
      ${renderLlmMetricsTable(route.items)}
    </section>
  `;
}

function renderLlmMetricsTable(items) {
  const recentItems = Array.isArray(items) ? items.slice(-12).reverse() : [];
  if (!recentItems.length) {
    return '<div class="mail-empty">所选时间范围内还没有小时数据。</div>';
  }

  return `
    <div class="table-wrap">
      <table class="app-table llm-metrics-table">
        <thead>
          <tr>
            <th>小时</th>
            <th>请求量</th>
            <th>成功率</th>
            <th>平均首字节</th>
            <th>平均总耗时</th>
          </tr>
        </thead>
        <tbody>
          ${recentItems
            .map(
              (item) => `
                <tr>
                  <td>${escapeHtml(item.hour)}</td>
                  <td>${escapeHtml(String(item.requestCount))}</td>
                  <td>${escapeHtml(String(item.successRate))}%</td>
                  <td>${escapeHtml(String(item.avgFirstByteLatencyMs))} ms</td>
                  <td>${escapeHtml(String(item.avgTotalLatencyMs))} ms</td>
                </tr>
              `,
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLlmSmokeTestTable(items) {
  return `
    <div class="table-wrap smoke-table-wrap">
      <table class="app-table smoke-table">
        <thead>
          <tr>
            <th class="smoke-table-control-cell">明细</th>
            <th>模型</th>
            <th>供应商</th>
            <th>供应商模型</th>
            <th>结果</th>
            <th>耗时</th>
            <th>摘要</th>
          </tr>
        </thead>
        <tbody>
          ${
            items.length
              ? items.map((item, index) => renderLlmSmokeTestRows(item, index)).join("")
              : `
                <tr>
                  <td colspan="7">
                    <div class="mail-empty">当前没有可展示的冒烟测试结果。</div>
                  </td>
                </tr>
              `
          }
        </tbody>
      </table>
    </div>
  `;
}

function renderLlmSmokeTestRows(item, index) {
  const itemKey = buildLlmSmokeItemKey(item, index);
  const expanded = Boolean(state.llmSmokeExpandedKeys[itemKey]);

  return `
    <tr data-smoke-status="${escapeHtml(item.status)}">
      <td class="smoke-table-control-cell">
        <button
          class="smoke-expand-button"
          type="button"
          data-action="toggle-llm-smoke-details"
          data-item-key="${escapeHtml(itemKey)}"
          aria-expanded="${expanded ? "true" : "false"}"
          aria-label="${expanded ? "收起详情" : "展开详情"}"
        >
          ${expanded ? "−" : "+"}
        </button>
      </td>
      <td>
        <div class="app-name-cell">
          <strong>${escapeHtml(item.modelLabel)}</strong>
          <span>${escapeHtml(item.modelKey)}</span>
        </div>
      </td>
      <td>
        <div class="app-name-cell">
          <strong>${escapeHtml(item.providerLabel)}</strong>
          <span>${escapeHtml(item.provider)}</span>
        </div>
      </td>
      <td><code>${escapeHtml(item.providerModel || "-")}</code></td>
      <td>${renderLlmSmokeStatusBadge(item.status)}</td>
      <td>${escapeHtml(typeof item.latencyMs === "number" ? `${item.latencyMs} ms` : "-")}</td>
      <td class="smoke-table-summary">${renderLlmSmokeSummaryCell(item)}</td>
    </tr>
    ${
      expanded
        ? `
          <tr class="smoke-details-row">
            <td colspan="7">
              ${renderLlmSmokeDetails(item)}
            </td>
          </tr>
        `
        : ""
    }
  `;
}

function renderLlmSmokeSummaryCell(item) {
  return `
    <div class="smoke-summary-cell">
      <strong>${escapeHtml(item.message)}</strong>
      <p>${escapeHtml(item.responsePreview || "点击 + 查看完整的请求参数、模型返回或错误详情。")}</p>
    </div>
  `;
}

function renderLlmSmokeDetails(item) {
  const diagnosticTitle =
    item.status === "success"
      ? "模型返回"
      : item.status === "failed"
        ? "错误详情"
        : "跳过说明";
  const diagnosticDescription =
    item.status === "success"
      ? "这里展示统一后的模型返回结果，便于确认内容、finish reason 和 usage。"
      : item.status === "failed"
        ? "这里展示失败时捕获到的错误对象关键信息，包括错误码和供应商返回细节。"
        : "这里说明当前组合为什么被跳过，没有真正发起上游调用。";
  const diagnosticPayload =
    item.status === "success"
      ? item.details?.response
      : item.status === "failed"
        ? item.details?.error
        : item.details?.skip;

  return `
    <div class="smoke-details-shell">
      <div class="smoke-detail-grid">
        ${renderLlmSmokeDetailCard(
          "调用参数",
          "这里是本次实际发出的 smoke request 快照，包含 providerModel、messages、timeoutMs 和 providerOptions。",
          item.details?.request,
          "当前组合没有生成可展示的请求参数。",
        )}
        ${renderLlmSmokeDetailCard(
          diagnosticTitle,
          diagnosticDescription,
          diagnosticPayload,
          item.status === "success" ? "当前没有模型返回内容。" : item.status === "failed" ? "当前没有捕获到可展示的错误详情。" : "当前没有跳过说明。",
        )}
        ${renderLlmSmokeDetailCard(
          "结果摘要",
          "这里聚合本次组合测试的最终状态、耗时和摘要消息，方便快速判断问题归属。",
          buildLlmSmokeOutcomeSnapshot(item),
          "当前没有额外摘要信息。",
        )}
      </div>
    </div>
  `;
}

function renderLlmSmokeDetailCard(title, description, payload, emptyText) {
  return `
    <section class="smoke-detail-card">
      <div class="smoke-detail-card-header">
        <div>
          <h4>${escapeHtml(title)}</h4>
          <p>${escapeHtml(description)}</p>
        </div>
      </div>
      ${
        payload
          ? renderJsonPreview(payload)
          : `<div class="smoke-detail-empty">${escapeHtml(emptyText)}</div>`
      }
    </section>
  `;
}

function renderLlmSmokeStatusBadge(status) {
  const label =
    status === "success"
      ? "成功"
      : status === "failed"
        ? "失败"
        : "跳过";

  return `
    <span class="smoke-status-badge" data-status="${escapeHtml(status)}">
      ${escapeHtml(label)}
    </span>
  `;
}

function buildLlmSmokeItemKey(item, index) {
  return [item.modelKey, item.provider, item.providerModel || "__none__", String(index)].join("::");
}

function buildLlmSmokeOutcomeSnapshot(item) {
  return {
    status: item.status,
    configured: Boolean(item.configured),
    message: item.message,
    ...(typeof item.latencyMs === "number" ? { latencyMs: item.latencyMs } : {}),
    ...(item.responsePreview ? { responsePreview: item.responsePreview } : {}),
  };
}

function buildLlmModelCollapseKey(model, index) {
  return [model.key || "__empty__", String(index)].join("::");
}

function renderLlmProviderCard(provider, index, readOnly) {
  return `
    <div class="mail-row">
      <div class="entity-card">
        <div class="entity-card-top">
          <div>
            <strong>${escapeHtml(provider.label || "未命名供应商")}</strong>
            <span>${escapeHtml(provider.key || "未设置 key")}</span>
          </div>
          <div class="row-actions">
            <button class="button button-secondary" type="button" data-action="edit-llm-provider" data-index="${escapeHtml(String(index))}" ${readOnly || state.savingLlm ? "disabled" : ""}>编辑</button>
            <button class="button button-ghost" type="button" data-action="delete-llm-provider" data-index="${escapeHtml(String(index))}" ${readOnly || state.savingLlm ? "disabled" : ""}>删除</button>
          </div>
        </div>
        <div class="entity-card-meta">
          <span class="meta-chip">${provider.enabled ? "已启用" : "已停用"}</span>
          <span class="meta-chip">${escapeHtml(provider.baseUrl || "未设置 baseUrl")}</span>
          <span class="meta-chip">timeout ${escapeHtml(String(provider.timeoutMs || 0))} ms</span>
        </div>
      </div>
    </div>
  `;
}

function renderLlmModelCard(model, index, readOnly, runtimeSnapshot) {
  const runtimeModel = runtimeSnapshot?.models?.find((item) => item.key === model.key);
  const enabledWeightSum = model.routes.filter((route) => route.enabled).reduce((sum, route) => sum + Number(route.weight || 0), 0);
  const weightHint = model.routes.some((route) => route.enabled)
    ? `当前启用 route 的 weight 合计 ${enabledWeightSum.toFixed(2)}，应等于 100。`
    : "当前没有启用 route。fixed 模式下会回退到列表里的第一条 route。";
  const collapseKey = buildLlmModelCollapseKey(model, index);
  const collapsed = Boolean(state.llmCollapsedModelKeys[collapseKey]);
  const enabledRouteCount = model.routes.filter((route) => route.enabled).length;
  const summaryHint = collapsed
    ? `已折叠，当前共有 ${model.routes.length} 条 route，其中 ${enabledRouteCount} 条启用。点击展开后可继续编辑路由明细。`
    : `当前共有 ${model.routes.length} 条 route，其中 ${enabledRouteCount} 条启用。`;

  return `
    <div class="mail-row">
      <div class="entity-card llm-model-card" data-collapsed="${collapsed ? "true" : "false"}">
        <div class="entity-card-top">
          <div>
            <strong>${escapeHtml(model.label || "未命名模型")}</strong>
            <span>${escapeHtml(model.key || "未设置 key")}</span>
          </div>
          <div class="row-actions">
            <button
              class="button button-secondary llm-collapse-button"
              type="button"
              data-action="toggle-llm-model-collapse"
              data-model-collapse-key="${escapeHtml(collapseKey)}"
              aria-expanded="${collapsed ? "false" : "true"}"
            >
              ${collapsed ? "展开" : "收起"}
            </button>
            <button class="button button-secondary" type="button" data-action="edit-llm-model" data-index="${escapeHtml(String(index))}" ${readOnly || state.savingLlm ? "disabled" : ""}>编辑</button>
            <button class="button button-ghost" type="button" data-action="delete-llm-model" data-index="${escapeHtml(String(index))}" ${readOnly || state.savingLlm ? "disabled" : ""}>删除</button>
          </div>
        </div>
        <div class="entity-card-meta">
          <span class="meta-chip">${escapeHtml(model.strategy)}</span>
          <span class="meta-chip">${escapeHtml(model.strategy === "auto" ? "按 weight × 健康分自动分流" : "固定走最高 weight route")}</span>
        </div>
        <p class="field-hint llm-model-summary-hint">${escapeHtml(summaryHint)}</p>
        ${
          collapsed
            ? ""
            : `
              <p class="field-hint">${escapeHtml(weightHint)}</p>
              <div class="mail-section llm-route-section">
                <div class="mail-section-header">
                  <div>
                    <h3>Routes</h3>
                    <p><code>weight</code> 表示基础流量比例。<code>auto</code> 会叠加健康分，<code>fixed</code> 只认最大的 weight。</p>
                  </div>
                  <button class="button button-secondary" type="button" data-action="add-llm-route" data-model-index="${escapeHtml(String(index))}" ${readOnly || state.savingLlm ? "disabled" : ""}>添加 Route</button>
                </div>
                <div class="table-wrap">
                  <table class="app-table llm-route-table">
                    <thead>
                      <tr>
                        <th>供应商</th>
                        <th>Provider Model</th>
                        <th>启用</th>
                        <th>Weight</th>
                        <th>健康分</th>
                        <th>成功率</th>
                        <th>实际流量</th>
                        <th class="align-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${model.routes
                        .map((route, routeIndex) => renderLlmRouteRow(route, routeIndex, index, runtimeModel, readOnly))
                        .join("")}
                    </tbody>
                  </table>
                </div>
              </div>
            `
        }
      </div>
    </div>
  `;
}

function renderLlmRouteRow(route, routeIndex, modelIndex, runtimeModel, readOnly) {
  const runtimeRoute = runtimeModel?.routes?.find(
    (item) => item.provider === route.provider && item.providerModel === route.providerModel,
  );

  return `
    <tr>
      <td>${escapeHtml(route.provider)}</td>
      <td>${escapeHtml(route.providerModel)}</td>
      <td>${route.enabled ? "是" : "否"}</td>
      <td>${escapeHtml(String(route.weight))}</td>
      <td>${escapeHtml(String(runtimeRoute?.healthScore ?? 100))}</td>
      <td>${escapeHtml(String(runtimeRoute?.successRate ?? 100))}%</td>
      <td>${escapeHtml(String(runtimeRoute?.effectiveProbability ?? 0))}%</td>
      <td class="align-right">
        <div class="row-actions row-actions-tight">
          <button class="button button-secondary" type="button" data-action="move-llm-route-up" data-model-index="${escapeHtml(String(modelIndex))}" data-route-index="${escapeHtml(String(routeIndex))}" ${readOnly || state.savingLlm || routeIndex === 0 ? "disabled" : ""}>上移</button>
          <button class="button button-secondary" type="button" data-action="move-llm-route-down" data-model-index="${escapeHtml(String(modelIndex))}" data-route-index="${escapeHtml(String(routeIndex))}" ${readOnly || state.savingLlm || routeIndex === state.llmDraft.models[modelIndex].routes.length - 1 ? "disabled" : ""}>下移</button>
          <button class="button button-secondary" type="button" data-action="edit-llm-route" data-model-index="${escapeHtml(String(modelIndex))}" data-route-index="${escapeHtml(String(routeIndex))}" ${readOnly || state.savingLlm ? "disabled" : ""}>编辑</button>
          <button class="button button-ghost" type="button" data-action="delete-llm-route" data-model-index="${escapeHtml(String(modelIndex))}" data-route-index="${escapeHtml(String(routeIndex))}" ${readOnly || state.savingLlm ? "disabled" : ""}>删除</button>
        </div>
      </td>
    </tr>
  `;
}

function renderMailRegionSection(regionConfig, regionIndex, readOnly) {
  const regionLabel = renderMailRegionLabel(regionConfig.region);
  const sender = regionConfig.sender ?? createEmptyMailSender();
  const templates = Array.isArray(regionConfig.templates) ? regionConfig.templates : [];
  const summary = [
    sender.id ? `sender: ${sender.id}` : "未配置 sender",
    `${templates.length} 个模板`,
  ].join(" · ");
  const isOpen = state.mailExpandedRegions[regionConfig.region] ?? regionIndex === 0;

  return `
    <details class="mail-region-section" data-mail-region="${escapeHtml(regionConfig.region)}" ${isOpen ? "open" : ""}>
      <summary>
        <div class="mail-region-summary">
          <strong>${escapeHtml(regionLabel)}</strong>
          <span>${escapeHtml(summary)}</span>
        </div>
      </summary>
      <div class="mail-region-body">
        <section class="mail-section">
          <div class="mail-section-header">
            <div>
              <h3>发件地址</h3>
              <p>这个地域下只保留一个 sender，发送时会严格使用当前地域对应的发件地址。</p>
            </div>
          </div>

          <div class="mail-row">
            <div class="mail-row-grid mail-row-grid-region-sender">
              <label class="field">
                <span>Sender ID</span>
                <input
                  data-mail-region-field="sender"
                  data-region-index="${escapeHtml(String(regionIndex))}"
                  data-key="id"
                  type="text"
                  value="${escapeHtml(sender.id)}"
                  placeholder="${regionConfig.region === "ap-guangzhou" ? "mainland" : "global"}"
                  autocomplete="off"
                  ${readOnly || state.savingMail ? "disabled" : ""}
                />
              </label>
              <label class="field">
                <span>发件地址</span>
                <input
                  data-mail-region-field="sender"
                  data-region-index="${escapeHtml(String(regionIndex))}"
                  data-key="address"
                  type="text"
                  value="${escapeHtml(sender.address)}"
                  placeholder="Admin <noreply@example.com>"
                  autocomplete="off"
                  ${readOnly || state.savingMail ? "disabled" : ""}
                />
              </label>
            </div>
          </div>
        </section>

        <section class="mail-section">
          <div class="mail-section-header">
            <div>
              <h3>模板</h3>
              <p>这个地域自己的模板列表。<code>subject</code> 会和模板 ID 一起下发到腾讯 SES。</p>
            </div>
            <button class="button button-secondary" type="button" data-action="add-mail-template" data-region-index="${escapeHtml(String(regionIndex))}" ${readOnly || state.savingMail ? "disabled" : ""}>添加模板</button>
          </div>

          <div class="mail-list">
            ${
              templates.length
                ? templates.map((template, templateIndex) => renderMailTemplateRow(template, regionIndex, templateIndex, readOnly)).join("")
                : '<div class="mail-empty">这个地域还没有模板。</div>'
            }
          </div>
        </section>
      </div>
    </details>
  `;
}

function renderMailTemplateRow(template, regionIndex, index, readOnly) {
  return `
    <div class="mail-row">
      <div class="mail-row-scroll">
        <div class="mail-row-grid mail-row-grid-template">
          <label class="field">
            <span>语言</span>
            <select
              data-mail-list="templates"
              data-region-index="${escapeHtml(String(regionIndex))}"
              data-index="${escapeHtml(String(index))}"
              data-key="locale"
              ${readOnly || state.savingMail ? "disabled" : ""}
            >
              ${renderTemplateLocaleOptions(template.locale)}
            </select>
            <small class="field-hint">优先按 <code>X-App-Locale</code> 精确匹配，找不到再做语言兜底。</small>
          </label>
          <label class="field">
            <span>模板 ID</span>
            <input
              data-mail-list="templates"
              data-region-index="${escapeHtml(String(regionIndex))}"
              data-index="${escapeHtml(String(index))}"
              data-key="templateId"
              type="number"
              min="1"
              step="1"
              value="${escapeHtml(template.templateId)}"
              placeholder="100001"
              autocomplete="off"
              ${readOnly || state.savingMail ? "disabled" : ""}
            />
            <small class="field-hint">腾讯云 SES 控制台里创建模板后会得到一个正整数 ID。</small>
          </label>
          <label class="field">
            <span>名称</span>
            <input
              data-mail-list="templates"
              data-region-index="${escapeHtml(String(regionIndex))}"
              data-index="${escapeHtml(String(index))}"
              data-key="name"
              type="text"
              value="${escapeHtml(template.name)}"
              placeholder="验证码"
              autocomplete="off"
              ${readOnly || state.savingMail ? "disabled" : ""}
            />
            <small class="field-hint">后台里的可读名称，只用于识别这条模板。</small>
          </label>
          <label class="field">
            <span>主题</span>
            <input
              data-mail-list="templates"
              data-region-index="${escapeHtml(String(regionIndex))}"
              data-index="${escapeHtml(String(index))}"
              data-key="subject"
              type="text"
              value="${escapeHtml(template.subject)}"
              placeholder="验证码"
              autocomplete="off"
              ${readOnly || state.savingMail ? "disabled" : ""}
            />
            <small class="field-hint">腾讯 SES 的 <code>Subject</code> 必填，建议和模板语言保持一致。</small>
          </label>
          <button
            class="button button-ghost mail-row-remove"
            type="button"
            data-action="remove-mail-template"
            data-region-index="${escapeHtml(String(regionIndex))}"
            data-index="${escapeHtml(String(index))}"
            ${readOnly || state.savingMail ? "disabled" : ""}
          >
            删除
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderTemplateLocaleOptions(selectedLocale) {
  const options = MAIL_TEMPLATE_LOCALE_OPTIONS.some((option) => option.value === selectedLocale)
    ? MAIL_TEMPLATE_LOCALE_OPTIONS
    : [{ value: selectedLocale, label: selectedLocale || "未设置" }, ...MAIL_TEMPLATE_LOCALE_OPTIONS];

  return options.map(
    (option) => `
      <option value="${escapeHtml(option.value)}" ${option.value === selectedLocale ? "selected" : ""}>
        ${escapeHtml(option.label)}
      </option>
    `,
  ).join("");
}

function renderMailTestRegionOptions(selectedRegion) {
  return MAIL_SENDER_REGION_OPTIONS.map((option) => `
    <option value="${escapeHtml(option.value)}" ${option.value === selectedRegion ? "selected" : ""}>
      ${escapeHtml(option.label)}
    </option>
  `).join("");
}

function renderMailTestTemplateOptions(selectedTemplateId, templates) {
  const items = Array.isArray(templates) ? templates : [];
  if (!items.length) {
    return '<option value="">请先配置模板</option>';
  }

  return items.map((template) => `
    <option value="${escapeHtml(String(template.templateId))}" ${String(template.templateId) === String(selectedTemplateId) ? "selected" : ""}>
      ${escapeHtml(`[${template.templateId}] ${template.name} · ${template.locale}`)}
    </option>
  `).join("");
}

function renderMailTestResult() {
  if (!state.mailTestResult) {
    return `
      <div class="mail-test-result" data-tone="neutral">
        <div class="mail-test-result-header">
          <strong>最近一次测试</strong>
          <span class="meta-chip">还没有执行</span>
        </div>
        <p class="mail-test-result-text">填写上面的信息后点击“发送测试邮件”，这里会展示实际使用的 sender、template 和模板变量。</p>
      </div>
    `;
  }

  if (state.mailTestResult.status === "error") {
    const debugPayload = state.mailTestResult.data;
    return `
      <div class="mail-test-result" data-tone="error">
        <div class="mail-test-result-header">
          <strong>最近一次测试</strong>
          <span class="meta-chip">发送失败</span>
        </div>
        <p class="mail-test-result-text">${escapeHtml(state.mailTestResult.message || "发送失败。")}</p>
        ${
          state.mailTestResult.code
            ? `<p class="mail-test-result-subtle">错误码：<code>${escapeHtml(state.mailTestResult.code)}</code></p>`
            : ""
        }
        ${
          debugPayload
            ? `
              <details class="version-note">
                <summary>查看失败调试信息</summary>
                <div class="version-note-body">
                  ${renderJsonPreview(debugPayload)}
                </div>
              </details>
            `
            : ""
        }
      </div>
    `;
  }

  const doc = state.mailTestResult.data;
  return `
    <div class="mail-test-result" data-tone="success">
      <div class="mail-test-result-header">
        <strong>最近一次测试</strong>
        <div class="mail-test-meta">
          <span class="meta-chip">已发送</span>
          <span class="meta-chip">${escapeHtml(formatTimestamp(doc.executedAt))}</span>
        </div>
      </div>
      <div class="mail-test-summary-grid">
        <div>
          <span class="mail-test-label">收件邮箱</span>
          <strong>${escapeHtml(doc.recipientEmail)}</strong>
        </div>
        <div>
          <span class="mail-test-label">客户端地区</span>
          <strong>${escapeHtml(renderMailRegionLabel(doc.clientRegion))}</strong>
          <small>最终腾讯云 Region：${escapeHtml(doc.resolvedRegion)}</small>
        </div>
        <div>
          <span class="mail-test-label">Sender</span>
          <strong>${escapeHtml(`${doc.sender.id} · ${doc.sender.region}`)}</strong>
          <small>${escapeHtml(doc.sender.address)}</small>
        </div>
        <div>
          <span class="mail-test-label">模板</span>
          <strong>${escapeHtml(`[${doc.template.templateId}] ${doc.template.name}`)}</strong>
          <small>${escapeHtml(`${doc.template.locale} · ${doc.template.subject}`)}</small>
        </div>
        <div>
          <span class="mail-test-label">Provider</span>
          <strong>${escapeHtml(doc.provider)}</strong>
          <small>${escapeHtml(doc.providerMessageId || doc.providerRequestId || "无额外回执")}</small>
        </div>
      </div>
      <details class="version-note">
        <summary>查看本次发送详情</summary>
        <div class="version-note-body">
          ${renderJsonPreview({
            clientRegion: doc.clientRegion,
            resolvedRegion: doc.resolvedRegion,
            sender: doc.sender,
            template: doc.template,
            templateData: doc.templateData,
            providerRequestId: doc.providerRequestId,
            providerMessageId: doc.providerMessageId,
            debug: doc.debug,
          })}
        </div>
      </details>
    </div>
  `;
}

function renderMailRegionLabel(region) {
  return MAIL_SENDER_REGION_OPTIONS.find((option) => option.value === region)?.label || region || "未设置";
}

function renderVersionDescription(desc) {
  return `
    <details class="version-note">
      <summary>此版本的更新说明</summary>
      <div class="version-note-body">${escapeHtml(desc || "未填写更新说明")}</div>
    </details>
  `;
}

function renderJsonEditor({ value, readOnly, compact, dirty }) {
  const placeholder = '{\n  "featureFlags": {},\n  "settings": {}\n}';
  return `
    <div class="json-editor-shell ${compact ? "json-editor-shell-compact" : ""}" data-dirty="${dirty ? "true" : "false"}">
      <pre class="json-editor-highlight" aria-hidden="true"></pre>
      <textarea
        id="config-json"
        name="configJson"
        class="json-editor-input ${compact ? "json-editor-compact" : ""}"
        spellcheck="false"
        data-json-placeholder="${escapeHtml(placeholder)}"
        ${readOnly ? "disabled" : ""}
      >${escapeHtml(value)}</textarea>
    </div>
  `;
}

function renderJsonPreview(value, options = {}) {
  const placeholder = typeof options.placeholder === "string" ? options.placeholder : "{\n}";
  const serialized =
    typeof value === "string"
      ? value
      : JSON.stringify(value ?? {}, null, 2);

  return `
    <pre class="json-preview json-preview-highlighted">${renderHighlightedJson(serialized, placeholder)}</pre>
  `;
}

function renderSaveDialog() {
  if (!state.saveDialog) {
    return "";
  }

  return `
    <div class="modal-backdrop" data-action="close-save-dialog">
      <div class="modal-card" data-modal-card="true" role="dialog" aria-modal="true" aria-labelledby="save-dialog-title">
        <form class="modal-form" data-form="save-dialog">
          <div class="modal-header">
            <div>
              <h2 id="save-dialog-title">${escapeHtml(state.saveDialog.title)}</h2>
              <p>${escapeHtml(state.saveDialog.subtitle)}</p>
            </div>
          </div>
          <label class="field">
            <span>更新说明</span>
            <textarea
              class="modal-textarea"
              name="saveDialogDesc"
              maxlength="400"
              spellcheck="false"
            >${escapeHtml(state.saveDialog.value)}</textarea>
          </label>
          <div class="form-footer">
            <button class="button button-ghost" type="button" data-action="close-save-dialog">取消</button>
            <button class="button button-primary" type="submit">${escapeHtml(state.saveDialog.confirmLabel)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderLlmDialog() {
  if (!state.llmDialog) {
    return "";
  }

  const dialog = state.llmDialog;

  return `
    <div class="modal-backdrop" data-action="close-llm-dialog">
      <div class="modal-card" data-llm-modal-card="true" role="dialog" aria-modal="true" aria-labelledby="llm-dialog-title">
        <form class="modal-form" data-form="llm-editor-dialog">
          <div class="modal-header">
            <div>
              <h2 id="llm-dialog-title">${escapeHtml(dialog.title)}</h2>
              <p>${escapeHtml(dialog.subtitle)}</p>
            </div>
          </div>
          ${renderLlmDialogFields(dialog)}
          ${dialog.error ? `<p class="editor-error" role="alert">${escapeHtml(dialog.error)}</p>` : ""}
          <div class="form-footer">
            <button class="button button-ghost" type="button" data-action="close-llm-dialog">取消</button>
            <button class="button button-primary" type="submit">${escapeHtml(dialog.confirmLabel)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderLlmDialogFields(dialog) {
  if (dialog.kind === "provider") {
    return `
      <div class="form-grid">
        <label class="field">
          <span>key</span>
          <input data-llm-dialog-field="key" type="text" value="${escapeHtml(dialog.values.key)}" autocomplete="off" />
          <small class="field-hint">系统内部标识，建议只使用小写字母、数字、下划线或中划线。</small>
        </label>
        <label class="field">
          <span>label</span>
          <input data-llm-dialog-field="label" type="text" value="${escapeHtml(dialog.values.label)}" autocomplete="off" />
          <small class="field-hint">后台展示名称，只影响可读性，不参与实际路由。</small>
        </label>
      </div>
      <div class="form-grid">
        <label class="field field-checkbox">
          <span>enabled</span>
          <input data-llm-dialog-field="enabled" type="checkbox" ${dialog.values.enabled ? "checked" : ""} />
          <small class="field-hint">关闭后，这个供应商不会参与任何 route 选路。</small>
        </label>
        <label class="field">
          <span>timeoutMs</span>
          <input data-llm-dialog-field="timeoutMs" type="number" min="1" step="1" value="${escapeHtml(dialog.values.timeoutMs)}" />
          <small class="field-hint">单次请求超时时间，单位毫秒。</small>
        </label>
      </div>
      <label class="field">
        <span>baseUrl</span>
        <input data-llm-dialog-field="baseUrl" type="text" value="${escapeHtml(dialog.values.baseUrl)}" autocomplete="off" />
        <small class="field-hint">供应商 API 根地址，例如 <code>https://dashscope.aliyuncs.com/compatible-mode/v1</code>。</small>
      </label>
      <label class="field">
        <span>apiKey</span>
        <input data-llm-dialog-field="apiKey" type="text" value="${escapeHtml(dialog.values.apiKey)}" autocomplete="off" />
        <small class="field-hint">支持明文，也支持 <code>{{zook.ps.xxx}}</code>，例如 <code>{{zook.ps.bailian.api_key}}</code>。</small>
      </label>
    `;
  }

  if (dialog.kind === "model") {
    return `
      <div class="form-grid">
        <label class="field">
          <span>key</span>
          <input data-llm-dialog-field="key" type="text" value="${escapeHtml(dialog.values.key)}" autocomplete="off" />
          <small class="field-hint">业务侧使用的逻辑模型名，例如 <code>kimi2.5</code>。</small>
        </label>
        <label class="field">
          <span>label</span>
          <input data-llm-dialog-field="label" type="text" value="${escapeHtml(dialog.values.label)}" autocomplete="off" />
          <small class="field-hint">后台展示名称，用于帮助你快速识别模型。</small>
        </label>
      </div>
      <label class="field">
        <span>strategy</span>
        <select data-llm-dialog-field="strategy">
          <option value="auto" ${dialog.values.strategy === "auto" ? "selected" : ""}>auto</option>
          <option value="fixed" ${dialog.values.strategy === "fixed" ? "selected" : ""}>fixed</option>
        </select>
        <small class="field-hint"><code>auto</code> 会按 weight 和健康分共同决定实际流量；<code>fixed</code> 固定走 weight 最大的 route。</small>
      </label>
    `;
  }

  return `
    <label class="field">
      <span>provider</span>
      <select data-llm-dialog-field="provider">
        ${ensureLlmDraft().providers
          .map(
            (provider) => `
              <option value="${escapeHtml(provider.key)}" ${dialog.values.provider === provider.key ? "selected" : ""}>
                ${escapeHtml(`${provider.label} · ${provider.key}`)}
              </option>
            `,
          )
          .join("")}
      </select>
      <small class="field-hint">这里选的是逻辑供应商 key，route 只能引用当前已存在的供应商。</small>
    </label>
    <label class="field">
      <span>providerModel</span>
      <input data-llm-dialog-field="providerModel" type="text" value="${escapeHtml(dialog.values.providerModel)}" autocomplete="off" />
      <small class="field-hint">供应商真实模型名，不一定等于逻辑模型 key，例如 <code>kimi/kimi-k2.5</code>。</small>
    </label>
    <div class="form-grid">
      <label class="field field-checkbox">
        <span>enabled</span>
        <input data-llm-dialog-field="enabled" type="checkbox" ${dialog.values.enabled ? "checked" : ""} />
        <small class="field-hint">关闭后，这条 route 不参与路由；如果模型是 fixed 且全部禁用，会回退到第一条 route。</small>
      </label>
      <label class="field">
        <span>weight</span>
        <input data-llm-dialog-field="weight" type="number" min="0.01" step="0.01" value="${escapeHtml(dialog.values.weight)}" />
        <small class="field-hint">基础流量比例。启用 route 的 weight 合计应等于 100。</small>
      </label>
    </div>
  `;
}

function renderNoAppState() {
  return `
    <section class="empty-state">
      <h3>暂无可编辑配置</h3>
      <p>先创建 App，再进入配置页。</p>
      <div>
        <a class="button button-primary" data-link="${escapeHtml(APPS_ROUTE)}" href="${escapeHtml(APPS_ROUTE)}">去添加 App</a>
      </div>
    </section>
  `;
}

async function handleAction(target) {
  const action = target.dataset.action;
  const appId = target.dataset.appId;

  if (action === "logout") {
    clearNotice();
    clearAdminSession();
    state.loginError = "";
    state.booting = false;
    await navigate(LOGIN_ROUTE);
    return;
  }

  if (action === "goto-login") {
    redirectToLogin("");
    await render();
    return;
  }

  if (action === "open-config") {
    if (appId) {
      saveSelectedAppId(appId);
      await syncRouteState(CONFIG_ROUTE);
    }
    clearNotice();
    await navigate(CONFIG_ROUTE);
    return;
  }

  if (action === "delete-app") {
    if (appId) {
      await deleteApp(appId);
    }
    return;
  }

  if (action === "reload-config") {
    await loadSelectedAppConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "view-latest-config") {
    await loadSelectedAppConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "view-config-revision") {
    const revision = Number(target.dataset.revision || 0);
    if (revision > 0) {
      await loadConfigRevision(revision);
      clearNotice();
      await render();
    }
    return;
  }

  if (action === "restore-config-revision") {
    const revision = Number(target.dataset.revision || 0);
    if (revision > 0) {
      const confirmed = window.confirm(`确认恢复到版本 R${revision} 吗？当前最新配置会保留为新版本历史。`);
      if (!confirmed) {
        return;
      }

      state.restoringRevision = String(revision);
      clearNotice();
      await render();

      try {
        const payload = await requestJson(
          `/api/v1/admin/apps/${encodeURIComponent(state.selectedAppId)}/config/revisions/${revision}/restore`,
          {
            method: "POST",
          },
        );
        state.configDocument = payload.data;
        state.editorValue = payload.data.rawJson;
        state.savedValue = payload.data.rawJson;
        state.editorError = "";
        await loadBootstrap();
        setNotice("success", `已恢复到版本 R${revision}。`);
      } catch (error) {
        setNotice("error", formatError(error));
      } finally {
        state.restoringRevision = "";
      }

      await render();
    }
    return;
  }

  if (action === "open-save-config-dialog") {
    try {
      const normalized = JSON.stringify(parseConfigText(state.editorValue), null, 2);
      const previous = parseConfigText(state.savedValue || "{}");
      const next = parseConfigText(normalized);
      state.saveDialog = {
        kind: "config",
        title: "保存配置版本",
        subtitle: "确认本次更新说明后再保存，系统已自动生成变更摘要。",
        confirmLabel: "保存新版本",
        value: buildChangeSummary(previous, next),
      };
      clearNotice();
      await render();
    } catch (error) {
      if (error instanceof Error) {
        state.editorError = error.message;
      }
      setNotice("error", formatError(error));
      pushToast("error", formatError(error));
      await render();
    }
    return;
  }

  if (action === "reload-mail") {
    await loadEmailServiceConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "switch-mail-tab") {
    state.mailTab = target.dataset.tab === "test" ? "test" : "config";
    clearNotice();
    await render();
    return;
  }

  if (action === "switch-llm-tab") {
    state.llmTab = target.dataset.tab === "config" ? "config" : "monitor";
    clearNotice();
    await render();
    return;
  }

  if (action === "reload-llm") {
    await loadLlmServiceConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "view-latest-llm") {
    await loadLlmServiceConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "view-llm-revision") {
    const revision = Number(target.dataset.revision || 0);
    if (revision > 0) {
      await loadLlmServiceRevision(revision);
      clearNotice();
      await render();
    }
    return;
  }

  if (action === "restore-llm-revision") {
    const revision = Number(target.dataset.revision || 0);
    if (revision > 0) {
      const confirmed = window.confirm(`确认恢复到版本 R${revision} 吗？当前最新 LLM 配置会保留为新版本历史。`);
      if (!confirmed) {
        return;
      }

      state.restoringLlmRevision = String(revision);
      clearNotice();
      await render();

      try {
        const payload = await requestJson(`/api/v1/admin/apps/common/llm-service/revisions/${revision}/restore`, {
          method: "POST",
        });
        state.llmDocument = payload.data;
        state.llmDraft = cloneLlmConfig(payload.data.config);
        setNotice("success", `已恢复到版本 R${revision}。`);
        pushToast("success", `已恢复到版本 R${revision}。`);
      } catch (error) {
        setNotice("error", formatError(error));
        pushToast("error", formatError(error));
      } finally {
        state.restoringLlmRevision = "";
      }

      await render();
    }
    return;
  }

  if (action === "reset-llm") {
    state.llmDraft = cloneLlmConfig(state.llmDocument?.config);
    clearNotice();
    await render();
    return;
  }

  if (action === "open-save-llm-dialog") {
    try {
      const next = serializeLlmDraft(ensureLlmDraft());
      const previous = state.llmDocument?.config ?? createDefaultLlmConfig();
      state.saveDialog = {
        kind: "llm",
        title: "保存 LLM 配置",
        subtitle: "确认本次更新说明后再保存，系统已自动生成变更摘要。",
        confirmLabel: "保存配置",
        value: buildChangeSummary(previous, next),
      };
      clearNotice();
      await render();
    } catch (error) {
      setNotice("error", formatError(error));
      pushToast("error", formatError(error));
      await render();
    }
    return;
  }

  if (action === "add-llm-provider") {
    openLlmDialog({
      kind: "provider",
      mode: "create",
      values: createEmptyLlmProvider(),
    });
    await render();
    return;
  }

  if (action === "edit-llm-provider") {
    const index = Number(target.dataset.index || -1);
    const provider = ensureLlmDraft().providers[index];
    if (provider) {
      openLlmDialog({
        kind: "provider",
        mode: "edit",
        index,
        values: { ...provider },
      });
      await render();
    }
    return;
  }

  if (action === "delete-llm-provider") {
    const index = Number(target.dataset.index || -1);
    const draft = ensureLlmDraft();
    const provider = draft.providers[index];
    if (!provider) {
      return;
    }

    const referenced = draft.models.some((model) => model.routes.some((route) => route.provider === provider.key));
    if (referenced) {
      setNotice("error", `供应商 ${provider.key} 仍被模型 route 引用，不能删除。`);
      pushToast("error", `供应商 ${provider.key} 仍被模型 route 引用，不能删除。`);
      await render();
      return;
    }

    draft.providers.splice(index, 1);
    clearNotice();
    await render();
    return;
  }

  if (action === "add-llm-model") {
    openLlmDialog({
      kind: "model",
      mode: "create",
      values: createEmptyLlmModel(),
    });
    await render();
    return;
  }

  if (action === "toggle-llm-model-collapse") {
    const collapseKey = String(target.dataset.modelCollapseKey || "");
    if (!collapseKey) {
      return;
    }

    state.llmCollapsedModelKeys[collapseKey] = !state.llmCollapsedModelKeys[collapseKey];
    if (!state.llmCollapsedModelKeys[collapseKey]) {
      delete state.llmCollapsedModelKeys[collapseKey];
    }
    await render();
    return;
  }

  if (action === "edit-llm-model") {
    const index = Number(target.dataset.index || -1);
    const model = ensureLlmDraft().models[index];
    if (model) {
      openLlmDialog({
        kind: "model",
        mode: "edit",
        index,
        values: {
          key: model.key,
          label: model.label,
          strategy: model.strategy,
        },
      });
      await render();
    }
    return;
  }

  if (action === "delete-llm-model") {
    const index = Number(target.dataset.index || -1);
    if (index >= 0) {
      ensureLlmDraft().models.splice(index, 1);
      if (state.llmDraft.defaultModelKey && !state.llmDraft.models.some((item) => item.key === state.llmDraft.defaultModelKey)) {
        state.llmDraft.defaultModelKey = state.llmDraft.models[0]?.key ?? "";
      }
    }
    clearNotice();
    await render();
    return;
  }

  if (action === "add-llm-route") {
    const modelIndex = Number(target.dataset.modelIndex || -1);
    const model = ensureLlmDraft().models[modelIndex];
    if (!model) {
      return;
    }

    if (!ensureLlmDraft().providers.length) {
      setNotice("error", "请先添加供应商，再为模型添加 route。");
      pushToast("error", "请先添加供应商，再为模型添加 route。");
      await render();
      return;
    }

    openLlmDialog({
      kind: "route",
      mode: "create",
      modelIndex,
      values: createEmptyLlmRoute(ensureLlmDraft().providers[0]?.key || ""),
    });
    await render();
    return;
  }

  if (action === "edit-llm-route") {
    const modelIndex = Number(target.dataset.modelIndex || -1);
    const routeIndex = Number(target.dataset.routeIndex || -1);
    const route = ensureLlmDraft().models[modelIndex]?.routes?.[routeIndex];
    if (route) {
      openLlmDialog({
        kind: "route",
        mode: "edit",
        modelIndex,
        routeIndex,
        values: { ...route },
      });
      await render();
    }
    return;
  }

  if (action === "delete-llm-route") {
    const modelIndex = Number(target.dataset.modelIndex || -1);
    const routeIndex = Number(target.dataset.routeIndex || -1);
    const routes = ensureLlmDraft().models[modelIndex]?.routes;
    if (Array.isArray(routes) && routeIndex >= 0) {
      routes.splice(routeIndex, 1);
    }
    clearNotice();
    await render();
    return;
  }

  if (action === "move-llm-route-up" || action === "move-llm-route-down") {
    const modelIndex = Number(target.dataset.modelIndex || -1);
    const routeIndex = Number(target.dataset.routeIndex || -1);
    const routes = ensureLlmDraft().models[modelIndex]?.routes;
    if (!Array.isArray(routes) || routeIndex < 0) {
      return;
    }

    const nextIndex = action === "move-llm-route-up" ? routeIndex - 1 : routeIndex + 1;
    if (nextIndex < 0 || nextIndex >= routes.length) {
      return;
    }

    const [item] = routes.splice(routeIndex, 1);
    routes.splice(nextIndex, 0, item);
    clearNotice();
    await render();
    return;
  }

  if (action === "change-llm-metrics-range") {
    const range = target.dataset.range || "24h";
    if (range !== state.llmMetricsRange) {
      state.llmMetricsRange = range;
      await loadLlmMetrics();
    } else {
      await render();
    }
    return;
  }

  if (action === "reload-llm-metrics") {
    await loadLlmMetrics();
    return;
  }

  if (action === "run-llm-smoke-test") {
    await runLlmSmokeTest();
    return;
  }

  if (action === "toggle-llm-smoke-details") {
    const itemKey = String(target.dataset.itemKey || "");
    if (!itemKey) {
      return;
    }

    state.llmSmokeExpandedKeys[itemKey] = !state.llmSmokeExpandedKeys[itemKey];
    if (!state.llmSmokeExpandedKeys[itemKey]) {
      delete state.llmSmokeExpandedKeys[itemKey];
    }
    await render();
    return;
  }

  if (action === "select-llm-model-metrics") {
    const modelKey = String(target.dataset.modelKey || "");
    if (modelKey) {
      state.llmSelectedModelKey = modelKey;
      await loadLlmModelMetrics(modelKey);
    }
    return;
  }

  if (action === "view-latest-mail") {
    await loadEmailServiceConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "view-mail-revision") {
    const revision = Number(target.dataset.revision || 0);
    if (revision > 0) {
      await loadEmailServiceRevision(revision);
      clearNotice();
      await render();
    }
    return;
  }

  if (action === "restore-mail-revision") {
    const revision = Number(target.dataset.revision || 0);
    if (revision > 0) {
      const confirmed = window.confirm(`确认恢复到版本 R${revision} 吗？当前最新邮件配置会保留为新版本历史。`);
      if (!confirmed) {
        return;
      }

      state.restoringMailRevision = String(revision);
      clearNotice();
      await render();

      try {
        const payload = await requestJson(
          `/api/v1/admin/apps/common/email-service/revisions/${revision}/restore`,
          {
            method: "POST",
          },
        );
        state.emailDocument = normalizeMailDocument(payload.data);
        state.mailDraft = normalizeMailDraft(payload.data?.config);
        state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft, payload.data?.config);
        setNotice("success", `已恢复到版本 R${revision}。`);
        pushToast("success", `已恢复到版本 R${revision}。`);
      } catch (error) {
        setNotice("error", formatError(error));
        pushToast("error", formatError(error));
      } finally {
        state.restoringMailRevision = "";
      }

      await render();
    }
    return;
  }

  if (action === "reset-mail") {
    clearNotice();
    state.mailDraft = cloneMailConfig(state.emailDocument?.config);
    state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft, state.emailDocument?.config);
    await render();
    return;
  }

  if (action === "add-mail-sender") {
    const regionIndex = Number(target.dataset.regionIndex || -1);
    const draft = ensureMailDraft();
    if (regionIndex >= 0 && draft.regions[regionIndex]) {
      draft.regions[regionIndex].sender = createEmptyMailSender();
      state.mailExpandedRegions[draft.regions[regionIndex].region] = true;
    }
    clearNotice();
    await render();
    return;
  }

  if (action === "open-save-mail-dialog") {
    try {
      const next = serializeMailDraft(ensureMailDraft());
      const previous = serializeMailDraft(cloneMailConfig(state.emailDocument?.config));
      state.saveDialog = {
        kind: "mail",
        title: "保存邮件服务配置",
        subtitle: "确认本次更新说明后再保存，系统已自动生成变更摘要。",
        confirmLabel: "保存配置",
        value: buildChangeSummary(previous, next),
      };
      clearNotice();
      await render();
    } catch (error) {
      setNotice("error", formatError(error));
      pushToast("error", formatError(error));
      await render();
    }
    return;
  }

  if (action === "remove-mail-sender") {
    const regionIndex = Number(target.dataset.regionIndex || -1);
    const draft = ensureMailDraft();
    if (regionIndex >= 0 && draft.regions[regionIndex]) {
      draft.regions[regionIndex].sender = null;
      state.mailExpandedRegions[draft.regions[regionIndex].region] = true;
    }
    clearNotice();
    await render();
    return;
  }

  if (action === "add-mail-template") {
    const regionIndex = Number(target.dataset.regionIndex || -1);
    const draft = ensureMailDraft();
    if (regionIndex >= 0 && draft.regions[regionIndex]) {
      draft.regions[regionIndex].templates.push(createEmptyMailTemplate());
      state.mailExpandedRegions[draft.regions[regionIndex].region] = true;
      state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft, draft);
    }
    clearNotice();
    await render();
    return;
  }

  if (action === "remove-mail-template") {
    const regionIndex = Number(target.dataset.regionIndex || -1);
    const index = Number(target.dataset.index || -1);
    const draft = ensureMailDraft();
    if (regionIndex >= 0 && index >= 0 && draft.regions[regionIndex]) {
      draft.regions[regionIndex].templates.splice(index, 1);
      state.mailExpandedRegions[draft.regions[regionIndex].region] = true;
      state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft, draft);
    }
    await render();
    return;
  }

  if (action === "send-mail-test") {
    try {
      serializeMailTestDraft(ensureMailTestDraft());
      await sendMailTest();
    } catch (error) {
      setNotice("error", formatError(error));
      pushToast("error", formatError(error));
      await render();
    }
    return;
  }

  if (action === "reload-passwords") {
    await loadPasswordConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "add-password-item") {
    ensurePasswordDraft().push(createEmptyPasswordItem());
    clearNotice();
    await render();
    return;
  }

  if (action === "remove-password-item") {
    const index = Number(target.dataset.index || -1);
    if (index < 0) {
      return;
    }

    const draft = ensurePasswordDraft();
    const item = draft[index];
    if (!item) {
      return;
    }

    const currentKey = String(item.key ?? "").trim();
    const persistedKey = String(item.originalKey ?? "").trim();
    const expectedKey = currentKey || persistedKey;
    if (!expectedKey) {
      draft.splice(index, 1);
      await render();
      return;
    }

    const confirmKey = window.prompt(`请输入要删除的 key 以确认删除：\n${expectedKey}`, "");
    if (confirmKey === null) {
      return;
    }

    if (confirmKey.trim() !== expectedKey) {
      pushToast("error", "输入的 key 不匹配，已取消删除。");
      return;
    }

    if (!persistedKey) {
      draft.splice(index, 1);
      pushToast("success", `已移除 ${expectedKey}。`);
      await render();
      return;
    }

    await deletePasswordItem(index, persistedKey, expectedKey);
    return;
  }

  if (action === "save-password-item") {
    const index = Number(target.dataset.index || -1);
    try {
      await persistPasswordItem(index);
    } catch (error) {
      pushToast("error", formatError(error));
      await render();
    }
    return;
  }

  if (action === "validate-json") {
    const parsed = parseConfigText(state.editorValue);
    const topLevelCount = Object.keys(parsed).length;
    state.editorError = "";
    setNotice("success", `JSON 有效，顶级字段 ${topLevelCount} 个。`);
    await render();
    return;
  }

  if (action === "format-json") {
    const parsed = parseConfigText(state.editorValue);
    state.editorValue = JSON.stringify(parsed, null, 2);
    state.editorError = "";
    clearNotice();
    await render();
    return;
  }

  if (action === "reset-config") {
    state.editorValue = state.savedValue;
    state.editorError = "";
    clearNotice();
    await render();
    return;
  }

  if (action === "close-save-dialog") {
    state.saveDialog = null;
    await render();
    return;
  }

  if (action === "close-llm-dialog") {
    state.llmDialog = null;
    await render();
    return;
  }

  if (action === "dismiss-toast") {
    dismissToast(target.dataset.toastId);
  }
}

async function handleFormSubmit(form) {
  if (form.dataset.form === "login") {
    const formData = new FormData(form);
    const username = String(formData.get("username") ?? "").trim();
    const password = String(formData.get("password") ?? "");

    if (!username || !password) {
      state.loginError = "请输入用户名和密码。";
      await render();
      return;
    }

    state.loginBusy = true;
    state.loginError = "";
    clearNotice();
    await render();

    try {
      const authorization = createBasicAuthorization(username, password);
      const payload = await requestJson("/api/v1/admin/bootstrap", {
        headers: {
          Authorization: authorization,
        },
      });

      saveAdminSession({
        username: payload.data.adminUser,
        authorization,
      });

      state.adminUser = payload.data.adminUser;
      state.apps = payload.data.apps ?? [];
      state.booting = false;

      if (!state.apps.some((item) => item.appId === state.selectedAppId)) {
        const defaultApp = state.apps.find((item) => item.appId === runtimeConfig.defaultAppId);
        saveSelectedAppId(defaultApp?.appId || state.apps[0]?.appId || "");
      }

      await syncRouteState(APPS_ROUTE);
      await navigate(APPS_ROUTE);
      return;
    } catch (error) {
      state.loginError = "用户名或密码错误。";
    } finally {
      state.loginBusy = false;
    }

    await render();
    return;
  }

  if (form.dataset.form === "create-app") {
    const formData = new FormData(form);
    const appId = String(formData.get("appId") ?? "").trim();
    const appName = String(formData.get("appName") ?? "").trim();

    if (!appId) {
      setNotice("error", "请输入 App ID。");
      await render();
      return;
    }

    state.creatingApp = true;
    clearNotice();
    await render();

    try {
      const payload = await requestJson("/api/v1/admin/apps", {
        method: "POST",
        body: {
          appId,
          appName: appName || undefined,
        },
      });

      await loadBootstrap();
      saveSelectedAppId(payload.data.appId);
      await loadSelectedAppConfig();
      form.reset();
      setNotice("success", "App 已添加。");
      await navigate(CONFIG_ROUTE);
      return;
    } catch (error) {
      setNotice("error", formatError(error));
    } finally {
      state.creatingApp = false;
    }

    await render();
    return;
  }

  if (form.dataset.form === "save-dialog") {
    if (!state.saveDialog) {
      return;
    }

    if (state.saveDialog.kind === "config") {
      await persistConfig(state.saveDialog.value);
      return;
    }

    if (state.saveDialog.kind === "mail") {
      await persistMailConfig(state.saveDialog.value);
      return;
    }

    if (state.saveDialog.kind === "llm") {
      await persistLlmConfig(state.saveDialog.value);
    }

    return;
  }

  if (form.dataset.form === "llm-editor-dialog") {
    await submitLlmDialog();
  }
}

async function deleteApp(appId) {
  const app = state.apps.find((item) => item.appId === appId);
  if (!app) {
    return;
  }

  const confirmed = window.confirm(`确认删除 ${app.appName} (${app.appId})？`);
  if (!confirmed) {
    return;
  }

  state.deletingAppId = appId;
  clearNotice();
  await render();

  try {
    await requestJson(`/api/v1/admin/apps/${encodeURIComponent(appId)}`, {
      method: "DELETE",
    });

    const deletedCurrentApp = state.selectedAppId === appId;
    await loadBootstrap();
    if (deletedCurrentApp) {
      saveSelectedAppId(state.apps[0]?.appId || "");
    }
    await syncRouteState(deletedCurrentApp ? APPS_ROUTE : currentPath());
    setNotice("success", "App 已删除。");
  } catch (error) {
    setNotice("error", formatError(error));
  } finally {
    state.deletingAppId = "";
  }

  await render();
}

async function handleAppSwitch(nextAppId) {
  if (!nextAppId || nextAppId === state.selectedAppId) {
    return;
  }

  saveSelectedAppId(nextAppId);
  clearNotice();
  await loadSelectedAppConfig();
  await render();
}

async function handleWorkspaceSwitch(nextValue) {
  if (!nextValue) {
    return;
  }

  if (nextValue === COMMON_WORKSPACE_VALUE) {
    clearNotice();
    if (!isCommonWorkspacePath(currentPath())) {
      await navigate(APPS_ROUTE);
      return;
    }
    await render();
    return;
  }

  if (nextValue !== state.selectedAppId) {
    saveSelectedAppId(nextValue);
    clearNotice();
    await loadSelectedAppConfig();
  }

  if (currentPath() !== CONFIG_ROUTE) {
    await navigate(CONFIG_ROUTE);
    return;
  }

  await render();
}

async function syncRouteState(path) {
  if (!state.session) {
    return;
  }

  if (path === LOGIN_ROUTE) {
    return;
  }

  if (path === MAIL_ROUTE) {
    await loadEmailServiceConfig(false);
    return;
  }

  if (path === PASSWORD_ROUTE) {
    await loadPasswordConfig(false);
    return;
  }

  if (path === LLM_ROUTE) {
    await loadLlmPageData(false);
    return;
  }

  if (path === CONFIG_ROUTE) {
    await loadSelectedAppConfig(false);
  }
}

async function loadBootstrap() {
  if (!state.session) {
    return;
  }

  state.loadingBootstrap = true;

  try {
    const payload = await requestJson("/api/v1/admin/bootstrap");
    state.adminUser = payload.data.adminUser;
    state.apps = payload.data.apps ?? [];

    if (!state.apps.some((item) => item.appId === state.selectedAppId)) {
      const defaultApp = state.apps.find((item) => item.appId === runtimeConfig.defaultAppId);
      saveSelectedAppId(defaultApp?.appId || state.apps[0]?.appId || "");
    }
  } finally {
    state.loadingBootstrap = false;
  }
}

async function loadSelectedAppConfig(showIntermediateRender = true) {
  if (!state.selectedAppId) {
    state.configDocument = null;
    state.editorValue = "";
    state.savedValue = "";
    state.configDesc = "";
    state.loadingConfig = false;
    return;
  }

  state.loadingConfig = true;
  state.editorError = "";
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson(`/api/v1/admin/apps/${encodeURIComponent(state.selectedAppId)}/config`);
    state.configDocument = payload.data;
    state.editorValue = payload.data.rawJson;
    state.savedValue = payload.data.rawJson;
    state.configDesc = "";
  } finally {
    state.loadingConfig = false;
  }
}

async function loadConfigRevision(revision, showIntermediateRender = true) {
  if (!state.selectedAppId || !revision) {
    return;
  }

  state.loadingConfig = true;
  state.editorError = "";
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson(
      `/api/v1/admin/apps/${encodeURIComponent(state.selectedAppId)}/config/revisions/${revision}`,
    );
    state.configDocument = payload.data;
    state.editorValue = payload.data.rawJson;
    state.savedValue = payload.data.rawJson;
    state.configDesc = "";
  } finally {
    state.loadingConfig = false;
  }
}

async function loadEmailServiceConfig(showIntermediateRender = true) {
  state.loadingMail = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/email-service");
    state.emailDocument = normalizeMailDocument(payload.data);
    state.mailDraft = normalizeMailDraft(payload.data?.config);
    state.mailExpandedRegions = {};
    state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft, payload.data?.config);
  } finally {
    state.loadingMail = false;
  }
}

async function loadEmailServiceRevision(revision, showIntermediateRender = true) {
  state.loadingMail = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson(`/api/v1/admin/apps/common/email-service/revisions/${revision}`);
    state.emailDocument = normalizeMailDocument(payload.data);
    state.mailDraft = normalizeMailDraft(payload.data?.config);
    state.mailExpandedRegions = {};
    state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft, payload.data?.config);
  } finally {
    state.loadingMail = false;
  }
}

async function loadPasswordConfig(showIntermediateRender = true) {
  state.loadingPasswords = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/passwords");
    state.passwordDocument = normalizePasswordDocument(payload.data);
    state.passwordDraft = normalizePasswordDraft(payload.data?.items);
  } finally {
    state.loadingPasswords = false;
  }
}

async function loadLlmPageData(showIntermediateRender = true) {
  state.loadingLlm = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    await Promise.all([
      loadLlmServiceConfig(false),
      loadLlmMetrics(false),
    ]);
  } finally {
    state.loadingLlm = false;
  }
}

async function loadLlmServiceConfig(showIntermediateRender = true) {
  state.loadingLlm = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/llm-service");
    state.llmDocument = payload.data;
    state.llmDraft = cloneLlmConfig(payload.data.config);
    if (!state.llmSelectedModelKey) {
      state.llmSelectedModelKey = payload.data.config.defaultModelKey || payload.data.config.models[0]?.key || "";
    }
  } finally {
    state.loadingLlm = false;
  }
}

async function loadLlmServiceRevision(revision, showIntermediateRender = true) {
  state.loadingLlm = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson(`/api/v1/admin/apps/common/llm-service/revisions/${revision}`);
    state.llmDocument = payload.data;
    state.llmDraft = cloneLlmConfig(payload.data.config);
  } finally {
    state.loadingLlm = false;
  }
}

async function loadLlmMetrics(showIntermediateRender = true) {
  state.loadingLlmMetrics = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson(`/api/v1/admin/apps/common/llm-service/metrics?range=${encodeURIComponent(state.llmMetricsRange)}`);
    state.llmMetricsDocument = payload.data;
    const nextModelKey =
      state.llmSelectedModelKey && payload.data.models.some((item) => item.modelKey === state.llmSelectedModelKey)
        ? state.llmSelectedModelKey
        : payload.data.models[0]?.modelKey || "";
    state.llmSelectedModelKey = nextModelKey;
    if (nextModelKey) {
      await loadLlmModelMetrics(nextModelKey, false);
    } else {
      state.llmModelMetricsDocument = null;
    }
  } finally {
    state.loadingLlmMetrics = false;
  }

  if (showIntermediateRender) {
    await render();
  }
}

async function loadLlmModelMetrics(modelKey, showIntermediateRender = true) {
  if (!modelKey) {
    state.llmModelMetricsDocument = null;
    return;
  }

  state.loadingLlmMetrics = true;
  if (showIntermediateRender) {
    await render();
  }

  try {
    const payload = await requestJson(
      `/api/v1/admin/apps/common/llm-service/metrics/models/${encodeURIComponent(modelKey)}?range=${encodeURIComponent(state.llmMetricsRange)}`,
    );
    state.llmModelMetricsDocument = payload.data;
  } finally {
    state.loadingLlmMetrics = false;
  }

  if (showIntermediateRender) {
    await render();
  }
}

async function runLlmSmokeTest() {
  state.runningLlmSmokeTest = true;
  clearNotice();
  await render();

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/llm-service/smoke-test", {
      method: "POST",
    });
    state.llmSmokeTestDocument = payload.data;
    state.llmSmokeExpandedKeys = {};
    setNotice(
      "success",
      `冒烟测试完成：成功 ${payload.data.summary.successCount}，失败 ${payload.data.summary.failureCount}，跳过 ${payload.data.summary.skippedCount}。`,
    );
    pushToast(
      "success",
      `冒烟测试完成：成功 ${payload.data.summary.successCount}，失败 ${payload.data.summary.failureCount}。`,
    );
  } catch (error) {
    setNotice("error", formatError(error));
    pushToast("error", formatError(error));
  } finally {
    state.runningLlmSmokeTest = false;
  }

  await render();
}

async function sendMailTest() {
  state.sendingMailTest = true;
  clearNotice();
  await render();

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/email-service/test-send", {
      method: "POST",
      body: serializeMailTestDraft(ensureMailTestDraft()),
    });
    state.mailTestResult = {
      status: "success",
      data: payload.data,
    };
    setNotice("success", `测试邮件已发送到 ${payload.data.recipientEmail}。`);
    pushToast("success", `测试邮件已发送到 ${payload.data.recipientEmail}。`);
  } catch (error) {
    state.mailTestResult = {
      status: "error",
      message: formatError(error),
      code: error?.code || "",
      data: error?.data ?? null,
    };
    setNotice("error", formatError(error));
    pushToast("error", formatError(error));
  } finally {
    state.sendingMailTest = false;
  }

  await render();
}

async function persistConfig(desc) {
  if (!state.selectedAppId) {
    setNotice("error", "请先选择一个 App。");
    pushToast("error", "请先选择一个 App。");
    await render();
    return;
  }

  state.busy = true;
  state.editorError = "";
  clearNotice();
  await render();

  try {
    const parsed = parseConfigText(state.editorValue);
    const normalized = JSON.stringify(parsed, null, 2);
    const payload = await requestJson(`/api/v1/admin/apps/${encodeURIComponent(state.selectedAppId)}/config`, {
      method: "PUT",
      body: {
        rawJson: normalized,
        desc: desc?.trim() || undefined,
      },
    });

    state.configDocument = payload.data;
    state.editorValue = payload.data.rawJson;
    state.savedValue = payload.data.rawJson;
    state.editorError = "";
    state.saveDialog = null;
    await loadBootstrap();
    setNotice("success", "配置已保存。");
    pushToast("success", "配置已保存。");
  } catch (error) {
    if (error && error.code === "ADMIN_CONFIG_INVALID_JSON") {
      state.editorError = error.message;
    }
    setNotice("error", formatError(error));
    pushToast("error", formatError(error));
  } finally {
    state.busy = false;
  }

  await render();
}

async function persistMailConfig(desc) {
  state.savingMail = true;
  clearNotice();
  await render();

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/email-service", {
      method: "PUT",
      body: {
        ...serializeMailDraft(ensureMailDraft()),
        desc: desc?.trim() || undefined,
      },
    });

    state.emailDocument = normalizeMailDocument(payload.data);
    state.mailDraft = normalizeMailDraft(payload.data?.config);
    state.mailExpandedRegions = {};
    state.saveDialog = null;
    setNotice("success", "邮件服务已保存。");
    pushToast("success", "邮件服务已保存。");
  } catch (error) {
    setNotice("error", formatError(error));
    pushToast("error", formatError(error));
  } finally {
    state.savingMail = false;
  }

  await render();
}

async function persistPasswordItem(index) {
  const draft = ensurePasswordDraft();
  const item = draft[index];
  if (!item) {
    return;
  }

  const body = serializePasswordItem(item, index);
  state.savingPasswords = true;
  clearNotice();
  await render();

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/passwords/item", {
      method: "PUT",
      body,
    });

    state.passwordDocument = normalizePasswordDocument(payload.data);
    const savedItem = normalizePasswordDraft(payload.data?.items).find((entry) => entry.key === body.key);
    draft[index] = savedItem ?? {
      ...item,
      originalKey: body.key,
      key: body.key,
      desc: body.desc,
      value: item.value,
    };
    pushToast("success", `${body.key} 已保存。`);
  } catch (error) {
    pushToast("error", formatError(error));
  } finally {
    state.savingPasswords = false;
  }

  await render();
}

async function deletePasswordItem(index, persistedKey, displayKey) {
  const draft = ensurePasswordDraft();
  state.savingPasswords = true;
  clearNotice();
  await render();

  try {
    const payload = await requestJson(`/api/v1/admin/apps/common/passwords/${encodeURIComponent(persistedKey)}`, {
      method: "DELETE",
    });

    state.passwordDocument = normalizePasswordDocument(payload.data);
    draft.splice(index, 1);
    pushToast("success", `${displayKey} 已删除。`);
  } catch (error) {
    pushToast("error", formatError(error));
  } finally {
    state.savingPasswords = false;
  }

  await render();
}

async function persistLlmConfig(desc) {
  state.savingLlm = true;
  clearNotice();
  await render();

  try {
    const payload = await requestJson("/api/v1/admin/apps/common/llm-service", {
      method: "PUT",
      body: {
        ...serializeLlmDraft(ensureLlmDraft()),
        desc: desc?.trim() || undefined,
      },
    });

    state.llmDocument = payload.data;
    state.llmDraft = cloneLlmConfig(payload.data.config);
    state.saveDialog = null;
    setNotice("success", "LLM 配置已保存。");
    pushToast("success", "LLM 配置已保存。");
    await loadLlmMetrics(false);
  } catch (error) {
    setNotice("error", formatError(error));
    pushToast("error", formatError(error));
  } finally {
    state.savingLlm = false;
  }

  await render();
}

function createDefaultMailConfig() {
  return {
    enabled: false,
    regions: MAIL_SENDER_REGION_OPTIONS.map((option) => createEmptyMailRegion(option.value)),
  };
}

function createDefaultMailTestDraft() {
  return {
    recipientEmail: "",
    region: MAIL_SENDER_REGION_OPTIONS[0].value,
    templateId: "",
    appName: "Zook",
    code: "123456",
    expireMinutes: 10,
  };
}

function cloneMailConfig(config = createDefaultMailConfig()) {
  const sourceRegions = Array.isArray(config?.regions) ? config.regions : [];
  return {
    enabled: Boolean(config?.enabled),
    regions: MAIL_SENDER_REGION_OPTIONS.map((option) => {
      const source = sourceRegions.find((item) => item?.region === option.value);
      return {
        region: option.value,
        sender: source?.sender
          ? {
              id: String(source.sender?.id ?? ""),
              address: String(source.sender?.address ?? ""),
            }
          : null,
        templates: Array.isArray(source?.templates)
          ? source.templates.map((item) => ({
              locale: String(item?.locale ?? MAIL_TEMPLATE_LOCALE_OPTIONS[0].value),
              templateId: item?.templateId == null ? "" : String(item.templateId),
              name: String(item?.name ?? ""),
              subject: String(item?.subject ?? ""),
            }))
          : [],
      };
    }),
  };
}

function ensureMailDraft() {
  if (!state.mailDraft) {
    state.mailDraft = cloneMailConfig(state.emailDocument?.config);
  }

  return state.mailDraft;
}

function ensureMailTestDraft(config = ensureMailDraft()) {
  state.mailTestDraft = normalizeMailTestDraft(state.mailTestDraft ?? createDefaultMailTestDraft(), config);
  return state.mailTestDraft;
}

function createEmptyMailSender() {
  return {
    id: "",
    address: "",
  };
}

function createEmptyMailRegion(region) {
  return {
    region,
    sender: null,
    templates: [],
  };
}

function createEmptyMailTemplate() {
  return {
    locale: MAIL_TEMPLATE_LOCALE_OPTIONS[0].value,
    templateId: "",
    name: "",
    subject: "",
  };
}

function isMailDraftControl(target) {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement
  ) && Boolean(target.dataset.mailField || target.dataset.mailList || target.dataset.mailRegionField);
}

function isMailTestDraftControl(target) {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement
  ) && Boolean(target.dataset.mailTestField);
}

function handleMailDraftChange(target) {
  const draft = ensureMailDraft();

  if (target.dataset.mailField) {
    const key = target.dataset.mailField;
    draft[key] = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
    return;
  }

  const regionField = target.dataset.mailRegionField;
  if (regionField === "sender") {
    const regionIndex = Number(target.dataset.regionIndex || -1);
    const key = target.dataset.key;
    if (regionIndex < 0 || !key || !draft.regions[regionIndex]) {
      return;
    }

    state.mailExpandedRegions[draft.regions[regionIndex].region] = true;
    const nextSender = draft.regions[regionIndex].sender ?? createEmptyMailSender();
    nextSender[key] = target.value;
    draft.regions[regionIndex].sender = nextSender;
    return;
  }

  const listName = target.dataset.mailList;
  const regionIndex = Number(target.dataset.regionIndex || -1);
  const index = Number(target.dataset.index || -1);
  const key = target.dataset.key;
  if (!listName || index < 0 || !key || regionIndex < 0) {
    return;
  }

  const regionConfig = draft.regions[regionIndex];
  if (!regionConfig) {
    return;
  }

  state.mailExpandedRegions[regionConfig.region] = true;
  const list = regionConfig[listName];
  if (!Array.isArray(list) || !list[index]) {
    return;
  }

  list[index][key] = target.value;
}

function handleMailTestDraftChange(target) {
  const draft = ensureMailTestDraft();
  const key = target.dataset.mailTestField;
  if (!key) {
    return;
  }

  if (key === "region") {
    draft.region = target.value;
    state.mailTestDraft = normalizeMailTestDraft(draft, ensureMailDraft());
    return;
  }

  if (target instanceof HTMLInputElement && target.type === "number") {
    draft[key] = target.value;
    return;
  }

  draft[key] = target.value;
}

function serializeMailDraft(draft) {
  return {
    enabled: Boolean(draft.enabled),
    regions: draft.regions.map((regionConfig, regionIndex) => {
      const region = String(regionConfig?.region ?? MAIL_SENDER_REGION_OPTIONS[regionIndex]?.value ?? "").trim();
      const senderId = String(regionConfig?.sender?.id ?? "").trim();
      const senderAddress = String(regionConfig?.sender?.address ?? "").trim();

      let sender = null;
      if (senderId || senderAddress) {
        if (!senderId || !senderAddress) {
          throw new Error(`请完整填写 ${renderMailRegionLabel(region)} 的发件地址。`);
        }
        if (!isValidSenderAddress(senderAddress)) {
          throw new Error(`${renderMailRegionLabel(region)} 的发件地址格式不正确。`);
        }
        sender = {
          id: senderId,
          address: senderAddress,
        };
      }

      const templates = [];
      for (const [templateIndex, item] of (Array.isArray(regionConfig?.templates) ? regionConfig.templates : []).entries()) {
        const locale = String(item?.locale ?? "").trim();
        const templateIdText = String(item?.templateId ?? "").trim();
        const name = String(item?.name ?? "").trim();
        const subject = String(item?.subject ?? "").trim();
        if (!templateIdText && !name && !subject) {
          continue;
        }
        if (!locale || !templateIdText || !name || !subject) {
          throw new Error(`请完整填写 ${renderMailRegionLabel(region)} 的第 ${templateIndex + 1} 个模板。`);
        }

        const templateId = Number(templateIdText);
        if (!Number.isInteger(templateId) || templateId <= 0) {
          throw new Error(`${renderMailRegionLabel(region)} 的第 ${templateIndex + 1} 个模板 ID 必须是正整数。`);
        }

        templates.push({
          locale,
          templateId,
          name,
          subject,
        });
      }

      return {
        region,
        sender,
        templates,
      };
    }),
  };
}

function serializeMailTestDraft(draft) {
  const recipientEmail = String(draft?.recipientEmail ?? "").trim();
  const region = String(draft?.region ?? "").trim();
  const templateIdText = String(draft?.templateId ?? "").trim();
  const appName = String(draft?.appName ?? "").trim();
  const code = String(draft?.code ?? "").trim();
  const expireMinutesText = String(draft?.expireMinutes ?? "").trim();

  if (!recipientEmail) {
    throw new Error("请填写测试邮件的收件邮箱。");
  }

  if (!isValidSenderAddress(recipientEmail) || recipientEmail.includes("<")) {
    throw new Error("测试邮件的收件邮箱格式不正确。");
  }

  if (!region) {
    throw new Error("请选择发信 Region。");
  }

  if (!templateIdText) {
    throw new Error("请选择模板 ID。");
  }

  const templateId = Number(templateIdText);
  if (!Number.isInteger(templateId) || templateId <= 0) {
    throw new Error("模板 ID 必须是正整数。");
  }

  if (!appName) {
    throw new Error("请填写 App 名称。");
  }

  if (!code) {
    throw new Error("请填写验证码。");
  }

  const expireMinutes = Number(expireMinutesText);
  if (!Number.isInteger(expireMinutes) || expireMinutes <= 0 || expireMinutes > 120) {
    throw new Error("过期分钟必须是 1 到 120 之间的整数。");
  }

  return {
    recipientEmail,
    region,
    templateId,
    appName,
    code,
    expireMinutes,
  };
}

function serializeMailDraftForPreview(draft) {
  try {
    return serializeMailDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft?.enabled),
      regions: Array.isArray(draft?.regions) ? draft.regions : createDefaultMailConfig().regions,
    };
  }
}

function getMailRegionConfig(config, region) {
  const normalizedConfig = normalizeMailDraft(config);
  return normalizedConfig.regions.find((item) => item.region === region) || normalizedConfig.regions[0] || createEmptyMailRegion(MAIL_SENDER_REGION_OPTIONS[0].value);
}

function createDefaultPasswordConfig() {
  return [];
}

function clonePasswordConfig(items = createDefaultPasswordConfig()) {
  return Array.isArray(items)
    ? items.map((item) => ({
        originalKey: String(item?.originalKey ?? item?.key ?? ""),
        key: String(item?.key ?? ""),
        desc: String(item?.desc ?? ""),
        value: String(item?.value ?? ""),
        valueMd5: item?.valueMd5 ? String(item.valueMd5) : "",
        updatedAt: item?.updatedAt ? String(item.updatedAt) : undefined,
      }))
    : [];
}

function ensurePasswordDraft() {
  if (!state.passwordDraft) {
    state.passwordDraft = clonePasswordConfig(state.passwordDocument?.items);
  }

  return state.passwordDraft;
}

function createEmptyPasswordItem() {
  return {
    originalKey: "",
    key: "",
    desc: "",
    value: "",
  };
}

function isPasswordDraftControl(target) {
  return target instanceof HTMLInputElement && Boolean(target.dataset.passwordField);
}

function handlePasswordDraftChange(target) {
  const draft = ensurePasswordDraft();
  const index = Number(target.dataset.index || -1);
  const key = target.dataset.passwordField;

  if (index < 0 || !key || !draft[index]) {
    return;
  }

  draft[index][key] = target.value;
}

function hasUnsavedPasswordChanges() {
  try {
    const current = JSON.stringify(serializePasswordDraft(ensurePasswordDraft()));
    const saved = JSON.stringify(serializePasswordDraft(clonePasswordConfig(state.passwordDocument?.items)));
    return current !== saved;
  } catch {
    return true;
  }
}

function serializePasswordDraft(draft) {
  const items = [];

  for (const [index, item] of draft.entries()) {
    const key = String(item?.key ?? "").trim();
    const desc = String(item?.desc ?? "").trim();
    const value = typeof item?.value === "string" ? item.value : "";

    if (!key && !desc && !value) {
      continue;
    }

    if (!key || !value) {
      throw new Error(`请完整填写第 ${index + 1} 个密码项。`);
    }

    items.push({ key, desc, value });
  }

  return items;
}

function serializePasswordItem(item, index) {
  if (!item || typeof item !== "object") {
    throw new Error(`第 ${index + 1} 个密码项无效。`);
  }

  const key = String(item.key ?? "").trim();
  const desc = String(item.desc ?? "").trim();
  const value = typeof item.value === "string" ? item.value : "";
  const originalKey = String(item.originalKey ?? "").trim();

  if (!key || !value) {
    throw new Error(`请完整填写第 ${index + 1} 个密码项。`);
  }

  return {
    originalKey: originalKey || undefined,
    key,
    desc,
    value,
  };
}

function serializePasswordDraftForPreview(draft) {
  try {
    return { items: serializePasswordDraft(draft) };
  } catch {
    return { items: Array.isArray(draft) ? draft : [] };
  }
}

function clearMaskedPasswordValue(input) {
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.dataset.passwordField !== "value" || input.dataset.passwordMasked !== "true") {
    return;
  }

  input.value = "";
  input.dataset.passwordMasked = "false";
  handlePasswordDraftChange(input);
}

function restoreMaskedPasswordValue(input) {
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  if (input.dataset.passwordField !== "value") {
    return;
  }

  const originalValue = input.dataset.passwordOriginalValue ?? "";
  if (!originalValue || input.value !== "") {
    return;
  }

  input.value = originalValue;
  input.dataset.passwordMasked = "true";
  handlePasswordDraftChange(input);
}

function createDefaultLlmConfig() {
  return {
    enabled: false,
    defaultModelKey: "",
    providers: [],
    models: [],
  };
}

function cloneLlmConfig(config = createDefaultLlmConfig()) {
  return {
    enabled: Boolean(config?.enabled),
    defaultModelKey: String(config?.defaultModelKey ?? ""),
    providers: Array.isArray(config?.providers)
      ? config.providers.map((item) => ({
          key: String(item?.key ?? ""),
          label: String(item?.label ?? ""),
          enabled: Boolean(item?.enabled),
          baseUrl: String(item?.baseUrl ?? ""),
          apiKey: String(item?.apiKey ?? ""),
          timeoutMs: item?.timeoutMs == null ? "30000" : String(item.timeoutMs),
        }))
      : [],
    models: Array.isArray(config?.models)
      ? config.models.map((item) => ({
          key: String(item?.key ?? ""),
          label: String(item?.label ?? ""),
          strategy: item?.strategy === "fixed" ? "fixed" : "auto",
          routes: Array.isArray(item?.routes)
            ? item.routes.map((route) => ({
                provider: String(route?.provider ?? ""),
                providerModel: String(route?.providerModel ?? ""),
                enabled: Boolean(route?.enabled),
                weight: route?.weight == null ? "0" : String(route.weight),
              }))
            : [],
        }))
      : [],
  };
}

function ensureLlmDraft() {
  if (!state.llmDraft) {
    state.llmDraft = cloneLlmConfig(state.llmDocument?.config);
  }

  return state.llmDraft;
}

function createEmptyLlmProvider() {
  return {
    key: "",
    label: "",
    enabled: true,
    baseUrl: "",
    apiKey: "",
    timeoutMs: "30000",
  };
}

function createEmptyLlmModel() {
  return {
    key: "",
    label: "",
    strategy: "auto",
    routes: [],
  };
}

function createEmptyLlmRoute(defaultProvider = "") {
  return {
    provider: defaultProvider,
    providerModel: "",
    enabled: true,
    weight: "100",
  };
}

function isLlmDraftControl(target) {
  return (
    target instanceof HTMLInputElement || target instanceof HTMLSelectElement
  ) && Boolean(target.dataset.llmField);
}

function handleLlmDraftChange(target) {
  const draft = ensureLlmDraft();
  const key = target.dataset.llmField;
  if (!key) {
    return;
  }

  draft[key] = target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
}

function isLlmDialogControl(target) {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  ) && Boolean(target.dataset.llmDialogField);
}

function handleLlmDialogChange(target) {
  if (!state.llmDialog) {
    return;
  }

  const key = target.dataset.llmDialogField;
  if (!key) {
    return;
  }

  state.llmDialog.error = "";
  state.llmDialog.values[key] =
    target instanceof HTMLInputElement && target.type === "checkbox" ? target.checked : target.value;
}

function serializeLlmDraft(draft) {
  const providers = draft.providers.map((item, index) => {
    const key = String(item?.key ?? "").trim();
    const label = String(item?.label ?? "").trim();
    const baseUrl = String(item?.baseUrl ?? "").trim().replace(/\/+$/, "");
    const apiKey = String(item?.apiKey ?? "").trim();
    const timeoutMs = Number(String(item?.timeoutMs ?? "").trim() || "0");

    if (!key || !label || !baseUrl) {
      throw new Error(`请完整填写第 ${index + 1} 个供应商。`);
    }

    if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
      throw new Error(`第 ${index + 1} 个供应商 key 格式不正确。`);
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`第 ${index + 1} 个供应商 timeoutMs 必须是正数。`);
    }

    if (item.enabled && !apiKey) {
      throw new Error(`第 ${index + 1} 个供应商启用时必须填写 apiKey。`);
    }

    return {
      key,
      label,
      enabled: Boolean(item.enabled),
      baseUrl,
      apiKey,
      timeoutMs: Math.round(timeoutMs),
    };
  });

  assertUniqueValues(
    providers.map((item) => item.key),
    "供应商 key 不允许重复。",
  );

  const providerKeys = new Set(providers.map((item) => item.key));
  const models = draft.models.map((item, index) => {
    const key = String(item?.key ?? "").trim();
    const label = String(item?.label ?? "").trim();
    const strategy = item?.strategy === "fixed" ? "fixed" : "auto";

    if (!key || !label) {
      throw new Error(`请完整填写第 ${index + 1} 个模型。`);
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
      throw new Error(`第 ${index + 1} 个模型 key 格式不正确。`);
    }

    const routes = item.routes.map((route, routeIndex) => {
      const provider = String(route?.provider ?? "").trim();
      const providerModel = String(route?.providerModel ?? "").trim();
      const weight = Number(String(route?.weight ?? "").trim());

      if (!provider || !providerModel) {
        throw new Error(`请完整填写模型 ${key} 的第 ${routeIndex + 1} 条 route。`);
      }

      if (!providerKeys.has(provider)) {
        throw new Error(`模型 ${key} 的第 ${routeIndex + 1} 条 route 引用了不存在的供应商 ${provider}。`);
      }

      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`模型 ${key} 的第 ${routeIndex + 1} 条 route weight 必须是正数。`);
      }

      if (Math.abs(weight - Math.round(weight * 100) / 100) > 0.000001) {
        throw new Error(`模型 ${key} 的第 ${routeIndex + 1} 条 route weight 最多保留两位小数。`);
      }

      return {
        provider,
        providerModel,
        enabled: Boolean(route.enabled),
        weight: Math.round(weight * 100) / 100,
      };
    });

    if (!routes.length) {
      throw new Error(`模型 ${key} 至少要有一条 route。`);
    }

    const enabledRoutes = routes.filter((route) => route.enabled);
    if (enabledRoutes.length) {
      const totalWeight = enabledRoutes.reduce((sum, route) => sum + route.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new Error(`模型 ${key} 当前启用 route 的 weight 合计必须等于 100。`);
      }
    }

    return {
      key,
      label,
      strategy,
      routes,
    };
  });

  assertUniqueValues(
    models.map((item) => item.key),
    "模型 key 不允许重复。",
  );

  const defaultModelKey = String(draft.defaultModelKey ?? "").trim();
  if (draft.enabled) {
    if (!defaultModelKey) {
      throw new Error("启用 LLM 服务时，必须选择默认模型。");
    }
    if (!models.some((item) => item.key === defaultModelKey)) {
      throw new Error("默认模型必须引用现有模型。");
    }
  }

  return {
    enabled: Boolean(draft.enabled),
    defaultModelKey,
    providers,
    models,
  };
}

function serializeLlmDraftForPreview(draft) {
  try {
    return serializeLlmDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft?.enabled),
      defaultModelKey: String(draft?.defaultModelKey ?? ""),
      providers: Array.isArray(draft?.providers) ? draft.providers : [],
      models: Array.isArray(draft?.models) ? draft.models : [],
    };
  }
}

function getLlmDraftValidation(draft) {
  const errors = [];

  try {
    serializeLlmDraft(draft);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "LLM 配置不合法。");
  }

  return {
    errors,
  };
}

function hasUnsavedLlmChanges() {
  const current = serializeLlmDraftForPreview(ensureLlmDraft());
  const saved = state.llmDocument?.config ?? createDefaultLlmConfig();
  return JSON.stringify(current) !== JSON.stringify(saved);
}

function isViewingHistoricalLlmConfig() {
  return Boolean(state.llmDocument && state.llmDocument.isLatest === false);
}

function createEmptyLlmSummary() {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 100,
    avgFirstByteLatencyMs: 0,
    avgTotalLatencyMs: 0,
    p95FirstByteLatencyMs: 0,
    p95TotalLatencyMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

function createEmptyLlmSmokeSummary() {
  return {
    totalCount: 0,
    attemptedCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    successRate: 0,
  };
}

function assertUniqueValues(values, message) {
  const seen = new Set();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(message);
    }
    seen.add(value);
  }
}

function openLlmDialog(options) {
  const kindLabel = options.kind === "provider" ? "供应商" : options.kind === "model" ? "模型" : "Route";
  state.llmDialog = {
    kind: options.kind,
    mode: options.mode,
    index: options.index ?? -1,
    modelIndex: options.modelIndex ?? -1,
    routeIndex: options.routeIndex ?? -1,
    title: `${options.mode === "create" ? "添加" : "编辑"}${kindLabel}`,
    subtitle:
      options.kind === "provider"
        ? "这里配置供应商连接信息，字段说明会直接显示在输入框下方。"
        : options.kind === "model"
          ? "这里配置逻辑模型 key、展示名称和路由策略。"
          : "这里配置某个逻辑模型下的一条具体 route。",
    confirmLabel: options.mode === "create" ? "确认添加" : "保存修改",
    values: { ...options.values },
    error: "",
  };
}

async function submitLlmDialog() {
  if (!state.llmDialog) {
    return;
  }

  const dialog = state.llmDialog;
  const draft = ensureLlmDraft();

  try {
    if (dialog.kind === "provider") {
      const normalized = normalizeLlmProviderDialogValues(dialog.values);
      if (dialog.mode === "create") {
        draft.providers.push(normalized);
      } else {
        const previousKey = draft.providers[dialog.index]?.key;
        draft.providers[dialog.index] = normalized;
        if (previousKey && previousKey !== normalized.key) {
          draft.models.forEach((model) => {
            model.routes.forEach((route) => {
              if (route.provider === previousKey) {
                route.provider = normalized.key;
              }
            });
          });
        }
      }
    } else if (dialog.kind === "model") {
      const normalized = normalizeLlmModelDialogValues(dialog.values);
      if (dialog.mode === "create") {
        draft.models.push({
          ...normalized,
          routes: [],
        });
        if (!draft.defaultModelKey) {
          draft.defaultModelKey = normalized.key;
        }
      } else {
        const previousKey = draft.models[dialog.index]?.key;
        const existingRoutes = draft.models[dialog.index]?.routes ?? [];
        draft.models[dialog.index] = {
          ...normalized,
          routes: existingRoutes,
        };
        if (draft.defaultModelKey === previousKey) {
          draft.defaultModelKey = normalized.key;
        }
      }
    } else {
      const normalized = normalizeLlmRouteDialogValues(dialog.values);
      const routes = draft.models[dialog.modelIndex]?.routes;
      if (!Array.isArray(routes)) {
        throw new Error("找不到目标模型，无法保存 route。");
      }

      if (dialog.mode === "create") {
        routes.push(normalized);
      } else {
        routes[dialog.routeIndex] = normalized;
      }
    }

    state.llmDialog = null;
    clearNotice();
    await render();
  } catch (error) {
    state.llmDialog.error = error instanceof Error ? error.message : "保存失败，请检查输入内容。";
    await render();
  }
}

function normalizeLlmProviderDialogValues(values) {
  const key = String(values.key ?? "").trim();
  const label = String(values.label ?? "").trim();
  const baseUrl = String(values.baseUrl ?? "").trim();
  const apiKey = String(values.apiKey ?? "").trim();
  const timeoutMs = String(values.timeoutMs ?? "").trim();

  if (!key || !label || !baseUrl) {
    throw new Error("请完整填写供应商的 key、label 和 baseUrl。");
  }

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
    throw new Error("供应商 key 只允许小写字母、数字、下划线或中划线。");
  }

  if (!timeoutMs || Number(timeoutMs) <= 0) {
    throw new Error("timeoutMs 必须是正整数。");
  }

  return {
    key,
    label,
    enabled: Boolean(values.enabled),
    baseUrl,
    apiKey,
    timeoutMs,
  };
}

function normalizeLlmModelDialogValues(values) {
  const key = String(values.key ?? "").trim();
  const label = String(values.label ?? "").trim();
  const strategy = values.strategy === "fixed" ? "fixed" : "auto";

  if (!key || !label) {
    throw new Error("请完整填写模型的 key 和 label。");
  }

  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
    throw new Error("模型 key 格式不正确。");
  }

  return {
    key,
    label,
    strategy,
  };
}

function normalizeLlmRouteDialogValues(values) {
  const provider = String(values.provider ?? "").trim();
  const providerModel = String(values.providerModel ?? "").trim();
  const weight = String(values.weight ?? "").trim();

  if (!provider || !providerModel) {
    throw new Error("请完整填写 route 的 provider 和 providerModel。");
  }

  if (!weight || Number(weight) <= 0) {
    throw new Error("route 的 weight 必须是正数。");
  }

  return {
    provider,
    providerModel,
    enabled: Boolean(values.enabled),
    weight,
  };
}

function isValidSenderAddress(value) {
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) || /^[^<>]+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>$/.test(value);
}

function buildChangeSummary(previousValue, nextValue) {
  const changes = [];
  collectObjectDiff(previousValue, nextValue, "", changes, 10);

  if (!changes.length) {
    return "更新配置";
  }

  const lines = changes.slice(0, 10).map(
    (item) => `${item.path}: ${formatDiffValue(item.before)} -> ${formatDiffValue(item.after)}`,
  );

  if (changes.length > 10) {
    lines.push(`等 ${changes.length} 项变更`);
  }

  return lines.join("；");
}

function collectObjectDiff(previousValue, nextValue, path, changes, maxItems) {
  if (changes.length > maxItems) {
    return;
  }

  if (isPlainObject(previousValue) && isPlainObject(nextValue)) {
    const keys = new Set([...Object.keys(previousValue), ...Object.keys(nextValue)]);
    Array.from(keys)
      .sort()
      .forEach((key) => {
        collectObjectDiff(previousValue[key], nextValue[key], path ? `${path}.${key}` : key, changes, maxItems);
      });
    return;
  }

  if (isSameValue(previousValue, nextValue)) {
    return;
  }

  changes.push({
    path: path || "(root)",
    before: previousValue,
    after: nextValue,
  });
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function formatDiffValue(value) {
  if (value === undefined) {
    return "∅";
  }

  if (typeof value === "string") {
    return shortenText(`'${value}'`, 42);
  }

  return shortenText(JSON.stringify(value), 42);
}

function shortenText(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 1)}…`;
}

function parseConfigText(rawText) {
  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(formatJsonParseError(rawText, error));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置根节点必须是 JSON object。");
  }

  return parsed;
}

function formatJsonParseError(rawText, error) {
  const message = error instanceof Error ? error.message : "请输入合法的 JSON。";
  const positionMatch = /position\s+(\d+)/i.exec(message);
  if (!positionMatch) {
    return "请输入合法的 JSON。";
  }

  const position = Number(positionMatch[1]);
  if (!Number.isInteger(position) || position < 0) {
    return "请输入合法的 JSON。";
  }

  const { line, column } = getJsonLineColumn(rawText, position);
  return `JSON 语法错误：第 ${line} 行，第 ${column} 列。`;
}

function getJsonLineColumn(text, position) {
  const normalized = text.slice(0, position);
  const lines = normalized.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1].length + 1,
  };
}

function syncJsonEditorDecorations() {
  const shells = appRoot.querySelectorAll(".json-editor-shell");
  shells.forEach((shell) => {
    const textarea = shell.querySelector('textarea[name="configJson"]');
    const highlight = shell.querySelector(".json-editor-highlight");
    if (!(textarea instanceof HTMLTextAreaElement) || !(highlight instanceof HTMLElement)) {
      return;
    }

    const placeholder = textarea.dataset.jsonPlaceholder || "";
    highlight.innerHTML = renderHighlightedJson(textarea.value, placeholder);
    highlight.scrollTop = textarea.scrollTop;
    highlight.scrollLeft = textarea.scrollLeft;

    textarea.onscroll = () => {
      highlight.scrollTop = textarea.scrollTop;
      highlight.scrollLeft = textarea.scrollLeft;
    };
  });
}

function renderHighlightedJson(rawText, placeholder = "") {
  if (!rawText) {
    return `<span class="json-placeholder">${escapeHtml(placeholder)}</span>`;
  }

  const tokenPattern = /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b/g;
  let cursor = 0;
  let html = "";
  let match;

  while ((match = tokenPattern.exec(rawText))) {
    html += renderJsonPlain(rawText.slice(cursor, match.index));
    const token = match[0];
    const nextSource = rawText.slice(match.index + token.length);
    let tokenClass = "string";

    if (token.startsWith('"')) {
      tokenClass = /^\s*:/.test(nextSource) ? "key" : "string";
    } else if (token === "true" || token === "false") {
      tokenClass = "boolean";
    } else if (token === "null") {
      tokenClass = "null";
    } else {
      tokenClass = "number";
    }

    html += `<span class="json-token-${tokenClass}">${escapeHtml(token)}</span>`;
    cursor = match.index + token.length;
  }

  html += renderJsonPlain(rawText.slice(cursor));
  return html;
}

function renderJsonPlain(segment) {
  return escapeHtml(segment).replace(/([{}\[\],:])/g, '<span class="json-token-punctuation">$1</span>');
}

async function requestJson(path, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = new Headers({
    Accept: "application/json",
  });

  Object.entries(headers).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      requestHeaders.set(key, value);
    }
  });

  if (body !== undefined) {
    requestHeaders.set("Content-Type", "application/json");
  }

  if (!requestHeaders.has("Authorization") && state.session?.authorization) {
    requestHeaders.set("Authorization", state.session.authorization);
  }

  const response = await fetch(path, {
    method,
    headers: requestHeaders,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    if (shouldRedirectToLogin(response, payload)) {
      redirectToLogin(payload?.message || "登录已失效，请重新登录。");
      await render();
    }

    const error = new Error(payload?.message || `Request failed with status ${response.status}`);
    error.statusCode = response.status;
    error.code = payload?.code;
    error.data = payload?.data ?? null;
    throw error;
  }

  return payload;
}

function shouldRedirectToLogin(response, payload) {
  if (response.status === 401) {
    return true;
  }

  if (payload?.code === "ADMIN_BASIC_AUTH_REQUIRED") {
    return true;
  }

  const message = String(payload?.message ?? "").toLowerCase();
  return message.includes("admin basic authentication is required");
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

function createBasicAuthorization(username, password) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function syncDocumentTitle(path) {
  const base = runtimeConfig.brandName || "Zook Admin";
  const label =
    path === LOGIN_ROUTE
      ? "登录"
      : path === APPS_ROUTE
        ? "应用管理"
        : path === MAIL_ROUTE
          ? "邮件服务"
          : path === LLM_ROUTE
            ? "LLM"
            : "配置管理";
  document.title = `${label} | ${base}`;
}

function formatError(error) {
  if (!error) {
    return "发生了未知错误。";
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
