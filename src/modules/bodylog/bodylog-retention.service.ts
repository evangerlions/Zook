import { BodyLogRetentionTelemetry } from "./bodylog-retention-telemetry.ts";
import { BodyLogCampaignService } from "./bodylog-campaign.service.ts";
import type { BodyLogRetentionStore } from "../../infrastructure/bodylog-retention-store.ts";
import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { BodyLogGrowthStore } from "../../infrastructure/bodylog-store-ports.ts";
import type { BodyLogRewardLedger } from "./bodylog-reward-ledger.ts";
import type { BodyLogInvitationService } from "./bodylog-invitation.service.ts";

export class BodyLogRetentionService {
  readonly campaigns: BodyLogCampaignService;
  readonly telemetry: BodyLogRetentionTelemetry;
  constructor(private readonly database: ApplicationDatabase, private readonly growth: BodyLogGrowthStore,
    readonly ledger: BodyLogRewardLedger, private readonly invitations: BodyLogInvitationService, private readonly store: BodyLogRetentionStore) {
    this.campaigns = new BodyLogCampaignService(database, store, ledger);
    this.telemetry = new BodyLogRetentionTelemetry(database);
  }
  async execute<T>(operation: () => Promise<T>): Promise<T> { return this.database.withExclusiveSession(operation); }
  async metrics() {
    const now = new Date().toISOString();
    const [telemetry, attributions, rewards, experiment] = await Promise.all([
      this.telemetry.metrics(), this.database.listBodyLogInvitationAttributions("bodylog"), this.store.grantSummary(now), this.telemetry.experimentStatus(),
    ]);
    return { ...telemetry, rewards, experiment, invitationBusiness: {
      attributed: attributions.length, qualified: attributions.filter(item=>Boolean(item.qualifiedAt)).length,
      pending: attributions.filter(item=>!item.qualifiedAt).length,
      rewardedInvitees: attributions.filter(item=>Boolean(item.inviteeRewardEndsAt)).length,
      rewardedInviters: attributions.filter(item=>Boolean(item.inviterRewardEndsAt)).length,
    } };
  }
  async reconcile(userId: string) { await this.invitations.list(userId); }
  async missions(userId: string) {
    const plan = await this.growth.findLatestGrowthPlan(userId);
    const missions = plan ? (await this.growth.findGrowthMissionsByPlanId(plan.id)).map(item => ({
      id: item.id, source: "sevenDayPlan", planId: plan.id, day: item.day, completed: item.completed,
      target: item.target, completedUnits: item.completed ? item.target : 0, completedAt: item.completedAt,
    })) : [];
    const summary = await this.invitations.list(userId);
    if (summary.attributed) missions.push({ id: "invitation_three_days", source: "invitation", planId: "", day: 0,
      completed: summary.inviteeProgressDays >= 3, target: 3, completedUnits: summary.inviteeProgressDays, completedAt: null });
    return missions;
  }
  async rewards(userId: string) {
    await this.invitations.list(userId);
    const plan = await this.growth.findLatestGrowthPlan(userId);
    const current = plan ? await this.growth.findGrowthRewardsByPlanId(plan.id) : [];
    for (const reward of current) if (reward.claimed && reward.type === "badge") {
      await this.ledger.grant(userId, "sevenDayPlan", reward.id, "badge", reward.value);
    }
    const currentIds = new Set(current.map(item => item.id));
    const grants = await this.ledger.grants(userId);
    const rewards: Record<string, unknown>[] = grants.filter(item => item.source !== "sevenDayPlan" || !currentIds.has(item.sourceId)).map(item => ({ ...item, id: item.source === "sevenDayPlan" ? item.sourceId : item.id, status: "claimed" }));
    for (const reward of current) rewards.push({ ...reward, source: "sevenDayPlan", status: reward.claimed ? "claimed" : plan?.status === "completed" ? "claimable" : "progressing" });
    return rewards;
  }
}
