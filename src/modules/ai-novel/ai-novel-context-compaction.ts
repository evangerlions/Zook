import type { LLMMessage } from "../../services/llm-manager.ts";
import {
  estimateLlmContextRequestTokens,
  estimateLlmContextTextTokens,
} from "../../services/llm-usage-estimator.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";

export const AI_NOVEL_CONTEXT_MAX_TOKENS = 1_000_000;
export const AI_NOVEL_SOFT_COMPACT_RETAINED_TOOL_TOKENS = 40_000;
export const AI_NOVEL_SOFT_COMPACT_MINIMUM_SAVINGS_TOKENS = 20_000;
export const AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER =
  "[Old tool result content cleared; re-run the tool if needed.]";

export interface AiNovelContextCompactionInput {
  messages: LLMMessage[];
  providerOptions?: Record<string, unknown>;
  maxTokens?: number;
  maxContextTokens?: number;
  latestRoundStartIndex?: number;
}

export interface AiNovelContextCompactionResult {
  messages: LLMMessage[];
  estimatedRequestTokens: number;
  latestRoundStartIndex?: number;
  softCompactedToolResultCount: number;
  softCompactedTokens: number;
  droppedMessageCount: number;
  droppedTurnCount: number;
  didCompact: boolean;
  withinBudget: boolean;
}

export interface AiNovelCompactedRequestPlan<T> {
  plan: T;
  compaction: AiNovelContextCompactionResult;
}

export function compactAiNovelRequestPlan<T extends {
  messages: LLMMessage[];
  providerOptions?: Record<string, unknown>;
}>(
  plan: T,
  maxTokens: number,
  logger?: StructuredLogger,
  context: { requestId?: string; sceneKey?: string } = {},
): AiNovelCompactedRequestPlan<T> {
  const compaction = compactAiNovelContext({
    messages: plan.messages,
    providerOptions: plan.providerOptions,
    maxTokens,
  });
  if (compaction.didCompact) {
    logger?.info("AINovel provider context compacted", {
      ...context,
      originalLength: serializedRequestLength(plan.messages, plan.providerOptions),
      compactedLength: serializedRequestLength(
        compaction.messages,
        plan.providerOptions,
      ),
      originalEstimatedTokens: estimateRequestTokens(
        { messages: plan.messages, providerOptions: plan.providerOptions },
        plan.messages,
        maxTokens,
      ),
      compactedEstimatedTokens: compaction.estimatedRequestTokens,
      softCompactedToolResultCount: compaction.softCompactedToolResultCount,
      softCompactedTokens: compaction.softCompactedTokens,
      droppedMessageCount: compaction.droppedMessageCount,
      droppedTurnCount: compaction.droppedTurnCount,
      withinBudget: compaction.withinBudget,
    });
  }
  return {
    plan: {
      ...plan,
      messages: compaction.messages,
    },
    compaction,
  };
}

interface SoftCompactResult {
  messages: LLMMessage[];
  compactedIndexes: Set<number>;
  compactedTokens: number;
}

interface OldTurnGroup {
  indices: number[];
  protected: boolean;
}

export function compactAiNovelContext(
  input: AiNovelContextCompactionInput,
): AiNovelContextCompactionResult {
  const maxContextTokens = input.maxContextTokens ?? AI_NOVEL_CONTEXT_MAX_TOKENS;
  const maxTokens = Math.max(0, input.maxTokens ?? 0);
  const latestRoundStartIndex =
    input.latestRoundStartIndex ?? latestUserMessageIndex(input.messages);
  const originalEstimate = estimateRequestTokens(input, input.messages, maxTokens);

  if (latestRoundStartIndex < 0) {
    return result({
      messages: input.messages,
      estimatedRequestTokens: originalEstimate,
      withinBudget: originalEstimate <= maxContextTokens,
    });
  }

  if (originalEstimate <= maxContextTokens) {
    return result({
      messages: input.messages,
      estimatedRequestTokens: originalEstimate,
      latestRoundStartIndex,
      withinBudget: true,
    });
  }

  const immutableEstimate = estimateRequestTokens(
    input,
    input.messages.filter(
      (message, index) => index >= latestRoundStartIndex || message.role === "system",
    ),
    maxTokens,
  );
  if (immutableEstimate > maxContextTokens) {
    return result({
      messages: input.messages,
      estimatedRequestTokens: originalEstimate,
      latestRoundStartIndex,
      withinBudget: originalEstimate <= maxContextTokens,
    });
  }

  const softCompacted = softCompactToolResults(
    input.messages,
    latestRoundStartIndex,
  );
  const softEstimate = estimateRequestTokens(
    input,
    softCompacted.messages,
    maxTokens,
  );
  if (softEstimate <= maxContextTokens) {
    return result({
      messages: softCompacted.messages,
      estimatedRequestTokens: softEstimate,
      latestRoundStartIndex,
      softCompactedToolResultCount: softCompacted.compactedIndexes.size,
      softCompactedTokens: softCompacted.compactedTokens,
      didCompact: softCompacted.compactedIndexes.size > 0,
      withinBudget: true,
    });
  }

  const dropped = dropOldestTurns({
    input,
    messages: softCompacted.messages,
    latestRoundStartIndex,
    initialEstimate: softEstimate,
    maxContextTokens,
    maxTokens,
  });
  return result({
    messages: dropped.messages,
    estimatedRequestTokens: dropped.estimatedRequestTokens,
    latestRoundStartIndex,
    softCompactedToolResultCount: softCompacted.compactedIndexes.size,
    softCompactedTokens: softCompacted.compactedTokens,
    droppedMessageCount: dropped.droppedMessageCount,
    droppedTurnCount: dropped.droppedTurnCount,
    didCompact:
      softCompacted.compactedIndexes.size > 0 || dropped.droppedMessageCount > 0,
    withinBudget: dropped.estimatedRequestTokens <= maxContextTokens,
  });
}

function result(input: {
  messages: LLMMessage[];
  estimatedRequestTokens: number;
  latestRoundStartIndex?: number;
  softCompactedToolResultCount?: number;
  softCompactedTokens?: number;
  droppedMessageCount?: number;
  droppedTurnCount?: number;
  didCompact?: boolean;
  withinBudget: boolean;
}): AiNovelContextCompactionResult {
  return {
    messages: input.messages,
    estimatedRequestTokens: input.estimatedRequestTokens,
    ...(input.latestRoundStartIndex === undefined
      ? {}
      : { latestRoundStartIndex: input.latestRoundStartIndex }),
    softCompactedToolResultCount: input.softCompactedToolResultCount ?? 0,
    softCompactedTokens: input.softCompactedTokens ?? 0,
    droppedMessageCount: input.droppedMessageCount ?? 0,
    droppedTurnCount: input.droppedTurnCount ?? 0,
    didCompact: input.didCompact ?? false,
    withinBudget: input.withinBudget,
  };
}

export function latestUserMessageIndex(messages: LLMMessage[]): number {
  return messages.findLastIndex((message) => message.role === "user");
}

function estimateRequestTokens(
  input: AiNovelContextCompactionInput,
  messages: LLMMessage[],
  maxTokens: number,
): number {
  return (
    estimateLlmContextRequestTokens({
      messages,
      providerOptions: input.providerOptions,
    }) + maxTokens
  );
}

function softCompactToolResults(
  messages: LLMMessage[],
  latestRoundStartIndex: number,
): SoftCompactResult {
  const latestToolCallIds = new Set(
    messages.slice(latestRoundStartIndex).flatMap(toolCallIds),
  );
  const candidates = messages.flatMap((message, index) => {
    if (
      index >= latestRoundStartIndex ||
      message.role !== "tool" ||
      !message.content ||
      (message.toolCallId !== undefined &&
        latestToolCallIds.has(message.toolCallId)) ||
      isProtectedToolResult(message.content)
    ) {
      return [];
    }
    return [{ index, estimatedTokens: estimateTextTokens(message.content) }];
  });
  if (candidates.length === 0) {
    return {
      messages,
      compactedIndexes: new Set<number>(),
      compactedTokens: 0,
    };
  }

  let retainedTokens = 0;
  let compactedTokens = 0;
  const compactedIndexes = new Set<number>();
  for (const candidate of [...candidates].reverse()) {
    if (retainedTokens < AI_NOVEL_SOFT_COMPACT_RETAINED_TOOL_TOKENS) {
      retainedTokens += candidate.estimatedTokens;
      continue;
    }
    compactedTokens += candidate.estimatedTokens;
    compactedIndexes.add(candidate.index);
  }
  if (compactedTokens <= AI_NOVEL_SOFT_COMPACT_MINIMUM_SAVINGS_TOKENS) {
    return {
      messages,
      compactedIndexes: new Set<number>(),
      compactedTokens: 0,
    };
  }

  return {
    messages: messages.map((message, index) =>
      compactedIndexes.has(index)
        ? { ...message, content: AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER }
        : message,
    ),
    compactedIndexes,
    compactedTokens,
  };
}

function dropOldestTurns(input: {
  input: AiNovelContextCompactionInput;
  messages: LLMMessage[];
  latestRoundStartIndex: number;
  initialEstimate: number;
  maxContextTokens: number;
  maxTokens: number;
}): {
  messages: LLMMessage[];
  estimatedRequestTokens: number;
  droppedMessageCount: number;
  droppedTurnCount: number;
} {
  const groups = oldTurnGroups(input.messages, input.latestRoundStartIndex);
  let messages = input.messages;
  let estimatedRequestTokens = input.initialEstimate;
  let droppedMessageCount = 0;
  let droppedTurnCount = 0;
  const droppedIndexes = new Set<number>();

  for (const group of groups) {
    if (group.protected) continue;
    if (estimatedRequestTokens <= input.maxContextTokens) break;
    for (const index of group.indices) droppedIndexes.add(index);
    messages = input.messages.filter((_, index) => !droppedIndexes.has(index));
    droppedMessageCount += group.indices.length;
    droppedTurnCount += 1;
    estimatedRequestTokens = estimateRequestTokens(
      input.input,
      messages,
      input.maxTokens,
    );
  }

  return {
    messages,
    estimatedRequestTokens,
    droppedMessageCount,
    droppedTurnCount,
  };
}

function oldTurnGroups(
  messages: LLMMessage[],
  latestRoundStartIndex: number,
): OldTurnGroup[] {
  const groups: number[][] = [];
  let current: number[] = [];
  for (let index = 0; index < latestRoundStartIndex; index += 1) {
    const message = messages[index];
    if (message.role === "system") continue;
    if (message.role === "user" && current.length > 0) {
      groups.push(current);
      current = [];
    }
    current.push(index);
  }
  if (current.length > 0) groups.push(current);

  const groupByIndex = new Map<number, number>();
  groups.forEach((group, groupIndex) => {
    for (const index of group) groupByIndex.set(index, groupIndex);
  });
  const latestGroupIndex = groups.length;
  const toolGroups = new Map<string, Set<number>>();
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    const groupIndex =
      index >= latestRoundStartIndex
        ? latestGroupIndex
        : groupByIndex.get(index);
    if (groupIndex === undefined) continue;
    for (const toolCallId of toolCallIds(message)) {
      const owners = toolGroups.get(toolCallId) ?? new Set<number>();
      owners.add(groupIndex);
      toolGroups.set(toolCallId, owners);
    }
  }
  const protectedGroups = new Set<number>();
  for (const owners of toolGroups.values()) {
    if (owners.size < 2) continue;
    for (const groupIndex of owners) protectedGroups.add(groupIndex);
  }
  return groups.map((indices, groupIndex) => ({
    indices,
    protected: protectedGroups.has(groupIndex),
  }));
}

function toolCallIds(message: LLMMessage): string[] {
  if (message.role === "tool" && message.toolCallId) {
    return [message.toolCallId];
  }
  if (message.role !== "assistant") return [];
  return (message.toolCalls ?? []).map((toolCall) => toolCall.id);
}

function estimateTextTokens(text: string): number {
  return estimateLlmContextTextTokens(text);
}

function serializedRequestLength(
  messages: LLMMessage[],
  providerOptions?: Record<string, unknown>,
): number {
  return JSON.stringify({ messages, providerOptions }).length;
}

function isProtectedToolResult(content: string): boolean {
  if (content.includes(AI_NOVEL_SOFT_COMPACT_TOOL_PLACEHOLDER)) return true;
  if (content.length > 32_000) {
    const prefix = content.slice(0, 4_096);
    return /"(?:error|errorCode)"\s*:/.test(prefix) ||
      /"status"\s*:\s*"error"/.test(prefix) ||
      /"compacted"\s*:\s*true/.test(prefix);
  }
  try {
    const value = JSON.parse(content) as Record<string, unknown>;
    return Boolean(
      value.error ||
        value.errorCode ||
        value.status === "error" ||
        value.compacted === true,
    );
  } catch {
    return false;
  }
}
