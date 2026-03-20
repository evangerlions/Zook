const runtimeConfig = window.__ADMIN_RUNTIME_CONFIG__ ?? {};
const STORAGE_KEYS = {
  selectedAppId: "zook.admin.selectedAppId",
};

const APPS_ROUTE = "/apps";
const CONFIG_ROUTE = "/config";
const MAIL_ROUTE = "/mail";
const COMMON_APP_ID = "common";
const KNOWN_ROUTES = new Set([APPS_ROUTE, CONFIG_ROUTE, MAIL_ROUTE]);

const appRoot = document.getElementById("app");

const state = {
  busy: false,
  creatingApp: false,
  deletingAppId: "",
  savingMail: false,
  loadingBootstrap: true,
  loadingConfig: false,
  loadingMail: false,
  notice: null,
  adminUser: "",
  apps: [],
  selectedAppId: loadSelectedAppId(),
  configDocument: null,
  emailDocument: null,
  editorValue: "",
  savedValue: "",
  editorError: "",
};

window.addEventListener("popstate", () => {
  syncRouteState(ensureKnownRoute()).then(render).catch(handleUnexpectedError);
});

appRoot.addEventListener("click", (event) => {
  const target = event.target.closest("[data-link], [data-action]");
  if (!target) {
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
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.name === "selectedAppId") {
    handleAppSwitch(target.value).catch(handleUnexpectedError);
    return;
  }

  if (target.name === "mailRegionMode") {
    render().catch(handleUnexpectedError);
  }
});

appRoot.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (target.name === "configJson") {
    state.editorValue = target.value;
    state.editorError = "";
    syncDirtyState();
  }
});

boot().catch(handleUnexpectedError);

async function boot() {
  await render();
  await loadBootstrap();
  await syncRouteState(ensureKnownRoute());
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

function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function ensureKnownRoute() {
  const path = currentPath();
  if (KNOWN_ROUTES.has(path)) {
    return path;
  }

  const fallback = state.selectedAppId ? CONFIG_ROUTE : APPS_ROUTE;
  window.history.replaceState({}, "", fallback);
  return fallback;
}

async function navigate(path) {
  const nextPath = KNOWN_ROUTES.has(path) ? path : CONFIG_ROUTE;
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

function handleUnexpectedError(error) {
  console.error(error);
  setNotice("error", formatError(error));
  render().catch(console.error);
}

function selectedApp() {
  return state.apps.find((item) => item.appId === state.selectedAppId) ?? null;
}

function hasUnsavedChanges() {
  return state.editorValue !== state.savedValue;
}

function syncDirtyState() {
  const editor = appRoot.querySelector('textarea[name="configJson"]');
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }

  editor.dataset.dirty = hasUnsavedChanges() ? "true" : "false";
}

async function render() {
  const path = ensureKnownRoute();
  syncDocumentTitle(path);
  appRoot.innerHTML = renderConsole(path);
  syncDirtyState();
}

function renderConsole(path) {
  const app = selectedApp();
  const brandName = runtimeConfig.brandName || "Zook Admin";
  const disableAppSelect = state.loadingBootstrap || state.apps.length === 0 || path === MAIL_ROUTE;

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

        <section class="workspace-brief">
          <span class="sidebar-label">当前工作区</span>
          <strong>${escapeHtml(app?.appName || "未选择 App")}</strong>
          <span>${escapeHtml(app?.appCode || "请选择 App")}</span>
        </section>

        <nav class="sidebar-nav" aria-label="主导航">
          ${renderNavItem(APPS_ROUTE, path, "应用")}
          ${renderNavItem(CONFIG_ROUTE, path, "配置")}
          ${renderNavItem(MAIL_ROUTE, path, "邮件服务")}
        </nav>
      </aside>

      <div class="main-shell">
        <header class="topbar">
          <div class="topbar-bar">
            <div class="topbar-brand">
              <strong>${escapeHtml(brandName)}</strong>
              <span>配置管理</span>
            </div>

            <div class="topbar-controls">
              <label class="select-inline">
                <span>App</span>
                <select name="selectedAppId" ${disableAppSelect ? "disabled" : ""}>
                  ${renderAppOptions()}
                </select>
              </label>

              <nav class="topbar-links" aria-label="外部工具">
                <a href="${escapeHtml(runtimeConfig.analyticsUrl || "https://analytics.youwoai.net")}" target="_blank" rel="noreferrer">Analytics</a>
                <a href="${escapeHtml(runtimeConfig.logsUrl || "https://log.youwoai.net")}" target="_blank" rel="noreferrer">Logs</a>
              </nav>

              <div class="user-chip">
                <span class="user-avatar" aria-hidden="true">${escapeHtml((state.adminUser || "A").slice(0, 1).toUpperCase())}</span>
                <strong>${escapeHtml(state.adminUser || "—")}</strong>
              </div>
            </div>
          </div>
        </header>

        <main class="content-shell">
          ${renderNotice()}
          ${renderContent(path)}
        </main>
      </div>
    </div>
  `;
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

function renderAppOptions() {
  if (state.loadingBootstrap) {
    return '<option value="">加载中...</option>';
  }

  if (state.apps.length === 0) {
    return '<option value="">暂无 App</option>';
  }

  return state.apps
    .map(
      (app) => `
        <option value="${escapeHtml(app.appId)}" ${app.appId === state.selectedAppId ? "selected" : ""}>
          ${escapeHtml(`${app.appName} · ${app.appCode}`)}
        </option>
      `,
    )
    .join("");
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  return `
    <section class="notice" data-tone="${escapeHtml(state.notice.tone || "info")}" role="status" aria-live="polite">
      <p>${escapeHtml(state.notice.text)}</p>
    </section>
  `;
}

function renderContent(path) {
  if (state.loadingBootstrap) {
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

  return renderConfigPage();
}

function renderAppsPage() {
  return `
    <section class="page-shell">
      <header class="page-header">
        <div>
          <h1 class="page-title">应用</h1>
        </div>
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
  const deleteLabel = app.appId === COMMON_APP_ID ? "保留" : app.canDelete ? "可删除" : "需先清空配置";

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
          ${
            app.appId === COMMON_APP_ID
              ? `<button class="button button-secondary" type="button" data-link="${escapeHtml(MAIL_ROUTE)}">邮件</button>`
              : `
                <button
                  class="button button-danger"
                  type="button"
                  data-action="delete-app"
                  data-app-id="${escapeHtml(app.appId)}"
                  ${!app.canDelete || isDeleting ? "disabled" : ""}
                >
                  ${isDeleting ? "删除中..." : "删除"}
                </button>
              `
          }
        </div>
      </td>
    </tr>
  `;
}

function renderConfigPage() {
  if (state.apps.length === 0 || !state.selectedAppId) {
    return renderNoAppState();
  }

  const app = selectedApp();
  const updatedAt = state.configDocument?.updatedAt ? formatTimestamp(state.configDocument.updatedAt) : "未保存";

  return `
    <section class="page-shell">
      <header class="page-header">
        <div>
          <h1 class="page-title">配置</h1>
          <p class="page-subtitle">${escapeHtml(app?.appName || "")} · ${escapeHtml(app?.appCode || "")}</p>
        </div>
        <div class="page-actions">
          <span class="meta-chip">${escapeHtml(updatedAt)}</span>
          <span class="meta-chip">${hasUnsavedChanges() ? "未保存" : "已保存"}</span>
        </div>
      </header>

      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">JSON</h2>
          <div class="panel-actions">
            <button class="button button-secondary" type="button" data-action="reload-config" ${state.loadingConfig ? "disabled" : ""}>读取</button>
            <button class="button button-secondary" type="button" data-action="validate-json" ${state.loadingConfig ? "disabled" : ""}>校验</button>
            <button class="button button-secondary" type="button" data-action="format-json" ${state.loadingConfig ? "disabled" : ""}>格式化</button>
          </div>
        </div>

        <form class="editor-form" data-form="save-config">
          <textarea
            id="config-json"
            name="configJson"
            class="json-editor"
            spellcheck="false"
            placeholder='{\n  "featureFlags": {},\n  "settings": {}\n}'
            ${state.loadingConfig ? "disabled" : ""}
          >${escapeHtml(state.editorValue)}</textarea>
          ${state.editorError ? `<p class="editor-error" role="alert">${escapeHtml(state.editorError)}</p>` : ""}
          <div class="form-footer">
            <button class="button button-ghost" type="button" data-action="reset-config" ${!hasUnsavedChanges() || state.loadingConfig ? "disabled" : ""}>恢复</button>
            <button class="button button-primary" type="submit" ${state.busy || state.loadingConfig ? "disabled" : ""}>
              ${state.busy ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </section>
    </section>
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

  const config = state.emailDocument?.config ?? createDefaultMailConfig();
  const updatedAt = state.emailDocument?.updatedAt ? formatTimestamp(state.emailDocument.updatedAt) : "未保存";

  return `
    <section class="page-shell">
      <header class="page-header">
        <div>
          <h1 class="page-title">邮件服务</h1>
          <p class="page-subtitle">Common</p>
        </div>
        <div class="page-actions">
          <span class="meta-chip">${escapeHtml(updatedAt)}</span>
          <span class="meta-chip">${escapeHtml(state.emailDocument?.resolvedRegion || "ap-guangzhou")}</span>
        </div>
      </header>

      <section class="panel">
        <div class="panel-header">
          <h2 class="panel-title">腾讯 SES</h2>
          <div class="panel-actions">
            <button class="button button-secondary" type="button" data-action="reload-mail" ${state.loadingMail ? "disabled" : ""}>读取</button>
          </div>
        </div>

        <form class="stack-form" data-form="save-mail">
          <div class="form-grid form-grid-wide">
            <label class="field field-checkbox">
              <span>启用</span>
              <input name="enabled" type="checkbox" ${config.enabled ? "checked" : ""} ${state.savingMail ? "disabled" : ""} />
            </label>
            <label class="field">
              <span>Region</span>
              <select name="mailRegionMode" ${state.savingMail ? "disabled" : ""}>
                <option value="auto" ${config.regionMode === "auto" ? "selected" : ""}>自动</option>
                <option value="manual" ${config.regionMode === "manual" ? "selected" : ""}>手动</option>
              </select>
            </label>
            ${
              config.regionMode === "manual"
                ? `
                  <label class="field">
                    <span>手动地域</span>
                    <select name="manualRegion" ${state.savingMail ? "disabled" : ""}>
                      <option value="ap-guangzhou" ${config.manualRegion === "ap-guangzhou" ? "selected" : ""}>ap-guangzhou</option>
                      <option value="ap-hongkong" ${config.manualRegion === "ap-hongkong" ? "selected" : ""}>ap-hongkong</option>
                    </select>
                  </label>
                `
                : ""
            }
          </div>

          <div class="form-grid">
            <label class="field">
              <span>SecretId</span>
              <input name="secretId" type="text" value="${escapeHtml(config.secretId)}" autocomplete="off" ${state.savingMail ? "disabled" : ""} />
            </label>
            <label class="field">
              <span>SecretKey</span>
              <input name="secretKey" type="password" value="${escapeHtml(config.secretKey)}" autocomplete="off" ${state.savingMail ? "disabled" : ""} />
            </label>
          </div>

          <div class="form-grid">
            <label class="field">
              <span>发件人</span>
              <input name="fromEmailAddress" type="text" value="${escapeHtml(config.fromEmailAddress)}" autocomplete="off" ${state.savingMail ? "disabled" : ""} />
            </label>
            <label class="field">
              <span>回复地址</span>
              <input name="replyToAddresses" type="text" value="${escapeHtml(config.replyToAddresses || "")}" autocomplete="off" ${state.savingMail ? "disabled" : ""} />
            </label>
          </div>

          <div class="form-grid">
            <label class="field">
              <span>主题</span>
              <input name="verificationSubject" type="text" value="${escapeHtml(config.verification.subject)}" autocomplete="off" ${state.savingMail ? "disabled" : ""} />
            </label>
            <label class="field">
              <span>模板 ID</span>
              <input name="verificationTemplateId" type="number" min="0" step="1" value="${escapeHtml(config.verification.templateId)}" ${state.savingMail ? "disabled" : ""} />
            </label>
          </div>

          <div class="form-grid">
            <label class="field">
              <span>模板变量</span>
              <input name="verificationTemplateDataKey" type="text" value="${escapeHtml(config.verification.templateDataKey)}" autocomplete="off" ${state.savingMail ? "disabled" : ""} />
            </label>
            <label class="field">
              <span>TriggerType</span>
              <select name="verificationTriggerType" ${state.savingMail ? "disabled" : ""}>
                <option value="1" ${config.verification.triggerType === 1 ? "selected" : ""}>1</option>
                <option value="0" ${config.verification.triggerType === 0 ? "selected" : ""}>0</option>
              </select>
            </label>
          </div>

          <div class="form-footer">
            <button class="button button-ghost" type="button" data-action="reset-mail" ${state.savingMail ? "disabled" : ""}>恢复</button>
            <button class="button button-primary" type="submit" ${state.savingMail ? "disabled" : ""}>
              ${state.savingMail ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </section>
    </section>
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
    if (!appId) {
      return;
    }

    await deleteApp(appId);
    return;
  }

  if (action === "reload-config") {
    await loadSelectedAppConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "reload-mail") {
    await loadEmailServiceConfig();
    clearNotice();
    await render();
    return;
  }

  if (action === "reset-mail") {
    clearNotice();
    await loadEmailServiceConfig();
    await render();
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
  }
}

async function handleFormSubmit(form) {
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

  if (form.dataset.form === "save-config") {
    if (!state.selectedAppId) {
      setNotice("error", "请先选择一个 App。");
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
        },
      });

      state.configDocument = payload.data;
      state.editorValue = payload.data.rawJson;
      state.savedValue = payload.data.rawJson;
      state.editorError = "";
      await loadBootstrap();
      setNotice("success", "配置已保存。");
    } catch (error) {
      if (error && error.code === "ADMIN_CONFIG_INVALID_JSON") {
        state.editorError = error.message;
      }
      setNotice("error", formatError(error));
    } finally {
      state.busy = false;
    }

    await render();
    return;
  }

  if (form.dataset.form === "save-mail") {
    const formData = new FormData(form);
    const regionMode = String(formData.get("mailRegionMode") ?? "auto");

    state.savingMail = true;
    clearNotice();
    await render();

    try {
      const payload = await requestJson("/api/v1/admin/apps/common/email-service", {
        method: "PUT",
        body: {
          enabled: formData.get("enabled") === "on",
          provider: "tencent_ses",
          regionMode,
          manualRegion: regionMode === "manual" ? String(formData.get("manualRegion") ?? "") : undefined,
          secretId: String(formData.get("secretId") ?? "").trim(),
          secretKey: String(formData.get("secretKey") ?? "").trim(),
          fromEmailAddress: String(formData.get("fromEmailAddress") ?? "").trim(),
          replyToAddresses: String(formData.get("replyToAddresses") ?? "").trim(),
          verification: {
            subject: String(formData.get("verificationSubject") ?? "").trim(),
            templateId: Number(formData.get("verificationTemplateId") ?? 0),
            templateDataKey: String(formData.get("verificationTemplateDataKey") ?? "").trim(),
            triggerType: Number(formData.get("verificationTriggerType") ?? 1) === 0 ? 0 : 1,
          },
        },
      });

      state.emailDocument = payload.data;
      setNotice("success", "邮件服务已保存。");
    } catch (error) {
      setNotice("error", formatError(error));
    } finally {
      state.savingMail = false;
    }

    await render();
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
  if (!nextAppId || nextAppId === state.selectedAppId || currentPath() === MAIL_ROUTE) {
    return;
  }

  saveSelectedAppId(nextAppId);
  clearNotice();
  await loadSelectedAppConfig();
  await render();
}

async function syncRouteState(path) {
  if (path === MAIL_ROUTE) {
    if (state.selectedAppId !== COMMON_APP_ID) {
      saveSelectedAppId(COMMON_APP_ID);
    }
    await loadEmailServiceConfig(false);
    return;
  }

  if (path === CONFIG_ROUTE) {
    await loadSelectedAppConfig(false);
    return;
  }
}

async function loadBootstrap() {
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
    state.emailDocument = payload.data;
  } finally {
    state.loadingMail = false;
  }
}

function createDefaultMailConfig() {
  return {
    enabled: false,
    provider: "tencent_ses",
    regionMode: "auto",
    manualRegion: "ap-guangzhou",
    secretId: "",
    secretKey: "",
    fromEmailAddress: "",
    replyToAddresses: "",
    verification: {
      subject: "",
      templateId: 0,
      templateDataKey: "code",
      triggerType: 1,
    },
  };
}

function parseConfigText(rawText) {
  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("请输入合法的 JSON。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置根节点必须是 JSON object。");
  }

  return parsed;
}

async function requestJson(path, { method = "GET", body } = {}) {
  const headers = new Headers({
    Accept: "application/json",
  });

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponsePayload(response);

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
  const label = path === APPS_ROUTE ? "应用管理" : path === MAIL_ROUTE ? "邮件服务" : "配置管理";
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
