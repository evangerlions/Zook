import { Navigate } from "react-router";

import { AppShell } from "../components/app-shell";
import { useAdminSession } from "../lib/admin-session";

export default function ConsoleLayoutRoute() {
  const { adminUser, bootstrapped, loadingBootstrap } = useAdminSession();

  if (!bootstrapped || loadingBootstrap) {
    return (
      <main className="page-loading-shell">
        <div className="loading-panel">
          <p>正在载入后台控制台...</p>
        </div>
      </main>
    );
  }

  if (!adminUser) {
    return <Navigate replace to="/login" />;
  }

  return <AppShell />;
}
