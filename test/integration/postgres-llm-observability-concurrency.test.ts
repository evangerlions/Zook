import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

import { PostgresLlmObservabilityStore } from "../../src/infrastructure/database/postgres/postgres-llm-observability.ts";

const databaseUrl = process.env.DATABASE_URL?.trim();

test("postgres LLM observation CTE is idempotent and concurrency-safe", { skip: !databaseUrl }, async () => {
  const schema = `zook_llm_obs_test_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const adminPool = new Pool({ connectionString: databaseUrl });
  let pool: Pool | undefined;
  try {
    await adminPool.query(`CREATE SCHEMA ${schema}`);
    const scopedUrl = new URL(databaseUrl!);
    scopedUrl.searchParams.set("options", `-c search_path=${schema}`);
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 24 });
    const migrationPath = fileURLToPath(new URL(
      "../../src/infrastructure/database/postgres/migrations/028_llm_call_observations.sql",
      import.meta.url,
    ));
    await pool.query(await readFile(migrationPath, "utf8"));
    const store = new PostgresLlmObservabilityStore(
      async (sql, values = []) => await pool!.query(sql, values),
      async () => await pool!.connect(),
    );
    const occurredAt = new Date("2026-08-25T10:00:00.000Z").toISOString();

    await Promise.all(Array.from({ length: 1000 }, (_, index) => store.recordObservation({
      callId: `pg_call_${index}`,
      occurredAt,
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation: "chat",
      responseMode: "stream",
      outcome: index % 10 === 0 ? "failure" : "success",
      healthImpact: index % 10 === 0 ? "failure" : "success",
      firstResponseLatencyMs: 30 + index % 20,
      totalLatencyMs: 100 + index % 200,
      promptTokens: 10,
      completionTokens: 8,
      reasoningTokens: 3,
      totalTokens: 18,
      usageSource: "provider",
      routingConfigRevision: 7,
    })));

    assert.equal(await store.recordObservation({
      callId: "pg_call_0",
      occurredAt,
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation: "chat",
      responseMode: "stream",
      outcome: "success",
      healthImpact: "success",
      totalLatencyMs: 1,
      usageSource: "missing",
    }), false);

    const metrics = await store.queryMetrics({
      occurredAtFrom: "2026-08-25T00:00:00.000Z",
      occurredAtTo: "2026-08-26T00:00:00.000Z",
      granularity: "hour",
    });
    assert.equal(metrics.summary.requestCount, 1000);
    assert.equal(metrics.summary.successCount, 900);
    assert.equal(metrics.summary.failureCount, 100);
    assert.equal(metrics.summary.totalTokens, 18_000);
    assert.equal(metrics.timeline.reduce((sum, item) => sum + item.requestCount, 0), 1000);
    assert.equal(metrics.routes.items[0]?.routingModelRequestCount, 1000);
    assert.equal(metrics.cross.items[0]?.requestCount, 1000);

    for (const [callId, provider] of [["share_a", "share-provider-a"], ["share_b", "share-provider-b"]] as const) {
      await store.recordObservation({
        callId,
        occurredAt,
        routingModelKey: "share-model",
        provider,
        providerModel: "share-upstream",
        operation: "chat",
        responseMode: "non_stream",
        outcome: "success",
        healthImpact: "success",
        totalLatencyMs: 100,
        usageSource: "missing",
      });
    }
    const filteredRouting = await store.queryMetrics({
      occurredAtFrom: "2026-08-25T00:00:00.000Z",
      occurredAtTo: "2026-08-26T00:00:00.000Z",
      granularity: "hour",
      provider: "share-provider-a",
    });
    assert.equal(filteredRouting.summary.requestCount, 1);
    assert.equal(filteredRouting.routes.items.filter((item) => item.routingModelKey === "share-model").length, 2);
    assert.equal(filteredRouting.routes.items.find((item) => item.provider === "share-provider-a")?.routingModelRequestCount, 2);

    const health = await store.getRouteHealth({
      routingModelKey: "model-a",
      provider: "provider-a",
      providerModel: "upstream-a",
      operation: "chat",
    });
    assert.equal(health?.totalCalls, 100);
    assert.equal(health?.recentOutcomes.length, 100);

    const orderedRecords = Array.from({ length: 150 }, (_, index) => ({
      callId: `ordered_${index}`,
      occurredAt: new Date(Date.parse("2026-08-20T00:00:00.000Z") + index * 1000).toISOString(),
      routingModelKey: "ordered-model",
      provider: "provider-a",
      providerModel: "ordered-upstream",
      operation: "chat" as const,
      responseMode: "non_stream" as const,
      outcome: index < 50 ? "failure" as const : "success" as const,
      healthImpact: index < 50 ? "failure" as const : "success" as const,
      totalLatencyMs: 100,
      usageSource: "missing" as const,
    })).reverse();
    await Promise.all(orderedRecords.map((record) => store.recordObservation(record)));
    const orderedHealth = await store.getRouteHealth({
      routingModelKey: "ordered-model",
      provider: "provider-a",
      providerModel: "ordered-upstream",
      operation: "chat",
    });
    assert.equal(orderedHealth?.recentOutcomes.length, 100);
    assert.equal(orderedHealth?.recentOutcomes.every(Boolean), true);
    assert.equal(orderedHealth?.lastErrorAt, undefined);
    assert.equal(orderedHealth?.updatedAt, "2026-08-20T00:02:29.000Z");

    await store.recordObservation({
      callId: "expired_call",
      occurredAt: "2026-06-01T00:00:00.000Z",
      routingModelKey: "expired",
      provider: "provider-a",
      providerModel: "expired",
      operation: "chat",
      responseMode: "non_stream",
      outcome: "success",
      healthImpact: "success",
      totalLatencyMs: 100,
      usageSource: "missing",
    });
    assert.equal((await store.deleteBefore("2026-07-21T00:00:00.000Z")).observations, 1);

    await pool.query(
      `INSERT INTO zook_llm_call_observations (
         call_id, occurred_at, routing_model_key, provider, provider_model,
         operation, response_mode, outcome, health_impact, total_latency_ms,
         prompt_tokens, completion_tokens, total_tokens, usage_source
       )
       SELECT
         'range_' || value,
         '2026-08-25T00:00:00.000Z'::timestamptz - (value % 30) * INTERVAL '1 day',
         'range-model', 'provider-a', 'range-upstream',
         'chat', 'non_stream', 'success', 'success', 100 + (value % 500),
         20, 10, 30, 'provider'
       FROM generate_series(1, 30000) AS value`,
    );
    const healthStartedAt = Date.now();
    const rangeHealth = await store.getRouteHealth({
      routingModelKey: "range-model",
      provider: "provider-a",
      providerModel: "range-upstream",
      operation: "chat",
    });
    assert.equal(rangeHealth?.recentOutcomes.length, 100);
    assert.ok(Date.now() - healthStartedAt < 1000);

    await pool.query(
      `INSERT INTO zook_llm_call_observations (
         call_id, occurred_at, routing_model_key, provider, provider_model,
         operation, response_mode, outcome, health_impact, total_latency_ms, usage_source
       )
       SELECT
         'neutral_' || value,
         '2026-08-25T00:00:00.000Z'::timestamptz + value * INTERVAL '1 millisecond',
         'neutral-heavy', 'provider-a', 'neutral-upstream',
         'chat', 'stream', 'cancelled', 'neutral', 100, 'missing'
       FROM generate_series(1, 30000) AS value
       UNION ALL
       SELECT
         'health_' || value,
         '2026-08-24T00:00:00.000Z'::timestamptz + value * INTERVAL '1 second',
         'neutral-heavy', 'provider-a', 'neutral-upstream',
         'chat', 'stream', 'success', 'success', 100, 'missing'
       FROM generate_series(1, 100) AS value`,
    );
    const neutralHealthStartedAt = Date.now();
    const neutralHeavyHealth = await store.getRouteHealth({
      routingModelKey: "neutral-heavy",
      provider: "provider-a",
      providerModel: "neutral-upstream",
      operation: "chat",
    });
    assert.equal(neutralHeavyHealth?.recentOutcomes.length, 100);
    assert.ok(Date.now() - neutralHealthStartedAt < 1000);
    const healthPlan = await pool.query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT call_id, occurred_at, health_impact
       FROM zook_llm_call_observations
       WHERE routing_model_key = 'neutral-heavy' AND provider = 'provider-a'
         AND provider_model = 'neutral-upstream' AND operation = 'chat'
         AND health_impact <> 'neutral'
       ORDER BY occurred_at DESC, call_id DESC
       LIMIT 100`,
    );
    assert.match(JSON.stringify(healthPlan.rows[0]?.["QUERY PLAN"]), /idx_zook_llm_observations_health_recent/);

    const explain = await pool.query(
      `EXPLAIN (ANALYZE, FORMAT JSON)
       SELECT percentile_disc(0.95) WITHIN GROUP (ORDER BY total_latency_ms)
       FROM zook_llm_call_observations
       WHERE occurred_at >= $1::timestamptz AND occurred_at < $2::timestamptz`,
      ["2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"],
    );
    const plan = explain.rows[0]?.["QUERY PLAN"]?.[0];
    assert.ok(Number(plan?.["Execution Time"] ?? 0) < 5000);
  } finally {
    await pool?.end().catch(() => undefined);
    await adminPool.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await adminPool.end();
  }
});
