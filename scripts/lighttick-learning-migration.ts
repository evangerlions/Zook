import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { readLearningManifest } from "../src/modules/lighttick/learning/learning-migration.manifest.ts";
import {
  digest,
  identity,
  integer,
} from "../src/modules/lighttick/learning/native-learning.validation.ts";
/** No database access. Remote execution uses the existing admin cookie and sensitive grant. */
export async function runLearningMigration(
  args: string[],
  fetcher: typeof fetch = fetch,
) {
  const options = new Map<string, string>();
  let apply = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--apply") {
      if (apply) throw Error("Duplicate --apply");
      apply = true;
      continue;
    }
    if (
      ![
        "--bundle",
        "--endpoint",
        "--cookie-file",
        "--expected-digest",
        "--action",
        "--base-revision",
        "--request-id",
      ].includes(args[i]) ||
      options.has(args[i]) ||
      !args[i + 1] ||
      args[i + 1].startsWith("--")
    )
      throw Error("Unknown, duplicate or incomplete migration argument");
    options.set(args[i], args[++i]);
  }
  const filename = options.get("--bundle");
  if (!filename) throw Error("--bundle is required");
  const info = await stat(filename);
  if (!info.isFile() || info.size > 6 * 1024 * 1024)
    throw Error("Expected a migration manifest file of at most 6 MiB");
  const bundle = JSON.parse(await readFile(filename, "utf8")),
    hash = digest(bundle),
    expected = options.get("--expected-digest") ?? hash;
  const owner = {
    appId: "lighttick" as const,
    userId: identity(bundle?.mapping?.target_user_id),
  };
  const manifest = readLearningManifest(
    owner,
    bundle,
    expected,
    new Date().toISOString(),
  );
  const action = options.get("--action") ?? "preflight";
  if (
    !["preflight", "freeze", "import", "verify", "activate", "abort"].includes(
      action,
    )
  )
    throw Error("Unsupported migration action");
  if (action !== "preflight" && !apply)
    throw Error(
      "Mutating actions require --apply; default is read-only preflight",
    );
  const endpoint = options.get("--endpoint");
  if (!endpoint) {
    if (apply || action !== "preflight")
      throw Error("Remote execution requires --endpoint");
    return {
      mode: "offline-dry-run",
      manifest_hash: hash,
      target_user_id: owner.userId,
      source_instance: manifest.source.instance,
      counts: {
        routes: manifest.routes.routes.length,
        route_versions: manifest.routes.versions.length,
        route_links: manifest.routes.links.length,
        work: 0,
        collections: manifest.collections.length,
        lessons: manifest.lessons.length,
        publications: manifest.publications.length,
        private_states: manifest.states.length,
        private_history: manifest.history.length,
        receipts: manifest.receipts.length,
      },
      source_watermarks_checked: false,
    };
  }
  const url = new URL(endpoint);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  )
    throw Error(
      "Endpoint must be an HTTPS origin, or disposable localhost HTTP origin",
    );
  const cookieFile = options.get("--cookie-file");
  if (!cookieFile)
    throw Error(
      "An existing --cookie-file is required for admin authorization",
    );
  const cookieStat = await stat(cookieFile);
  if (
    !cookieStat.isFile() ||
    cookieStat.size > 8192 ||
    (cookieStat.mode & 0o077) !== 0
  )
    throw Error(
      "Admin cookie file must be private (chmod 600) and at most 8192 bytes",
    );
  const cookie = (await readFile(cookieFile, "utf8")).trim();
  if (!/^adminSession=[^;\s]+$/.test(cookie))
    throw Error("Cookie file must contain only adminSession=<value>");
  const key = options.get("--request-id");
  const body: Record<string, unknown> = { bundle, expected_digest: expected };
  if (action !== "preflight") {
    if (
      !options.has("--expected-digest") ||
      !key ||
      !options.has("--base-revision")
    )
      throw Error(
        "Writes require the reviewed --expected-digest, original --request-id and --base-revision",
      );
    identity(key);
    body.base_revision = integer(
      Number(options.get("--base-revision")),
      0,
      2147483646,
    );
  }
  const response = await fetcher(
    new URL(
      `/api/v1/admin/apps/lighttick/learning-migrations/${encodeURIComponent(owner.userId)}/${action}`,
      url,
    ),
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    },
  );
  const result = (await response.json()) as {
    code?: string;
    message?: string;
    data?: unknown;
  };
  if (!response.ok || result.code !== "OK")
    throw Error(
      `Migration ${action} returned HTTP ${response.status} (${result.code ?? "invalid response"}); retain the same manifest, base revision and request ID before retry`,
    );
  return {
    mode: action === "preflight" ? "remote-dry-run" : "remote-command",
    manifest_hash: hash,
    action,
    result: result.data,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.stdout.write(
      JSON.stringify(
        await runLearningMigration(process.argv.slice(2)),
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    process.stderr.write(
      (error instanceof Error ? error.message : "Migration failed") + "\n",
    );
    process.exitCode = 1;
  }
}
