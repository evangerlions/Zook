import type { LightTickRepository } from "./lighttick.repository.ts";
import { LightTickGoalService } from "./lighttick-goal.service.ts";
import { LightTickPlanService } from "./lighttick-plan.service.ts";
import { LightTickProfileService } from "./lighttick-profile.service.ts";
import { LightTickProposalService } from "./lighttick-proposal.service.ts";
import { LightTickReviewService } from "./lighttick-review.service.ts";
import { LightTickTaskService } from "./lighttick-task.service.ts";
import { LightTickTodayService } from "./lighttick-today.service.ts";
import { LightTickSyncService } from "./lighttick-sync.service.ts";
import { LightTickProgressiveService } from "./lighttick-progressive.service.ts";
import type { LightTickJobService, LightTickWorker } from "./lighttick-worker.ts";
import type { LightTickNotificationService } from "./lighttick-notifications.ts";
import type { LightTickGuestIdentityService } from "./lighttick-guest-identity.service.ts";

export interface LightTickRuntime {
  repository: LightTickRepository;
  profile: LightTickProfileService;
  goals: LightTickGoalService;
  plans: LightTickPlanService;
  tasks: LightTickTaskService;
  today: LightTickTodayService;
  reviews: LightTickReviewService;
  proposals: LightTickProposalService;
  sync: LightTickSyncService;
  progressive: LightTickProgressiveService;
  jobs?: LightTickJobService;
  worker?: LightTickWorker;
  notifications?: LightTickNotificationService;
  guestIdentity?: LightTickGuestIdentityService;
}

export function createLightTickRuntime(repository: LightTickRepository): LightTickRuntime {
  const tasks = new LightTickTaskService(repository);
  return {
    repository,
    profile: new LightTickProfileService(repository),
    goals: new LightTickGoalService(repository),
    plans: new LightTickPlanService(repository),
    tasks,
    today: new LightTickTodayService(repository),
    reviews: new LightTickReviewService(repository),
    proposals: new LightTickProposalService(repository),
    sync: new LightTickSyncService(repository, tasks),
    progressive: new LightTickProgressiveService(repository, tasks),
  };
}
