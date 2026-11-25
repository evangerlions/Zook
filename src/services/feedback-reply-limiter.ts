import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { ApplicationError, badRequest, tooManyRequests } from "../shared/errors.ts";
import { sha256 } from "../shared/utils.ts";

const SCOPE = "ainovel.feedback.reply";
const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const CHINA_OFFSET_MS = 8 * 60 * MINUTE_MS;

interface ReplyUnits {
  text: number;
  images: number;
}

export class FeedbackReplyLimiter {
  constructor(private readonly kv: KVManager, private readonly now: () => number = Date.now) {}

  async admitRequest(userId: string): Promise<void> {
    const key = `${userId}:attempt:${Math.floor(this.now() / MINUTE_MS)}`;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const raw = await this.kv.getString(SCOPE, key);
      const count = Number(raw ?? 0);
      if (count >= 30) this.reject();
      if (await this.kv.applyAtomic(SCOPE, {
        compare: [{ key, value: raw ?? null }],
        set: [{ key, value: String(count + 1), ttlSeconds: 120 }],
      })) return;
    }
    this.reject();
  }

  async consume(userId: string, feedbackId: string, submissionKey: string, units: ReplyUnits): Promise<void> {
    const now = this.now();
    const minute = `${userId}:minute:${Math.floor(now / MINUTE_MS)}`;
    const day = `${userId}:day:${Math.floor((now + CHINA_OFFSET_MS) / DAY_MS)}`;
    const submission = `${day}:submission:${sha256(`${feedbackId}:${submissionKey}`)}`;
    const classification = JSON.stringify(units);

    for (let attempt = 0; attempt < 20; attempt += 1) {
      const [minuteRaw, dayRaw, submissionRaw] = await Promise.all([minute, day, submission].map(key => this.kv.getString(SCOPE, key)));
      if (submissionRaw !== undefined) {
        if (submissionRaw !== classification) badRequest("REQ_INVALID_BODY", "Feedback reply key was reused with different content.");
        return;
      }
      const sent = Number(minuteRaw ?? 0);
      const used: ReplyUnits = dayRaw ? JSON.parse(dayRaw) : { text: 0, images: 0 };
      if (sent >= 10 || used.text + units.text > 200 || used.images + units.images > 20) this.reject();
      if (await this.kv.applyAtomic(SCOPE, {
        compare: [{ key: minute, value: minuteRaw ?? null }, { key: day, value: dayRaw ?? null }, { key: submission, value: null }],
        set: [
          { key: minute, value: String(sent + 1), ttlSeconds: 120 },
          { key: day, value: JSON.stringify({ text: used.text + units.text, images: used.images + units.images }), ttlSeconds: 86_400 },
          { key: submission, value: classification, ttlSeconds: 86_400 },
        ],
      })) return;
    }
    throw new ApplicationError(503, "SYS_INTERNAL_ERROR", "Feedback reply is temporarily unavailable.");
  }

  private reject(): never {
    tooManyRequests("AUTH_RATE_LIMITED", "Feedback reply limit reached.");
  }
}
