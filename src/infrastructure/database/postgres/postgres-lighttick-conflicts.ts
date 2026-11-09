import { ApplicationError } from "../../../shared/errors.ts";
export function versionConflict(resourceId: string): never {
  throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource version is stale.", { resourceId });
}
