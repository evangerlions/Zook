import { deliverBodyLogPush } from "../../src/services/bodylog-push-delivery.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { createApplication } from '../support/create-test-application.ts';
import { resolveBodyLogStores } from '../../src/application-bodylog-stores.ts';

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: 'bodylog', code: 'bodylog', name: 'BodyLog', nameI18n: { 'zh-CN': 'BodyLog', 'en-US': 'BodyLog' }, status: 'ACTIVE', apiDomain: 'bodylog.example.com', joinMode: 'AUTO', createdAt: new Date().toISOString() });
  for (const userId of ['user_alice', 'user_bob']) seed.appUsers!.push({ id: `bodylog_${userId}`, appId: 'bodylog', userId, status: 'ACTIVE', joinedAt: new Date().toISOString() });
  const runtime = await createApplication({ seed });
  const call = (userId: string, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) => runtime.app.handle({ method, path: `/api/v1/bodylog/${path}`, body, headers: { authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, 'bodylog')}` } });
  for (const userId of ['user_alice', 'user_bob']) assert.equal((await call(userId, 'GET', 'profile')).statusCode, 200);
  return { runtime, call };
}

test('BodyLog buddy invitation requires recipient consent and returns a usable URL', async () => {
  const { call } = await setup();
  const created = await call('user_bob', 'POST', 'buddies', { partnerUserId: 'user_alice', sharedHabitIds: ['steps'] });
  assert.equal(created.statusCode, 200);
  const { pair, invitationUrl } = created.body.data;
  assert.equal(new URL(invitationUrl).pathname, `/b/${pair.id}`);
  assert.equal((await call('user_bob', 'POST', `buddies/${pair.id}/accept`)).statusCode, 403);
  const accepted = await call('user_alice', 'POST', `buddies/${pair.id}/accept`);
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.body.data.status, 'active');
});

test('BodyLog group create, invite, join, detail, and leadership transfer stay consistent', async () => {
  const { runtime, call } = await setup();
  const created = await call('user_alice', 'POST', 'groups', { name: 'Walk', sharedHabitIds: ['steps'] });
  assert.equal(created.statusCode, 200);
  const { group, invitationUrl } = created.body.data;
  assert.ok(group.id);
  assert.equal(new URL(invitationUrl).pathname, `/g/${group.id}`);
  const invited = await call('user_alice', 'POST', `groups/${group.id}/invite`, { userId: 'user_bob' });
  assert.deepEqual(invited.body.data, { invited: true });
  const accepted = await call('user_bob', 'POST', `groups/${group.id}/accept`, { token: new URL(invitationUrl).searchParams.get('token') });
  assert.equal(accepted.statusCode, 200);
  const detail = await call('user_bob', 'GET', `groups/${group.id}`);
  assert.equal(detail.body.data.members.length, 2);
  assert.ok(Array.isArray(detail.body.data.recentActivities));
  assert.ok(Array.isArray(detail.body.data.weeklyRecords));
  assert.equal((await call('user_alice', 'POST', `groups/${group.id}/checkin`, { habitId: 'unshared' })).statusCode, 400);
  await Promise.all(['user_alice', 'user_bob'].map(user => call(user, 'POST', `groups/${group.id}/checkin`, { habitId: 'steps' })));
  const checked = await call('user_bob', 'GET', `groups/${group.id}`);
  assert.equal(checked.body.data.weeklyRecords[0].completedCount, 2);
  await call('user_alice', 'POST', `groups/${group.id}/leave`);
  assert.equal((await call('user_bob', 'GET', `groups/${group.id}`)).body.data.group.leaderUserId, 'user_bob');
  assert.equal((await call('user_alice', 'POST', `groups/${group.id}/invite`, { userId: 'user_alice' })).statusCode, 403);
});

test('BodyLog expired invitations release capacity and can be renewed', async () => {
  const { runtime, call } = await setup();
  const created = await call('user_bob', 'POST', 'buddies', { partnerUserId: 'user_alice', sharedHabitIds: ['steps'] });
  const store = resolveBodyLogStores(runtime.database).buddy;
  const pair = (await store.findBodyLogBuddyPair(created.body.data.pair.id))!;
  await store.updateBodyLogBuddyPair({ ...pair, createdAt: new Date(Date.now() - 15 * 86400000).toISOString() });
  assert.equal((await call('user_alice', 'POST', `buddies/${pair.id}/accept`)).statusCode, 410);
  const renewed = await call('user_bob', 'POST', 'buddies', { partnerUserId: 'user_alice', sharedHabitIds: ['steps'] });
  assert.equal(renewed.statusCode, 200);
  assert.equal(renewed.body.data.pair.id, pair.id);
  assert.notEqual(renewed.body.data.invitationUrl, created.body.data.invitationUrl);
  assert.equal((await call('user_alice', 'POST', `buddies/${pair.id}/accept`)).statusCode, 200);
});

test('BodyLog growth stays disabled and notification preferences/devices isolate users', async () => {
  const { call } = await setup();
  assert.equal((await call('user_alice', 'POST', 'seven-day-plan/enroll')).statusCode, 404);
  await call('user_alice', 'PUT', 'notification-preferences', { marketingConsent: true });
  await call('user_bob', 'PUT', 'notification-preferences', { marketingConsent: false });
  assert.equal((await call('user_alice', 'GET', 'notification-preferences')).body.data.marketingConsent, true);
  assert.equal((await call('user_alice', 'POST', 'push-devices', { deviceToken: 'device', platform: 'ios' })).statusCode, 200);
  await call('user_bob', 'POST', 'push-devices', { deviceToken: 'device', platform: 'ios' });
  assert.deepEqual((await call('user_alice', 'GET', 'push-devices')).body.data, []);
  assert.equal((await call('user_bob', 'GET', 'push-devices')).body.data.length, 1);
});


test('BodyLog local log retries are idempotent and preserve occurrence time', async () => {
  const { call } = await setup();
  const created = await call('user_alice', 'POST', 'buddies', { partnerUserId: 'user_bob', sharedHabitIds: ['water'] });
  const id = created.body.data.pair.id;
  await call('user_bob', 'POST', `buddies/${id}/accept`);
  const event = { habitId: 'water', count: 1, eventId: 'log-1', occurredAt: new Date().toISOString() };
  for (const response of await Promise.all([call('user_alice', 'POST', 'buddies/checkin', event), call('user_alice', 'POST', 'buddies/checkin', event)])) assert.equal(response.statusCode, 200);
  const feed = await call('user_alice', 'GET', `buddies/${id}`);
  assert.equal(feed.body.data.activities.filter((item: any) => item.type === 'checked_in').length, 1);
  assert.equal((await call('user_alice', 'POST', 'buddies/checkin', { ...event, count: 2 })).statusCode, 409);
  assert.equal((await call('user_alice', 'POST', 'buddies/checkin', { habitId: 'water', eventId: 'missing-date' })).statusCode, 400);
});

test('BodyLog cloud entitlement defaults to free without a server grant', async () => {
  const { call } = await setup();
  const response = await call('user_alice', 'GET', 'subscription/status');
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, { tier: 'free', expiresAt: null, autoRenew: false });
});


test('BodyLog latest plan survives completion and isolates accounts', async () => {
  const { runtime, call } = await setup();
  const stores = resolveBodyLogStores(runtime.database);
  await stores.flags.updateBodyLogFeatureFlag('growth', true);
  const enrolled = await call('user_alice', 'POST', 'seven-day-plan/enroll');
  const id = enrolled.body.data.id;
  await stores.growth.updateGrowthPlan(id, { status: 'completed', completedMissions: 21 });
  assert.equal((await call('user_alice', 'GET', 'seven-day-plan/active')).body.data, null);
  assert.equal((await call('user_alice', 'GET', 'seven-day-plan/latest')).body.data.id, id);
  assert.equal((await call('user_bob', 'GET', 'seven-day-plan/latest')).body.data, null);
});


test('BodyLog push uses owned devices, category preferences and invalidation', async () => {
  const { runtime, call } = await setup();
  await call('user_alice', 'POST', 'push-devices', { platform: 'ios', deviceToken: 'alice-token' });
  await call('user_bob', 'POST', 'push-devices', { platform: 'android', deviceToken: 'bob-token' });
  const sent: string[] = [];
  const dispatcher = { async dispatch(request: any) { sent.push(request.pushToken); await request.invalidateToken(); } };
  const record = { recipientUserId: 'user_alice', payload: { type: 'buddy_checked_in', title: 'Checkin', body: 'Done', data: {} } };
  await call('user_alice', 'PUT', 'notification-preferences', { enabledCategories: [] });
  await deliverBodyLogPush(runtime.database, dispatcher, record);
  assert.deepEqual(sent, []);
  await call('user_alice', 'PUT', 'notification-preferences', { enabledCategories: ['activity'] });
  await deliverBodyLogPush(runtime.database, dispatcher, record);
  assert.deepEqual(sent, ['alice-token']);
  assert.deepEqual((await call('user_alice', 'GET', 'push-devices')).body.data, []);
  assert.equal((await call('user_bob', 'GET', 'push-devices')).body.data.length, 1);
});
