import type {
  LlmBoundedAggregateGroup,
  LlmCallObservationRecord,
  LlmCrossAggregate,
  LlmHealthFailureAggregate,
  LlmObservabilityFilter,
  LlmObservabilityQueryResult,
  LlmObservabilityStore,
  LlmObservationAggregate,
  LlmOperation,
  LlmProviderAggregate,
  LlmProviderModelAggregate,
  LlmRouteAggregate,
  LlmRouteHealthKey,
  LlmRouteHealthRecord,
  LlmTimelineAggregate,
} from "../llm-observability-store.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
interface PostgresSnapshotClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(): void;
}

const PROVIDER_LIMIT = 50;
const MODEL_LIMIT = 100;
const ROUTE_LIMIT = 500;
const HEALTH_FAILURE_LIMIT = 100;

const AGGREGATE_COLUMNS = `
  COUNT(*)::bigint AS request_count,
  COUNT(*) FILTER (WHERE outcome = 'success')::bigint AS success_count,
  COUNT(*) FILTER (WHERE outcome = 'failure')::bigint AS failure_count,
  COUNT(*) FILTER (WHERE outcome = 'timeout')::bigint AS timeout_count,
  COUNT(*) FILTER (WHERE outcome = 'cancelled')::bigint AS cancelled_count,
  COUNT(*) FILTER (WHERE outcome = 'success')::bigint AS latency_sample_count,
  COUNT(first_response_latency_ms)::bigint AS first_response_sample_count,
  ROUND(AVG(first_response_latency_ms)) AS avg_first_response_latency_ms,
  ROUND(AVG(total_latency_ms) FILTER (WHERE outcome = 'success')) AS avg_total_latency_ms,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY first_response_latency_ms)
    FILTER (WHERE first_response_latency_ms IS NOT NULL) AS p50_first_response_latency_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY first_response_latency_ms)
    FILTER (WHERE first_response_latency_ms IS NOT NULL) AS p95_first_response_latency_ms,
  percentile_disc(0.5) WITHIN GROUP (ORDER BY total_latency_ms)
    FILTER (WHERE outcome = 'success') AS p50_total_latency_ms,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY total_latency_ms)
    FILTER (WHERE outcome = 'success') AS p95_total_latency_ms,
  SUM(prompt_tokens) FILTER (WHERE usage_source <> 'missing') AS prompt_tokens,
  SUM(GREATEST(completion_tokens - COALESCE(reasoning_tokens, 0), 0))
    FILTER (WHERE usage_source <> 'missing' AND completion_tokens IS NOT NULL) AS visible_output_tokens,
  SUM(reasoning_tokens) FILTER (WHERE usage_source <> 'missing') AS reasoning_tokens,
  SUM(GREATEST(
    total_tokens - COALESCE(prompt_tokens, 0) -
    GREATEST(COALESCE(completion_tokens, 0) - COALESCE(reasoning_tokens, 0), 0) -
    COALESCE(reasoning_tokens, 0),
    0
  )) FILTER (WHERE usage_source <> 'missing' AND total_tokens IS NOT NULL) AS unclassified_tokens,
  SUM(total_tokens) FILTER (WHERE usage_source <> 'missing') AS total_tokens,
  COUNT(*) FILTER (WHERE usage_source = 'provider')::bigint AS provider_usage_count,
  COUNT(*) FILTER (WHERE usage_source = 'estimated')::bigint AS estimated_usage_count,
  COUNT(*) FILTER (WHERE usage_source = 'missing')::bigint AS missing_usage_count`;

export class PostgresLlmObservabilityStore implements LlmObservabilityStore {
  constructor(
    private readonly query: PostgresQuery,
    private readonly connect?: () => Promise<PostgresSnapshotClient>,
  ) {}

  async recordObservation(record: LlmCallObservationRecord): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO zook_llm_call_observations (
           call_id, occurred_at, app_id, routing_model_key, provider, provider_model,
           operation, response_mode, outcome, health_impact,
           first_response_latency_ms, total_latency_ms,
           prompt_tokens, completion_tokens, reasoning_tokens, total_tokens,
           usage_source, error_code, error_message, routing_config_revision
         )
         VALUES (
           $1, $2::timestamptz, $3, $4, $5, $6,
           $7, $8, $9, $10,
           $11, $12, $13, $14, $15, $16,
           $17, $18, $19, $20
         )
         ON CONFLICT (call_id) DO NOTHING
         RETURNING call_id`,
      [
        record.callId,
        record.occurredAt,
        record.appId ?? null,
        record.routingModelKey,
        record.provider,
        record.providerModel,
        record.operation,
        record.responseMode,
        record.outcome,
        record.healthImpact,
        record.firstResponseLatencyMs ?? null,
        record.totalLatencyMs,
        record.promptTokens ?? null,
        record.completionTokens ?? null,
        record.reasoningTokens ?? null,
        record.totalTokens ?? null,
        record.usageSource,
        record.errorCode ?? null,
        record.errorMessage ?? null,
        record.routingConfigRevision ?? null,
      ],
    );
    return Boolean(result.rows[0]?.call_id);
  }

  async getRouteHealth(key: LlmRouteHealthKey): Promise<LlmRouteHealthRecord | undefined> {
    const result = await this.query(
      `WITH recent AS (
         SELECT call_id, occurred_at, health_impact
         FROM zook_llm_call_observations
         WHERE routing_model_key = $1 AND provider = $2 AND provider_model = $3 AND operation = $4
           AND health_impact <> 'neutral'
         ORDER BY occurred_at DESC, call_id DESC
         LIMIT 100
       )
       SELECT
         (SELECT COUNT(*)::bigint FROM recent) AS total_calls,
         (SELECT ARRAY_AGG(health_impact = 'success' ORDER BY occurred_at ASC, call_id ASC) FROM recent) AS recent_outcomes,
         (SELECT MAX(occurred_at) FROM recent WHERE health_impact = 'failure') AS last_error_at,
         (SELECT MAX(occurred_at) FROM recent) AS updated_at`,
      [key.routingModelKey, key.provider, key.providerModel, key.operation],
    );
    const row = result.rows[0];
    if (!row || numberValue(row.total_calls) === 0) return undefined;
    return {
      ...key,
      totalCalls: numberValue(row.total_calls),
      recentOutcomes: Array.isArray(row.recent_outcomes)
        ? row.recent_outcomes.map(Boolean)
        : [],
      lastErrorAt: row.last_error_at ? toIsoString(row.last_error_at) : undefined,
      updatedAt: toIsoString(row.updated_at),
    };
  }

  async queryMetrics(filter: LlmObservabilityFilter): Promise<LlmObservabilityQueryResult> {
    if (!this.connect) return this.queryMetricsWith(this.query, filter);
    const client = await this.connect();
    try {
      await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const result = await this.queryMetricsWith(
        async (sql, values = []) => await client.query(sql, values),
        filter,
      );
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  async queryRoutingModelRequestCounts(
    filter: LlmObservabilityFilter,
  ): Promise<Record<string, number>> {
    const query = buildWhere(filter);
    const result = await this.query(
      `SELECT routing_model_key, COUNT(*)::bigint AS request_count
       FROM zook_llm_call_observations ${query.where}
       GROUP BY routing_model_key`,
      query.values,
    );
    return Object.fromEntries(
      result.rows.map((row) => [String(row.routing_model_key), numberValue(row.request_count)]),
    );
  }

  private async queryMetricsWith(
    query: PostgresQuery,
    filter: LlmObservabilityFilter,
  ): Promise<LlmObservabilityQueryResult> {
    const full = buildWhere(filter);
    const routing = buildWhere({ ...filter, provider: undefined, providerModel: undefined });
    const providerScope = buildWhere({ ...filter, provider: undefined });
    const revisions = buildWhere({
      ...filter,
      provider: undefined,
      providerModel: undefined,
      routingModelKey: undefined,
    });
    const summaryResult = await query(`SELECT ${AGGREGATE_COLUMNS} FROM zook_llm_call_observations ${full.where}`, full.values);
    const latencyResult = await query(
      `SELECT operation, ${AGGREGATE_COLUMNS}
       FROM zook_llm_call_observations ${full.where}
       GROUP BY operation ORDER BY operation`,
      full.values,
    );
    const timelineResult = await query(buildTimelineSql(filter.granularity, full.where), full.values);
    const providers = await query(buildProviderGroupedSql(providerScope.where, PROVIDER_LIMIT), providerScope.values);
    const models = await query(buildGroupedSql("provider_model, operation", full.where, MODEL_LIMIT), full.values);
    const cross = await query(buildGroupedSql("provider, provider_model, operation", full.where, ROUTE_LIMIT), full.values);
    const routes = await query(buildRouteGroupedSql(routing.where, ROUTE_LIMIT), routing.values);
    const healthFailures = await query(
      buildHealthFailureGroupedSql(full.where, HEALTH_FAILURE_LIMIT),
      full.values,
    );
    const availableResult = await query("SELECT MIN(occurred_at) AS data_available_since FROM zook_llm_call_observations");
    const revisionsResult = await query(
      `SELECT DISTINCT routing_config_revision
       FROM zook_llm_call_observations ${revisions.where}
         AND routing_config_revision IS NOT NULL
       ORDER BY routing_config_revision`,
      revisions.values,
    );

    return {
      dataAvailableSince: availableResult.rows[0]?.data_available_since
        ? toIsoString(availableResult.rows[0].data_available_since)
        : undefined,
      summary: parseAggregate(summaryResult.rows[0] ?? {}),
      latencyByOperation: Object.fromEntries(
        latencyResult.rows.map((row) => [String(row.operation), parseAggregate(row)]),
      ),
      timeline: timelineResult.rows.map((row) => ({
        bucket: String(row.bucket),
        ...parseAggregate(row),
      })),
      providers: parseBounded(providers.rows, PROVIDER_LIMIT, (row) => ({
        provider: String(row.provider),
        operation: String(row.operation) as LlmOperation,
        operationRequestCount: numberValue(row.operation_request_count),
        ...parseAggregate(row),
      })),
      providerModels: parseBounded(models.rows, MODEL_LIMIT, (row) => ({
        providerModel: String(row.provider_model),
        operation: String(row.operation) as LlmOperation,
        ...parseAggregate(row),
      })),
      routes: parseBounded(routes.rows, ROUTE_LIMIT, (row) => ({
        routingModelKey: String(row.routing_model_key),
        provider: String(row.provider),
        providerModel: String(row.provider_model),
        operation: String(row.operation) as LlmOperation,
        routingModelRequestCount: numberValue(row.routing_model_request_count),
        ...parseAggregate(row),
      })),
      cross: parseBounded(cross.rows, ROUTE_LIMIT, (row): LlmCrossAggregate => ({
        provider: String(row.provider),
        providerModel: String(row.provider_model),
        operation: String(row.operation) as LlmOperation,
        ...parseAggregate(row),
      })),
      healthFailures: parseBounded(
        healthFailures.rows,
        HEALTH_FAILURE_LIMIT,
        (row): LlmHealthFailureAggregate => ({
          routingModelKey: String(row.routing_model_key),
          provider: String(row.provider),
          providerModel: String(row.provider_model),
          operation: String(row.operation) as LlmOperation,
          errorCode: String(row.error_code),
          errorMessage: row.error_message ? String(row.error_message) : undefined,
          count: numberValue(row.failure_count),
          lastOccurredAt: toIsoString(row.last_occurred_at),
        }),
      ),
      routingConfigRevisions: revisionsResult.rows.map((row) => numberValue(row.routing_config_revision)),
    };
  }

  async deleteBefore(cutoffIso: string): Promise<{ observations: number }> {
    const result = await this.query(
      `WITH deleted_observations AS (
         DELETE FROM zook_llm_call_observations WHERE occurred_at < $1::timestamptz RETURNING 1
       )
       SELECT (SELECT COUNT(*) FROM deleted_observations)::bigint AS observations`,
      [cutoffIso],
    );
    return { observations: numberValue(result.rows[0]?.observations) };
  }
}

function buildWhere(filter: LlmObservabilityFilter): { where: string; values: unknown[] } {
  const clauses = ["occurred_at >= $1::timestamptz", "occurred_at < $2::timestamptz"];
  const values: unknown[] = [filter.occurredAtFrom, filter.occurredAtTo];
  for (const [column, value] of [
    ["operation", filter.operation],
    ["provider", filter.provider],
    ["provider_model", filter.providerModel],
    ["routing_model_key", filter.routingModelKey],
    ["app_id", filter.appId],
  ] as const) {
    if (!value) continue;
    values.push(value);
    clauses.push(`${column} = $${values.length}`);
  }
  return { where: `WHERE ${clauses.join(" AND ")}`, values };
}

function buildTimelineSql(granularity: "hour" | "day", where: string): string {
  const format = granularity === "hour" ? "YYYY-MM-DD-HH24" : "YYYY-MM-DD";
  return `SELECT
      to_char(date_trunc('${granularity}', occurred_at AT TIME ZONE 'Asia/Shanghai'), '${format}') AS bucket,
      ${AGGREGATE_COLUMNS}
    FROM zook_llm_call_observations ${where}
    GROUP BY bucket ORDER BY bucket`;
}

function buildGroupedSql(columns: string, where: string, limit: number): string {
  return `WITH grouped AS (
      SELECT ${columns}, ${AGGREGATE_COLUMNS}
      FROM zook_llm_call_observations ${where}
      GROUP BY ${columns}
    ), counted AS (
      SELECT *, COUNT(*) OVER()::bigint AS total_count FROM grouped
    )
    SELECT * FROM counted
    ORDER BY total_tokens DESC NULLS LAST, request_count DESC
    LIMIT ${limit}`;
}

function buildProviderGroupedSql(where: string, limit: number): string {
  return `WITH grouped AS (
      SELECT provider, operation, ${AGGREGATE_COLUMNS}
      FROM zook_llm_call_observations ${where}
      GROUP BY provider, operation
    ), counted AS (
      SELECT *,
        COUNT(*) OVER()::bigint AS total_count,
        SUM(request_count) OVER(PARTITION BY operation)::bigint AS operation_request_count
      FROM grouped
    )
    SELECT * FROM counted
    ORDER BY total_tokens DESC NULLS LAST, request_count DESC
    LIMIT ${limit}`;
}

function buildRouteGroupedSql(where: string, limit: number): string {
  return `WITH grouped AS (
      SELECT routing_model_key, provider, provider_model, operation, ${AGGREGATE_COLUMNS}
      FROM zook_llm_call_observations ${where}
      GROUP BY routing_model_key, provider, provider_model, operation
    ), counted AS (
      SELECT *,
        COUNT(*) OVER()::bigint AS total_count,
        SUM(request_count) OVER(PARTITION BY routing_model_key, operation)::bigint AS routing_model_request_count
      FROM grouped
    )
    SELECT * FROM counted
    ORDER BY total_tokens DESC NULLS LAST, request_count DESC
    LIMIT ${limit}`;
}

function buildHealthFailureGroupedSql(where: string, limit: number): string {
  return `WITH grouped AS (
      SELECT
        routing_model_key,
        provider,
        provider_model,
        operation,
        COALESCE(NULLIF(error_code, ''), 'UNKNOWN_ERROR') AS error_code,
        NULLIF(error_message, '') AS error_message,
        COUNT(*)::bigint AS failure_count,
        MAX(occurred_at) AS last_occurred_at
      FROM zook_llm_call_observations ${where}
        AND health_impact = 'failure'
      GROUP BY routing_model_key, provider, provider_model, operation,
        COALESCE(NULLIF(error_code, ''), 'UNKNOWN_ERROR'), NULLIF(error_message, '')
    ), counted AS (
      SELECT *, COUNT(*) OVER()::bigint AS total_count FROM grouped
    )
    SELECT * FROM counted
    ORDER BY failure_count DESC, last_occurred_at DESC
    LIMIT ${limit}`;
}

function parseAggregate(row: Record<string, unknown>): LlmObservationAggregate {
  return {
    requestCount: numberValue(row.request_count),
    successCount: numberValue(row.success_count),
    failureCount: numberValue(row.failure_count),
    timeoutCount: numberValue(row.timeout_count),
    cancelledCount: numberValue(row.cancelled_count),
    latencySampleCount: numberValue(row.latency_sample_count),
    firstResponseSampleCount: numberValue(row.first_response_sample_count),
    avgFirstResponseLatencyMs: optionalNumber(row.avg_first_response_latency_ms),
    avgTotalLatencyMs: optionalNumber(row.avg_total_latency_ms),
    p50FirstResponseLatencyMs: optionalNumber(row.p50_first_response_latency_ms),
    p95FirstResponseLatencyMs: optionalNumber(row.p95_first_response_latency_ms),
    p50TotalLatencyMs: optionalNumber(row.p50_total_latency_ms),
    p95TotalLatencyMs: optionalNumber(row.p95_total_latency_ms),
    promptTokens: optionalNumber(row.prompt_tokens),
    visibleOutputTokens: optionalNumber(row.visible_output_tokens),
    reasoningTokens: optionalNumber(row.reasoning_tokens),
    unclassifiedTokens: optionalNumber(row.unclassified_tokens),
    totalTokens: optionalNumber(row.total_tokens),
    providerUsageCount: numberValue(row.provider_usage_count),
    estimatedUsageCount: numberValue(row.estimated_usage_count),
    missingUsageCount: numberValue(row.missing_usage_count),
  };
}

function parseBounded<T>(
  rows: Record<string, unknown>[],
  limit: number,
  mapper: (row: Record<string, unknown>) => T,
): LlmBoundedAggregateGroup<T> {
  const totalCount = numberValue(rows[0]?.total_count);
  return { items: rows.map(mapper), totalCount, truncated: totalCount > limit };
}

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  return numberValue(value);
}
