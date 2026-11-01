import assert from "node:assert/strict";
import test from "node:test";
import { BodyLogGroupService } from "../../src/modules/bodylog/bodylog-group.service.ts";
import { InMemoryBodyLogGroupStore } from "../../src/modules/bodylog/bodylog-stores.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import type { CheckInGroupRecord, GroupMemberRecord } from "../../src/modules/bodylog/bodylog-group.types.ts";

async function setup(targetStatus: GroupMemberRecord["status"] = "active") {
  const store = new InMemoryBodyLogGroupStore();
  const group: CheckInGroupRecord = {
    id: "group-test", appId: "bodylog", name: "Walk", icon: null,
    leaderUserId: "alice", sharedHabitIds: ["steps"], completionRule: "all",
    maxMembers: 3, status: "active", consecutiveDays: 0, maxConsecutive: 0,
    currentTier: null, lastActiveDate: null,
    createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z",
  };
  const members: GroupMemberRecord[] = [
    { id: "leader", groupId: group.id, userId: "alice", role: "leader", status: "active", invitationToken: null, joinedAt: group.createdAt },
    { id: "member", groupId: group.id, userId: "bob", role: "member", status: targetStatus, invitationToken: null, joinedAt: group.createdAt },
  ];
  await store.insertCheckInGroup(group);
  for (const member of members) await store.insertGroupMember(member);
  return { store, group, service: new BodyLogGroupService(store, new InMemoryDatabase()) };
}

test("group ownership transfer updates both roles, group owner and activity", async () => {
  const { store, group, service } = await setup();
  await service.transferGroupOwnership("alice", group.id, "bob");
  assert.equal((await store.findCheckInGroup(group.id))?.leaderUserId, "bob");
  assert.equal((await store.findGroupMember(group.id, "alice"))?.role, "admin");
  assert.equal((await store.findGroupMember(group.id, "bob"))?.role, "leader");
  const activities = await store.listGroupActivities(group.id);
  assert.equal(activities.length, 1);
  assert.equal(activities[0]?.type, "leader_changed");
  assert.equal(activities[0]?.actorUserId, "alice");
  assert.deepEqual(activities[0]?.payload, { newLeaderUserId: "bob" });
});

test("group ownership transfer rejects a non-leader before writing", async () => {
  const { store, group, service } = await setup();
  await assert.rejects(service.transferGroupOwnership("bob", group.id, "alice"),
    (error: unknown) => error instanceof ApplicationError && error.code === "GROUP_NOT_AUTHORIZED");
  assert.equal((await store.findCheckInGroup(group.id))?.leaderUserId, "alice");
  assert.equal((await store.listGroupActivities(group.id)).length, 0);
});

test("group ownership transfer rejects a pending target before changing the leader", async () => {
  const { store, group, service } = await setup("pending");
  await assert.rejects(service.transferGroupOwnership("alice", group.id, "bob"),
    (error: unknown) => error instanceof ApplicationError && error.code === "GROUP_NOT_MEMBER");
  assert.equal((await store.findGroupMember(group.id, "alice"))?.role, "leader");
  assert.equal((await store.listGroupActivities(group.id)).length, 0);
});
