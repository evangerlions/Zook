CREATE TABLE IF NOT EXISTS zook_llm_call_observations (
  call_id TEXT PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL,
  routing_model_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_model TEXT NOT NULL,
  operation TEXT NOT NULL CHECK (operation IN ('chat', 'embedding')),
  response_mode TEXT NOT NULL CHECK (response_mode IN ('stream', 'non_stream')),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'timeout', 'cancelled')),
  health_impact TEXT NOT NULL CHECK (health_impact IN ('success', 'failure', 'neutral')),
  first_response_latency_ms INTEGER,
  total_latency_ms INTEGER NOT NULL,
  prompt_tokens BIGINT,
  completion_tokens BIGINT,
  reasoning_tokens BIGINT,
  total_tokens BIGINT,
  usage_source TEXT NOT NULL CHECK (usage_source IN ('provider', 'estimated', 'missing')),
  error_code TEXT,
  routing_config_revision INTEGER
);

CREATE INDEX IF NOT EXISTS idx_zook_llm_observations_time
  ON zook_llm_call_observations(occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_zook_llm_observations_provider_time
  ON zook_llm_call_observations(provider, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_zook_llm_observations_model_time
  ON zook_llm_call_observations(provider_model, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_zook_llm_observations_route_time
  ON zook_llm_call_observations(routing_model_key, provider, provider_model, operation, occurred_at DESC, call_id DESC);
CREATE INDEX IF NOT EXISTS idx_zook_llm_observations_health_recent
  ON zook_llm_call_observations(routing_model_key, provider, provider_model, operation, occurred_at DESC, call_id DESC)
  WHERE health_impact <> 'neutral';
