import type { FrogSleepEntityRecord } from "../../../shared/types.ts";

export const SLEEP_ARTIFACT_VERSION = "shared-session-v2";

export function buildSleepSummaryArtifact(input: {
  session: FrogSleepEntityRecord;
  userId: string;
  partnerUserId?: string;
  participantStates: Record<string, unknown>;
  interruptedCount: number;
  returnedCount: number;
  pausedTonight: boolean;
  completed: boolean;
}) {
  const participantState = String(input.participantStates[input.userId] ?? "");
  const partnerState = input.partnerUserId ? String(input.participantStates[input.partnerUserId] ?? "") : "";
  const hadRecovery = input.interruptedCount > 0;
  const returnedAfterRecovery = input.returnedCount > 0;
  const completedMorning = input.completed && participantState === "morning_completed";
  const visibleState = input.pausedTonight
    ? "paused_tonight"
    : completedMorning
      ? "morning_completed"
      : hadRecovery && !returnedAfterRecovery
        ? "interrupted"
        : hadRecovery
          ? "recovered"
          : input.completed
            ? "morning_completed"
            : "in_progress";
  return {
    artifact_version: SLEEP_ARTIFACT_VERSION,
    visible_state: visibleState,
    started_on_time: Boolean(input.session.startsAt),
    had_recovery: hadRecovery,
    returned_after_recovery: returnedAfterRecovery,
    paused_tonight: input.pausedTonight,
    completed_morning: completedMorning,
    headline: summaryHeadline(visibleState, partnerState),
  };
}

export function buildSleepRecapArtifact(input: {
  requesterUserId: string;
  partnerUserId?: string;
  participantStates: Record<string, unknown>;
  interruptedCount: number;
  returnedCount: number;
  pausedTonight: boolean;
  completed: boolean;
}) {
  const myResultState = resultState(input.participantStates[input.requesterUserId], input);
  const partnerResultState = input.partnerUserId
    ? resultState(input.participantStates[input.partnerUserId], input)
    : null;
  const combinedResultType = combinedResultTypeFor(myResultState, partnerResultState, input);
  return {
    artifact_version: SLEEP_ARTIFACT_VERSION,
    combined_result_type: combinedResultType,
    my_result_state: myResultState,
    partner_result_state: partnerResultState,
    headline: recapHeadline(combinedResultType),
    supporting_line: recapSupportingLine(input),
    recommended_next_step: recapNextStep(combinedResultType),
  };
}

function resultState(state: unknown, input: {
  interruptedCount: number;
  returnedCount: number;
  pausedTonight: boolean;
  completed: boolean;
}) {
  const normalized = String(state ?? "");
  if (normalized === "paused_tonight" || input.pausedTonight) return "paused";
  if (normalized === "morning_completed") return "completed";
  if (normalized === "returned" || (input.interruptedCount > 0 && input.returnedCount > 0)) return "recovered";
  if (normalized === "interrupted" || input.interruptedCount > 0) return "interrupted";
  return input.completed ? "completed" : "incomplete";
}

function combinedResultTypeFor(myResultState: string, partnerResultState: string | null, input: {
  pausedTonight: boolean;
  completed: boolean;
}) {
  if (input.pausedTonight) return "paused_tonight";
  if (myResultState === "completed" && partnerResultState === "completed") return "both_completed";
  if (myResultState === "recovered" || partnerResultState === "recovered") return "recovered_together";
  if (myResultState === "interrupted" || partnerResultState === "interrupted") return "one_had_difficulty";
  return input.completed ? "partially_completed" : "incomplete";
}

function summaryHeadline(visibleState: string, partnerState: string) {
  if (visibleState === "paused_tonight") return "今晚已暂停共同守护";
  if (visibleState === "recovered") return "昨晚有一次恢复，但你回来了";
  if (visibleState === "interrupted") return "昨晚出现中断，需要温柔复盘";
  if (visibleState === "morning_completed") {
    return partnerState === "morning_completed" ? "昨晚共同守护已完成" : "你的晨间记录已完成";
  }
  return "共同守护仍在进行";
}

function recapHeadline(combinedResultType: string) {
  switch (combinedResultType) {
    case "both_completed":
      return "共同守护完成";
    case "recovered_together":
      return "昨晚完成了一次恢复";
    case "paused_tonight":
      return "今晚共同守护已暂停";
    case "one_had_difficulty":
      return "昨晚有一方遇到困难";
    default:
      return "共同守护更新";
  }
}

function recapSupportingLine(input: {
  interruptedCount: number;
  returnedCount: number;
  pausedTonight: boolean;
  completed: boolean;
}) {
  if (input.pausedTonight) return "暂停只影响今晚，不会解除搭子关系。";
  if (input.interruptedCount > 0 && input.returnedCount > 0) return "记录到中断后的返回，说明守护链路仍然有效。";
  if (input.interruptedCount > 0) return "记录到中断，明天可以把睡前流程再提前一点。";
  return input.completed ? "双方数据已生成，可以继续保持这个节奏。" : "还没有完整晨间结果，稍后可继续同步。";
}

function recapNextStep(combinedResultType: string) {
  if (combinedResultType === "both_completed") return "keep_rhythm";
  if (combinedResultType === "recovered_together") return "review_recovery";
  if (combinedResultType === "paused_tonight") return "resume_when_ready";
  if (combinedResultType === "one_had_difficulty") return "adjust_bedtime";
  return "complete_morning_checkin";
}
