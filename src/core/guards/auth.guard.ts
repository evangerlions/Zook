import { unauthorized } from "../../shared/errors.ts";
import type { HttpRequest } from "../../shared/types.ts";
import { getHeader } from "../../shared/utils.ts";
import { TokenService } from "../../modules/auth/token.service.ts";

/**
 * AuthGuard enforces the single Bearer authentication path.
 */
export class AuthGuard {
  constructor(private readonly tokenService: TokenService) {}

  canActivate(request: HttpRequest, now = new Date()) {
    const authorization = getHeader(request.headers, "authorization");
    if (!authorization?.startsWith("Bearer ")) {
      unauthorized("AUTH_BEARER_REQUIRED", "Authorization header must use Bearer tokens.");
    }

    const auth = this.tokenService.verifyAccessToken(authorization.slice(7), now);
    request.auth = auth;
    return auth;
  }
}
