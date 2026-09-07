import type { BodyLogFeatureFlagStore } from "../../infrastructure/bodylog-store-ports.ts";
import type { FeatureFlagDocument, FeatureFlagsConfig } from "./bodylog-feature-flag.types.ts";

export class BodyLogFeatureFlagService {
  constructor(private readonly database: BodyLogFeatureFlagStore) {}

  /**
   * Get all feature flags as a config object
   */
  async getAllFlags(): Promise<FeatureFlagsConfig> {
    const flags = await this.database.listBodyLogFeatureFlags();
    const config: FeatureFlagsConfig = {};
    for (const flag of flags) {
      config[flag.key] = flag.enabled;
    }
    return config;
  }

  /**
   * Get a specific feature flag
   */
  async getFlag(key: string): Promise<FeatureFlagDocument | null> {
    const flag = await this.database.findBodyLogFeatureFlag(key);
    if (!flag) {
      return null;
    }

    return {
      key: flag.key,
      enabled: flag.enabled,
    };
  }

  /**
   * Update a feature flag
   */
  async updateFlag(key: string, enabled: boolean): Promise<FeatureFlagDocument> {
    const flag = await this.database.updateBodyLogFeatureFlag(key, enabled);
    return {
      key: flag.key,
      enabled: flag.enabled,
    };
  }

  /**
   * Check if a feature is enabled
   */
  async isEnabled(key: string): Promise<boolean> {
    const flag = await this.database.findBodyLogFeatureFlag(key);
    return flag?.enabled ?? false;
  }
}
