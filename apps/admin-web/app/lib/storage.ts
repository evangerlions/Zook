const SELECTED_APP_KEY = "zook.admin.selectedAppId";
const SIDEBAR_COLLAPSED_KEY = "zook.admin.sidebarCollapsed";

export function loadSelectedAppId(): string {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(SELECTED_APP_KEY) ?? "";
}

export function saveSelectedAppId(appId: string): void {
  if (typeof window === "undefined") {
    return;
  }

  if (appId) {
    window.localStorage.setItem(SELECTED_APP_KEY, appId);
    return;
  }

  window.localStorage.removeItem(SELECTED_APP_KEY);
}

export function loadSidebarCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1";
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") {
    return;
  }

  if (collapsed) {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, "1");
    return;
  }

  window.localStorage.removeItem(SIDEBAR_COLLAPSED_KEY);
}
