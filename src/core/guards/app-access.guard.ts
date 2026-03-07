import { forbidden } from "../../shared/errors.ts";

/**
 * AppAccessGuard keeps all protected operations inside the authenticated app scope.
 */
export class AppAccessGuard {
  assertScope(requestedAppId: string, tokenAppId: string): void {
    if (requestedAppId !== tokenAppId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Requested app scope does not match the access token.");
    }
  }
}
