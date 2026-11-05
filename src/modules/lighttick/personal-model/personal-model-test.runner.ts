import { randomUUID } from "node:crypto";
import { PersonalModelService } from "./personal-model.service.ts";
import {
  PersonalModelDispatcher,
  selectionOption,
} from "./personal-model.dispatcher.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
export class PersonalModelTestRunner {
  constructor(
    readonly service: PersonalModelService,
    readonly dispatcher: PersonalModelDispatcher,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
  ) {}
  get store() {
    return this.service.repo.personalModels;
  }
  async recover() {
    const rows = await this.store.recoverable(
      this.service.clock().toISOString(),
    );
    for (const r of rows) await this.service.dispatch(r, r.id);
    return rows.length;
  }
  async execute(o: LightTickOwner, id: string) {
    const claim = await this.service.repo.transaction(o, async () => {
      await this.authorizeOwner(o);
      const r = await this.store.test(o, id),
        now = this.service.clock().toISOString();
      if (
        !r ||
        !["queued", "running"].includes(r.status) ||
        (r.status === "running" && r.lease_until! > now)
      )
        return;
      if ((await this.store.running(o, now)) >= 1) return;
      if (r.attempt >= 3) {
        await this.store.saveTest(
          {
            ...r,
            revision: r.revision + 1,
            status: "failed",
            draft_secret: null,
            fence: null,
            lease_until: null,
            error_code: "RECOVERY_EXHAUSTED",
            updated_at: now,
          },
          r.revision,
        );
        return;
      }
      const next = {
        ...r,
        revision: r.revision + 1,
        status: "running" as const,
        attempt: r.attempt + 1,
        fence: randomUUID(),
        lease_until: new Date(
          this.service.clock().getTime() + 60000,
        ).toISOString(),
        updated_at: now,
      };
      await this.store.saveTest(next, r.revision);
      return next;
    });
    if (!claim) return;
    const controller = new AbortController();
    let polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void (async () => {
        await this.authorizeOwner(o);
        const current = await this.store.test(o, id);
        if (current?.status !== "running" || current.fence !== claim.fence)
          controller.abort();
      })()
        .catch(() => controller.abort())
        .finally(() => (polling = false));
    }, 250);
    let error: string | null = null;
    try {
      await this.dispatcher.test(claim, {
        modelKey: "lighttick.personal.test",
        messages: [
          {
            role: "user",
            content: "Reply with exactly OK. This is a connection test.",
          },
        ],
        maxTokens: 64,
        temperature: 0,
        usageOwner: o,
        signal: controller.signal,
        providerOptions: selectionOption({
          mode: "personal",
          revision: claim.settings_revision,
        }),
      });
    } catch {
      error = controller.signal.aborted
        ? "CANCELLED_OR_REVOKED"
        : "MODEL_TEST_FAILED";
    } finally {
      clearInterval(timer);
      controller.abort();
    }
    await this.service.repo.transaction(o, async () => {
      await this.authorizeOwner(o);
      const current = await this.store.test(o, id),
        settings = await this.store.get(o),
        now = this.service.clock().toISOString();
      if (
        !current ||
        current.status !== "running" ||
        current.fence !== claim.fence ||
        current.lease_until! <= now
      )
        return;
      if (
        (settings?.revision ?? 0) !== claim.settings_revision ||
        (claim.target === "saved" && settings?.mode !== "personal")
      )
        error = "SETTINGS_CHANGED";
      await this.store.saveTest(
        {
          ...current,
          revision: current.revision + 1,
          status: error ? "failed" : "succeeded",
          draft_secret: null,
          fence: null,
          lease_until: null,
          error_code: error,
          updated_at: now,
        },
        current.revision,
      );
    });
  }
}
