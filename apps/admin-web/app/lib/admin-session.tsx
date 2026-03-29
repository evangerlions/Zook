import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLocation, useNavigate } from "react-router";

import { ADMIN_AUTH_REQUIRED_EVENT, adminApi, isAdminAuthError } from "./admin-api";
import { formatApiError, makeNotice } from "./format";
import { getRuntimeConfig } from "./runtime-config";
import { loadSelectedAppId, saveSelectedAppId } from "./storage";
import type { AdminAppSummary, NoticeState, RuntimeConfig } from "./types";

interface AdminSessionContextValue {
  adminUser: string;
  apps: AdminAppSummary[];
  selectedAppId: string;
  bootstrapped: boolean;
  loadingBootstrap: boolean;
  authenticating: boolean;
  runtimeConfig: RuntimeConfig;
  notice: NoticeState | null;
  setNotice: (notice: NoticeState | null) => void;
  clearNotice: () => void;
  setSelectedAppId: (appId: string) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: (message?: string) => Promise<void>;
  reloadBootstrap: () => Promise<void>;
}

const AdminSessionContext = createContext<AdminSessionContextValue | null>(null);

function resolveNextSelectedAppId(currentAppId: string, apps: AdminAppSummary[], defaultAppId: string): string {
  if (currentAppId && apps.some((item) => item.appId === currentAppId)) {
    return currentAppId;
  }

  const defaultApp = apps.find((item) => item.appId === defaultAppId);
  return defaultApp?.appId ?? apps[0]?.appId ?? "";
}

export function AdminSessionProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const runtimeConfig = getRuntimeConfig();

  const [adminUser, setAdminUser] = useState("");
  const [apps, setApps] = useState<AdminAppSummary[]>([]);
  const [selectedAppId, setSelectedAppIdState] = useState(() => loadSelectedAppId());
  const [bootstrapped, setBootstrapped] = useState(false);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [authenticating, setAuthenticating] = useState(false);
  const [notice, setNotice] = useState<NoticeState | null>(null);

  const clearNotice = useCallback(() => {
    setNotice(null);
  }, []);

  const redirectToLogin = useCallback((message = "登录已失效，请重新登录。") => {
    setAdminUser("");
    setApps([]);
    startTransition(() => {
      saveSelectedAppId("");
      setSelectedAppIdState("");
    });
    setNotice(makeNotice("error", message));
    if (location.pathname !== "/login") {
      navigate("/login", { replace: true });
    }
  }, [location.pathname, navigate]);

  const applyBootstrap = useCallback((nextAdminUser: string, nextApps: AdminAppSummary[]) => {
    setAdminUser(nextAdminUser);
    setApps(nextApps);
    const nextSelectedAppId = resolveNextSelectedAppId(
      loadSelectedAppId() || selectedAppId,
      nextApps,
      runtimeConfig.defaultAppId,
    );
    saveSelectedAppId(nextSelectedAppId);
    setSelectedAppIdState(nextSelectedAppId);
  }, [runtimeConfig.defaultAppId, selectedAppId]);

  const reloadBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    try {
      const payload = await adminApi.bootstrap();
      applyBootstrap(payload.adminUser, payload.apps ?? []);
      setBootstrapped(true);
    } catch (error) {
      if (isAdminAuthError(error)) {
        redirectToLogin("登录已失效，请重新登录。");
      } else {
        setNotice(makeNotice("error", formatApiError(error)));
      }
    } finally {
      setLoadingBootstrap(false);
    }
  }, [applyBootstrap, redirectToLogin]);

  const login = useCallback(async (username: string, password: string) => {
    setAuthenticating(true);
    clearNotice();
    try {
      const payload = await adminApi.login(username, password);
      applyBootstrap(payload.adminUser, payload.apps ?? []);
      setBootstrapped(true);
      navigate("/apps", { replace: true });
    } finally {
      setAuthenticating(false);
    }
  }, [applyBootstrap, clearNotice, navigate]);

  const logout = useCallback(async (message = "已退出登录。") => {
    try {
      await adminApi.logout();
    } catch {
      // Ignore logout response errors and clear local session anyway.
    }

    setAdminUser("");
    setApps([]);
    saveSelectedAppId("");
    setSelectedAppIdState("");
    setNotice(makeNotice("info", message));
    navigate("/login", { replace: true });
  }, [navigate]);

  const setSelectedAppId = useCallback((appId: string) => {
    startTransition(() => {
      saveSelectedAppId(appId);
      setSelectedAppIdState(appId);
    });
  }, []);

  useEffect(() => {
    const handleAuthRequired = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      redirectToLogin(detail?.message ?? "登录已失效，请重新登录。");
    };

    window.addEventListener(ADMIN_AUTH_REQUIRED_EVENT, handleAuthRequired);
    return () => {
      window.removeEventListener(ADMIN_AUTH_REQUIRED_EVENT, handleAuthRequired);
    };
  }, [redirectToLogin]);

  useEffect(() => {
    void reloadBootstrap();
  }, [reloadBootstrap]);

  const value = useMemo<AdminSessionContextValue>(() => ({
    adminUser,
    apps,
    selectedAppId,
    bootstrapped,
    loadingBootstrap,
    authenticating,
    runtimeConfig,
    notice,
    setNotice,
    clearNotice,
    setSelectedAppId,
    login,
    logout,
    reloadBootstrap,
  }), [
    adminUser,
    apps,
    selectedAppId,
    bootstrapped,
    loadingBootstrap,
    authenticating,
    runtimeConfig,
    notice,
    clearNotice,
    setSelectedAppId,
    login,
    logout,
    reloadBootstrap,
  ]);

  return (
    <AdminSessionContext.Provider value={value}>
      {children}
    </AdminSessionContext.Provider>
  );
}

export function useAdminSession() {
  const context = useContext(AdminSessionContext);
  if (!context) {
    throw new Error("useAdminSession must be used inside AdminSessionProvider.");
  }

  return context;
}
