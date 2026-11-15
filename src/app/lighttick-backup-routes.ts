import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
export async function handleBackupRequest(
  rt: LightTickRuntime,
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const p = r.path.replace("/api/v1/lighttick/backups", "");
  if (!r.path.startsWith("/api/v1/lighttick/backups")) return;
  const s = rt.backups;
  if (!s)
    throw new ApplicationError(
      503,
      "LIGHTTICK_BACKUP_UNAVAILABLE",
      "账户备份暂不可用。",
    );
  const key =
    r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  const full = () => rt.scopePolicy.assertFull();
  if (!p && r.method === "GET") return { items: await s.list(o) };
  if (p === "/export" && r.method === "POST") {
    if (!r.body || Array.isArray(r.body) || typeof r.body !== "object" || Object.keys(r.body).length)
      throw new ApplicationError(
        422,
        "REQ_INVALID_BODY",
        "Export body must be empty.",
      );
    return s.export(o, key, authorize);
  }
  if (p === "/preflight" && r.method === "POST")
    return s.preview(o, key, r.body, authorize, full);
  if (p === "/restore" && r.method === "POST")
    return s.restore(o, key, r.body as any, authorize, full);
  const m = p.match(/^\/([a-f0-9-]{36})$/);
  if (m && r.method === "GET") return s.download(o, m[1]);
  if (m && r.method === "DELETE") return s.remove(o, m[1], authorize);
}
