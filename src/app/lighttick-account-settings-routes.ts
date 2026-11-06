import { handlePersonalModelRequest } from "./lighttick-personal-model-routes.ts";
import { handleGitHubRequest } from "./lighttick-github-routes.ts";
import type { PersonalModelService } from "../modules/lighttick/personal-model/personal-model.service.ts";
import type { GitHubService } from "../modules/lighttick/github/github.service.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
export async function handleAccountSettingsRequest(
  runtime: { personalModel?: PersonalModelService; github?: GitHubService },
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
) {
  if (
    request.path === "/api/v1/lighttick/account/github" ||
    request.path.startsWith("/api/v1/lighttick/account/github/")
  )
    return handleGitHubRequest(runtime, owner, request, authorize);
  return handlePersonalModelRequest(runtime, owner, request, authorize);
}
