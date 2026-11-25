import type { IncomingMessage, ServerResponse } from "node:http";

// The wire limit leaves room for base64 expansion of the legacy 10 MiB payload.
const FEEDBACK_REQUEST_BYTES = 14 * 1024 * 1024;
const FEEDBACK_CONTROL_REQUEST_BYTES = 8 * 1024;
const MAX_CONCURRENT_PER_LANE = 4;
const BODY_READ_TIMEOUT_MS = 15_000;
const FEEDBACK_REQUEST_TIMEOUT_MS = 30_000;

type Lane = "userUpload" | "adminUpload" | "control" | "imageRead";
interface FeedbackIngressPolicy {
  lane: Lane;
  maxBytes: number;
}

export class FeedbackIngressError extends Error {
  constructor(readonly status: 408 | 413 | 429) {
    super({
      408: "Feedback request took too long to upload.",
      413: "Feedback request is too large.",
      429: "Too many feedback requests. Try again shortly.",
    }[status]);
  }
}

export function feedbackIngressPolicy(method: string, path: string): FeedbackIngressPolicy | undefined {
  const match = /^\/api\/v1\/(admin\/apps\/)?ai_novel\/feedback(?:\/.*)?$/.exec(path);
  if (!match) return undefined;
  if (method === "POST") {
    if (path === "/api/v1/ai_novel/feedback" || /^\/api\/v1\/(?:admin\/apps\/)?ai_novel\/feedback\/[^/]+\/messages$/.test(path)) {
      return { lane: match[1] ? "adminUpload" : "userUpload", maxBytes: FEEDBACK_REQUEST_BYTES };
    }
  }
  return {
    lane: method === "GET" && /\/attachments\/[^/]+$/.test(path) ? "imageRead" : "control",
    maxBytes: FEEDBACK_CONTROL_REQUEST_BYTES,
  };
}

export class FeedbackIngress {
  private readonly active: Record<Lane, number> = { userUpload: 0, adminUpload: 0, control: 0, imageRead: 0 };

  acquire(request: IncomingMessage, { lane, maxBytes }: FeedbackIngressPolicy): () => void {
    if (Number(request.headers["content-length"]) > maxBytes) {
      throw new FeedbackIngressError(413);
    }
    if (this.active[lane] >= MAX_CONCURRENT_PER_LANE) throw new FeedbackIngressError(429);
    this.active[lane] += 1;
    return () => { this.active[lane] -= 1; };
  }
}

export async function withFeedbackBodyDeadline<T>(reading: Promise<T>, timeoutMs = BODY_READ_TIMEOUT_MS): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([reading, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new FeedbackIngressError(408)), timeoutMs);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export function holdFeedbackSlotThroughResponse(response: ServerResponse, release: () => void): () => void {
  const timer = setTimeout(() => response.destroy(), FEEDBACK_REQUEST_TIMEOUT_MS);
  const done = () => {
    clearTimeout(timer);
    response.off("finish", done);
    response.off("close", done);
    release();
  };
  return () => {
    if (response.writableFinished || response.destroyed) {
      done();
      return;
    }
    response.once("finish", done);
    response.once("close", done);
  };
}

export function writeFeedbackIngressError(response: ServerResponse, error: FeedbackIngressError): void {
  response.statusCode = error.status;
  response.setHeader("Connection", "close");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (error.status === 429) response.setHeader("Retry-After", "1");
  response.end(JSON.stringify({
    code: error.status === 429 ? "AUTH_RATE_LIMITED" : "REQ_INVALID_BODY",
    message: error.message,
    data: null,
    requestId: "req_feedback_ingress",
  }));
}
