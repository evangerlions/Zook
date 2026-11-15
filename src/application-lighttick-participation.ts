import { ParticipationService } from "./modules/lighttick/participation/participation.service.ts";
import type { LightTickRuntime } from "./modules/lighttick/lighttick-runtime.ts";
import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import type { CommonTestAccountService } from "./services/common-test-account.service.ts";
export function attachLightTickParticipation(
  rt: LightTickRuntime | undefined,
  db: ApplicationDatabase,
  tests: CommonTestAccountService,
  secrets: string[],
) {
  if (rt)
    rt.participation = new ParticipationService(
      rt.repository,
      secrets,
      async (id) => {
        const [user, member, test] = await Promise.all([
          db.findUserById(id),
          db.findAppUser("lighttick", id),
          tests.hasEnabledUserAccount("lighttick", id),
        ]);
        return {
          active: user?.status === "ACTIVE" && member?.status === "ACTIVE",
          joinedAt: member?.joinedAt ?? "",
          test,
        };
      },
    );
}
