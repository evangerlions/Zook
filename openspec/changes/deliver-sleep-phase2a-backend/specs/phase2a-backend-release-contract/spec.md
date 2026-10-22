## ADDED Requirements

### Requirement: Account endpoints independent of buddy capabilities

The backend SHALL serve app-scoped account login, me, refresh and logout when all ordinary Buddy capabilities are disabled.

#### Scenario: Buddy disabled
- **WHEN** all ordinary buddy flags are false
- **THEN** account endpoints remain functional without activating buddy commands

### Requirement: Private data and membership isolation

The backend MUST derive owner and app scope from authentication and MUST reject deleted membership tokens without affecting other apps.

#### Scenario: A and B
- **WHEN** two authenticated users upload and list personal focus data
- **THEN** each list contains only its owner records

#### Scenario: FrogSleep deletion
- **WHEN** a user deletes their FrogSleep account
- **THEN** FrogSleep data and sessions are invalidated while their other app memberships continue

### Requirement: Revocation and notification safety

The backend MUST revalidate relationship and directional grant on reads, writes and notification routes, including retries.

#### Scenario: Delayed notification
- **WHEN** a queued notification is opened after revocation
- **THEN** it cannot reveal the revoked partner data

### Requirement: Current release evidence

The backend SHALL record the candidate SHA, local and PostgreSQL results separately from dev/online provider checks.

#### Scenario: Unverified provider
- **WHEN** SES/APNs/FCM evidence is absent
- **THEN** production readiness remains incomplete and no deployment is inferred


### Requirement: Atomic private focus reporting identity

The backend MUST use authenticated app and owner scope with the optional opaque client session ID to atomically insert or update one live personal focus record, across processes and database connections.

#### Scenario: Repeated same content
- **WHEN** a caller retries an identical normalized report with the same client ID
- **THEN** the original server ID, created_at, content and first default timestamps are returned and personal session/minute totals do not increase

#### Scenario: Concurrent same key
- **WHEN** multiple database connections report the same app, owner and client ID concurrently
- **THEN** the database uniqueness constraint and atomic UPSERT retain one live row, independent of process-local locks

#### Scenario: Cross account and app
- **WHEN** different users or apps report the same client ID
- **THEN** their records and totals remain independent and body-supplied ownership cannot change the authenticated scope

#### Scenario: Changed same-key content
- **WHEN** corrected report content is submitted under an existing key
- **THEN** the original server ID and created_at are retained, one record is updated, and weekly/daily totals count its latest database-accepted content once without claiming revision-based conflict resolution

#### Scenario: Replay derived work
- **WHEN** an existing report is replayed or corrected
- **THEN** the first-insert milestone is not repeated; authorized shared detection may repair a missing derived moment but MUST NOT create another moment for the same relationship and server-session pair

### Requirement: Focus client ID compatibility

The backend SHALL accept matching session_id/sessionId string aliases of at most 128 characters containing non-whitespace text and SHALL preserve their case and whitespace as an opaque key.

#### Scenario: Missing client ID
- **WHEN** both ID aliases are omitted
- **THEN** the legacy append-only behavior is preserved

#### Scenario: Invalid or conflicting ID
- **WHEN** an ID is null, not a string, blank, oversized or conflicts with the other alias
- **THEN** 400 REQ_INVALID_BODY is returned before history is written

### Requirement: Recoverable legacy focus deduplication

The backend MUST install the unique focus constraint and consolidate existing known-key duplicates within one migration transaction without assigning unknown ownership.

#### Scenario: Upgrade historical duplicates
- **WHEN** live rows share app, owner and usable client ID
- **THEN** the earliest entity ID/created_at survive with the latest updated content, other rows are soft-deleted, shared-moment session references are repaired and private statistics count one live row

#### Scenario: Migration rollback and rerun
- **WHEN** the migration fails before commit or is applied again after success
- **THEN** failure preserves the original rows, references and index state; a rerun preserves the consolidated history

### Requirement: Independent explicit domain invitation commands

The backend MUST expose read-only per-domain preview state, decision_version and viewer actions and MUST atomically decide only the requested Sleep or Focus domain. Accept SHALL create its canonical relationship and slots without implicit sharing grants. Decline and cancel SHALL remain capability-independent and SHALL NOT create relationships or slots.

#### Scenario: Wrong account then correct login
- **WHEN** an unbound email invitation is accessed by another account
- **THEN** preview and commands return neutral unavailable without binding or private detail disclosure; only an explicit successful command by the matching recipient account binds that recipient

#### Scenario: Independent sibling
- **WHEN** Sleep is accepted while Focus is pending, declined or cancelled
- **THEN** preview reports each authoritative result, terminal domains have no mutation actions and a pending sibling can be explicitly decided

### Requirement: Original invitation decision replay

The backend MUST revalidate the authenticated app membership and action actor on replay, require the original version and key, and retain the original accepted relationship identity independently of current slots.

#### Scenario: Repeated or competing decision
- **WHEN** identical commands or accept/cancel competitors arrive on separate PostgreSQL connections
- **THEN** one decision, relationship and event are committed per domain; identical retries replay and losing conflicting commands roll back

#### Scenario: Relationship replaced
- **WHEN** the accepted relationship is revoked and the user occupies a new slot
- **THEN** the original command replays the original relationship with its current status without exposing the new relationship or recreating sharing

#### Scenario: Compatibility competition
- **WHEN** compatibility and canonical invitations compete for the same user and domain
- **THEN** both accept paths use ordered common slot locks and recheck existing relationships so only one current relationship is established in that domain

### Requirement: Recoverable invitation relationship receipts

The backend SHALL migrate original relationship receipts by exact app, domain, participant and decision-time identity only when there is one candidate, and SHALL preserve repeatability without guessing current slots.

#### Scenario: Upgrade old accepted decision
- **WHEN** the original relationship is uniquely identifiable
- **THEN** migration fills its receipt once and rerunning the migration preserves it; missing or ambiguous candidates remain unavailable for replay


### Requirement: Atomic directional selection

The backend MUST derive the grantor from authentication, expose absent canonical grants as read-only revoked/version-zero defaults, atomically validate all original category versions, and modify only that grantor's direction. New grants SHALL require an active unblocked relationship; revocation SHALL remain possible while paused.

#### Scenario: One direction granted
- **WHEN** A grants daily summary access to B
- **THEN** B may read A's shared summary and A may publish their own summary, while B's grants to A remain unchanged

#### Scenario: Concurrent or failing batch
- **WHEN** competing updates use the same original versions or an audit write fails
- **THEN** one version winner commits or the entire batch rolls back without partial grants

### Requirement: Participant-owned pause and terminal cleanup

The backend MUST serialize lifecycle and directional grant commands using the same participant/domain slot locks as acceptance. Pause SHALL retain occupied slots, resume SHALL remove only the actor's pause, and revoke SHALL be terminal and release only slots still pointing to that relationship.

#### Scenario: Both participants paused
- **WHEN** only one participant resumes
- **THEN** the relationship remains paused and no protected reads or new grants are allowed

#### Scenario: Old revoke after replacement
- **WHEN** an original revoked relationship command is replayed after a new invitation occupies the slot
- **THEN** the original receipt remains revoked and the new slot is unaffected

#### Scenario: Pending compatibility invitation
- **WHEN** lifecycle commands are attempted on a pending legacy Focus invitation relationship
- **THEN** it remains pending and cannot become accepted or occupy slots through pause/resume

#### Scenario: Shared sessions ended
- **WHEN** a relationship is paused, revoked or blocked, or shared_activity consent is withdrawn
- **THEN** its pending/active shared coordination sessions are terminated without modifying private Sleep/Focus history and cannot be revived through an old accept link

### Requirement: Bilateral block cleanup

The backend MUST revoke current canonical and compatibility relationships and directional grants across both domains under the pair's domain locks when either participant blocks the other. Unblock SHALL NOT restore terminated relationships, grants or shared sessions.

#### Scenario: Same partner in both domains
- **WHEN** one participant blocks the other
- **THEN** both domain relationships are revoked and their original slots become available

### Requirement: Relationship silence and current notification targets

The backend MUST keep each participant's per-relationship notification silence independent of grants and legacy sleep preferences, and MUST verify the real target kind and IDs, recipient, expiry, active relationship and incoming category on notification route opens and each Buddy worker retry. Delivery SHALL also honor current recipient silence; legacy shared-sleep Push enqueue SHALL honor the same silence and category gate.

#### Scenario: Retry after silence
- **WHEN** an earlier notification attempt is retried after the recipient mutes the relationship
- **THEN** no new feed or Push enqueue is produced and sharing authorization remains unchanged

#### Scenario: Forged or obsolete route
- **WHEN** a stored notification has mismatched target identifiers/type or is opened after expiry, pause, withdrawal, revocation or block
- **THEN** route resolution cannot expose the former target's protected data


### Requirement: Canonical two-account Focus journey

The backend MUST expose accepted canonical Focus relationships through existing Focus read endpoints without copying compatibility relationship facts. Private reporting SHALL persist independently of optional companion derivation.

#### Scenario: Concurrent private completions
- **WHEN** two independently authenticated participants complete overlapping private sessions and both shared_activity directions are granted
- **THEN** one shared moment per relationship and source-session pair is derived under common slot locks; each viewer receives stable moment identity and correctly oriented client session references; replay does not add minutes or moments

#### Scenario: Companion unavailable
- **WHEN** the relationship is paused, revoked or blocked, consent is absent, or companion derivation fails
- **THEN** private reporting still succeeds with authenticated owner-scoped history and statistics, without exposing unauthorized shared data

### Requirement: Participant-specific shared morning lifecycle

The backend MUST record each participant's morning acknowledgement independently and serialize shared begin, accept, event, grant and relationship changes under the same slot locks.

#### Scenario: One participant completes morning
- **WHEN** A completes morning while B has not completed
- **THEN** the shared session remains active, A's summary reflects completion and B's summary and recap do not attribute A's result to B

#### Scenario: Repeated concurrent events
- **WHEN** concurrent begin requests or identical actor/type/occurred_at events are retried, including repeated terminal morning or pause acknowledgement
- **THEN** one session and one logical event survive and one summary plus one recap per viewer is maintained; other events cannot reopen a terminal session

#### Scenario: Historical single-owner recap
- **WHEN** B reads an old recap owned by A
- **THEN** current daily-summary consent is checked and stored participant states are reprojected for B; missing viewer context returns a redacted placeholder


### Requirement: Durable notification retry identity

The backend MUST retain one logical job and stable in-app identity per outbox entry and serialize concurrent outbox, queue and recovery workers across database connections. Confirmed per-device receipts MUST survive process restart without keeping job state on a singleton.

#### Scenario: Partial provider failure
- **WHEN** one device is confirmed accepted while another receives a known retryable provider failure
- **THEN** replay uses the original job, never resends the confirmed device, retries the failed device with a five-attempt bound, and retains at most one due recovery event

#### Scenario: Interrupted or unknown handoff
- **WHEN** processing is persisted before a provider request and its acknowledgement is lost or the process terminates
- **THEN** recovery records outcome unknown and stops automatic resend for that device; it never claims physical device delivery or external exactly-once success

### Requirement: Actual Push delivery reauthorization and fallback

The backend MUST revalidate current membership, target, relationship, incoming grant, recipient silence, interruption preferences, capability and device identity on each actual Push attempt, including failed-event replay after outbox completion.

#### Scenario: Muted or revoked while queued
- **WHEN** the recipient mutes or disables the category, the relationship is paused/ended, or an incoming grant is withdrawn after enqueue
- **THEN** the former queued job cannot reach the provider on subsequent attempts

#### Scenario: No device or no provider
- **WHEN** no active owned device exists
- **THEN** Push converges without a failure loop while the viewer-scoped in-app notification and authorized route remain usable
- **WHEN** a configured provider is absent or returns a known failure
- **THEN** delivery records failure rather than successful logging and preserves in-app fallback

### Requirement: Current registered device owner

The backend MUST bind one live app/platform/token identity to its latest authenticated registrant and scope deletion and dispatch to its current owner. Upgrade SHALL retain the most recent explicit registration and soft-delete historical same-scope duplicates.

#### Scenario: Register after account change
- **WHEN** B registers a token that was registered by A in the same app/platform
- **THEN** A's queued job cannot deliver to B's current device and A cannot delete B's registration; tokens in another app remain independent

### Requirement: Truthful bounded invitation email outcomes

The backend MUST exclusively claim ready invitation emails, recheck current capability, target and bound recipient preference/block, distinguish provider acceptance from callback delivery, and retain processing outcomes that cannot be confirmed.

#### Scenario: Terminal, disabled or unknown email
- **WHEN** an invitation terminates, delivery is disabled or its bound recipient disables invitations before retry
- **THEN** no further email is sent
- **WHEN** processing expires or transport acknowledgement is unknown
- **THEN** the delivery enters outcome-unknown dead letter without blind automatic resend
