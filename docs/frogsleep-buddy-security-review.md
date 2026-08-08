# FrogSleep Buddy Security Review

Reviewed boundaries: invitation token/code preview, authenticated viewer actions, relationship/grant reads, block/report enforcement, notification routing, goals/reports, and analytics.

- Identifier enumeration and IDOR: protected resources require authenticated participant membership; failures use neutral unavailable responses.
- Token/code guessing: preview and response paths are rate-limited; tokens are not logged or emitted to analytics.
- Replay and races: mutations require idempotency keys and expected versions; terminal transitions and outbox writes are transactional.
- Authorization bypass: relationship state, bilateral block state, and directional category grants are checked server-side on every protected read/write.
- Notification leakage: APNs carries opaque notification ID and safe route metadata; current protected state is fetched after authentication.
- Consent removal: cached shares/reports are filtered again at read time and revoked relationships fail closed.
- Rate-limit evasion: limits are keyed by authenticated actor plus target/action window; unauthorized attempts have a separate budget.

Residual risk: distributed abuse across many accounts requires operational complaint monitoring. Mitigation is capability-level rollout shutdown and account enforcement. No high-severity unresolved finding remains in the reviewed scope.
