import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LLMProvider } from "./llm-manager.ts";
import { buildLlmSmokeChatRequest } from "./llm-smoke-test.service.ts";
import type {
  LlmRouteCircuitBreakerService,
  LlmRouteCircuitConfirmation,
} from "./llm-route-circuit-breaker.service.ts";
import type { LlmRouteRef } from "./llm-health.service.ts";

/** Runs immediate confirmation and worker recovery probes; it never retries a user request. */
export class LlmRouteCircuitRecoveryService {
  constructor(
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly circuitBreaker: LlmRouteCircuitBreakerService,
    private readonly chatProviders: Record<string, LLMProvider>,
  ) {}

  async runDueRecoveries(): Promise<{ attempted: number; restored: number; failed: number }> {
    const config = await this.commonLlmConfigService.getRuntimeConfig();
    return this.circuitBreaker.recoverDueRoutes(
      Boolean(config?.enabled && config.routeCircuitBreaker?.enabled),
      async (ref) => this.probe(config, ref),
    );
  }

  async confirmRoute(ref: LlmRouteRef): Promise<void> {
    const config = await this.commonLlmConfigService.getRuntimeConfig();
    if (!config?.enabled || !config.routeCircuitBreaker?.enabled) return;
    const confirmation = await this.circuitBreaker.claimCircuitConfirmation(ref);
    if (!confirmation) return;
    await this.runConfirmation(config, confirmation);
  }

  async runPendingConfirmations(): Promise<{ attempted: number; cleared: number; opened: number }> {
    const config = await this.commonLlmConfigService.getRuntimeConfig();
    if (!config?.enabled || !config.routeCircuitBreaker?.enabled) {
      return { attempted: 0, cleared: 0, opened: 0 };
    }
    let attempted = 0;
    let cleared = 0;
    let opened = 0;
    while (true) {
      const confirmation = await this.circuitBreaker.claimNextCircuitConfirmation();
      if (!confirmation) break;
      attempted += 1;
      const result = await this.runConfirmation(config, confirmation);
      if (result === "cleared") cleared += 1;
      if (result === "opened") opened += 1;
    }
    return { attempted, cleared, opened };
  }

  private async runConfirmation(
    config: Awaited<ReturnType<CommonLlmConfigService["getRuntimeConfig"]>>,
    confirmation: LlmRouteCircuitConfirmation,
  ): Promise<"cleared" | "opened" | "skipped"> {
    const succeeded = await this.probe(config, confirmation.ref) || await this.probe(config, confirmation.ref);
    return this.circuitBreaker.completeCircuitConfirmation(confirmation, succeeded);
  }

  private async probe(
    config: Awaited<ReturnType<CommonLlmConfigService["getRuntimeConfig"]>>,
    ref: Required<LlmRouteRef>,
  ): Promise<boolean> {
    const model = config?.models.find((item) => item.key === ref.modelKey && item.kind === "chat");
    const route = model?.routes.find((item) =>
      item.provider === ref.provider && item.providerModel === ref.providerModel && item.enabled,
    );
    const provider = config?.providers.find((item) => item.key === ref.provider && item.enabled);
    const adapter = this.chatProviders[ref.provider];
    if (!model || !route || !provider || !adapter) return false;
    try {
      const response = await adapter.complete(buildLlmSmokeChatRequest({ model, route, provider }));
      return Boolean(response.text.trim() || response.reasoningText?.trim() || response.toolCalls?.length);
    } catch {
      return false;
    }
  }
}
