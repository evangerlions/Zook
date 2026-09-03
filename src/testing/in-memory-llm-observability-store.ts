import type {
  LlmBoundedAggregateGroup,
  LlmCallObservationRecord,
  LlmCrossAggregate,
  LlmHealthFailureAggregate,
  LlmObservabilityFilter,
  LlmObservabilityQueryResult,
  LlmObservabilityStore,
  LlmOperation,
  LlmProviderAggregate,
  LlmProviderModelAggregate,
  LlmRouteAggregate,
  LlmRouteHealthKey,
  LlmRouteHealthRecord,
  LlmTimelineAggregate,
} from "../infrastructure/database/llm-observability-store.ts";
import { aggregateLlmObservations } from "../services/llm-observability-aggregation.ts";
import { toDateKey, toHourKey } from "../shared/utils.ts";

const PROVIDER_LIMIT = 50;
const MODEL_LIMIT = 100;
const ROUTE_LIMIT = 500;
const HEALTH_FAILURE_LIMIT = 100;

export class InMemoryLlmObservabilityStore implements LlmObservabilityStore {
  readonly observations: LlmCallObservationRecord[] = [];

  async recordObservation(record: LlmCallObservationRecord): Promise<boolean> {
    if (this.observations.some((item) => item.callId === record.callId)) {
      return false;
    }
    this.observations.push(structuredClone(record));
    return true;
  }

  async getRouteHealth(key: LlmRouteHealthKey): Promise<LlmRouteHealthRecord | undefined> {
    const matching = this.observations
      .filter((item) => item.routingModelKey === key.routingModelKey)
      .filter((item) => item.provider === key.provider && item.providerModel === key.providerModel)
      .filter((item) => item.operation === key.operation && item.healthImpact !== "neutral")
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt) || left.callId.localeCompare(right.callId));
    if (!matching.length) return undefined;
    const recent = matching.slice(-100);
    const lastFailure = [...recent].reverse().find((item) => item.healthImpact === "failure");
    return {
      ...key,
      totalCalls: recent.length,
      recentOutcomes: recent.map((item) => item.healthImpact === "success"),
      lastErrorAt: lastFailure?.occurredAt,
      updatedAt: matching.at(-1)!.occurredAt,
    };
  }

  async queryMetrics(filter: LlmObservabilityFilter): Promise<LlmObservabilityQueryResult> {
    const records = this.observations
      .filter((item) => item.occurredAt >= filter.occurredAtFrom && item.occurredAt < filter.occurredAtTo)
      .filter((item) => filter.operation ? item.operation === filter.operation : true)
      .filter((item) => filter.provider ? item.provider === filter.provider : true)
      .filter((item) => filter.providerModel ? item.providerModel === filter.providerModel : true);
    const rangeRecords = records.filter((item) => filter.routingModelKey
      ? item.routingModelKey === filter.routingModelKey
      : true);
    const routingRecords = this.observations
      .filter((item) => item.occurredAt >= filter.occurredAtFrom && item.occurredAt < filter.occurredAtTo)
      .filter((item) => filter.operation ? item.operation === filter.operation : true)
      .filter((item) => filter.routingModelKey ? item.routingModelKey === filter.routingModelKey : true);
    const providerRecords = this.observations
      .filter((item) => item.occurredAt >= filter.occurredAtFrom && item.occurredAt < filter.occurredAtTo)
      .filter((item) => filter.operation ? item.operation === filter.operation : true)
      .filter((item) => filter.providerModel ? item.providerModel === filter.providerModel : true)
      .filter((item) => filter.routingModelKey ? item.routingModelKey === filter.routingModelKey : true);
    const revisionRecords = this.observations
      .filter((item) => item.occurredAt >= filter.occurredAtFrom && item.occurredAt < filter.occurredAtTo)
      .filter((item) => filter.operation ? item.operation === filter.operation : true);
    const allFiltered = this.observations
      .filter((item) => filter.operation ? item.operation === filter.operation : true)
      .filter((item) => filter.provider ? item.provider === filter.provider : true)
      .filter((item) => filter.providerModel ? item.providerModel === filter.providerModel : true)
      .filter((item) => filter.routingModelKey ? item.routingModelKey === filter.routingModelKey : true);

    return {
      dataAvailableSince: allFiltered.map((item) => item.occurredAt).sort()[0],
      summary: aggregateLlmObservations(rangeRecords),
      latencyByOperation: Object.fromEntries(
        (["chat", "embedding"] as LlmOperation[]).map((operation) => [
          operation,
          aggregateLlmObservations(rangeRecords.filter((item) => item.operation === operation)),
        ]),
      ),
      timeline: groupTimeline(rangeRecords, filter.granularity),
      providers: bounded(groupByProvider(providerRecords), PROVIDER_LIMIT),
      providerModels: bounded(groupByProviderModel(rangeRecords), MODEL_LIMIT),
      routes: bounded(groupByRoute(routingRecords), ROUTE_LIMIT),
      cross: bounded(groupByCross(rangeRecords), ROUTE_LIMIT),
      healthFailures: boundedHealthFailures(
        groupHealthFailures(rangeRecords),
        HEALTH_FAILURE_LIMIT,
      ),
      routingConfigRevisions: Array.from(new Set(
        revisionRecords.map((item) => item.routingConfigRevision).filter((item): item is number => item !== undefined),
      )).sort((left, right) => left - right),
    };
  }

  async deleteBefore(cutoffIso: string): Promise<{ observations: number }> {
    const before = this.observations.length;
    const kept = this.observations.filter((item) => item.occurredAt >= cutoffIso);
    this.observations.splice(0, this.observations.length, ...kept);
    return { observations: before - kept.length };
  }
}

function groupTimeline(records: LlmCallObservationRecord[], granularity: "hour" | "day"): LlmTimelineAggregate[] {
  return group(records, (item) => granularity === "hour"
    ? toHourKey(new Date(item.occurredAt), "Asia/Shanghai")
    : toDateKey(new Date(item.occurredAt), "Asia/Shanghai"))
    .map(([bucket, items]) => ({ bucket, ...aggregateLlmObservations(items) }));
}

function groupByProvider(records: LlmCallObservationRecord[]): LlmProviderAggregate[] {
  const grouped = group(records, (item) => `${item.provider}\u0000${item.operation}`).map(([key, items]) => {
    const [provider, operation] = key.split("\u0000") as [string, LlmOperation];
    return { provider, operation, operationRequestCount: 0, ...aggregateLlmObservations(items) };
  });
  return grouped.map((item) => ({
    ...item,
    operationRequestCount: grouped
      .filter((candidate) => candidate.operation === item.operation)
      .reduce((sum, candidate) => sum + candidate.requestCount, 0),
  }));
}

function groupByProviderModel(records: LlmCallObservationRecord[]): LlmProviderModelAggregate[] {
  return group(records, (item) => `${item.providerModel}\u0000${item.operation}`).map(([key, items]) => {
    const [providerModel, operation] = key.split("\u0000") as [string, LlmOperation];
    return { providerModel, operation, ...aggregateLlmObservations(items) };
  });
}

function groupByRoute(records: LlmCallObservationRecord[]): LlmRouteAggregate[] {
  const grouped = group(records, (item) => [item.routingModelKey, item.provider, item.providerModel, item.operation].join("\u0000"))
    .map(([key, items]) => {
      const [routingModelKey, provider, providerModel, operation] = key.split("\u0000") as [string, string, string, LlmOperation];
      return { routingModelKey, provider, providerModel, operation, routingModelRequestCount: 0, ...aggregateLlmObservations(items) };
    });
  return grouped.map((item) => ({
    ...item,
    routingModelRequestCount: grouped
      .filter((candidate) => candidate.routingModelKey === item.routingModelKey && candidate.operation === item.operation)
      .reduce((sum, candidate) => sum + candidate.requestCount, 0),
  }));
}

function groupByCross(records: LlmCallObservationRecord[]): LlmCrossAggregate[] {
  return group(records, (item) => [item.provider, item.providerModel, item.operation].join("\u0000"))
    .map(([key, items]) => {
      const [provider, providerModel, operation] = key.split("\u0000") as [string, string, LlmOperation];
      return { provider, providerModel, operation, ...aggregateLlmObservations(items) };
    });
}

function groupHealthFailures(records: LlmCallObservationRecord[]): LlmHealthFailureAggregate[] {
  return group(
    records.filter((item) => item.healthImpact === "failure"),
    (item) => [
      item.routingModelKey,
      item.provider,
      item.providerModel,
      item.operation,
      item.errorCode || "UNKNOWN_ERROR",
      item.errorMessage || "",
    ].join("\u0000"),
  ).map(([key, items]) => {
    const [routingModelKey, provider, providerModel, operation, errorCode, errorMessage] =
      key.split("\u0000") as [string, string, string, LlmOperation, string, string];
    return {
      routingModelKey,
      provider,
      providerModel,
      operation,
      errorCode,
      errorMessage: errorMessage || undefined,
      count: items.length,
      lastOccurredAt: items.map((item) => item.occurredAt).sort().at(-1)!,
    };
  });
}

function group(
  records: LlmCallObservationRecord[],
  keyFor: (record: LlmCallObservationRecord) => string,
): Array<[string, LlmCallObservationRecord[]]> {
  const grouped = new Map<string, LlmCallObservationRecord[]>();
  for (const record of records) {
    grouped.set(keyFor(record), [...(grouped.get(keyFor(record)) ?? []), record]);
  }
  return [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function bounded<T extends { totalTokens?: number; requestCount: number }>(
  items: T[],
  limit: number,
): LlmBoundedAggregateGroup<T> {
  const sorted = [...items].sort((left, right) =>
    (right.totalTokens ?? 0) - (left.totalTokens ?? 0) || right.requestCount - left.requestCount,
  );
  return {
    items: sorted.slice(0, limit),
    totalCount: sorted.length,
    truncated: sorted.length > limit,
  };
}

function boundedHealthFailures(
  items: LlmHealthFailureAggregate[],
  limit: number,
): LlmBoundedAggregateGroup<LlmHealthFailureAggregate> {
  const sorted = [...items].sort((left, right) =>
    right.count - left.count || right.lastOccurredAt.localeCompare(left.lastOccurredAt),
  );
  return {
    items: sorted.slice(0, limit),
    totalCount: sorted.length,
    truncated: sorted.length > limit,
  };
}
