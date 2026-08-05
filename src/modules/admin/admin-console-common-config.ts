import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { ManagedStateStore } from "../../infrastructure/kv/managed-state.store.ts";
import type { CommonAuthRateLimitConfigService } from "../../services/common-auth-rate-limit-config.service.ts";
import type { CommonContentSafetyConfigService } from "../../services/common-content-safety-config.service.ts";
import type { CommonEmailConfigService } from "../../services/common-email-config.service.ts";
import type { CommonGetuiGyConfigService } from "../../services/common-getui-gy-config.service.ts";
import type { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import type { CommonSmsConfigService } from "../../services/common-sms-config.service.ts";
import type { EmailTestSendService } from "../../services/email-test-send.service.ts";
import type { LlmHealthService } from "../../services/llm-health.service.ts";
import type { LlmMetricsService } from "../../services/llm-metrics.service.ts";
import type { LlmSmokeTestService } from "../../services/llm-smoke-test.service.ts";
import type {
  AdminAuthRateLimitDocument,
  AdminContentSafetyDocument,
  AdminEmailServiceDocument,
  AdminEmailTestSendCommand,
  AdminEmailTestSendDocument,
  AdminGetuiGyCredentialRevealDocument,
  AdminGetuiGyServiceDocument,
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmServiceDocument,
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestRunRequest,
  AdminPasswordDocument,
  AdminPasswordRevealDocument,
  AdminSmsServiceDocument,
  GetuiGySensitiveCredentialField,
  LlmMetricsRange,
} from "../../shared/types.ts";

export class AdminConsoleCommonConfig {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly managedStateStore: ManagedStateStore,
    private readonly commonEmailConfigService: CommonEmailConfigService,
    private readonly commonSmsConfigService: CommonSmsConfigService,
    private readonly commonAuthRateLimitConfigService: CommonAuthRateLimitConfigService,
    private readonly commonGetuiGyConfigService: CommonGetuiGyConfigService,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly commonContentSafetyConfigService: CommonContentSafetyConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly emailTestSendService: EmailTestSendService,
    private readonly llmHealthService: LlmHealthService,
    private readonly llmMetricsService: LlmMetricsService,
    private readonly llmSmokeTestService: LlmSmokeTestService,
  ) {}

  async getEmailServiceConfig(revision?: number): Promise<AdminEmailServiceDocument> {
    return this.commonEmailConfigService.getDocument(revision);
  }

  async updateEmailServiceConfig(input: unknown, desc?: string): Promise<AdminEmailServiceDocument> {
    const document = await this.commonEmailConfigService.updateConfig(input, desc);
    await this.saveState();
    return document;
  }

  async restoreEmailServiceConfig(revision: number, desc?: string): Promise<AdminEmailServiceDocument> {
    const document = await this.commonEmailConfigService.restoreConfig(revision, desc);
    await this.saveState();
    return document;
  }

  async sendEmailTest(input: AdminEmailTestSendCommand): Promise<AdminEmailTestSendDocument> {
    return this.emailTestSendService.run(input);
  }

  async getAuthRateLimitConfig(revision?: number): Promise<AdminAuthRateLimitDocument> {
    return this.commonAuthRateLimitConfigService.getDocument(revision);
  }

  async updateAuthRateLimitConfig(input: unknown, desc?: string): Promise<AdminAuthRateLimitDocument> {
    const document = await this.commonAuthRateLimitConfigService.updateConfig(input, desc);
    await this.saveState();
    return document;
  }

  async restoreAuthRateLimitConfig(revision: number, desc?: string): Promise<AdminAuthRateLimitDocument> {
    const document = await this.commonAuthRateLimitConfigService.restoreConfig(revision, desc);
    await this.saveState();
    return document;
  }

  async getSmsServiceConfig(revision?: number): Promise<AdminSmsServiceDocument> {
    return this.commonSmsConfigService.getDocument(revision);
  }

  async updateSmsServiceConfig(input: unknown, desc?: string): Promise<AdminSmsServiceDocument> {
    const document = await this.commonSmsConfigService.updateConfig(input, desc);
    await this.saveState();
    return document;
  }

  async restoreSmsServiceConfig(revision: number, desc?: string): Promise<AdminSmsServiceDocument> {
    const document = await this.commonSmsConfigService.restoreConfig(revision, desc);
    await this.saveState();
    return document;
  }

  async getGetuiGyServiceConfig(revision?: number): Promise<AdminGetuiGyServiceDocument> {
    return this.commonGetuiGyConfigService.getDocument(revision);
  }

  async updateGetuiGyServiceConfig(input: unknown, desc?: string): Promise<AdminGetuiGyServiceDocument> {
    const document = await this.commonGetuiGyConfigService.updateConfig(input, desc);
    await this.saveState();
    return document;
  }

  async restoreGetuiGyServiceConfig(revision: number, desc?: string): Promise<AdminGetuiGyServiceDocument> {
    const document = await this.commonGetuiGyConfigService.restoreConfig(revision, desc);
    await this.saveState();
    return document;
  }

  async revealGetuiGyCredentialValue(
    zookAppId: string,
    field: GetuiGySensitiveCredentialField,
  ): Promise<AdminGetuiGyCredentialRevealDocument> {
    return this.commonGetuiGyConfigService.revealCredentialValue(zookAppId, field);
  }

  async getPasswordConfig(): Promise<AdminPasswordDocument> {
    return this.commonPasswordConfigService.getDocument();
  }

  async updatePasswordConfig(input: unknown): Promise<AdminPasswordDocument> {
    return this.commonPasswordConfigService.updateConfig(input);
  }

  async upsertPasswordItem(input: unknown): Promise<AdminPasswordDocument> {
    const document = await this.commonPasswordConfigService.upsertItem(input);
    await this.saveState();
    return document;
  }

  async deletePasswordItem(key: string): Promise<AdminPasswordDocument> {
    const document = await this.commonPasswordConfigService.deleteItem(key);
    await this.saveState();
    return document;
  }

  async revealPasswordValue(key: string): Promise<AdminPasswordRevealDocument> {
    return this.commonPasswordConfigService.revealValue(key);
  }

  async getLlmServiceConfig(revision?: number): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.getDocument(revision);
    const runtime = {
      generatedAt: new Date().toISOString(),
      models: await Promise.all(
        document.config.models.map((model) => this.llmHealthService.buildModelRuntimeStatus(model)),
      ),
    };

    return {
      ...document,
      runtime,
    };
  }

  async updateLlmServiceConfig(input: unknown, desc?: string): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.updateConfig(input, desc);
    await this.saveState();
    return this.getLlmServiceConfig(document.revision);
  }

  async restoreLlmServiceConfig(revision: number, desc?: string): Promise<AdminLlmServiceDocument> {
    const document = await this.commonLlmConfigService.restoreConfig(revision, desc);
    await this.saveState();
    return this.getLlmServiceConfig(document.revision);
  }

  async getLlmMetrics(range: LlmMetricsRange, provider?: string): Promise<AdminLlmMetricsDocument> {
    return this.llmMetricsService.getOverview(
      await this.commonLlmConfigService.getCurrentConfig(),
      range,
      new Date(),
      provider,
    );
  }

  async getLlmModelMetrics(
    modelKey: string,
    range: LlmMetricsRange,
    provider?: string,
  ): Promise<AdminLlmModelMetricsDocument> {
    return this.llmMetricsService.getModelDetail(
      await this.commonLlmConfigService.getCurrentConfig(),
      modelKey,
      range,
      new Date(),
      provider,
    );
  }

  async runLlmSmokeTest(
    input?: AdminLlmSmokeTestRunRequest,
  ): Promise<AdminLlmSmokeTestDocument> {
    return this.llmSmokeTestService.run(input);
  }

  async getContentSafetyConfig(revision?: number): Promise<AdminContentSafetyDocument> {
    return this.commonContentSafetyConfigService.getDocument(revision);
  }

  async updateContentSafetyConfig(input: unknown, desc?: string): Promise<AdminContentSafetyDocument> {
    const document = await this.commonContentSafetyConfigService.updateConfig(input, desc);
    await this.saveState();
    return this.getContentSafetyConfig(document.revision);
  }

  async restoreContentSafetyConfig(revision: number, desc?: string): Promise<AdminContentSafetyDocument> {
    const document = await this.commonContentSafetyConfigService.restoreConfig(revision, desc);
    await this.saveState();
    return this.getContentSafetyConfig(document.revision);
  }

  private async saveState(): Promise<void> {
    await this.managedStateStore.save(this.database);
  }
}
