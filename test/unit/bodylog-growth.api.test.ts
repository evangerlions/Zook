import { describe, it, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { BodyLogGrowthService } from "../../src/modules/bodylog/bodylog-growth.service.ts";
import type { BodyLogGrowthPlan, BodyLogGrowthMission, BodyLogGrowthReward } from "../../src/modules/bodylog/bodylog-growth.types.ts";
import type { BodyLogGrowthStore } from "../../src/infrastructure/bodylog-store-ports.ts";

describe("BodyLogGrowthService", () => {
  let service: BodyLogGrowthService;
  let mockDb: BodyLogGrowthStore;

  const mockPlan: BodyLogGrowthPlan = {
    id: "plan-1",
    userId: "user-1",
    startDate: "2026-08-27T00:00:00.000Z",
    endDate: "2026-09-03T00:00:00.000Z",
    status: "active",
    completedMissions: 0,
    totalMissions: 21,
    createdAt: "2026-08-27T00:00:00.000Z",
    updatedAt: "2026-08-27T00:00:00.000Z",
  };

  const mockMission: BodyLogGrowthMission = {
    id: "mission-1",
    planId: "plan-1",
    day: 1,
    type: "steps",
    target: 8000,
    completed: false,
    completedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  const mockReward: BodyLogGrowthReward = {
    id: "reward-1",
    planId: "plan-1",
    type: "badge",
    value: "7_day_champion",
    claimed: false,
    claimedAt: null,
    createdAt: "2026-08-27T00:00:00.000Z",
  };

  beforeEach(() => {
    mockDb = {
      createGrowthPlan: mock.fn(async () => mockPlan),
      findLatestGrowthPlan: mock.fn(async () => null),
      findActiveGrowthPlan: mock.fn(async () => null),
      findGrowthPlanById: mock.fn(async () => mockPlan),
      updateGrowthPlan: mock.fn(async () => mockPlan),
      incrementGrowthPlanCompletedMissions: mock.fn(async () => {}),
      createGrowthMission: mock.fn(async () => mockMission),
      findGrowthMissionsByPlanId: mock.fn(async () => [mockMission]),
      findGrowthMissionById: mock.fn(async () => mockMission),
      updateGrowthMission: mock.fn(async () => ({ ...mockMission, completed: true, completedAt: "2026-08-27T12:00:00.000Z" })),
      createGrowthReward: mock.fn(async () => mockReward),
      findGrowthRewardsByPlanId: mock.fn(async () => [mockReward]),
      findGrowthRewardById: mock.fn(async () => mockReward),
      updateGrowthReward: mock.fn(async () => ({ ...mockReward, claimed: true, claimedAt: "2026-08-27T12:00:00.000Z" })),
    } as unknown as BodyLogGrowthStore;

    service = new BodyLogGrowthService(mockDb);
  });

  describe("enroll", () => {
    it("should create a new 7-day plan with missions and rewards", async () => {
      const result = await service.enroll("user-1");

      assert.equal(result.userId, "user-1");
      assert.equal(result.status, "active");
      assert.equal(result.totalMissions, 21);
      assert.equal(result.completedMissions, 0);

      const createPlanMock = mockDb.createGrowthPlan as ReturnType<typeof mock.fn>;
      assert.equal(createPlanMock.mock.callCount(), 1);

      const createMissionMock = mockDb.createGrowthMission as ReturnType<typeof mock.fn>;
      assert.equal(createMissionMock.mock.callCount(), 21); // 7 days * 3 missions per day

      const createRewardMock = mockDb.createGrowthReward as ReturnType<typeof mock.fn>;
      assert.equal(createRewardMock.mock.callCount(), 1);
    });

    it("should reject enrollment if user already has an active plan", async () => {
      (mockDb.findActiveGrowthPlan as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => mockPlan);

      await assert.rejects(
        async () => service.enroll("user-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_PLAN_ACTIVE");
          assert.equal(error.statusCode, 409);
          return true;
        }
      );
    });
  });

  describe("getPlan", () => {
    it("should return plan details", async () => {
      const result = await service.getPlan("user-1", "plan-1");

      assert.equal(result.id, "plan-1");
      assert.equal(result.userId, "user-1");
    });

    it("should throw 404 if plan not found", async () => {
      (mockDb.findGrowthPlanById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => null);

      await assert.rejects(
        async () => service.getPlan("user-1", "non-existent"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_PLAN_NOT_FOUND");
          assert.equal(error.statusCode, 404);
          return true;
        }
      );
    });

    it("should throw 403 if user does not own the plan", async () => {
      await assert.rejects(
        async () => service.getPlan("user-2", "plan-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_PLAN_FORBIDDEN");
          assert.equal(error.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe("getMissions", () => {
    it("should return all missions for a plan", async () => {
      const missions = await service.getMissions("user-1", "plan-1");

      assert.equal(missions.length, 1);
      assert.equal(missions[0].id, "mission-1");
      assert.equal(missions[0].day, 1);
    });

    it("should throw 403 if user does not own the plan", async () => {
      await assert.rejects(
        async () => service.getMissions("user-2", "plan-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_PLAN_FORBIDDEN");
          assert.equal(error.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe("completeMission", () => {
    it("should mark a mission as completed", async () => {
      const result = await service.completeMission("user-1", "plan-1", "mission-1");

      assert.equal(result.completed, true);
      assert.ok(result.completedAt);

      const updateMissionMock = mockDb.updateGrowthMission as ReturnType<typeof mock.fn>;
      assert.equal(updateMissionMock.mock.callCount(), 1);

      const incrementMock = mockDb.incrementGrowthPlanCompletedMissions as ReturnType<typeof mock.fn>;
      assert.equal(incrementMock.mock.callCount(), 1);
    });

    it("should throw 400 if plan is not active", async () => {
      (mockDb.findGrowthPlanById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => ({
        ...mockPlan,
        status: "completed",
      }));

      await assert.rejects(
        async () => service.completeMission("user-1", "plan-1", "mission-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_PLAN_INACTIVE");
          assert.equal(error.statusCode, 400);
          return true;
        }
      );
    });

    it("should throw 404 if mission not found", async () => {
      (mockDb.findGrowthMissionById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => null);

      await assert.rejects(
        async () => service.completeMission("user-1", "plan-1", "non-existent"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_MISSION_NOT_FOUND");
          assert.equal(error.statusCode, 404);
          return true;
        }
      );
    });

    it("should throw 400 if mission does not belong to plan", async () => {
      (mockDb.findGrowthMissionById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => ({
        ...mockMission,
        planId: "plan-2",
      }));

      await assert.rejects(
        async () => service.completeMission("user-1", "plan-1", "mission-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_MISSION_MISMATCH");
          assert.equal(error.statusCode, 400);
          return true;
        }
      );
    });

    it("should throw 409 if mission already completed", async () => {
      (mockDb.findGrowthMissionById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => ({
        ...mockMission,
        completed: true,
      }));

      await assert.rejects(
        async () => service.completeMission("user-1", "plan-1", "mission-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_MISSION_COMPLETED");
          assert.equal(error.statusCode, 409);
          return true;
        }
      );
    });

    it("should mark plan as completed when all missions are done", async () => {
      // completeMission 会两次读取计划：getPlan 权限/状态检查（仍差 1 个任务），
      // 以及 increment 之后的最新计数（21/21 触发完成）。
      let planReads = 0;
      (mockDb.findGrowthPlanById as ReturnType<typeof mock.fn>).mock.mockImplementation(async () => {
        planReads += 1;
        return {
          ...mockPlan,
          completedMissions: planReads >= 2 ? mockPlan.totalMissions : mockPlan.totalMissions - 1,
        };
      });

      await service.completeMission("user-1", "plan-1", "mission-1");

      const updatePlanMock = mockDb.updateGrowthPlan as ReturnType<typeof mock.fn>;
      assert.equal(updatePlanMock.mock.callCount(), 1);
      assert.deepEqual(updatePlanMock.mock.calls[0].arguments[1], { status: "completed" });
    });
  });

  describe("getRewards", () => {
    it("should return all rewards for a plan", async () => {
      const rewards = await service.getRewards("user-1", "plan-1");

      assert.equal(rewards.length, 1);
      assert.equal(rewards[0].id, "reward-1");
      assert.equal(rewards[0].type, "badge");
    });

    it("should throw 403 if user does not own the plan", async () => {
      await assert.rejects(
        async () => service.getRewards("user-2", "plan-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_PLAN_FORBIDDEN");
          assert.equal(error.statusCode, 403);
          return true;
        }
      );
    });
  });

  describe("claimReward", () => {
    it("rejects rewards before plan completion without changing the reward", async () => {
      await assert.rejects(service.claimReward("user-1", "plan-1", "reward-1"), (error: any) => {
        assert.equal(error.code, "BODYLOG_GROWTH_PLAN_INACTIVE");
        assert.equal(error.statusCode, 409);
        return true;
      });
      assert.equal((mockDb.updateGrowthReward as ReturnType<typeof mock.fn>).mock.callCount(), 0);
    });
    it("should mark a reward as claimed", async () => {
      (mockDb.findGrowthPlanById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => ({ ...mockPlan, status: 'completed', completedMissions: 21 }));
      const result = await service.claimReward("user-1", "plan-1", "reward-1");

      assert.equal(result.claimed, true);
      assert.ok(result.claimedAt);

      const updateRewardMock = mockDb.updateGrowthReward as ReturnType<typeof mock.fn>;
      assert.equal(updateRewardMock.mock.callCount(), 1);
    });

    it("should throw 404 if reward not found", async () => {
      (mockDb.findGrowthRewardById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => null);

      await assert.rejects(
        async () => service.claimReward("user-1", "plan-1", "non-existent"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_REWARD_NOT_FOUND");
          assert.equal(error.statusCode, 404);
          return true;
        }
      );
    });

    it("should throw 400 if reward does not belong to plan", async () => {
      (mockDb.findGrowthRewardById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => ({
        ...mockReward,
        planId: "plan-2",
      }));

      await assert.rejects(
        async () => service.claimReward("user-1", "plan-1", "reward-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_REWARD_MISMATCH");
          assert.equal(error.statusCode, 400);
          return true;
        }
      );
    });

    it("should throw 409 if reward already claimed", async () => {
      (mockDb.findGrowthRewardById as ReturnType<typeof mock.fn>).mock.mockImplementationOnce(async () => ({
        ...mockReward,
        claimed: true,
      }));

      await assert.rejects(
        async () => service.claimReward("user-1", "plan-1", "reward-1"),
        (error: any) => {
          assert.equal(error.code, "BODYLOG_GROWTH_REWARD_CLAIMED");
          assert.equal(error.statusCode, 409);
          return true;
        }
      );
    });
  });
});
