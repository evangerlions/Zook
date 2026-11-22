import { PostgresLightTickLearningContinuationStore } from "./postgres-lighttick-learning-continuation-store.ts";
import { PostgresLightTickLocalGenerationStore } from "./postgres-lighttick-local-generation-store.ts";
import { PostgresLightTickAccountUpgradeStore } from "./postgres-lighttick-account-upgrade-store.ts";
import { PostgresFormRecordsStore } from "./postgres-form-records-store.ts";
import {PostgresResearchAIStore} from "./postgres-research-ai-store.ts";
import { PostgresGitHubStore } from "./postgres-github-store.ts";
import {PostgresPersonalModelStore} from "./postgres-personal-model-store.ts";
import {PostgresInvestmentStore} from "./postgres-investment-store.ts";
import {PostgresLightTickDeviceStore} from "./postgres-lighttick-device-store.ts";
import {PostgresKnowledgeStore} from "./postgres-knowledge-store.ts";
import {deleteLightTickOwnerData} from './postgres-lighttick-owner-deletion.ts';
import {PostgresLearningRouteStore} from './postgres-learning-route-store.ts';
import {versionConflict} from './postgres-lighttick-conflicts.ts';
import {PostgresNativeLearningStore} from "./postgres-lighttick-native-learning-store.ts";
import {PostgresLocalAdoptionStore} from './postgres-lighttick-local-adoption-store.ts';
import {mapRow} from "./postgres-lighttick-row-mappers.ts";
import {readLightTickOperationalSummary} from "./postgres-lighttick-admin-summary.ts";
import { PostgresRecordTransferStore } from "./postgres-lighttick-record-transfer-store.ts";
import { PostgresRecordStore } from "./postgres-lighttick-record-store.ts";
import { PostgresSearchStore } from "./postgres-lighttick-search-store.ts";
import { PostgresLightTickStudyNotesStore } from "./postgres-lighttick-study-notes-store.ts";
import type { EvidenceSnapshot } from "../../../modules/lighttick/lighttick-ai-evidence.service.ts";
import type { LightTickRecordRow, RecordQuery } from "../../../modules/lighttick/lighttick-record.service.ts";
import {PostgresActionStore} from './postgres-lighttick-action-store.ts';
import {PostgresPlanningStore} from './postgres-lighttick-planning-store.ts';
import { PostgresReflectionStore } from "./postgres-lighttick-reflection-store.ts";
import { PostgresReadingStore } from "./postgres-lighttick-reading-store.ts";
import type {
  LightTickReadingArticleRow, LightTickReadingDailyRow, LightTickReadingFeedbackRow,
  LightTickReadingGuideRow, LightTickReadingStateRow,
} from "../../../modules/lighttick/reading/reading.types.ts";
import type { LightTickReflectionRow } from "../../../modules/lighttick/lighttick-reflection.service.ts";
import {LightTickOwnerTransactionGate,type Connector,type QueryResult} from "./postgres-lighttick-owner-transaction.ts";
import type { LightTickRepository, LightTickAtomicWrite } from "../../../modules/lighttick/lighttick.repository.ts";
import type {
  LightTickAiRunRow, LightTickChangeProposalRow, LightTickChangeRow, LightTickChatMessageRow, LightTickDnaInsightRow, LightTickDeviceRow,
  LightTickAccountUpgradeCommand, LightTickInsightAuditRow,
  LightTickGoalRow, LightTickGuestIdentityRow, LightTickOperationRow, LightTickOwner, LightTickPlanRow,
  LightTickProfileRow, LightTickReviewRow, LightTickTaskRow, LightTickTaskStepRow,
} from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

export class PostgresLightTickRepository implements LightTickRepository {
  readonly learningContinuations = new PostgresLightTickLearningContinuationStore((sql, args) => this.query(sql, args));
  readonly localGenerations = new PostgresLightTickLocalGenerationStore((sql, args) => this.query(sql, args));
  readonly researchAI=new PostgresResearchAIStore((sql,args)=>this.query(sql,args));
  readonly formRecords=new PostgresFormRecordsStore((sql,args)=>this.query(sql,args));
  readonly github=new PostgresGitHubStore((sql,args)=>this.query(sql,args));
  readonly personalModels=new PostgresPersonalModelStore((sql,args)=>this.query(sql,args));
  readonly investments=new PostgresInvestmentStore((sql,args)=>this.query(sql,args));
  readonly knowledge=new PostgresKnowledgeStore((sql,args)=>this.query(sql,args)); readonly learningRoutes=new PostgresLearningRouteStore((sql,args)=>this.query(sql,args),(o,fn)=>this.transaction(o,fn));
  private readonly nativeLearning=new PostgresNativeLearningStore((sql,values)=>this.query(sql,values));
  getNativeLearningCounts=async(o:LightTickOwner)=>({...await this.nativeLearning.getNativeLearningCounts(o),...await this.learningRoutes.counts(o)});
  clearNativeLearningStaging=(owner:LightTickOwner)=>this.transaction(owner,async()=>{await this.learningRoutes.clearStaging(owner);await this.nativeLearning.clearNativeLearningStaging(owner);});
  listLearningReceipts=this.nativeLearning.listLearningReceipts.bind(this.nativeLearning);
  getUserSubscription=(owner:LightTickOwner)=>this.nativeLearning.getUserSubscription(owner);
  getLearningAuthority=this.nativeLearning.getLearningAuthority.bind(this.nativeLearning);
  saveLearningAuthority=(...args:Parameters<PostgresNativeLearningStore["saveLearningAuthority"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveLearningAuthority(...args));
  listLearningCollections=this.nativeLearning.listLearningCollections.bind(this.nativeLearning);
  getLearningCollection=this.nativeLearning.getLearningCollection.bind(this.nativeLearning);
  saveLearningCollection=(...args:Parameters<PostgresNativeLearningStore["saveLearningCollection"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveLearningCollection(...args));
  listNativeLessons=this.nativeLearning.listNativeLessons.bind(this.nativeLearning);
  getNativeLesson=this.nativeLearning.getNativeLesson.bind(this.nativeLearning);
  saveNativeLesson=(...args:Parameters<PostgresNativeLearningStore["saveNativeLesson"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveNativeLesson(...args));
  getLessonPublication=this.nativeLearning.getLessonPublication.bind(this.nativeLearning);
  insertLessonPublication=(...args:Parameters<PostgresNativeLearningStore["insertLessonPublication"]>)=>this.transaction(args[0],()=>this.nativeLearning.insertLessonPublication(...args));
  getNativePrivateState=this.nativeLearning.getNativePrivateState.bind(this.nativeLearning);
  saveNativePrivateState=(...args:Parameters<PostgresNativeLearningStore["saveNativePrivateState"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveNativePrivateState(...args));
  appendLearningHistory=(...args:Parameters<PostgresNativeLearningStore["appendLearningHistory"]>)=>this.transaction(args[0],()=>this.nativeLearning.appendLearningHistory(...args));
  listLearningHistory=this.nativeLearning.listLearningHistory.bind(this.nativeLearning);
  listLearningModules=this.nativeLearning.listLearningModules.bind(this.nativeLearning);
  getLearningModule=this.nativeLearning.getLearningModule.bind(this.nativeLearning);
  saveLearningModule=(...args:Parameters<PostgresNativeLearningStore["saveLearningModule"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveLearningModule(...args));
  listLearningModuleTemplates=this.nativeLearning.listLearningModuleTemplates.bind(this.nativeLearning);
  private readonly studyNotes = new PostgresLightTickStudyNotesStore((sql, args) => this.query(sql, args));
  saveStudyNote = this.studyNotes.save.bind(this.studyNotes);
  getStudyNote = this.studyNotes.get.bind(this.studyNotes);
  listStudyNotes = this.studyNotes.list.bind(this.studyNotes);
  private readonly localAdoptionStore=new PostgresLocalAdoptionStore((sql,values)=>this.query(sql,values));
  lockLocalSource=this.localAdoptionStore.lockLocalSource.bind(this.localAdoptionStore);
  getLocalClaim=this.localAdoptionStore.getLocalClaim.bind(this.localAdoptionStore);
  saveLocalClaim=this.localAdoptionStore.saveLocalClaim.bind(this.localAdoptionStore);
  private readonly transactions:LightTickOwnerTransactionGate;
  private readonly accountUpgrades: PostgresLightTickAccountUpgradeStore;
  constructor(connector: Connector, transactionRunner?: <T>(operation: () => Promise<T>) => Promise<T>) {
    this.transactions = new LightTickOwnerTransactionGate(connector, transactionRunner);
    this.accountUpgrades = new PostgresLightTickAccountUpgradeStore(this.transactions);
  }

  private async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    return await this.transactions.query(sql, values);
  }

  private readonly recordTransferStore=new PostgresRecordTransferStore((sql,values)=>this.query(sql,values));
  lockRecordSource=this.recordTransferStore.lockRecordSource.bind(this.recordTransferStore);
  getRecordTransfer=this.recordTransferStore.getRecordTransfer.bind(this.recordTransferStore);
  getOwnerRecordTransfer=this.recordTransferStore.getOwnerRecordTransfer.bind(this.recordTransferStore);
  saveRecordTransfer=(...args:Parameters<PostgresRecordTransferStore["saveRecordTransfer"]>)=>this.transaction(args[0],()=>this.recordTransferStore.saveRecordTransfer(...args));
  getRecordTransferTicket=this.recordTransferStore.getRecordTransferTicket.bind(this.recordTransferStore);
  saveRecordTransferTicket=(...args:Parameters<PostgresRecordTransferStore["saveRecordTransferTicket"]>)=>this.transaction(args[0],()=>this.recordTransferStore.saveRecordTransferTicket(...args));
  importRecord=(...args:Parameters<PostgresRecordTransferStore["importRecord"]>)=>this.transaction(args[0],()=>this.recordTransferStore.importRecord(...args));
  recordSourceHistory=this.recordTransferStore.recordSourceHistory.bind(this.recordTransferStore);
  private readonly actionStore=new PostgresActionStore((sql,values)=>this.query(sql,values));
  getLearningPrivate=this.actionStore.getLearningPrivate.bind(this.actionStore);
  saveLearningPrivate=(...args:Parameters<PostgresActionStore["saveLearningPrivate"]>)=>this.transaction(args[0],()=>this.actionStore.saveLearningPrivate(...args));
  getLearningLibrary=this.actionStore.getLearningLibrary.bind(this.actionStore);
  saveLearningLibrary=(...args:Parameters<PostgresActionStore["saveLearningLibrary"]>)=>this.transaction(args[0],()=>this.actionStore.saveLearningLibrary(...args));
  lockActionOwner=this.actionStore.lockActionOwner.bind(this.actionStore);
  getActionWorkspace=this.actionStore.getActionWorkspace.bind(this.actionStore);
  saveActionWorkspace=(...args:Parameters<PostgresActionStore["saveActionWorkspace"]>)=>this.transaction(args[0],()=>this.actionStore.saveActionWorkspace(...args));
  getActionTicket=this.actionStore.getActionTicket.bind(this.actionStore);
  saveActionTicket=(...args:Parameters<PostgresActionStore["saveActionTicket"]>)=>this.transaction(args[0],()=>this.actionStore.saveActionTicket(...args));
  getActionLink=this.actionStore.getActionLink.bind(this.actionStore);
  getOwnerActionLink=this.actionStore.getOwnerActionLink.bind(this.actionStore);
  saveActionLink=(...args:Parameters<PostgresActionStore["saveActionLink"]>)=>this.transaction(args[0],()=>this.actionStore.saveActionLink(...args));
  async lockRecordOwner(owner: LightTickOwner) {
    await this.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`records:${owner.appId}:${owner.userId}`]);
  }
  private recordStore() { return new PostgresRecordStore(this.query.bind(this)); }
  private searchStore() { return new PostgresSearchStore(this.query.bind(this)); }
  async getRecord(owner: LightTickOwner, id: string) { return this.recordStore().getRecord(owner, id); }
  async listRecords(owner: LightTickOwner, query?: RecordQuery) { return this.recordStore().listRecords(owner, query); }
  async recordVersions(owner: LightTickOwner, id: string) { return this.recordStore().recordVersions(owner, id); }
  async getRecordVersion(owner:LightTickOwner,id:string,version:number){return this.recordStore().getRecordVersion(owner,id,version);}
  async saveRecord(row: LightTickRecordRow, baseVersion: number) {
    return this.transaction(row, () => this.recordStore().saveRecord(row, baseVersion));
  }
  async lockPlanningOwner(owner: LightTickOwner) {
    await this.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`planning:${owner.appId}:${owner.userId}`]);
    // Existing non-session mutations lock these same rows on write.
    for (const table of ["goals", "plan_cycles", "tasks"])
      await this.query(`SELECT id FROM zook_lighttick_${table} WHERE app_id=$1 AND user_id=$2 ORDER BY id FOR UPDATE`, [owner.appId, owner.userId]);
  }
  private readonly planningStore=new PostgresPlanningStore((sql,values)=>this.query(sql,values));
  getPlanningSession=this.planningStore.getPlanningSession.bind(this.planningStore);
  savePlanningSession=(...args:Parameters<PostgresPlanningStore["savePlanningSession"]>)=>this.transaction(args[0],()=>this.planningStore.savePlanningSession(...args));
  async getGuestIdentity(owner: LightTickOwner): Promise<LightTickGuestIdentityRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_guest_identities WHERE app_id=$1 AND user_id=$2", [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickGuestIdentityRow>(result.rows[0]) : undefined;
  }
  async getGuestIdentityByDevice(deviceId: string): Promise<LightTickGuestIdentityRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_guest_identities WHERE app_id='lighttick' AND device_id=$1", [deviceId]);
    return result.rows[0] ? mapRow<LightTickGuestIdentityRow>(result.rows[0]) : undefined;
  }
  async saveGuestIdentity(row: LightTickGuestIdentityRow): Promise<LightTickGuestIdentityRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveGuestIdentity(row));
    const result = await this.query(`INSERT INTO zook_lighttick_guest_identities
      (app_id,user_id,device_id,device_secret_hash,platform,timezone,locale,app_version,upgrade_token_hash,expires_at,revoked_at,upgraded_to_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (app_id,device_id) DO UPDATE SET user_id=EXCLUDED.user_id,device_secret_hash=EXCLUDED.device_secret_hash,
      platform=EXCLUDED.platform,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,app_version=EXCLUDED.app_version,
      upgrade_token_hash=EXCLUDED.upgrade_token_hash,expires_at=EXCLUDED.expires_at,revoked_at=EXCLUDED.revoked_at,
      upgraded_to_user_id=EXCLUDED.upgraded_to_user_id,updated_at=EXCLUDED.updated_at RETURNING *`,
      [row.appId,row.userId,row.deviceId,row.deviceSecretHash,row.platform,row.timezone,row.locale,row.appVersion,
        row.upgradeTokenHash,row.expiresAt,row.revokedAt ?? null,row.upgradedToUserId ?? null,row.createdAt,row.updatedAt]);
    return mapRow<LightTickGuestIdentityRow>(result.rows[0]!);
  }

  upgradeGuestAccount(command: LightTickAccountUpgradeCommand) {
    return this.accountUpgrades.upgradeGuestAccount(command);
  }

  async transaction<T>(owner: LightTickOwner, operation: () => Promise<T>): Promise<T> {
    return this.transactionOwners([owner], operation);
  }

  /** Acquire every owner before domain locks or sequence allocation. Nested calls may not widen scope. */
  private transactionOwners<T>(owners:LightTickOwner[],operation:()=>Promise<T>){return this.transactions.transactionOwners(owners,operation);}

  async getProfile(owner: LightTickOwner): Promise<LightTickProfileRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_profiles WHERE app_id = $1 AND user_id = $2", [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickProfileRow>(result.rows[0]) : undefined;
  }

  async saveProfile(row: LightTickProfileRow, expectedVersion?: number): Promise<LightTickProfileRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveProfile(row, expectedVersion));
    const values = [row.timezone, row.locale, row.pace, row.onboardingState,
      JSON.stringify(row.notificationPreferences), JSON.stringify(row.onboardingDraft), row.appId, row.userId];
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_profiles SET timezone=$1, locale=$2, pace=$3,
        onboarding_state=$4, notification_preferences=$5::jsonb, onboarding_draft=$6::jsonb,
        version=version+1, updated_at=NOW() WHERE app_id=$7 AND user_id=$8 AND version=$9 RETURNING *`, [...values, expectedVersion]);
      if (!result.rows[0]) versionConflict(row.userId);
      return mapRow<LightTickProfileRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_profiles
      (app_id,user_id,timezone,locale,pace,onboarding_state,notification_preferences,onboarding_draft,version,created_at,updated_at)
      VALUES ($7,$8,$1,$2,$3,$4,$5::jsonb,$6::jsonb,1,NOW(),NOW()) RETURNING *`, values);
    return mapRow<LightTickProfileRow>(result.rows[0]!);
  }

  async listGoals(owner: LightTickOwner): Promise<LightTickGoalRow[]> {
    const result = await this.query("SELECT * FROM zook_lighttick_goals WHERE app_id=$1 AND user_id=$2 ORDER BY updated_at DESC", [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickGoalRow>);
  }
  async getGoal(owner: LightTickOwner, id: string): Promise<LightTickGoalRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_goals WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickGoalRow>(result.rows[0]) : undefined;
  }
  async saveGoal(row: LightTickGoalRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickGoalRow> {
    return await this.saveAggregate(row, write, expectedVersion, "zook_lighttick_goals",
      ["title", "description", "status", "constraints", "target_date", "pause_metadata", "recovery_started_at", "review_cadence"],
      [row.title, row.description ?? null, row.status, JSON.stringify(row.constraints), row.targetDate ?? null,
        JSON.stringify(row.pauseMetadata ?? {}), row.recoveryStartedAt ?? null, row.reviewCadence ? JSON.stringify(row.reviewCadence) : null]);
  }

  async getPlan(owner: LightTickOwner, id: string): Promise<LightTickPlanRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_plan_cycles WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickPlanRow>(result.rows[0]) : undefined;
  }
  async listPlans(owner: LightTickOwner, goalId?: string): Promise<LightTickPlanRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_plan_cycles WHERE app_id=$1 AND user_id=$2
      ${goalId ? "AND goal_id=$3" : ""} ORDER BY period_start DESC, updated_at DESC`,
    goalId ? [owner.appId, owner.userId, goalId] : [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickPlanRow>);
  }
  async getActivePlan(owner: LightTickOwner): Promise<LightTickPlanRow | undefined> {
    const result = await this.query(`SELECT * FROM zook_lighttick_plan_cycles WHERE app_id=$1 AND user_id=$2
      AND status='active' ORDER BY updated_at DESC LIMIT 1`, [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickPlanRow>(result.rows[0]) : undefined;
  }
  async savePlan(row: LightTickPlanRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickPlanRow> {
    return await this.saveAggregate(row, write, expectedVersion, "zook_lighttick_plan_cycles",
      ["goal_id", "granularity", "status", "source", "period_start", "period_end", "proposal"],
      [row.goalId, row.granularity, row.status, row.source, row.periodStart, row.periodEnd, JSON.stringify(row.proposal)]);
  }

  async listTasks(owner: LightTickOwner, planId?: string): Promise<LightTickTaskRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2
      ${planId ? "AND plan_id=$3" : ""} ORDER BY scheduled_for NULLS LAST, priority DESC`, planId ? [owner.appId, owner.userId, planId] : [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickTaskRow>);
  }
  async getTask(owner: LightTickOwner, id: string): Promise<LightTickTaskRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickTaskRow>(result.rows[0]) : undefined;
  }
  async saveTask(row: LightTickTaskRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickTaskRow> {
    return await this.saveAggregate(row, write, expectedVersion, "zook_lighttick_tasks",
      ["goal_id", "plan_id", "title", "status", "priority", "estimated_minutes", "scheduled_for", "started_at", "completed_at", "notes",
        "lineage_id", "selected_variant", "variant_definitions", "completion_criteria", "actual_minutes", "commitment_satisfied", "guidance", "scheduled_business_date", "lesson_source"],
      [row.goalId, row.planId, row.title, row.status, row.priority, row.estimatedMinutes, row.scheduledFor ?? null,
        row.startedAt ?? null, row.completedAt ?? null, row.notes ?? null, row.lineageId ?? row.id,
        row.selectedVariant ?? "standard", JSON.stringify(row.variantDefinitions ?? {}), row.completionCriteria ?? null,
        row.actualMinutes ?? null, row.commitmentSatisfied ?? null, JSON.stringify(row.guidance ?? {}),
        /^\d{4}-\d{2}-\d{2}$/.test(row.scheduledFor ?? "") ? row.scheduledFor : null, row.lessonSource ? JSON.stringify(row.lessonSource) : null]);
  }
  async listTaskSteps(owner: LightTickOwner, taskId?: string): Promise<LightTickTaskStepRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_task_steps
      WHERE app_id=$1 AND user_id=$2 AND ($3::text IS NULL OR task_id=$3) ORDER BY task_id,position,id`, [owner.appId, owner.userId, taskId ?? null]);
    return result.rows.map(mapRow<LightTickTaskStepRow>);
  }
  async getTaskStep(owner: LightTickOwner, taskId: string, id: string): Promise<LightTickTaskStepRow | undefined> {
    const result = await this.query(`SELECT * FROM zook_lighttick_task_steps
      WHERE app_id=$1 AND user_id=$2 AND task_id=$3 AND id=$4`, [owner.appId, owner.userId, taskId, id]);
    return result.rows[0] ? mapRow<LightTickTaskStepRow>(result.rows[0]) : undefined;
  }
  async saveTaskStep(row: LightTickTaskStepRow, expectedVersion?: number): Promise<LightTickTaskStepRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveTaskStep(row, expectedVersion));
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_task_steps SET title=$1,position=$2,completed=$3,
        version=version+1,updated_at=$4 WHERE app_id=$5 AND user_id=$6 AND task_id=$7 AND id=$8 AND version=$9 RETURNING *`,
      [row.title,row.position,row.completed,row.updatedAt,row.appId,row.userId,row.taskId,row.id,expectedVersion]);
      if (!result.rows[0]) versionConflict(row.id);
      return mapRow<LightTickTaskStepRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_task_steps
      (id,app_id,user_id,task_id,title,position,completed,version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,1,$8,$9) RETURNING *`,
    [row.id,row.appId,row.userId,row.taskId,row.title,row.position,row.completed,row.createdAt,row.updatedAt]);
    return mapRow<LightTickTaskStepRow>(result.rows[0]!);
  }
  async listExecutionEvents(owner: LightTickOwner, from?: string, to?: string, goalId?: string) {
    const params: unknown[] = [owner.appId, owner.userId];
    const conditions = ["e.app_id=$1", "e.user_id=$2"];
    if (from) { params.push(from); conditions.push(`e.occurred_at >= $${params.length}`); }
    if (to) { params.push(to); conditions.push(`e.occurred_at < $${params.length}`); }
    if (goalId !== undefined) {
      params.push(goalId);
      conditions.push(`e.aggregate_type='task' AND EXISTS (SELECT 1 FROM zook_lighttick_tasks t
        WHERE t.app_id=e.app_id AND t.user_id=e.user_id AND t.id=e.aggregate_id AND t.goal_id=$${params.length})`);
    }
    const result = await this.query(`SELECT e.* FROM zook_lighttick_execution_events e
      WHERE ${conditions.join(" AND ")} ORDER BY e.occurred_at ASC, e.id ASC`, params);
    return result.rows.map(mapRow<import("../../../modules/lighttick/lighttick.types.ts").LightTickExecutionEventRow>);
  }
  async appendInsightAudit(row: LightTickInsightAuditRow): Promise<LightTickInsightAuditRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.appendInsightAudit(row));
    const result = await this.query(`INSERT INTO zook_lighttick_insight_audits
      (id,app_id,user_id,rule_id,kind,evidence_count,evidence_window,output,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9) RETURNING *`,
      [row.id,row.appId,row.userId,row.ruleId,row.kind,row.evidenceCount,JSON.stringify(row.evidenceWindow),
        JSON.stringify(row.output),row.createdAt]);
    return mapRow<LightTickInsightAuditRow>(result.rows[0]!);
  }
  async listInsightAudits(owner: LightTickOwner, from?: string, to?: string): Promise<LightTickInsightAuditRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_insight_audits WHERE app_id=$1 AND user_id=$2
      ${from ? "AND created_at >= $3" : ""} ${to ? `AND created_at < $${from ? 4 : 3}` : ""}
      ORDER BY created_at DESC`, [owner.appId, owner.userId, ...(from ? [from] : []), ...(to ? [to] : [])]);
    return result.rows.map(mapRow<LightTickInsightAuditRow>);
  }
  async saveChatMessage(row: LightTickChatMessageRow): Promise<LightTickChatMessageRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveChatMessage(row));
    const result = await this.query(`INSERT INTO zook_lighttick_chat_messages
      (id,app_id,user_id,thread_id,goal_id,role,content,run_id,created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [row.id,row.appId,row.userId,row.threadId,row.goalId,row.role,row.content,row.runId ?? null,row.createdAt]);
    return mapRow<LightTickChatMessageRow>(result.rows[0]!);
  }
  async listChatMessages(owner: LightTickOwner, threadId: string, limit: number, goalId?: string): Promise<LightTickChatMessageRow[]> {
    const bounded = Math.min(Math.max(limit, 1), 200);
    const result = await this.query(`SELECT * FROM zook_lighttick_chat_messages
      WHERE app_id=$1 AND user_id=$2 AND thread_id=$3 ${goalId !== undefined ? "AND goal_id=$5" : ""}
      ORDER BY created_at DESC, id DESC LIMIT $4`,
      [owner.appId, owner.userId, threadId, bounded, ...(goalId !== undefined ? [goalId] : [])]);
    return result.rows.map(mapRow<LightTickChatMessageRow>).reverse();
  }
  async getDnaInsight(owner: LightTickOwner, id: string): Promise<LightTickDnaInsightRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_dna_insights WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickDnaInsightRow>(result.rows[0]) : undefined;
  }
  async listDnaInsights(owner: LightTickOwner, goalId?: string): Promise<LightTickDnaInsightRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_dna_insights WHERE app_id=$1 AND user_id=$2
      ${goalId ? "AND goal_id=$3" : ""} ORDER BY updated_at DESC`, goalId ? [owner.appId, owner.userId, goalId] : [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickDnaInsightRow>);
  }
  async saveDnaInsight(row: LightTickDnaInsightRow, expectedVersion?: number): Promise<LightTickDnaInsightRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveDnaInsight(row, expectedVersion));
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_dna_insights SET
        statement=$1,kind=$2,status=$3,evidence_count=$4,data_range=$5::jsonb,confidence=$6,scope=$7,
        allowed_effects=$8::jsonb,user_feedback=$9,expires_at=$10,evidence=$15::jsonb,updated_at=NOW(),version=version+1
        WHERE app_id=$11 AND user_id=$12 AND id=$13 AND version=$14 RETURNING *`,
        [row.statement,row.kind,row.status,row.evidenceCount,JSON.stringify(row.dataRange),row.confidence,row.scope,
          JSON.stringify(row.allowedEffects),row.userFeedback ?? null,row.expiresAt,row.appId,row.userId,row.id,expectedVersion,JSON.stringify(row.evidence ?? {})]);
      if (!result.rows[0]) versionConflict(row.id);
      return mapRow<LightTickDnaInsightRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_dna_insights
      (id,app_id,user_id,signature,rule_id,statement,kind,status,evidence_count,data_range,confidence,scope,allowed_effects,user_feedback,goal_id,created_at,expires_at,updated_at,version,evidence)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15,$16,$17,$18,1,$19::jsonb)
      ON CONFLICT (app_id,user_id,signature) DO UPDATE SET statement=EXCLUDED.statement,kind=EXCLUDED.kind,
      evidence_count=EXCLUDED.evidence_count,data_range=EXCLUDED.data_range,confidence=EXCLUDED.confidence,
      scope=EXCLUDED.scope,evidence=EXCLUDED.evidence,expires_at=EXCLUDED.expires_at,updated_at=EXCLUDED.updated_at
      WHERE zook_lighttick_dna_insights.status='proposed' RETURNING *`,
      [row.id,row.appId,row.userId,row.signature,row.ruleId,row.statement,row.kind,row.status,row.evidenceCount,
        JSON.stringify(row.dataRange),row.confidence,row.scope,JSON.stringify(row.allowedEffects),row.userFeedback ?? null,
        row.goalId ?? null,row.createdAt,row.expiresAt,row.updatedAt,JSON.stringify(row.evidence ?? {})]);
    return mapRow<LightTickDnaInsightRow>(result.rows[0]!);
  }

  private async saveAggregate<T extends { id: string; appId: "lighttick"; userId: string }>(
    row: T, write: LightTickAtomicWrite, expectedVersion: number | undefined,
    table: string, columns: string[], values: unknown[],
  ): Promise<T> {
    return await this.transaction(row, async () => {
      let result: QueryResult;
      if (expectedVersion === undefined) {
        const placeholders = columns.map((_, index) => `$${index + 4}`).join(",");
        result = await this.query(`INSERT INTO ${table} (id,app_id,user_id,${columns.join(",")},version,created_at,updated_at)
          VALUES ($1,$2,$3,${placeholders},1,NOW(),NOW()) RETURNING *`, [row.id, row.appId, row.userId, ...values]);
      } else {
        const assignments = columns.map((column, index) => `${column}=$${index + 1}${["constraints", "proposal", "pause_metadata", "variant_definitions", "review_cadence"].includes(column) ? "::jsonb" : ""}`).join(",");
        result = await this.query(`UPDATE ${table} SET ${assignments},version=version+1,updated_at=NOW()
          WHERE app_id=$${values.length + 1} AND user_id=$${values.length + 2} AND id=$${values.length + 3}
          AND version=$${values.length + 4} RETURNING *`, [...values, row.appId, row.userId, row.id, expectedVersion]);
        if (!result.rows[0]) versionConflict(row.id);
      }
      await this.appendAtomicWrite(write);
      return mapRow<T>(result.rows[0]!);
    });
  }

  private async appendAtomicWrite(write: LightTickAtomicWrite): Promise<void> {
    for (const event of [write.event, ...(write.additionalEvents ?? [])]) {
      await this.query(`INSERT INTO zook_lighttick_execution_events
        (id,app_id,user_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload,occurred_at,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [event.id,event.appId,event.userId,event.aggregateType,
        event.aggregateId,event.eventType,event.aggregateVersion,JSON.stringify(event.payload),event.occurredAt,event.createdAt]);
    }
    const change = write.change;
    await this.query(`INSERT INTO zook_lighttick_change_log
      (app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot,changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [change.appId,change.userId,change.entityType,change.entityId,
      change.entityVersion,change.operation,JSON.stringify(change.snapshot ?? null),change.changedAt]);
  }

  async listReflections(owner: LightTickOwner): Promise<LightTickReflectionRow[]> {
    return new PostgresReflectionStore(this.query.bind(this), mapRow).listReflections(owner);
  }
  async saveReflection(row: LightTickReflectionRow, expectedVersion?: number): Promise<LightTickReflectionRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveReflection(row, expectedVersion));
    return new PostgresReflectionStore(this.query.bind(this), mapRow).saveReflection(row, expectedVersion);
  }
  private reading() { return new PostgresReadingStore(this.query.bind(this), mapRow); }
  listReadingArticles(owner: LightTickOwner) { return this.reading().listReadingArticles(owner); }
  getReadingArticle(owner: LightTickOwner, id: string) { return this.reading().getReadingArticle(owner, id); }
  findReadingArticleByUrlHash(owner: LightTickOwner, urlHash: string) { return this.reading().findReadingArticleByUrlHash(owner, urlHash); }
  saveReadingArticle(row: LightTickReadingArticleRow, expectedRevision?: number) { return this.reading().saveReadingArticle(row, expectedRevision); }
  deleteReadingArticle(owner: LightTickOwner, id: string) { return this.reading().deleteReadingArticle(owner, id); }
  getReadingGuide(owner: LightTickOwner, articleId: string) { return this.reading().getReadingGuide(owner, articleId); }
  saveReadingGuide(row: LightTickReadingGuideRow, expectedRevision?: number) { return this.reading().saveReadingGuide(row, expectedRevision); }
  getReadingState(owner: LightTickOwner, articleId: string) { return this.reading().getReadingState(owner, articleId); }
  saveReadingState(row: LightTickReadingStateRow, expectedRevision?: number) { return this.reading().saveReadingState(row, expectedRevision); }
  getReadingFeedback(owner: LightTickOwner, articleId: string) { return this.reading().getReadingFeedback(owner, articleId); }
  saveReadingFeedback(row: LightTickReadingFeedbackRow, expectedRevision?: number) { return this.reading().saveReadingFeedback(row, expectedRevision); }
  listReadingDaily(owner: LightTickOwner, businessDate: string) { return this.reading().listReadingDaily(owner, businessDate); }
  listReadingDailySince(owner: LightTickOwner, sinceDate: string) { return this.reading().listReadingDailySince(owner, sinceDate); }
  listReadingStates(owner: LightTickOwner) { return this.reading().listReadingStates(owner); }
  listReadingFeedback(owner: LightTickOwner) { return this.reading().listReadingFeedback(owner); }
  listReadingGuides(owner: LightTickOwner) { return this.reading().listReadingGuides(owner); }
  saveReadingDaily(rows: LightTickReadingDailyRow[]) { return this.reading().saveReadingDaily(rows); }
  async listReviews(owner: LightTickOwner): Promise<LightTickReviewRow[]> {
    const result = await this.query("SELECT * FROM zook_lighttick_reviews WHERE app_id=$1 AND user_id=$2 ORDER BY period_start DESC", [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickReviewRow>);
  }
  async saveReview(row: LightTickReviewRow, expectedVersion?: number): Promise<LightTickReviewRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveReview(row, expectedVersion));
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_reviews SET
        status=$1,facts=$2::jsonb,output=$3::jsonb,data_sufficiency=$4,version=version+1,updated_at=$5
        WHERE app_id=$6 AND user_id=$7 AND id=$8 AND version=$9 RETURNING *`,
        [row.status,JSON.stringify(row.facts),JSON.stringify(row.output),row.dataSufficiency,row.updatedAt,
          row.appId,row.userId,row.id,expectedVersion]);
      if (!result.rows[0]) versionConflict(row.id);
      return mapRow<LightTickReviewRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_reviews
      (id,app_id,user_id,goal_id,period,status,period_start,period_end,facts,output,data_sufficiency,version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,facts=EXCLUDED.facts,output=EXCLUDED.output,
      data_sufficiency=EXCLUDED.data_sufficiency,version=EXCLUDED.version,updated_at=EXCLUDED.updated_at
      WHERE zook_lighttick_reviews.app_id=EXCLUDED.app_id AND zook_lighttick_reviews.user_id=EXCLUDED.user_id
      RETURNING *`,
      [row.id,row.appId,row.userId,row.goalId,row.period,row.status,row.periodStart,row.periodEnd,JSON.stringify(row.facts),
        JSON.stringify(row.output),row.dataSufficiency,row.version,row.createdAt,row.updatedAt]);
    if (!result.rows[0]) throw new ApplicationError(409, "LIGHTTICK_APP_ACCESS_DENIED", "Review ownership does not match.");
    return mapRow<LightTickReviewRow>(result.rows[0]!);
  }

  async getProposal(owner: LightTickOwner, id: string): Promise<LightTickChangeProposalRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_change_proposals WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId,owner.userId,id]);
    return result.rows[0] ? mapRow<LightTickChangeProposalRow>(result.rows[0]) : undefined;
  }
  async listProposals(owner: LightTickOwner, planId?: string): Promise<LightTickChangeProposalRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_change_proposals WHERE app_id=$1 AND user_id=$2
      ${planId ? "AND plan_id=$3" : ""} ORDER BY updated_at DESC`,
    planId ? [owner.appId, owner.userId, planId] : [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickChangeProposalRow>);
  }
  async saveProposal(row: LightTickChangeProposalRow, expectedVersion?: number): Promise<LightTickChangeProposalRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveProposal(row, expectedVersion));
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_change_proposals SET status=$1,decided_at=$2,version=version+1,updated_at=NOW()
        WHERE app_id=$3 AND user_id=$4 AND id=$5 AND version=$6 RETURNING *`, [row.status,row.decidedAt ?? null,row.appId,row.userId,row.id,expectedVersion]);
      if (!result.rows[0]) versionConflict(row.id);
      return mapRow<LightTickChangeProposalRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_change_proposals
      (id,app_id,user_id,plan_id,base_plan_version,status,reason,diff,impact,expires_at,decided_at,version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,1,$12,$13) RETURNING *`,
      [row.id,row.appId,row.userId,row.planId,row.basePlanVersion,row.status,row.reason,JSON.stringify(row.diff),
        JSON.stringify(row.impact),row.expiresAt,row.decidedAt ?? null,row.createdAt,row.updatedAt]);
    return mapRow<LightTickChangeProposalRow>(result.rows[0]!);
  }

  async getAiRun(owner: LightTickOwner, id: string): Promise<LightTickAiRunRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_ai_runs WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId,owner.userId,id]);
    return result.rows[0] ? mapRow<LightTickAiRunRow>(result.rows[0]) : undefined;
  }
  async saveAiRun(row: LightTickAiRunRow): Promise<LightTickAiRunRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveAiRun(row));
    const result = await this.query(`INSERT INTO zook_lighttick_ai_runs
      (id,app_id,user_id,kind,status,resource_id,scene_key,prompt_version,schema_version,provider,model,attempt_count,input_context,output,error_code,usage,latency_ms,created_at,started_at,completed_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16::jsonb,$17,$18,$19,$20,$21)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,resource_id=EXCLUDED.resource_id,provider=EXCLUDED.provider,model=EXCLUDED.model,
      attempt_count=EXCLUDED.attempt_count,output=EXCLUDED.output,error_code=EXCLUDED.error_code,usage=EXCLUDED.usage,
      latency_ms=EXCLUDED.latency_ms,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at RETURNING *`,
      [row.id,row.appId,row.userId,row.kind,row.status,row.resourceId ?? null,row.sceneKey,row.promptVersion,row.schemaVersion,
        row.provider ?? null,row.model ?? null,row.attemptCount,JSON.stringify(row.inputContext),JSON.stringify(row.output ?? null),
        row.errorCode ?? null,JSON.stringify(row.usage),row.latencyMs ?? null,row.createdAt,row.startedAt ?? null,row.completedAt ?? null,row.updatedAt]);
    return mapRow<LightTickAiRunRow>(result.rows[0]!);
  }

  async getOperation(owner: LightTickOwner, operationId: string): Promise<LightTickOperationRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id=$3", [owner.appId,owner.userId,operationId]);
    return result.rows[0] ? mapRow<LightTickOperationRow>(result.rows[0]) : undefined;
  }
  async saveOperation(row: LightTickOperationRow): Promise<LightTickOperationRow> {
    if (!this.transactions.active) return this.transaction(row, () => this.saveOperation(row));
    const result = await this.query(`INSERT INTO zook_lighttick_operations
      (app_id,user_id,operation_id,device_id,payload_hash,entity_type,entity_id,action,request_payload,result_payload,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)
      ON CONFLICT (app_id,user_id,operation_id) DO NOTHING RETURNING *`, [row.appId,row.userId,row.operationId,row.deviceId,
      row.payloadHash,row.entityType,row.entityId,row.action,JSON.stringify(row.requestPayload),JSON.stringify(row.resultPayload),
      row.status,row.createdAt,row.updatedAt]);
    return result.rows[0] ? mapRow<LightTickOperationRow>(result.rows[0]) : (await this.getOperation(row,row.operationId))!;
  }
  async pullChanges(owner: LightTickOwner, afterSequence: number, limit: number): Promise<LightTickChangeRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_change_log WHERE app_id=$1 AND user_id=$2
      AND sequence>$3 ORDER BY sequence ASC LIMIT $4`, [owner.appId,owner.userId,afterSequence,limit]);
    return result.rows.map(mapRow<LightTickChangeRow>);
  }

  private readonly devices=new PostgresLightTickDeviceStore((sql,args)=>this.query(sql,args));
  upsertDevice=(row:LightTickDeviceRow)=>this.transaction(row,()=>this.devices.upsertDevice(row));
  listDevices=(owner:LightTickOwner)=>this.devices.listDevices(owner);
  deleteDevice=(owner:LightTickOwner,id:string,deletedAt:string)=>this.transaction(owner,()=>this.devices.deleteDevice(owner,id,deletedAt));
  async deleteOwnerData(owner:LightTickOwner):Promise<void>{await deleteLightTickOwnerData(this,this.query.bind(this),owner);}
  async getAdminOperationalSummary():Promise<Record<string,number>> {return readLightTickOperationalSummary((sql,values=[])=>this.query(sql,values));}
  searchRecords=(owner:LightTickOwner,q:string,limit:number)=>this.searchStore().searchRecords(owner,q,limit);
  searchGoals=(owner:LightTickOwner,q:string,limit:number)=>this.searchStore().searchGoals(owner,q,limit);
  searchTasks=(owner:LightTickOwner,q:string,limit:number)=>this.searchStore().searchTasks(owner,q,limit);
  listTimeline=(owner:LightTickOwner,limit:number,cursor?:Parameters<PostgresSearchStore["listTimeline"]>[2])=>this.searchStore().listTimeline(owner,limit,cursor);
  async saveBehaviorApplication(owner:LightTickOwner,app:import("../../../modules/lighttick/lighttick-behavior.service.ts").BehaviorApplication):Promise<void> {
    await this.query(`INSERT INTO zook_lighttick_behavior_applications(app_id,user_id,id,date,module_id,concept,scenario,effectiveness,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[owner.appId,owner.userId,app.id,app.date,app.module_id,app.concept,app.scenario,app.effectiveness,app.created_at]);
  }
  async listBehaviorApplications(owner:LightTickOwner,query:{date_from?:string;date_to?:string;module_id?:import("../../../modules/lighttick/lighttick-behavior.service.ts").BehaviorModule}):Promise<import("../../../modules/lighttick/lighttick-behavior.service.ts").BehaviorApplication[]> {
    const values:unknown[]=[owner.appId,owner.userId];
    const clauses=['app_id=$1','user_id=$2'];
    if(query.date_from){values.push(query.date_from);clauses.push('date>=$'+values.length);}
    if(query.date_to){values.push(query.date_to);clauses.push('date<=$'+values.length);}
    if(query.module_id){values.push(query.module_id);clauses.push('module_id=$'+values.length);}
    const result=await this.query(`SELECT * FROM zook_lighttick_behavior_applications WHERE ${clauses.join(' AND ')} ORDER BY date DESC,id DESC`,values);
    return result.rows.map(r=>({id:String(r.id),date:String(r.date),module_id:String(r.module_id),concept:String(r.concept),scenario:String(r.scenario??''),effectiveness:Number(r.effectiveness),created_at:String(r.created_at)}));
  }
  async getBehaviorApplication(owner:LightTickOwner,id:string):Promise<import("../../../modules/lighttick/lighttick-behavior.service.ts").BehaviorApplication|undefined> {
    const result=await this.query('SELECT * FROM zook_lighttick_behavior_applications WHERE app_id=$1 AND user_id=$2 AND id=$3',[owner.appId,owner.userId,id]);
    const r=result.rows[0];
    return r?{id:String(r.id),date:String(r.date),module_id:String(r.module_id),concept:String(r.concept),scenario:String(r.scenario??''),effectiveness:Number(r.effectiveness),created_at:String(r.created_at)}:undefined;
  }
  async updateBehaviorApplication(owner:LightTickOwner,app:import("../../../modules/lighttick/lighttick-behavior.service.ts").BehaviorApplication):Promise<void> {
    await this.query('UPDATE zook_lighttick_behavior_applications SET date=$3,module_id=$4,concept=$5,scenario=$6,effectiveness=$7 WHERE app_id=$1 AND user_id=$2 AND id=$3',[owner.appId,owner.userId,app.date,app.module_id,app.concept,app.scenario,app.effectiveness]);
  }
  async deleteBehaviorApplication(owner:LightTickOwner,id:string):Promise<boolean> {
    const result=await this.query('DELETE FROM zook_lighttick_behavior_applications WHERE app_id=$1 AND user_id=$2 AND id=$3',[owner.appId,owner.userId,id]);
    return (result.rowCount??0)>0;
  }
  async listDistinctBehaviorConcepts(owner:LightTickOwner):Promise<string[]> {
    const result=await this.query('SELECT DISTINCT concept FROM zook_lighttick_behavior_applications WHERE app_id=$1 AND user_id=$2 ORDER BY concept',[owner.appId,owner.userId]);
    return result.rows.map(r=>String(r.concept));
  }
  async listAiEvidenceSnapshots(owner:LightTickOwner,query?:{kind?:import("../../../modules/lighttick/lighttick-ai-evidence.service.ts").EvidenceKind;limit?:number}):Promise<import("../../../modules/lighttick/lighttick-ai-evidence.service.ts").EvidenceSnapshot[]> {
    const result = await this.query(
      "SELECT data FROM zook_lighttick_ai_evidence WHERE app_id=$1 AND user_id=$2 AND ($3::text IS NULL OR kind=$3) ORDER BY captured_at DESC, id LIMIT $4",
      [owner.appId, owner.userId, query?.kind ?? null, query?.limit ?? 50],
    );
    return result.rows.map(row => (typeof row.data === "string" ? JSON.parse(row.data) : row.data) as EvidenceSnapshot);
  }
  async getAiEvidenceSnapshot(owner:LightTickOwner,snapshotId:string):Promise<import("../../../modules/lighttick/lighttick-ai-evidence.service.ts").EvidenceSnapshot|undefined> {
    const result=await this.query('SELECT * FROM zook_lighttick_ai_evidence WHERE app_id=$1 AND user_id=$2 AND id=$3',[owner.appId,owner.userId,snapshotId]);
    const data = result.rows[0]?.data;
    return (typeof data === "string" ? JSON.parse(data) : data) as EvidenceSnapshot | undefined;
  }
  async saveAiEvidenceFeedback(owner:LightTickOwner,feedback:import("../../../modules/lighttick/lighttick-ai-evidence.service.ts").EvidenceFeedback):Promise<void> {
    await this.query('INSERT INTO zook_lighttick_ai_evidence_feedback(app_id,user_id,snapshot_id,useful,comment,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(app_id,user_id,snapshot_id) DO UPDATE SET useful=EXCLUDED.useful,comment=EXCLUDED.comment',[owner.appId,owner.userId,feedback.snapshot_id,feedback.useful,feedback.comment??null,feedback.created_at]);
  }
  async listAiEvidenceFeedback(owner:LightTickOwner):Promise<import("../../../modules/lighttick/lighttick-ai-evidence.service.ts").EvidenceFeedback[]> {
    const result=await this.query('SELECT * FROM zook_lighttick_ai_evidence_feedback WHERE app_id=$1 AND user_id=$2 ORDER BY created_at DESC',[owner.appId,owner.userId]);
    return result.rows.map(r=>({snapshot_id:String(r.snapshot_id),useful:Boolean(r.useful),comment:r.comment?String(r.comment):undefined,created_at:String(r.created_at)}));
  }
}
