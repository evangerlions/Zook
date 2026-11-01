import type {AdminBootstrapResult} from "./types";
import {adminPath,requestJson} from "./admin-api-client.ts";
export const adminAuthApi={
  login(username: string, password: string) {
    return requestJson<AdminBootstrapResult & { sessionExpiresAt?: string }>(
      adminPath("/auth/login"),
      {
        method: "POST",
        body: { username, password },
      },
    );
  },
  logout() {
    return requestJson<{ loggedOut: true }>(adminPath("/auth/logout"), {
      method: "POST",
    });
  },
  bootstrap() {
    return requestJson<AdminBootstrapResult>(adminPath("/bootstrap"));
  },
};
