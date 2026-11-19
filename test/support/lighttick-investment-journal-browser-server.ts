// Isolated loopback HTTP adapter over the real Zook test application and worker.
import http from "node:http";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { HttpRequest } from "../../src/shared/types.ts";

const seed = buildDefaultSeed(undefined, { includeLightTick: true });
const owner = { appId: "lighttick" as const, userId: "user_alice" };
seed.appUsers.push({ id: "journal-browser-test", ...owner, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
const runtime = await createApplication({ seed, lighttickEnabled: true });
const worker = runtime.services.lighttickRuntime!.worker!;
const port = Number(process.env.LIGHTTICK_JOURNAL_TEST_PORT ?? 3198);

http.createServer(async (incoming, outgoing) => {
  try {
    const url = new URL(incoming.url!, "http://127.0.0.1");
    let payload = "";
    for await (const chunk of incoming) payload += chunk;
    const request = {
      method: incoming.method, path: url.pathname, query: Object.fromEntries(url.searchParams),
      headers: incoming.headers, body: payload ? JSON.parse(payload) : undefined,
    } as HttpRequest;
    const response = await runtime.app.handle(request);
    outgoing.writeHead(response.statusCode, { "content-type": "application/json", ...response.headers });
    outgoing.end(JSON.stringify(response.body));
    if (request.method === "POST" && response.statusCode === 200) {
      const work = response.body.data as { id?: string } | undefined;
      if (work?.id && url.pathname.endsWith("/events")) await worker.investments!.execute(owner, work.id);
      if (work?.id && url.pathname.endsWith("/portfolio/work")) await worker.portfolio!.execute(owner, work.id);
    }
  } catch (error) {
    console.error(error);
    if (!outgoing.headersSent) outgoing.writeHead(500);
    outgoing.end();
  }
}).listen(port, "127.0.0.1", () => console.log(`LightTick journal browser test backend on ${port}`));
