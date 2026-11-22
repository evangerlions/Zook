import * as learningContracts from '../src/generated/openapi/public-contracts.generated.ts';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { LightTickPlanningSessionSchema, LightTickPlanningCreateRequestSchema, LightTickPlanningMessageRequestSchema, LightTickPlanningContextRequestSchema, LightTickPlanningDraftRequestSchema, LightTickPlanningDraftEditRequestSchema, LightTickPlanningConfirmRequestSchema, LightTickContinuationContextSchema, LightTickConditionCommandSchema, LightTickReflectionDataSchema, LightTickActionReviewRequestSchema, LightTickActionWorkspaceSchema, LightTickActionCreateRequestSchema, LightTickActionMutationRequestSchema, PasswordLoginRequestSchema, RefreshRequestSchema, LightTickRecordSchema, LightTickRecordWriteRequestSchema, LightTickRecordPageEnvelopeSchema, LightTickRecordEnvelopeSchema, LightTickManualDraftSchema, LightTickManualPlanEnvelopeSchema, LightTickManualConfirmSchema, LightTickTodayDataSchema } from '../src/generated/openapi/public-contracts.generated.ts';
const index = process.argv.indexOf('--output');
if (index < 0 || !process.argv[index + 1]) throw Error('Pass --output /absolute/path/to/contracts.json');
/**
 * 对外契约是「已交付域」的人工精选，不是全量导出（生成模块里 564 个 LightTick schema
 * 只有一部分对外）。这个设计的代价很实在：新增一个域却忘了在这里加前缀，整个域会
 * 从产物里**静默消失**，没有任何报错。
 *
 * 已经踩过两次：阅读域漏加；search / timeline / notification / weekly / learning-checkin
 * 则是反过来的问题——提交的 JSON 里有它们，但提交的脚本产不出它们，说明那份产物是从
 * 脏工作区导出的，从提交历史重建得不到同样的结果。
 * 现在把两者对齐：脚本能产出 JSON 里的全部内容，再加阅读域。
 */
const EXPORTED_PREFIXES = [
  'LightTickGoalWorkspace',
  'LightTickStudyNote',
  'LightTickProfile',
  'LightTickPlanningCapacity', 'LightTickPlanningAgenda',
  'LightTickPlanningSessionSummary', 'LightTickPlanningSessionListEnvelope',
  'LightTickPublicConfig', 'LightTickForm', 'LightTickGitHub', 'LightTickPersonalModel', 'LightTickLocalGeneration',
  'LightTickNativeLearning', 'LightTickPracticeSource', 'LightTickInvestment',
  'LightTickKnowledge', 'LightTickReview', 'LightTickReading',
  'LightTickSearch', 'LightTickTimeline', 'LightTickNotification', 'LightTickWeekly',
  'LightTickLearning', 'LightTickTutor', 'LightTickWorkReport', 'LightTickTaskReschedule', 'LightTickTaskDetail',
  'LightTickTaskProgress', 'LightTickTaskExecutionProgress', 'LightTickTaskRemainingEstimate', 'LightTickTaskWaitingForInput',
  'LightTickNextWeek',
];

const contract = {
  product: 'lighttick',
  source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  schemas: {
    ...Object.fromEntries(
      Object.entries(learningContracts).filter(([key]) =>
        EXPORTED_PREFIXES.some((prefix) => key.startsWith(prefix)),
      ),
    ),
    LightTickPlanningSessionSchema, LightTickPlanningCreateRequestSchema, LightTickPlanningMessageRequestSchema, LightTickPlanningContextRequestSchema, LightTickPlanningDraftRequestSchema, LightTickPlanningDraftEditRequestSchema, LightTickPlanningConfirmRequestSchema, LightTickContinuationContextSchema, LightTickConditionCommandSchema, LightTickReflectionDataSchema, LightTickActionReviewRequestSchema, LightTickActionWorkspaceSchema, LightTickActionCreateRequestSchema, LightTickActionMutationRequestSchema, PasswordLoginRequest: PasswordLoginRequestSchema, RefreshRequest: RefreshRequestSchema, Record: LightTickRecordSchema, RecordWrite: LightTickRecordWriteRequestSchema, RecordPage: LightTickRecordPageEnvelopeSchema, RecordEnvelope: LightTickRecordEnvelopeSchema, LightTickManualDraftSchema, LightTickManualPlanEnvelopeSchema, LightTickManualConfirmSchema, LightTickTodayDataSchema,
  },
};

/**
 * 拒收静默丢键。
 *
 * 上面那份前缀白名单是人工精选，一旦有人漏加前缀，整个域会安静地从产物里消失——
 * 本文件自己就踩过：重导出时丢了 search / timeline / notification / weekly /
 * learning 共 20 个 schema，命令退出码仍是 0。
 * 所以写盘前先跟既有文件比一遍，少一个就报错并点名。真要删契约，先手动删掉目标文件，
 * 让「删除」变成一个必须显式做出的动作。
 */
const target = process.argv[index + 1];
if (existsSync(target)) {
  const previous = JSON.parse(readFileSync(target, 'utf8'))?.schemas ?? {};
  const lost = Object.keys(previous).filter((key) => !(key in contract.schemas));
  if (lost.length)
    throw Error(
      `导出会丢掉 ${lost.length} 个既有 schema，已拒绝写入：\n  ${lost.join('\n  ')}\n` +
        `如果确实要删除契约，请先删掉 ${target} 再重跑。`,
    );
}

writeFileSync(target, JSON.stringify(contract, null, 2) + '\n');
