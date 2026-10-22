import { randomBytes, randomUUID } from 'node:crypto';

export function validateSleepDevUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || !['app-dev.youwoai.net', '127.0.0.1', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Acceptance only permits the known dev origin or loopback, without credentials or path.');
  }
  if (url.hostname === 'app-dev.youwoai.net' && url.origin !== 'https://app-dev.youwoai.net') throw new Error('Dev requires HTTPS.');
  return url.origin;
}

/** Real HTTP acceptance; credentials and private resource bodies never enter the evidence. */
export async function runSleepDevAcceptance({ baseUrl, account, deletionAccount, expectedVersion, checkCors = true, onCheck = () => {} }) {
  const origin = validateSleepDevUrl(baseUrl), runId = randomUUID();
  const checks = [], guests = [], cleanup = [], sessions = [];
  const ensure = (condition, message) => { if (!condition) throw new Error(message); };
  const key = label => `sleep-dev-${runId}-${label}`;
  const path = suffix => `/api/v1/frogsleep${suffix}`;
  const record = (label, status, code) => { const item = { label, status, code }; checks.push(item); onCheck(item); };
  async function call(label, suffix, { method = 'GET', token, body, headers = {}, status = 200, code, platform = false } = {}) {
    const response = await fetch(origin + (platform ? suffix : path(suffix)), {
      method, redirect: 'error', headers: { accept: 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000),
    });
    let payload;
    try { payload = await response.json(); } catch { throw new Error(`${label}: non-JSON HTTP ${response.status}`); }
    ensure((Array.isArray(status) ? status : [status]).includes(response.status) && (!code || payload.code === code), `${label}: HTTP ${response.status} ${payload.code ?? 'UNKNOWN'}; expected ${status}${code ? ' '+code : ''}`);
    record(label, response.status, payload.code);
    return payload.data;
  }
  const state = (token, label = 'sync state') => call(label, '/product-data/personal-sync/state', { token });
  const raw = (id, value = 'original') => ({ session_id: id, schema_version: '1', status: 'completed',
    started_at: '2026-10-17T14:00:00.123456Z', ended_at: '2026-10-17T22:00:00Z', timezone: 'Asia/Shanghai',
    sleep_intent: 'night_sleep', data: { acceptance: value },
    events: [{ event_id: 'pause-one', type: 'paused', occurred_at: '2026-10-17T16:00:00Z', data: { reason: 'acceptance' } }] });
  const writeHeaders = (epoch, operation, revision) => ({ 'x-sync-epoch': epoch, 'idempotency-key': key(operation), ...(revision === undefined ? {} : { 'if-match': String(revision) }) });
  async function createGuest(label) {
    const body = { device_id: key('device-'+label), device_secret: randomBytes(32).toString('base64url'), platform: 'ios' };
    const headers = { 'idempotency-key': key('create-'+label) };
    const g = await call(label+' guest creation', '/account/guest-sessions', { method: 'POST', body, headers });
    ensure(g?.guest_user_id && g.access_token && g.refresh_token && g.guest_upgrade_token, 'Guest credential response is incomplete.');
    const guest = { ...g, deviceBody: body, createHeaders: headers, active: true };
    guests.push(guest); return guest;
  }
  async function login(credentials, label) {
    const session = await call(label, '/auth/password/login', { method: 'POST', body: { account: credentials.account, password: credentials.password } });
    ensure(session?.access_token && session.refresh_token, 'Registered login response is incomplete.');
    sessions.push(session); return session;
  }
  async function restore(token, route = '/product-data/personal-sync/restore', cursor) {
    const rows = []; let page;
    for (let count = 0; count < 150; count++) {
      page = await call('recovery page', route + '?limit=2' + (cursor ? '&cursor='+encodeURIComponent(cursor) : ''), { token });
      rows.push(...page.items);
      if (!page.pagination.has_more) return { ...page, items: rows };
      cursor = page.pagination.next_cursor;
    }
    throw new Error('Recovery exceeded the bounded acceptance page limit.');
  }
  async function deleteGuest(guest, label) {
    if (!guest.active) return;
    await call(label, '/me/account', { method: 'DELETE', token: guest.access_token }); guest.active = false;
  }
  async function cleanResource(token, kind, id, missingOk = false) {
    const collection = kind === 'sleep_report' ? 'sleep-reports' : 'sleep-sessions';
    const current = await call('cleanup current resource', `/product-data/${collection}/${encodeURIComponent(id)}`, { token, status: missingOk ? [200,404] : 200 });
    if (missingOk && !current) return;
    const revision = kind === 'sleep_report' ? current.revision : current.sleep_session.revision;
    const epoch = (await state(token, 'cleanup epoch')).sync_epoch;
    const receipt = await call('cleanup own acceptance resource', `/product-data/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE', token, headers: writeHeaders(epoch, 'cleanup-'+id, revision) });
    ensure((kind === 'sleep_report' ? receipt.resource : receipt.sleep_session).deleted, 'Deletion acknowledgement lost its tombstone.');
  }
  let health, outcome, failure;
  try {
    health = await call('dev health', '/api/health', { platform: true });
    ensure(health.status === 'ok', 'Dev health is not ready.');
    if (expectedVersion) ensure(health.version === expectedVersion, 'Dev version differs from the pinned release.');
    if (checkCors) {
      const requested = 'authorization,content-type,x-sync-epoch,idempotency-key,if-match';
      const response = await fetch(origin+path('/product-data/sleep-sessions/preflight'), { method: 'OPTIONS', redirect: 'error',
        headers: { origin: 'https://app-dev.youwoai.net', 'access-control-request-method': 'PUT', 'access-control-request-headers': requested }, signal: AbortSignal.timeout(20000) });
      ensure(response.status === 204 && response.headers.get('access-control-allow-origin') === 'https://app-dev.youwoai.net', 'Browser preflight was rejected.');
      ensure(response.headers.get('access-control-allow-methods')?.split(/,\s*/).includes('PUT'), 'Browser preflight does not allow PUT.');
      const allowed = response.headers.get('access-control-allow-headers')?.toLowerCase().split(/,\s*/) ?? [];
      ensure(requested.split(',').every(h => allowed.includes(h)), 'Browser preflight lost private sync headers.');
      record('browser PUT and sync headers', 204, 'OK');
    }
    await call('private raw route requires authentication', '/product-data/sleep-sessions', { status: 401 });
    const g = await createGuest('source'), token = g.access_token;
    const recovered = await call('lost creation acknowledgement replay', '/account/guest-sessions', { method: 'POST', body: g.deviceBody, headers: g.createHeaders });
    ensure(recovered.guest_user_id === g.guest_user_id && recovered.guest_upgrade_token === g.guest_upgrade_token, 'Creation retry changed the guest identity or proof.');
    const oldState = await state(token), epoch = oldState.sync_epoch;
    await call('guest platform restriction', '/api/v1/users/me', { token, platform: true, status: 403, code: 'FROGSLEEP_GUEST_SCOPE_FORBIDDEN' });
    await call('guest focus restriction', '/focus-buddy/sessions', { token, status: 403, code: 'FROGSLEEP_GUEST_SCOPE_FORBIDDEN' });
    const id1 = key('night-one'), id2 = key('night-two'), reportId = key('report');
    await call('raw headers are required', '/product-data/sleep-sessions', { method: 'POST', token, body: raw(id1), status: 400 });
    const saved = await call('raw creation', '/product-data/sleep-sessions', { method: 'POST', token, body: raw(id1), headers: writeHeaders(epoch, 'night-one') });
    ensure(saved.sleep_session.revision === 1 && saved.sleep_session.data.started_at.endsWith('.123Z'), 'Raw revision or timestamp normalization is incorrect.');
    const replay = await call('raw lost acknowledgement replay', '/product-data/sleep-sessions', { method: 'POST', token, body: raw(id1), headers: writeHeaders(epoch, 'night-one') });
    ensure(replay.sleep_session.sequence === saved.sleep_session.sequence, 'Raw replay added a second committed change.');
    await call('raw forged owner rejected', '/product-data/sleep-sessions', { method: 'POST', token, body: { ...raw(id1), owner_user_id: 'another-user' }, headers: writeHeaders(epoch, 'forged'), status: 403 });
    await call('raw key reuse conflict', '/product-data/sleep-sessions', { method: 'POST', token, body: raw(id1, 'different'), headers: writeHeaders(epoch, 'night-one'), status: 409, code: 'FROGSLEEP_SYNC_IDEMPOTENCY_CONFLICT' });
    await call('second raw creation', '/product-data/sleep-sessions', { method: 'POST', token, body: raw(id2), headers: writeHeaders(epoch, 'night-two') });
    const first = await call('fixed boundary first page', '/product-data/sleep-sessions?limit=1', { token });
    ensure(first.pagination.has_more && first.items[0].revision === 1, 'First restore page is incorrect.');
    await call('stale raw revision rejected', '/product-data/sleep-sessions/'+id1, { method: 'PUT', token, body: raw(id1, 'corrected'), headers: writeHeaders(epoch, 'stale-revision', 0), status: 409 });
    await call('raw PUT correction', '/product-data/sleep-sessions/'+id1, { method: 'PUT', token, body: raw(id1, 'corrected'), headers: writeHeaders(epoch, 'correction', 1) });
    await call('raw tombstone deletion', '/product-data/sleep-sessions/'+id2, { method: 'DELETE', token, headers: writeHeaders(epoch, 'delete-night-two', 1) });
    const second = await call('fixed boundary next page', '/product-data/sleep-sessions?limit=1&cursor='+encodeURIComponent(first.pagination.next_cursor), { token });
    ensure(second.items[0].id === id2 && !second.items[0].deleted && second.boundary === first.boundary, 'Writes changed the fixed restore view.');
    const changes = await restore(token, '/product-data/personal-sync/changes', second.changes_cursor);
    ensure(changes.items.some(r => r.id === id1 && r.revision === 2) && changes.items.some(r => r.id === id2 && r.deleted), 'Changes missed a revision or tombstone.');
    await call('stale upload cannot revive tombstone', '/product-data/sleep-sessions', { method: 'POST', token, body: raw(id2), headers: writeHeaders(epoch, 'revive'), status: 410 });
    await call('private report creation', '/product-data/sleep-reports', { method: 'POST', token, body: { snapshot_id: reportId, schema_version: '1', recorded_at: '2026-10-17T22:00:00Z', data: { acceptance: true } }, headers: writeHeaders(epoch, 'report') });
    const sourceRestore = await restore(token);
    ensure(sourceRestore.items.length === 3 && sourceRestore.items.filter(r => r.deleted).length === 1, 'Private recovery lost guest data.');
    let upgradeResult;
    if (account) {
      const registered = await login(account, 'registered target login'), target = registered.access_token;
      ensure(registered.user_id !== g.guest_user_id, 'Registered target is a guest.');
      if (deletionAccount) ensure(account.account !== deletionAccount.account, 'Read/write QA and deletion QA must be separate accounts.');
      const targetEpoch = (await state(target, 'target epoch')).sync_epoch;
      const checkpoint = await call('target checkpoint before upgrade', '/product-data/personal-sync/restore?limit=1', { token: target });
      const upgradeBody = { guest_user_id: g.guest_user_id, guest_upgrade_token: g.guest_upgrade_token, device_id: g.deviceBody.device_id, confirmed: true };
      const upgradeHeaders = writeHeaders(targetEpoch, 'upgrade');
      await call('legacy device identifier cannot transfer', '/account/upgrade', { method: 'POST', token: target, body: { guest_device_id: g.deviceBody.device_id }, status: 409, code: 'FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED' });
      await call('wrong transfer proof rejected', '/account/upgrade', { method: 'POST', token: target, body: { ...upgradeBody, guest_upgrade_token: 'fs_upg_'+randomBytes(32).toString('base64url') }, headers: upgradeHeaders, status: 401, code: 'FROGSLEEP_GUEST_PROOF_INVALID' });
      await call('wrong transfer device rejected', '/account/upgrade', { method: 'POST', token: target, body: { ...upgradeBody, device_id: 'wrong-device' }, headers: upgradeHeaders, status: 401 });
      await call('stale target epoch rejected', '/account/upgrade', { method: 'POST', token: target, body: upgradeBody, headers: { ...upgradeHeaders, 'x-sync-epoch': 'stale-epoch' }, status: 409, code: 'FROGSLEEP_SYNC_EPOCH_MISMATCH' });
      upgradeResult = await call('proven guest upgrade', '/account/upgrade', { method: 'POST', token: target, body: upgradeBody, headers: upgradeHeaders });
      g.active = false;
      cleanup.push(() => cleanResource(target, 'sleep_session', id1), () => cleanResource(target, 'sleep_report', reportId));
      ensure(upgradeResult.migrated_data_count === 3 && upgradeResult.deduplicated_data_count === 0 && upgradeResult.sync_epoch === targetEpoch, 'Upgrade counts or target epoch are incorrect.');
      const retried = await call('upgrade lost acknowledgement replay', '/account/upgrade', { method: 'POST', token: target, body: upgradeBody, headers: upgradeHeaders });
      ensure(retried.migrated_data_count === upgradeResult.migrated_data_count, 'Upgrade retry changed its receipt.');
      for (const stale of [token, recovered.access_token]) await call('every guest access session revoked', '/me', { token: stale, status: 401 });
      await call('guest refresh revoked', '/auth/token/refresh', { method: 'POST', body: { refresh_token: g.refresh_token }, status: 401 });
      await call('upgraded identity cannot recover', '/account/guest-sessions', { method: 'POST', body: g.deviceBody, headers: { 'idempotency-key': key('recover-upgraded') }, status: 401 });
      const migrated = await call('target raw restore', '/product-data/sleep-sessions/'+id1, { token: target });
      ensure(migrated.sleep_session.data.data.acceptance === 'corrected', 'Upgrade lost corrected raw history.');
      await call('target tombstone cannot be read as live', '/product-data/sleep-sessions/'+id2, { token: target, status: 404 });
      const targetChanges = await restore(target, '/product-data/personal-sync/changes', checkpoint.changes_cursor);
      ensure([id1, id2, reportId].every(id => targetChanges.items.some(r => r.id === id)), 'Target change feed missed a migrated resource.');
      const conflict = await createGuest('conflict'), conflictEpoch = (await state(conflict.access_token)).sync_epoch;
      const clashId = key('collision'), partialId = key('partial');
      await call('target collision resource', '/product-data/sleep-sessions', { method: 'POST', token: target, body: raw(clashId, 'target'), headers: writeHeaders(targetEpoch, 'target-clash') });
      cleanup.push(() => cleanResource(target, 'sleep_session', clashId));
      await call('source pre-conflict resource', '/product-data/sleep-sessions', { method: 'POST', token: conflict.access_token, body: raw(partialId), headers: writeHeaders(conflictEpoch, 'partial') });
      await call('source conflicting resource', '/product-data/sleep-sessions', { method: 'POST', token: conflict.access_token, body: raw(clashId, 'guest'), headers: writeHeaders(conflictEpoch, 'guest-clash') });
      cleanup.push(() => cleanResource(target, 'sleep_session', partialId, true));
      const before = await state(target, 'target sequence before collision');
      await call('upgrade collision rolls back', '/account/upgrade', { method: 'POST', token: target, body: { guest_user_id: conflict.guest_user_id, guest_upgrade_token: conflict.guest_upgrade_token, device_id: conflict.deviceBody.device_id, confirmed: true }, headers: writeHeaders(targetEpoch, 'conflicting-upgrade'), status: 409, code: 'FROGSLEEP_GUEST_DATA_CONFLICT' });
      ensure((await state(target, 'target sequence after collision')).sequence === before.sequence, 'Failed upgrade changed target state.');
      await call('no partial target resource', '/product-data/sleep-sessions/'+partialId, { token: target, status: 404 });
      ensure((await restore(conflict.access_token)).items.length === 2, 'Failed upgrade lost source history.');
      if (deletionAccount) {
        const disposable = await login(deletionAccount, 'explicit disposable account login');
        ensure(disposable.user_id !== registered.user_id, 'Deletion account resolves to the read/write QA identity.');
        const alternate = await login(deletionAccount, 'second disposable session');
        const oldEpoch = (await state(disposable.access_token, 'disposable epoch')).sync_epoch;
        const deleteId = key('deleted-account-night');
        await call('disposable private raw record', '/product-data/sleep-sessions', { method: 'POST', token: disposable.access_token, body: raw(deleteId), headers: writeHeaders(oldEpoch, 'disposable-night') });
        await call('second disposable private raw record', '/product-data/sleep-sessions', { method: 'POST', token: disposable.access_token, body: raw(deleteId+'-second'), headers: writeHeaders(oldEpoch, 'disposable-second') });
        const oldRecovery = await call('disposable recovery checkpoint', '/product-data/personal-sync/restore?limit=1', { token: disposable.access_token });
        ensure(oldRecovery.pagination.has_more === true && typeof oldRecovery.pagination.next_cursor === 'string' && oldRecovery.pagination.next_cursor.length > 0, 'Disposable recovery checkpoint did not return a real pagination cursor.');
        const preserved = await state(target, 'unrelated QA state before deletion');
        await call('disposable account deletion', '/me/account', { method: 'DELETE', token: disposable.access_token });
        for (const stale of [disposable.access_token, alternate.access_token]) await call('deleted account access rejected', '/product-data/personal-sync/restore', { token: stale, status: 401 });
        await call('deleted refresh rejected', '/auth/token/refresh', { method: 'POST', body: { refresh_token: alternate.refresh_token }, status: 401 });
        await call('late deleted upload rejected', '/product-data/sleep-sessions', { method: 'POST', token: disposable.access_token, body: raw(deleteId), headers: writeHeaders(oldEpoch, 'late-deleted'), status: 401 });
        await call('deleted identity is not auto-rejoined', '/auth/password/login', { method: 'POST', body: { account: deletionAccount.account, password: deletionAccount.password }, status: 403, code: 'APP_MEMBER_DELETED' });
        const fresh = await createGuest('fresh-after-deletion'), freshEpoch = (await state(fresh.access_token)).sync_epoch;
        ensure((await restore(fresh.access_token)).items.length === 0, 'New identity inherited deleted data.');
        await call('old epoch cannot upload into fresh identity', '/product-data/sleep-sessions', { method: 'POST', token: fresh.access_token, body: raw(deleteId), headers: writeHeaders(oldEpoch, 'old-epoch'), status: 409, code: 'FROGSLEEP_SYNC_EPOCH_MISMATCH' });
        await call('old recovery cursor cannot restore into fresh identity', '/product-data/personal-sync/restore?cursor='+encodeURIComponent(oldRecovery.pagination.next_cursor), { token: fresh.access_token, status: 409 });
        const own = await call('fresh identity explicitly saves new history', '/product-data/sleep-sessions', { method: 'POST', token: fresh.access_token, body: raw(key('fresh-night')), headers: writeHeaders(freshEpoch, 'fresh-save') });
        ensure(own.sleep_session.revision === 1, 'Fresh history did not start at its own first revision.');
        const after = await state(target, 'unrelated QA state after deletion');
        ensure(after.sequence === preserved.sequence && after.sync_epoch === preserved.sync_epoch, 'Deletion changed another account.');
      }
    }
    // Every run exercises deletion/recovery for its own anonymous identity as well.
    const deletedGuest = await createGuest('delete-guest'), deletedToken = deletedGuest.access_token;
    const deletedEpoch = (await state(deletedToken)).sync_epoch;
    await call('guest private data before deletion', '/product-data/sleep-sessions', { method: 'POST', token: deletedToken, body: raw(key('guest-delete-night')), headers: writeHeaders(deletedEpoch, 'guest-delete-night') });
    await call('second guest record before deletion', '/product-data/sleep-sessions', { method: 'POST', token: deletedToken, body: raw(key('guest-delete-second')), headers: writeHeaders(deletedEpoch, 'guest-delete-second') });
    const deletedRecovery = await call('guest checkpoint before deletion', '/product-data/personal-sync/restore?limit=1', { token: deletedToken });
    ensure(deletedRecovery.pagination.has_more === true && typeof deletedRecovery.pagination.next_cursor === 'string' && deletedRecovery.pagination.next_cursor.length > 0, 'Guest recovery checkpoint did not return a real pagination cursor.');
    await deleteGuest(deletedGuest, 'own guest account deletion');
    await call('deleted guest access rejected', '/product-data/personal-sync/restore', { token: deletedToken, status: 401 });
    await call('deleted guest refresh rejected', '/auth/token/refresh', { method: 'POST', body: { refresh_token: deletedGuest.refresh_token }, status: 401 });
    await call('deleted guest proof cannot resurrect identity', '/account/guest-sessions', { method: 'POST', body: deletedGuest.deviceBody, headers: { 'idempotency-key': key('deleted-recover') }, status: 401 });
    const freshGuest = await createGuest('fresh-guest-recovery'), newState = await state(freshGuest.access_token);
    ensure(newState.sequence === 0 && newState.sync_epoch !== deletedEpoch && (await restore(freshGuest.access_token)).items.length === 0, 'Fresh guest inherited deleted account state.');
    await call('deleted epoch cannot upload into new guest', '/product-data/sleep-sessions', { method: 'POST', token: freshGuest.access_token, body: raw(key('guest-delete-night')), headers: writeHeaders(deletedEpoch, 'guest-old-epoch'), status: 409, code: 'FROGSLEEP_SYNC_EPOCH_MISMATCH' });
    await call('deleted restore cursor cannot enter new guest', '/product-data/personal-sync/restore?cursor='+encodeURIComponent(deletedRecovery.pagination.next_cursor), { token: freshGuest.access_token, status: 409, code: 'FROGSLEEP_SYNC_CURSOR_INVALID' });
    const freshId = key('fresh-guest-night');
    await call('new guest explicitly starts fresh history', '/product-data/sleep-sessions', { method: 'POST', token: freshGuest.access_token, body: raw(freshId), headers: writeHeaders(newState.sync_epoch, 'fresh-guest-save') });
    const freshHistory = await restore(freshGuest.access_token);
    ensure(freshHistory.items.length === 1 && freshHistory.items[0].id === freshId && freshHistory.items[0].revision === 1, 'Fresh guest recovery revived old resources.');
    outcome = { complete: Boolean(account && deletionAccount), guest_sync: true, guest_deletion_recovery: true, guest_upgrade: Boolean(account), registered_deletion: Boolean(account && deletionAccount) };
  } catch (error) { failure = error instanceof Error ? error.message : 'Acceptance failed.'; }
  const cleanupFailures = [];
  for (const operation of cleanup) { try { await operation(); } catch (error) { cleanupFailures.push(error instanceof Error ? error.message : 'Resource cleanup failed.'); } }
  for (const guest of guests) { try { await deleteGuest(guest, 'cleanup own guest'); } catch (error) { cleanupFailures.push(error instanceof Error ? error.message : 'Guest cleanup failed.'); } }
  for (const session of sessions) { try { await call('close acceptance session', '/auth/logout', { method: 'POST', token: session.access_token, body: { refresh_token: session.refresh_token, scope: 'current' }, status: [200,401] }); } catch (error) { cleanupFailures.push(error instanceof Error ? error.message : 'Session cleanup failed.'); } }
  return { base_url: origin, version: health?.version, run_id: runId, ...outcome, passed: !failure && cleanupFailures.length === 0, failure, cleanup_failures: cleanupFailures, checks };
}
