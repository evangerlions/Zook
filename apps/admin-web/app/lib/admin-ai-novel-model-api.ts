import { adminPath, requestJson } from "./admin-api-client.ts";
import type {
  AdminAiNovelModelSelectionDocument,
  AdminAiNovelModelPointPricingDocument,
  AiNovelModelSelectionConfig,
  AiNovelModelPointPricingConfig,
} from "./types";

export const adminAiNovelModelApi = {
  getAiNovelModelSelection() {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath("/apps/ai_novel/model-selection"),
    );
  },
  getAiNovelModelSelectionRevision(revision: number) {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath(`/apps/ai_novel/model-selection/revisions/${revision}`),
    );
  },
  updateAiNovelModelSelection(
    config: AiNovelModelSelectionConfig,
    desc?: string,
  ) {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath("/apps/ai_novel/model-selection"),
      {
        method: "PUT",
        body: { config, desc: desc || undefined },
      },
    );
  },
  restoreAiNovelModelSelection(revision: number, desc?: string) {
    return requestJson<AdminAiNovelModelSelectionDocument>(
      adminPath(
        `/apps/ai_novel/model-selection/revisions/${revision}/restore`,
      ),
      {
        method: "POST",
        body: { desc: desc || undefined },
      },
    );
  },
  getAiNovelModelPointPricing() {
    return requestJson<AdminAiNovelModelPointPricingDocument>(
      adminPath("/apps/ai_novel/model-point-pricing"),
    );
  },
  getAiNovelModelPointPricingRevision(revision: number) {
    return requestJson<AdminAiNovelModelPointPricingDocument>(
      adminPath(`/apps/ai_novel/model-point-pricing/revisions/${revision}`),
    );
  },
  updateAiNovelModelPointPricing(
    config: AiNovelModelPointPricingConfig,
    desc?: string,
  ) {
    return requestJson<AdminAiNovelModelPointPricingDocument>(
      adminPath("/apps/ai_novel/model-point-pricing"),
      { method: "PUT", body: { config, desc: desc || undefined } },
    );
  },
  restoreAiNovelModelPointPricing(revision: number, desc?: string) {
    return requestJson<AdminAiNovelModelPointPricingDocument>(
      adminPath(`/apps/ai_novel/model-point-pricing/revisions/${revision}/restore`),
      { method: "POST", body: { desc: desc || undefined } },
    );
  },
};
