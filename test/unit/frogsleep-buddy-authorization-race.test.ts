import assert from "node:assert/strict";
import test from "node:test";
import { ApplicationError } from "../../src/shared/errors.ts";
import { BuddyConsentService } from "../../src/modules/frogsleep/buddy-growth/buddy-consent.service.ts";
import type { ApplicationDatabase } from "../../src/infrastructure/database/application-database.ts";

const denied = (error: unknown) => error instanceof ApplicationError && [403, 404].includes(error.statusCode);

function fixture() {
  const relationship = { id: "sleep-A", kind: "sleep_relationship", appId: "frogsleep",
    ownerUserId: "A", partnerUserId: "B", status: "active", payload: {} };
  const grant = { id: "grant-B-A", appId: "frogsleep", relationshipId: "sleep-A", domain: "sleep",
    grantorUserId: "B", granteeUserId: "A", category: "daily_summary", state: "granted", version: 1 };
  const state = { relationship, grants: [grant], blocked: false, afterRead: undefined as (() => void) | undefined };
  const database = {
    findFrogSleepBuddyDomainRelationship: async () => undefined,
    listCurrentFrogSleepBuddyDomainRelationships: async () => [],
    findFrogSleepEntity: async (kind: string) => kind === "sleep_relationship" ? structuredClone(relationship) : undefined,
    listFrogSleepEntities: async () => state.blocked ? [{ status: "blocked" }] : [],
    listFrogSleepBuddySharingGrants: async () => {
      const snapshot = structuredClone(state.grants);
      const hook = state.afterRead; state.afterRead = undefined; hook?.();
      return snapshot;
    },
  } as unknown as ApplicationDatabase;
  return { state, service: new BuddyConsentService(database) };
}

for (const status of ["paused", "revoked"]) {
  test(`sharing read rejects relationship ${status} during grant lookup`, async () => {
    const { state, service } = fixture();
    state.afterRead = () => { state.relationship.status = status; };
    await assert.rejects(service.assertAuthorized("A", "sleep-A", "daily_summary"), denied);
  });
}

test("sharing read rejects consent revoked during grant lookup", async () => {
  const { state, service } = fixture();
  state.afterRead = () => { state.grants[0].state = "revoked"; state.grants[0].version++; };
  await assert.rejects(service.assertAuthorized("A", "sleep-A", "daily_summary"), denied);
});

test("sharing read rejects revoke and regrant even when final state is granted", async () => {
  const { state, service } = fixture();
  state.afterRead = () => { state.grants[0].version += 2; };
  await assert.rejects(service.assertAuthorized("A", "sleep-A", "daily_summary"), denied);
});

test("wrong domain grant cannot authorize sleep results", async () => {
  const { state, service } = fixture(); state.grants[0].domain = "focus";
  await assert.rejects(service.assertAuthorized("A", "sleep-A", "daily_summary"), denied);
});

test("block during a read denies data to a previously authorized viewer", async () => {
  const { state, service } = fixture(); state.afterRead = () => { state.blocked = true; };
  await assert.rejects(service.assertAuthorized("A", "sleep-A", "daily_summary"), denied);
});

test("stable directional grant succeeds while unrelated identity cannot read", async () => {
  const { service } = fixture();
  await service.assertAuthorized("A", "sleep-A", "daily_summary");
  await assert.rejects(service.assertAuthorized("C", "sleep-A", "daily_summary"), denied);
});

for (const status of ["active", "paused", "revoked"] as const) {
  test(`normalized ${status} relationship without grants never backfills legacy consent`, async () => {
    let writes = 0;
    const database = {
      findFrogSleepBuddyDomainRelationship: async () => ({ id: "domain-A", appId: "frogsleep", domain: "sleep",
        userIdLow: "A", userIdHigh: "B", status }),
      listFrogSleepEntities: async () => [],
      listFrogSleepBuddySharingGrants: async () => [],
      upsertFrogSleepBuddySharingGrant: async () => { writes++; },
    } as unknown as ApplicationDatabase;
    await assert.rejects(new BuddyConsentService(database).assertAuthorized("A", "domain-A", "daily_summary"));
    assert.equal(writes, 0);
  });
}
