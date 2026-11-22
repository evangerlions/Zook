import { Pool } from "pg";
import { createHash } from "node:crypto";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/independent-reading/reading-work.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
const dsn = process.env.LIGHTTICK_READING_TEST_DATABASE_URL,
  user = process.argv[process.argv.indexOf("--synthetic-user") + 1];
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !/^grow_web_u1_content_completion_[0-9]+$/.test(
    new URL(dsn).pathname.slice(1),
  ) ||
  !/^user_reading_acceptance_[a-z0-9_]+$/.test(user ?? "")
)
  throw Error(
    "Dedicated localhost synthetic reading DB and explicit synthetic user required",
  );
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  owner = { appId: "lighttick", userId: user } as const,
  work = new ReadingWorkService(repo, new InMemoryJobQueue());
try {
  const task = await work.create(
    owner,
    {
      kind: "collect_url",
      title: "Synthetic backup byte fixture; no parser/provider verification",
      url: "https://reading.example.test/backup-byte-fixture",
    },
    "backup-browser-large-original-20261112",
  );
  if (process.argv.includes("--cancel")) {
    const current = await work.read(owner, task.id);
    if (current.status === "queued")
      await work.cancel(
        owner,
        task.id,
        { base_revision: current.revision },
        "backup-browser-fixture-cancel-20261112",
      );
    console.log(
      JSON.stringify({
        work_id: task.id,
        status: (await work.read(owner, task.id)).status,
      }),
    );
  } else {
    const bytes = Buffer.alloc(7 * 1024 * 1024, 23);
    bytes[0] = 0;
    bytes[bytes.length - 1] = 255;
    const value = {
        body: bytes.toString("base64"),
        encoding: "base64" as const,
        content_type: "application/octet-stream",
        url: "https://reading.example.test/backup-byte-fixture",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        capture_kind: "web_text",
      },
      sha256 = digest(value),
      id = "readasset-" + digest(["document", sha256]);
    await repo.transaction(owner, () =>
      repo.readingWork.assets.save(owner, {
        id,
        work_id: task.id,
        sha256,
        kind: "document",
        value,
      }),
    );
    console.log(
      JSON.stringify({
        work_id: task.id,
        asset_id: id,
        byte_length: bytes.length,
        raw_sha256: value.sha256,
        validation:
          "synthetic arbitrary raw bytes, not a website/PDF parsing result",
      }),
    );
  }
} finally {
  await pool.end();
}
