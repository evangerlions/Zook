import { createHash, randomBytes } from "node:crypto";
import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { BodyLogRetentionStore } from "../../infrastructure/bodylog-retention-store.ts";
import type { BodyLogRewardLedger } from "./bodylog-reward-ledger.ts";
import { ApplicationError } from "../../shared/errors.ts";

type Definition = { id: string; status: string; title: string; subtitle: string; startsAt: string; endsAt: string;
  reward: { type: string; durationDays: number; displayText: string }; rules: string[];
  platformPolicy: { allowedPlatforms: string[]; freeFormAllowed: boolean; oauthPlatforms: string[]; manualReviewPlatforms: string[] } };
export class BodyLogCampaignService {
  constructor(private readonly database: ApplicationDatabase, private readonly store: BodyLogRetentionStore, private readonly ledger: BodyLogRewardLedger) {}
  private async definitions(): Promise<Definition[]> {
    const config = await this.database.findAppConfig("bodylog", "bodylog.campaigns");
    if (!config) return [];
    try {
      const definitions = JSON.parse(config.configValue);
      if (!Array.isArray(definitions)) throw new Error();
      for (const item of definitions) if (!item || !/^[A-Za-z0-9_-]{1,128}$/.test(item.id) ||
        typeof item.title !== "string" || typeof item.subtitle !== "string" || !Array.isArray(item.rules) ||
        !item.rules.every((rule: unknown) => typeof rule === "string") || item.reward?.type !== "premium" ||
        !Number.isInteger(item.reward.durationDays) || item.reward.durationDays < 1 || item.reward.durationDays > 31 ||
        !Number.isFinite(Date.parse(item.startsAt)) || Date.parse(item.endsAt) <= Date.parse(item.startsAt) ||
        !Number.isFinite(Date.parse(item.endsAt)) || typeof item.reward.displayText !== "string" ||
        typeof item.platformPolicy?.freeFormAllowed !== "boolean" ||
        ![item.platformPolicy.allowedPlatforms, item.platformPolicy.oauthPlatforms, item.platformPolicy.manualReviewPlatforms].every(values => Array.isArray(values) && values.every((value: unknown) => typeof value === "string" && /^[a-z0-9_-]{1,32}$/.test(value)))) throw new Error();
      if (new Set(definitions.map(item => item.id)).size !== definitions.length || definitions.some(item =>
        item.platformPolicy.oauthPlatforms.length > 0 || !item.platformPolicy.allowedPlatforms.every((platform: string) => item.platformPolicy.manualReviewPlatforms.includes(platform)))) throw new Error();
      return definitions;
    } catch { throw new ApplicationError(503, "BODYLOG_CAMPAIGN_CONFIG_INVALID", "Campaign configuration is unavailable."); }
  }
  private async definition(id: string, active = true) {
    const item = (await this.definitions()).find(item => item.id === id);
    if (!item || (active && (item.status !== "active" || Date.parse(item.startsAt) > Date.now() || Date.parse(item.endsAt) <= Date.now())))
      throw new ApplicationError(404, "BODYLOG_CAMPAIGN_NOT_FOUND", "Campaign is unavailable.");
    return item;
  }
  private id(userId: string, campaignId: string) {
    return "participation_" + createHash("sha256").update(JSON.stringify([userId, campaignId])).digest("hex");
  }
  async participation(userId: string, campaignId: string) {
    const definition = await this.definition(campaignId, false);
    const saved = (await this.store.list("participation", userId)).find(item => item.id === this.id(userId, campaignId))?.data;
    if (saved) { const { reviewedBy: _reviewer, ...publicData } = saved; return publicData; }
    return {
      id: null, campaignId, status: "none", verificationLevel: "none", rewardClaimStatus: "not_eligible",
      retryRemaining: 3, reviewTargetHours: 48, expiresAt: definition.endsAt,
    };
  }
  async active(userId: string) {
    const items = (await this.definitions()).filter(item => item.status === "active" && Date.parse(item.startsAt) <= Date.now() && Date.parse(item.endsAt) > Date.now());
    return { campaigns: await Promise.all(items.map(async item => ({ ...item, participation: await this.participation(userId, item.id) }))) };
  }
  private async save(userId: string, campaignId: string, data: Record<string, unknown>) {
    const record = { ...data, updatedAt: new Date().toISOString() };
    await this.store.save({ id: this.id(userId, campaignId), kind: "participation", userId, data: record });
    return record;
  }
  async join(userId: string, campaignId: string) {
    const definition = await this.definition(campaignId);
    const current = await this.participation(userId, campaignId);
    if (current.id) return { participation: current };
    const code = randomBytes(8).toString("hex").toUpperCase();
    return { participation: await this.save(userId, campaignId, { ...current, id: this.id(userId, campaignId), status: "created", claimCode: code,
      shareCopy: { title: definition.title, text: `${definition.subtitle}\n${code}`, requiredCode: code } }) };
  }
  async submit(userId: string, campaignId: string, input: { platform: unknown; url: unknown }) {
    const definition = await this.definition(campaignId);
    const current = await this.participation(userId, campaignId);
    if (!current.id || !["created", "rejected"].includes(String(current.status)) || Number(current.retryRemaining) < 1)
      throw new ApplicationError(409, "BODYLOG_CAMPAIGN_STATE_CONFLICT", "Participation cannot accept a submission.");
    if (typeof input.platform !== "string" || !definition.platformPolicy.allowedPlatforms.includes(input.platform) || typeof input.url !== "string" || input.url.length > 2048)
      throw new ApplicationError(400, "BODYLOG_CAMPAIGN_SUBMISSION_INVALID", "A supported platform and public HTTPS link are required.");
    let url: URL;
    try { url = new URL(input.url); } catch { throw new ApplicationError(400, "BODYLOG_CAMPAIGN_SUBMISSION_INVALID", "Invalid public link."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hostname === "localhost" || /^\d|:/.test(url.hostname))
      throw new ApplicationError(400, "BODYLOG_CAMPAIGN_SUBMISSION_INVALID", "A public HTTPS link is required.");
    // Store for manual review. Never fetch user-controlled URLs or trust a client verification field.
    return { participation: await this.save(userId, campaignId, { ...current, status: "manual_review", submittedUrl: input.url,
      normalizedUrl: url.toString(), platform: input.platform, verificationLevel: "manual_review_required", rewardClaimStatus: "not_eligible", rejection: null }) };
  }
  async review(userId: string, campaignId: string, approved: boolean, reviewer: string) {
    await this.definition(campaignId, false);
    const current = await this.participation(userId, campaignId);
    if (current.status !== "manual_review") throw new ApplicationError(409, "BODYLOG_CAMPAIGN_STATE_CONFLICT", "Submission is not awaiting review.");
    return { participation: await this.save(userId, campaignId, { ...current, status: approved ? "verified" : "rejected",
      verificationLevel: approved ? "public_link_verified" : "rejected", rewardClaimStatus: approved ? "ready_to_claim" : "not_eligible",
      retryRemaining: approved ? current.retryRemaining : Math.max(0, Number(current.retryRemaining) - 1),
      rejection: approved ? null : { code: "BODYLOG_CAMPAIGN_REJECTED", message: "Submission did not meet the campaign rules.", retryAllowed: Number(current.retryRemaining) > 1, retryRemaining: Math.max(0, Number(current.retryRemaining) - 1) }, reviewedBy: reviewer }) };
  }
  async claim(userId: string, campaignId: string) {
    const saved = (await this.store.list("participation", userId)).find(item => item.id === this.id(userId, campaignId))?.data;
    if (saved?.status === "claimed") {
      const prior = (await this.ledger.grants(userId)).find(item => item.source === "campaign" && item.sourceId === campaignId);
      if (!prior) throw new ApplicationError(503, "BODYLOG_CAMPAIGN_REWARD_UNCONFIRMED", "Reward receipt is unavailable.");
      return this.receipt(userId, prior);
    }
    const definition = await this.definition(campaignId);
    const current = await this.participation(userId, campaignId);
    if (current.status !== "verified") throw new ApplicationError(409, "BODYLOG_CAMPAIGN_REWARD_NOT_ELIGIBLE", "A server-reviewed submission is required.");
    const grant = await this.ledger.grant(userId, "campaign", campaignId, "premium", `${definition.reward.durationDays}_day_premium`, definition.reward.durationDays);
    await this.save(userId, campaignId, { ...current, status: "claimed", rewardClaimStatus: "claimed" });
    return this.receipt(userId, grant);
  }
  private async receipt(userId: string, grant: import("./bodylog-reward-ledger.ts").RewardGrant) {
    return { reward: { claimStatus: "claimed", entitlementId: grant.id, entitlementStatus: Date.parse(grant.endsAt!) <= Date.now() ? "expired" : Date.parse(grant.startsAt) > Date.now() ? "queued" : "active", startsAt: grant.startsAt, endsAt: grant.endsAt },
      effectiveEntitlement: (await this.ledger.entitlements(userId)).effective };
  }
}
