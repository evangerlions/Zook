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
  AdminSmsServiceDocument,
  GetuiGySensitiveCredentialField,
  LlmMetricsRange,
} from "../../shared/types.ts";
import type { AdminConsoleCommonConfig } from "./admin-console-common-config.ts";

export class AdminConsoleCommonFacade {
  constructor(protected readonly commonConfig: AdminConsoleCommonConfig) {}

  async getEmailServiceConfig(revision?: number): Promise<AdminEmailServiceDocument> {
    return this.commonConfig.getEmailServiceConfig(revision);
  }

  async updateEmailServiceConfig(input: unknown, desc?: string): Promise<AdminEmailServiceDocument> {
    return this.commonConfig.updateEmailServiceConfig(input, desc);
  }

  async restoreEmailServiceConfig(revision: number, desc?: string): Promise<AdminEmailServiceDocument> {
    return this.commonConfig.restoreEmailServiceConfig(revision, desc);
  }

  async sendEmailTest(input: AdminEmailTestSendCommand): Promise<AdminEmailTestSendDocument> {
    return this.commonConfig.sendEmailTest(input);
  }

  async getAuthRateLimitConfig(revision?: number): Promise<AdminAuthRateLimitDocument> {
    return this.commonConfig.getAuthRateLimitConfig(revision);
  }

  async updateAuthRateLimitConfig(input: unknown, desc?: string): Promise<AdminAuthRateLimitDocument> {
    return this.commonConfig.updateAuthRateLimitConfig(input, desc);
  }

  async restoreAuthRateLimitConfig(revision: number, desc?: string): Promise<AdminAuthRateLimitDocument> {
    return this.commonConfig.restoreAuthRateLimitConfig(revision, desc);
  }

  async getSmsServiceConfig(revision?: number): Promise<AdminSmsServiceDocument> {
    return this.commonConfig.getSmsServiceConfig(revision);
  }

  async updateSmsServiceConfig(input: unknown, desc?: string): Promise<AdminSmsServiceDocument> {
    return this.commonConfig.updateSmsServiceConfig(input, desc);
  }

  async restoreSmsServiceConfig(revision: number, desc?: string): Promise<AdminSmsServiceDocument> {
    return this.commonConfig.restoreSmsServiceConfig(revision, desc);
  }

  async getGetuiGyServiceConfig(revision?: number): Promise<AdminGetuiGyServiceDocument> {
    return this.commonConfig.getGetuiGyServiceConfig(revision);
  }

  async updateGetuiGyServiceConfig(input: unknown, desc?: string): Promise<AdminGetuiGyServiceDocument> {
    return this.commonConfig.updateGetuiGyServiceConfig(input, desc);
  }

  async restoreGetuiGyServiceConfig(revision: number, desc?: string): Promise<AdminGetuiGyServiceDocument> {
    return this.commonConfig.restoreGetuiGyServiceConfig(revision, desc);
  }

  async revealGetuiGyCredentialValue(
    zookAppId: string,
    field: GetuiGySensitiveCredentialField,
  ): Promise<AdminGetuiGyCredentialRevealDocument> {
    return this.commonConfig.revealGetuiGyCredentialValue(zookAppId, field);
  }

  async getPasswordConfig(): Promise<AdminPasswordDocument> {
    return this.commonConfig.getPasswordConfig();
  }

  async updatePasswordConfig(input: unknown): Promise<AdminPasswordDocument> {
    return this.commonConfig.updatePasswordConfig(input);
  }

  async upsertPasswordItem(input: unknown): Promise<AdminPasswordDocument> {
    return this.commonConfig.upsertPasswordItem(input);
  }

  async deletePasswordItem(key: string): Promise<AdminPasswordDocument> {
    return this.commonConfig.deletePasswordItem(key);
  }

  async getLlmServiceConfig(revision?: number): Promise<AdminLlmServiceDocument> {
    return this.commonConfig.getLlmServiceConfig(revision);
  }

  async updateLlmServiceConfig(input: unknown, desc?: string): Promise<AdminLlmServiceDocument> {
    return this.commonConfig.updateLlmServiceConfig(input, desc);
  }

  async restoreLlmServiceConfig(revision: number, desc?: string): Promise<AdminLlmServiceDocument> {
    return this.commonConfig.restoreLlmServiceConfig(revision, desc);
  }

  async getLlmMetrics(
    range: LlmMetricsRange,
    provider?: string,
    operation?: "chat" | "embedding",
    providerModel?: string,
  ): Promise<AdminLlmMetricsDocument> {
    return this.commonConfig.getLlmMetrics(range, provider, operation, providerModel);
  }

  async getLlmModelMetrics(
    modelKey: string,
    range: LlmMetricsRange,
    provider?: string,
  ): Promise<AdminLlmModelMetricsDocument> {
    return this.commonConfig.getLlmModelMetrics(modelKey, range, provider);
  }

  async runLlmSmokeTest(input?: AdminLlmSmokeTestRunRequest): Promise<AdminLlmSmokeTestDocument> {
    return this.commonConfig.runLlmSmokeTest(input);
  }

  async getContentSafetyConfig(revision?: number): Promise<AdminContentSafetyDocument> {
    return this.commonConfig.getContentSafetyConfig(revision);
  }

  async updateContentSafetyConfig(input: unknown, desc?: string): Promise<AdminContentSafetyDocument> {
    return this.commonConfig.updateContentSafetyConfig(input, desc);
  }

  async restoreContentSafetyConfig(revision: number, desc?: string): Promise<AdminContentSafetyDocument> {
    return this.commonConfig.restoreContentSafetyConfig(revision, desc);
  }
}
