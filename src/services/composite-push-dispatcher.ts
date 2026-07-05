import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { PushDispatchRequest, PushDispatcher } from "./notification.service.ts";

/**
 * Routes push dispatch to platform-specific dispatchers.
 *
 * Each platform (ios, android, web) has its own dispatcher. If a platform has
 * no configured dispatcher, notifications for that platform are silently skipped
 * (logged as a warning).
 */
export class CompositePushDispatcher implements PushDispatcher {
  private readonly dispatchers: Map<string, PushDispatcher>;
  private readonly logger: StructuredLogger | null;

  constructor(
    platformDispatchers: Record<string, PushDispatcher | undefined>,
    options: { logger?: StructuredLogger } = {},
  ) {
    this.dispatchers = new Map();
    for (const [platform, dispatcher] of Object.entries(platformDispatchers)) {
      if (dispatcher) {
        this.dispatchers.set(platform, dispatcher);
      }
    }
    this.logger = options.logger ?? null;
  }

  async dispatch(request: PushDispatchRequest): Promise<void> {
    const dispatcher = this.dispatchers.get(request.platform);
    if (!dispatcher) {
      this.logger?.warn("no push dispatcher configured for platform", {
        appId: request.appId,
        userId: request.userId,
        platform: request.platform,
      });
      return;
    }
    await dispatcher.dispatch(request);
  }
}
