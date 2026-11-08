import { randomUUID } from "node:crypto";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { ScreeningService, SCREEN_LIMITS } from "./screen.service.ts";
import { screen } from "./screen.engine.ts";
import type { ScreenReport, ScreenWork } from "./screen.types.ts";
export class ScreeningRunner {
  constructor(
    readonly service: ScreeningService,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
    readonly compute = screen,
  ) {}
  async recover() {
    const rows = await this.service.store.recoverable(
      this.service.clock().toISOString(),
    );
    for (const w of rows) await this.service.dispatch(w, w.id);
    return rows.length;
  }
  async execute(o: LightTickOwner, id: string) {
    const s = this.service,
      store = s.store,
      now = () => s.clock().toISOString();
    const claim = await s.repo.transaction(o, async () => {
      const w = await store.work(o, id);
      if (
        !w ||
        !["queued", "running"].includes(w.status) ||
        (w.status === "running" && w.lease_until! > now())
      )
        return;
      try {
        await this.authorizeOwner(o);
      } catch {
        await store.saveWork(
          {
            ...w,
            revision: w.revision + 1,
            status: "failed",
            output: null,
            error_code: "SCREEN_PERMISSION_REVOKED",
            fence: null,
            lease_until: null,
            updated_at: now(),
          },
          w.revision,
        );
        return;
      }
      if (w.attempt >= SCREEN_LIMITS.attempts) {
        await store.saveWork(
          {
            ...w,
            revision: w.revision + 1,
            status: "failed",
            error_code: "RECOVERY_EXHAUSTED",
            fence: null,
            lease_until: null,
            updated_at: now(),
          },
          w.revision,
        );
        return;
      }
      const n = {
        ...w,
        revision: w.revision + 1,
        status: "running" as const,
        attempt: w.attempt + 1,
        fence: randomUUID(),
        lease_until: new Date(
          s.clock().getTime() + SCREEN_LIMITS.lease_ms,
        ).toISOString(),
        updated_at: now(),
      };
      await store.saveWork(n, w.revision);
      return n;
    });
    if (!claim) return;
    const abort = new AbortController();
    let output: ScreenReport | null = null,
      error: string | null = null,
      polling = false;
    const check = () =>
      s.repo.transaction(o, async () => {
        await this.authorizeOwner(o);
        const w = await store.work(o, id);
        if (
          !w ||
          w.status !== "running" ||
          w.fence !== claim.fence ||
          w.lease_until! <= now()
        )
          throw Error("STALE");
        await s.context(o, claim.input);
      });
    const timer = setTimeout(() => abort.abort(), SCREEN_LIMITS.timeout_ms),
      poll = setInterval(() => {
        if (polling) return;
        polling = true;
        void check()
          .catch(() => abort.abort())
          .finally(() => (polling = false));
      }, 250);
    try {
      await check();
      output = await Promise.race([
        this.compute(claim.input, abort.signal),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(Error("CANCELLED_OR_TIMEOUT")),
            { once: true },
          );
          if (abort.signal.aborted) reject(Error("CANCELLED_OR_TIMEOUT"));
        }),
      ]);
      await check();
    } catch {
      error = abort.signal.aborted
        ? "CANCELLED_OR_TIMEOUT"
        : "SCREEN_INPUT_OR_PERMISSION_CHANGED";
    } finally {
      clearTimeout(timer);
      clearInterval(poll);
      abort.abort();
    }
    return s.repo.transaction(o, async () => {
      const w = await store.work(o, id);
      if (
        !w ||
        w.status !== "running" ||
        w.fence !== claim.fence ||
        w.lease_until! <= now()
      )
        return;
      try {
        await this.authorizeOwner(o);
        await s.context(o, claim.input);
      } catch {
        error = "SCREEN_INPUT_OR_PERMISSION_CHANGED";
      }
      await store.saveWork(
        {
          ...w,
          revision: w.revision + 1,
          status: error ? "failed" : "succeeded",
          output: error ? null : output,
          error_code: error,
          fence: null,
          lease_until: null,
          updated_at: now(),
        },
        w.revision,
      );
    });
  }
}
