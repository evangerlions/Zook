# LightTick Native Client Integration

## Scope

Production clients are native only:

- iOS: SwiftUI + async/await + generated `LightTickContracts` Swift Package.
- Android: Jetpack Compose + Coroutines/Flow + generated Kotlin contracts module.

`lighttick_flutter` is a historical interaction prototype and must not be linked,
embedded, or used as the source of API DTOs. Zook OpenAPI is the contract source.

## Shared flow

```text
fuzzy wish
  -> POST /api/v1/lighttick/onboarding/starter
  -> recommended starter (one) + alternatives (two)
  -> optional POST /tasks/{id}/variant
  -> POST /onboarding/first-action
  -> factual feedback + three-day preview
  -> second valid action or explicit deep planning
  -> POST /onboarding/commitment
```

Every mutation stores a stable `Idempotency-Key` before network dispatch. A retry
must reuse the same key and byte-equivalent semantic payload. `base_version`
comes from the last server snapshot. Version conflicts are surfaced to the user
or reconciled through `/sync/push`; clients must not silently overwrite them.

## iOS module boundary

```text
LightTickContracts (generated Swift Package)
  -> LightTickAPIClient (URLSession actor)
  -> ProgressiveOnboardingRepository
  -> ProgressiveOnboardingFeature (SwiftUI state machine)
  -> TodayFeature / GoalContinuityFeature

Shared App Group snapshot
  -> WidgetKit timeline
  -> App Intent task action
  -> Live Activity timer presentation
```

- Store session secrets in Keychain, never SwiftData or App Group defaults.
- Store snapshots and pending operations in SwiftData or GRDB; the operation ID
  is created before the first request.
- App Intents enqueue the same operation model as the main app. They do not
  implement a second task state machine.
- WidgetKit and Live Activities render the last verified Today snapshot. They
  do not invent completion or variant state while offline.
- Use `BGAppRefreshTask` for bounded snapshot refresh and `BGProcessingTask`
  only for queued sync that meets system constraints.

## Android module boundary

```text
lighttick-contracts (generated Kotlin module)
  -> LightTickApi (Retrofit/OkHttp)
  -> ProgressiveOnboardingRepository
  -> ViewModel (StateFlow)
  -> Compose screens

Room pending_operation
  -> WorkManager sync worker
  -> Glance/App Widget snapshot
  -> notification actions
```

- Store tokens in Android Keystore-backed encrypted storage.
- Room is the offline operation queue and snapshot cache; Zook version/cursor is
  authoritative.
- WorkManager retries only retryable failures and keeps the original operation
  ID. Conflict responses require the documented resolution action.
- Widgets and notification actions dispatch through the repository instead of
  mutating Room task rows directly.

## Required UI states

Both clients implement the same finite states: `notStarted`, `submittingWish`,
`starterReady`, `runningStarter`, `submittingFirstAction`, `threeDayActive`,
`commitmentEligible`, `committed`, and recoverable `failed`.

Today shows the recommended action immediately. “今天状态不同” is optional and
opens `light` and `minimum` variants. A paused goal shows a rest state and resume
choices; recovery mode shows only recovery-appropriate tasks. Existing users
with completed onboarding or an active goal continue to the existing main flow.

## Repository prerequisite

No standalone LightTick iOS or Android application repository is present in the
current workspace. Before production UI implementation, record the exact iOS
and Android repository paths and read their local `AGENTS.md` files. Do not infer
that unrelated native projects under `/Users/hao/Documents/project` are
LightTick clients.

## Acceptance

- Decode `progressive-starter-success.json` in both native contract packages.
- Complete the starter flow with AI disabled.
- Retry every mutation after a simulated lost response without duplication.
- Switch variants from the app, widget/intent, and notification action while
  preserving one lineage.
- Pause suppresses normal reminders and Today pressure; recovery completion
  records an effective return only within the documented window.
- An existing plan-first account reaches the current main experience unchanged.
