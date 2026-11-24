import { accountClock, type LearningContinuationRepository, type LearningContinuationRow } from "../modules/lighttick/learning/learning-continuation.types.ts";
import { businessDateAt } from "../modules/lighttick/lighttick-today.service.ts";
import type { LocalGeneration, LocalGenerationRepository } from "../modules/lighttick/personal-model/local-generation.types.ts";
import { InMemoryFormRecordsStore } from "./in-memory-form-records-store.ts";
import {InMemoryResearchAIStore} from "./in-memory-research-ai-store.ts";
import { InMemoryGitHubStore } from "./in-memory-github-store.ts";
import {InMemoryPersonalModelStore} from "./in-memory-personal-model-store.ts";
import {InMemoryInvestmentStore} from "./in-memory-investment-store.ts";
import {sourceAvailable} from "../modules/lighttick/knowledge/knowledge.service.ts";
import {InMemoryKnowledgeStore} from "./in-memory-knowledge-store.ts";
import {InMemoryNativeLearningStore} from "./in-memory-native-learning-store.ts";
import {InMemoryLearningRouteStore} from "./in-memory-learning-route-store.ts";
import type {LocalClaim} from '../modules/lighttick/manual/local-adoption.types.ts';
import type { RecordTransferRow, RecordTransferTicket } from "../modules/lighttick/records/record-transfer.types.ts";
import { selectRecordRows } from "../modules/lighttick/lighttick-record.service.ts";
import type { LightTickRecordRow, LightTickRecord, RecordQuery } from "../modules/lighttick/lighttick-record.service.ts";
import type {ActionWorkspaceRow,ActionTicket,ActionLink} from '../modules/lighttick/actions/action.types.ts';
import type { LightTickReflectionRow } from "../modules/lighttick/lighttick-reflection.service.ts";
import type { PlanningAvailability, PlanningAvailabilityStore } from "../modules/lighttick/planning/planning-availability-store.ts";
import type { StageOutcomeEvidenceHistory, StageOutcomeEvidenceRow, StageOutcomeEvidenceStore } from "../modules/lighttick/planning/stage-outcome-evidence-store.ts";
import type { PlannedRestDate, PlannedRestStore } from "../modules/lighttick/planning/planned-rest-store.ts";
import type { PlanningSession } from "../modules/lighttick/planning/planning.types.ts";
import type { LightTickAtomicWrite, LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { AsyncLocalStorage } from "node:async_hooks";
import type {
  LightTickAiRunRow, LightTickChangeProposalRow, LightTickChangeRow, LightTickChatMessageRow, LightTickDnaInsightRow, LightTickDeviceRow,
  LightTickAccountUpgradeCommand, LightTickAccountUpgradeResult, LightTickInsightAuditRow,
  LightTickExecutionEventRow, LightTickGoalContextRow, LightTickGoalRow, LightTickGuestIdentityRow, LightTickOperationRow, LightTickOwner,
  LightTickPlanRow, LightTickProfileRow, LightTickReviewRow, LightTickTaskRow, LightTickTaskStepRow, LightTickWeeklyPlanningBudget,
} from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";

type VersionedOwnerRow = { id?: string; appId: "lighttick"; userId: string; version: number; updatedAt: string };
const clone = <T>(value: T): T => structuredClone(value);
const ownerKey = (owner: LightTickOwner) => `${owner.appId}:${owner.userId}`;
const rowKey = (row: LightTickOwner & { id: string }) => `${ownerKey(row)}:${row.id}`;

export class InMemoryLightTickRepository implements LightTickRepository {
  private continuationRows = new Map<string, LearningContinuationRow>();
  readonly learningContinuations: LearningContinuationRepository = {
    get: async (owner, taskId) => clone(this.continuationRows.get(rowKey({ ...owner, id: taskId }))),
    list: async owner => clone([...this.continuationRows.values()].filter(row => row.appId === owner.appId && row.userId === owner.userId)),
    listDue: async (now, limit) => clone([...this.continuationRows.values()].filter(row => {
      const timezone = this.profiles.get(ownerKey(row))?.timezone ?? "UTC";
      const date = businessDateAt(now, timezone);
      return row.phase === "rollover" && row.dueDate <= date || row.phase === "reminder" &&
        (row.dueDate < date || row.dueDate === date && accountClock(now, timezone) >= row.reminderTime!);
    }).sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.taskId.localeCompare(right.taskId)).slice(0, limit)),
    save: async row => { this.continuationRows.set(rowKey({ ...row, id: row.taskId }), clone(row)); },
  };
  readonly researchAI=new InMemoryResearchAIStore();
  readonly formRecords=new InMemoryFormRecordsStore();
  readonly github=new InMemoryGitHubStore();
  readonly personalModels=new InMemoryPersonalModelStore();
  readonly investments=new InMemoryInvestmentStore();
  readonly knowledge=new InMemoryKnowledgeStore(async o=>{
    const facts=[];for(const lesson of await this.listNativeLessons(o,'',5001)){
      if(lesson.archived||!lesson.publishedVersion||(await this.getLearningCollection(o,lesson.collectionId))?.archived)continue;
      const publication=await this.getLessonPublication(o,lesson.id,lesson.publishedVersion);if(publication){const state=await this.getNativePrivateState(o,lesson.id,lesson.publishedVersion)??null;const h=(await this.listLearningHistory(o,lesson.id,lesson.publishedVersion,'',1000)).find(h=>['initial','notes','import'].includes(h.component)&&h.state.notesRevision===state?.notesRevision);facts.push({lesson,publication,state,notesUpdatedAt:h?.createdAt??null});}
    }return facts;
  },(o,s)=>sourceAvailable(this,o,s));
  readonly learningRoutes=new InMemoryLearningRouteStore(async(o,id)=>{
    const result=[];
    for(const link of await this.learningRoutes.listRouteLessonLinks(o,id)){
      const lesson=await this.getNativeLesson(o,link.lessonId);if(!lesson?.publishedVersion)continue;
      const state=await this.getNativePrivateState(o,lesson.id,lesson.publishedVersion);
      result.push({number:link.number,lessonId:lesson.id,contentVersion:lesson.publishedVersion,completed:state?.completed===true,sourceCompleted:lesson.sourceCompleted===true&&lesson.sourceCompletedVersion===lesson.publishedVersion});
    }
    return result;
  });
  private nativeLearning=new InMemoryNativeLearningStore();
  private setupKnowledgeExport=(()=>{this.knowledge.learningExport=(o,includePrivate)=>this.nativeLearning.exportAuthorized(o,includePrivate);return true;})();
  getNativeLearningCounts=async(o:LightTickOwner)=>({...await this.nativeLearning.getNativeLearningCounts(o),...await this.learningRoutes.counts(o)});
  async clearNativeLearningStaging(o:LightTickOwner){await this.learningRoutes.clearStaging(o);await this.nativeLearning.clearNativeLearningStaging(o);for(const [id,r] of this.operations)if(r.appId===o.appId&&r.userId===o.userId&&r.deviceId==='learning-migration')this.operations.delete(id);}
  async listLearningReceipts(o:LightTickOwner,id:string){return clone([...this.operations.values()].filter(r=>r.appId===o.appId&&r.userId===o.userId&&r.entityType==='learning_private'&&r.entityId===id&&r.operationId.startsWith('learning-compat:')).slice(0,1000));}
  getLearningAuthority=this.nativeLearning.getLearningAuthority.bind(this.nativeLearning);
  saveLearningAuthority=this.nativeLearning.saveLearningAuthority.bind(this.nativeLearning);
  listLearningCollections=this.nativeLearning.listLearningCollections.bind(this.nativeLearning);
  getLearningCollection=this.nativeLearning.getLearningCollection.bind(this.nativeLearning);
  saveLearningCollection=this.nativeLearning.saveLearningCollection.bind(this.nativeLearning);
  listNativeLessons=this.nativeLearning.listNativeLessons.bind(this.nativeLearning);
  getNativeLesson=this.nativeLearning.getNativeLesson.bind(this.nativeLearning);
  saveNativeLesson=this.nativeLearning.saveNativeLesson.bind(this.nativeLearning);
  getLessonPublication=this.nativeLearning.getLessonPublication.bind(this.nativeLearning);
  insertLessonPublication=this.nativeLearning.insertLessonPublication.bind(this.nativeLearning);
  getNativePrivateState=this.nativeLearning.getNativePrivateState.bind(this.nativeLearning);
  saveNativePrivateState=this.nativeLearning.saveNativePrivateState.bind(this.nativeLearning);
  appendLearningHistory=this.nativeLearning.appendLearningHistory.bind(this.nativeLearning);
  listLearningHistory=this.nativeLearning.listLearningHistory.bind(this.nativeLearning);
  listLearningModules=this.nativeLearning.listLearningModules.bind(this.nativeLearning);
  getLearningModule=this.nativeLearning.getLearningModule.bind(this.nativeLearning);
  saveLearningModule=this.nativeLearning.saveLearningModule.bind(this.nativeLearning);
  listLearningModuleTemplates=this.nativeLearning.listLearningModuleTemplates.bind(this.nativeLearning);
  getUserSubscription=this.nativeLearning.getUserSubscription.bind(this.nativeLearning);
  saveUserSubscription=this.nativeLearning.saveUserSubscription.bind(this.nativeLearning);
  getStorageUsage=this.nativeLearning.getStorageUsage.bind(this.nativeLearning);
  getUserStorage=this.nativeLearning.getUserStorage.bind(this.nativeLearning);
  listUserStorage=this.nativeLearning.listUserStorage.bind(this.nativeLearning);
  saveUserStorage=this.nativeLearning.saveUserStorage.bind(this.nativeLearning);
  deleteUserStorage=this.nativeLearning.deleteUserStorage.bind(this.nativeLearning);
  private localClaims=new Map<string,LocalClaim>();
  async lockLocalSource(hash:string){}
  async getLocalClaim(hash:string){return clone(this.localClaims.get(hash));}
  async saveLocalClaim(row:LocalClaim){if(this.localClaims.has(row.sourceHash))throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','Source was already adopted.');this.localClaims.set(row.sourceHash,clone(row));}
  private recordTransfers=new Map<string,RecordTransferRow>();
  private recordTickets=new Map<string,RecordTransferTicket>();
  private sourceHistories=new Map<string,Record<string,unknown>>();
  private learningPrivate = new Map<string,Record<string,any>>();
  private learningLibraries = new Map<string,Record<string,any>>();
  private actionWorkspaces = new Map<string,ActionWorkspaceRow>();
  private actionTickets = new Map<string,ActionTicket>();
  private actionLinks = new Map<string,ActionLink>();
  private planningSessions = new Map<string, PlanningSession>();
  private profiles = new Map<string, LightTickProfileRow>();
  private weeklyPlanningBudgets = new Map<string, LightTickWeeklyPlanningBudget>();
  private goals = new Map<string, LightTickGoalRow>();
  private plans = new Map<string, LightTickPlanRow>();
  private tasks = new Map<string, LightTickTaskRow>();
  private taskSteps = new Map<string, LightTickTaskStepRow>();
  private records = new Map<string, LightTickRecordRow>();
  private recordHistory = new Map<string, LightTickRecord[]>();
  private reflections = new Map<string, LightTickReflectionRow>();
  private reviews = new Map<string, LightTickReviewRow>();
  private proposals = new Map<string, LightTickChangeProposalRow>();
  private aiRuns = new Map<string, LightTickAiRunRow>();
  private localGenerationRows = new Map<string, LocalGeneration>();
  readonly localGenerations: LocalGenerationRepository = {
    get: async (owner, id) => clone(this.localGenerationRows.get(rowKey({ ...owner, id }))),
    pending: async owner => clone([...this.localGenerationRows.values()]
      .filter(row => ownerKey(row) === ownerKey(owner) && row.status === "prepared")),
    save: async row => { this.localGenerationRows.set(rowKey(row), clone(row)); },
  };
  private operations = new Map<string, LightTickOperationRow>();
  private devices = new Map<string, LightTickDeviceRow>();
  private guestIdentities = new Map<string, LightTickGuestIdentityRow>();
  private upgradeOperations = new Map<string, { requestHash: string; result: LightTickAccountUpgradeResult }>();
  private events: LightTickExecutionEventRow[] = [];
  private insightAudits: LightTickInsightAuditRow[] = [];
  private chatMessages: LightTickChatMessageRow[] = [];
  private dnaInsights: LightTickDnaInsightRow[] = [];
  private changes: LightTickChangeRow[] = [];
  private sequence = 0;
  private readonly transactionSession = new AsyncLocalStorage<boolean>();
  private transactionTail: Promise<void> = Promise.resolve();

  async transaction<T>(owner: LightTickOwner, operation: () => Promise<T>): Promise<T> {
    this.assertOwner(owner);
    if (this.transactionSession.getStore()) return await operation();
    // Serialize snapshots across owners as all maps belong to this repository.
    const previous = this.transactionTail;
    let release!: () => void;
    this.transactionTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await this.transactionSession.run(true, () => this.runTransaction(operation)); }
    finally { release(); }
  }

  private planningAvailabilityByOwner = new Map<string, PlanningAvailability>();
  readonly planningAvailability: PlanningAvailabilityStore = {
    get: async owner => clone(this.planningAvailabilityByOwner.get(ownerKey(owner))),
    save: async (owner, availability) => {
      this.assertOwner(owner);
      const key = ownerKey(owner);
      if (availability.version !== (this.planningAvailabilityByOwner.get(key)?.version ?? 0) + 1)
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Review the current planning weekdays.");
      this.planningAvailabilityByOwner.set(key, clone(availability));
      return clone(availability);
    },
  };
  private stageOutcomeRows = new Map<string, StageOutcomeEvidenceRow>();
  readonly stageOutcomeEvidence: StageOutcomeEvidenceStore = {
    list: async (owner, goalId, { stageId, startsOn, endsOn } = {}) => this.stageOutcomeHistory(owner, goalId)
      .filter(row => (!stageId || row.stageId === stageId) && (!startsOn || row.occurredOn >= startsOn) && (!endsOn || row.occurredOn <= endsOn))
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn) || b.recordedAt.localeCompare(a.recordedAt) || a.id.localeCompare(b.id)),
    get: async (owner, goalId, stageId, id) => this.stageOutcomeHistory(owner, goalId).find(row => row.stageId === stageId && row.id === id),
    stageIds: async (owner, goalId) => [...new Set(this.stageOutcomeHistory(owner, goalId).map(row => row.stageId))],
    add: async row => {
      this.assertOwner(row);
      const key = ownerKey(row) + ":" + row.id;
      if (this.stageOutcomeRows.has(key) || (row.correctedFrom &&
        !this.stageOutcomeHistory(row, row.goalId).some(prior => prior.stageId === row.stageId && prior.id === row.correctedFrom && prior.isCurrent)))
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Reload the current evidence.");
      this.stageOutcomeRows.set(key, clone(row));
    },
  };
  private stageOutcomeHistory(owner: LightTickOwner, goalId: string): StageOutcomeEvidenceHistory[] {
    const rows = [...this.stageOutcomeRows.values()].filter(row => ownerKey(row) === ownerKey(owner) && row.goalId === goalId);
    const corrected = new Set(rows.map(row => row.correctedFrom));
    return rows.map(row => ({ ...clone(row), isCurrent: !corrected.has(row.id) }));
  }
  private plannedRestByOwner = new Map<string, Record<string, PlannedRestDate>>();
  readonly plannedRest: PlannedRestStore = {
    get: async (owner, date) => clone(this.plannedRestByOwner.get(ownerKey(owner))?.[date]),
    list: async (owner, startsOn, endsOn) => Object.values(this.plannedRestByOwner.get(ownerKey(owner)) ?? {})
      .filter(row => row.planned_rest && row.date >= startsOn && row.date <= endsOn).map(row => row.date).sort(),
    save: async (owner, rest) => {
      this.assertOwner(owner);
      const rows = this.plannedRestByOwner.get(ownerKey(owner)) ?? {};
      if (rest.version !== (rows[rest.date]?.version ?? 0) + 1)
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The planned rest date changed.");
      this.plannedRestByOwner.set(ownerKey(owner), { ...rows, [rest.date]: clone(rest) });
      return clone(rest);
    },
  };
  private async runTransaction<T>(operation: () => Promise<T>): Promise<T> {
    const snapshot = clone({ continuationRows: [...this.continuationRows], formRecords:this.formRecords.snapshot(), researchAI:this.researchAI.snapshot(), github:this.github.snapshot(), personalModels:this.personalModels.snapshot(), investments:this.investments.snapshot(), knowledge:this.knowledge.snapshot(), learningRoutes:this.learningRoutes.snapshot(), nativeLearning:this.nativeLearning.snapshot(), localClaims:[...this.localClaims], learningPrivate:[...this.learningPrivate], learningLibraries:[...this.learningLibraries], recordTransfers:[...this.recordTransfers],recordTickets:[...this.recordTickets],sourceHistories:[...this.sourceHistories], records:[...this.records],recordHistory:[...this.recordHistory], actionWorkspaces:[...this.actionWorkspaces],actionTickets:[...this.actionTickets],actionLinks:[...this.actionLinks],planningSessions: [...this.planningSessions], profiles: [...this.profiles], goals: [...this.goals], plans: [...this.plans],
      tasks: [...this.tasks], taskSteps: [...this.taskSteps], reflections: [...this.reflections], reviews: [...this.reviews], proposals: [...this.proposals], aiRuns: [...this.aiRuns],
      localGenerationRows: [...this.localGenerationRows], operations: [...this.operations], devices: [...this.devices], guestIdentities: [...this.guestIdentities],
      weeklyPlanningBudgets: [...this.weeklyPlanningBudgets],
      upgradeOperations: [...this.upgradeOperations],
      events: this.events, insightAudits: this.insightAudits, chatMessages: this.chatMessages, dnaInsights: this.dnaInsights,
      changes: this.changes, sequence: this.sequence, planningAvailabilityByOwner: [...this.planningAvailabilityByOwner], stageOutcomeRows: [...this.stageOutcomeRows], plannedRestByOwner: [...this.plannedRestByOwner] });
    try { return await operation(); }
    catch (error) {
      this.continuationRows = new Map(snapshot.continuationRows);
      this.formRecords.restore(snapshot.formRecords);
      this.researchAI.restore(snapshot.researchAI);
      this.github.restore(snapshot.github);
      this.personalModels.restore(snapshot.personalModels);
      this.nativeLearning.restore(snapshot.nativeLearning);
      this.investments.restore(snapshot.investments); this.knowledge.restore(snapshot.knowledge); this.learningRoutes.restore(snapshot.learningRoutes);
      this.planningAvailabilityByOwner = new Map(snapshot.planningAvailabilityByOwner);
      this.stageOutcomeRows = new Map(snapshot.stageOutcomeRows);
      this.plannedRestByOwner = new Map(snapshot.plannedRestByOwner);
      this.localClaims=new Map(snapshot.localClaims);
      this.recordTransfers=new Map(snapshot.recordTransfers);this.recordTickets=new Map(snapshot.recordTickets);this.sourceHistories=new Map(snapshot.sourceHistories);
      this.records=new Map(snapshot.records);this.recordHistory=new Map(snapshot.recordHistory);
      this.learningPrivate=new Map(snapshot.learningPrivate);
      this.learningLibraries=new Map(snapshot.learningLibraries);
      this.actionWorkspaces=new Map(snapshot.actionWorkspaces);this.actionTickets=new Map(snapshot.actionTickets);this.actionLinks=new Map(snapshot.actionLinks);
      this.reflections = new Map(snapshot.reflections);
      this.planningSessions = new Map(snapshot.planningSessions);
      this.weeklyPlanningBudgets = new Map(snapshot.weeklyPlanningBudgets);
      this.profiles = new Map(snapshot.profiles); this.goals = new Map(snapshot.goals); this.plans = new Map(snapshot.plans);
      this.tasks = new Map(snapshot.tasks); this.taskSteps = new Map(snapshot.taskSteps); this.reviews = new Map(snapshot.reviews); this.proposals = new Map(snapshot.proposals);
      this.aiRuns = new Map(snapshot.aiRuns); this.localGenerationRows = new Map(snapshot.localGenerationRows); this.operations = new Map(snapshot.operations); this.devices = new Map(snapshot.devices);
      this.guestIdentities = new Map(snapshot.guestIdentities);
      this.upgradeOperations = new Map(snapshot.upgradeOperations);
      this.events = snapshot.events; this.insightAudits = snapshot.insightAudits;
      this.chatMessages = snapshot.chatMessages; this.dnaInsights = snapshot.dnaInsights; this.changes = snapshot.changes; this.sequence = snapshot.sequence;
      throw error;
    }
  }

  private assertOwner(owner: LightTickOwner) {
    if (owner.appId !== "lighttick") throw new Error("LightTick repository requires appId=lighttick");
  }
  private versioned<T extends VersionedOwnerRow>(current: T | undefined, input: T, expectedVersion?: number): T {
    this.assertOwner(input);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource version is stale.");
    }
    if (expectedVersion === undefined && current) {
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource already exists.");
    }
    return clone({ ...input, version: current ? current.version + 1 : 1, updatedAt: input.updatedAt });
  }
  private append(write: LightTickAtomicWrite) {
    this.events.push(clone(write.event));
    this.events.push(...clone(write.additionalEvents ?? []));
    this.changes.push(clone({ ...write.change, sequence: ++this.sequence }));
  }

  async lockActionOwner(owner:LightTickOwner){this.assertOwner(owner);}
  async getLearningPrivate(owner:LightTickOwner){return clone(this.learningPrivate.get(ownerKey(owner)));}
  async saveLearningPrivate(owner:LightTickOwner,data:Record<string,any>){this.learningPrivate.set(ownerKey(owner),clone(data));}
  async getLearningLibrary(owner:LightTickOwner){return clone(this.learningLibraries.get(ownerKey(owner)));}
  async saveLearningLibrary(owner:LightTickOwner,data:Record<string,any>){this.learningLibraries.set(ownerKey(owner),clone(data));}
  async getActionWorkspace(owner:LightTickOwner){return clone(this.actionWorkspaces.get(ownerKey(owner)));}
  async saveActionWorkspace(row:ActionWorkspaceRow){this.actionWorkspaces.set(ownerKey(row),clone(row));}
  async getActionTicket(hash:string){return clone(this.actionTickets.get(hash));}
  async saveActionTicket(row:ActionTicket){this.actionTickets.set(row.hash,clone(row));}
  async getActionLink(source:string){return clone(this.actionLinks.get(source));}
  async getOwnerActionLink(owner:LightTickOwner){return clone([...this.actionLinks.values()].find(l=>ownerKey(l)===ownerKey(owner)));}
  async saveActionLink(row:ActionLink){const source=this.actionLinks.get(row.source_account_id),owner=await this.getOwnerActionLink(row);
    if(source&&source.userId!==row.userId||owner&&owner.source_account_id!==row.source_account_id)throw new ApplicationError(409,'LIGHTTICK_VERSION_CONFLICT','账户已连接。');
    this.actionLinks.set(row.source_account_id,clone(row));}
  async lockRecordSource(key:string) {}
  async getRecordTransfer(key:string){return clone(this.recordTransfers.get(key));}
  async getOwnerRecordTransfer(owner:LightTickOwner){return clone([...this.recordTransfers.values()].find(r=>ownerKey(r)===ownerKey(owner)));}
  async saveRecordTransfer(row:RecordTransferRow){
    const source=this.recordTransfers.get(row.sourceKey),target=await this.getOwnerRecordTransfer(row);
    if(source&&source.userId!==row.userId||target&&target.sourceKey!==row.sourceKey)throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Record binding conflict.");
    this.recordTransfers.set(row.sourceKey,clone(row));
  }
  async getRecordTransferTicket(hash:string){return clone(this.recordTickets.get(hash));}
  async saveRecordTransferTicket(row:RecordTransferTicket){this.recordTickets.set(row.hash,clone(row));}
  async importRecord(row:LightTickRecordRow,versions:LightTickRecord[],history:Record<string,unknown>){
    if(this.records.has(rowKey(row)))throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Imported record conflict.");
    this.records.set(rowKey(row),clone(row));this.recordHistory.set(rowKey(row),clone(versions));this.sourceHistories.set(rowKey(row),clone(history));
    this.changes.push({...row,entityType:"record",entityId:row.id,entityVersion:row.version,operation:"upsert",snapshot:clone(row.payload) as unknown as Record<string,unknown>,changedAt:row.payload.updated_at,sequence:++this.sequence});
  }
  async recordSourceHistory(owner:LightTickOwner,id:string){return clone(this.sourceHistories.get(rowKey({...owner,id})));}
  async lockRecordOwner(owner: LightTickOwner) { this.assertOwner(owner); }
  async getRecord(owner: LightTickOwner, id: string) { this.assertOwner(owner); return clone(this.records.get(rowKey({...owner,id}))); }
  async listRecords(owner: LightTickOwner, query?: RecordQuery) { this.assertOwner(owner); const rows=[...this.records.values()].filter(r => ownerKey(r) === ownerKey(owner)); return clone(query?selectRecordRows(rows,query):rows); }
  async recordVersions(owner: LightTickOwner, id: string) { this.assertOwner(owner); return clone(this.recordHistory.get(rowKey({...owner,id})) ?? []).reverse(); }
  async getRecordVersion(owner:LightTickOwner,id:string,version:number){this.assertOwner(owner);return clone(this.recordHistory.get(rowKey({...owner,id}))?.find(record=>record.version===version));}
  async saveRecord(row: LightTickRecordRow, baseVersion: number) {
    const key=rowKey(row),current=this.records.get(key);
    if ((current?.version ?? 0) !== baseVersion) throw new ApplicationError(409,"LIGHTTICK_VERSION_CONFLICT","Record version changed.");
    this.records.set(key,clone(row)); this.recordHistory.set(key,[...(this.recordHistory.get(key)??[]),clone(row.payload)]);
    this.changes.push({...row,entityType:"record",entityId:row.id,entityVersion:row.version,operation:"upsert",snapshot:clone(row.payload) as unknown as Record<string,unknown>,changedAt:row.payload.updated_at,sequence:++this.sequence});
  }
  async lockPlanningOwner(owner: LightTickOwner) { this.assertOwner(owner); }
  async getPlanningSession(owner: LightTickOwner, id: string) {
    this.assertOwner(owner); return clone(this.planningSessions.get(rowKey({ ...owner, id })));
  }
  async listPlanningSessions(owner: LightTickOwner, limit: number, goalId?: string, stageId?: string, subjectId?: string) {
    this.assertOwner(owner);
    return [...this.planningSessions.values()]
      .filter(row => ownerKey(row) === ownerKey(owner) && (goalId === undefined || row.goalId === goalId) &&
        (stageId === undefined || row.stageId === stageId) && (subjectId === undefined || row.subjectId === subjectId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id))
      .flatMap(({ id, goalId, status, context, updatedAt, draftPlanId, draftExpiresAt, previousPlanId, stageId: storedStageId, subjectId: storedSubjectId }) => {
        const goal = this.goals.get(rowKey({ ...owner, id: goalId }));
        const start = context.period_start?.source !== "assumption" ? context.period_start?.value : undefined;
        const end = context.period_end?.source !== "assumption" ? context.period_end?.value : undefined;
        return goal ? [{ id, goalId, goalTitle: goal.title, status, updatedAt, draftPlanId, draftExpiresAt, previousPlanId, stageId: storedStageId,
          ...(storedSubjectId ? { subjectId: storedSubjectId } : {}),
          periodStart: typeof start === "string" ? start : null, periodEnd: typeof end === "string" ? end : null }] : [];
      })
      .slice(0, limit);
  }
  async listPlanningAgendaTasks(owner: LightTickOwner, startsOn: string, endsOn: string, canReadLearning: boolean) {
    const min = Date.parse(startsOn) - 86_400_000;
    const max = Date.parse(endsOn) + 2 * 86_400_000;
    const rows: LightTickTaskRow[] = [];
    for (const task of this.tasks.values()) {
      if (ownerKey(task) !== ownerKey(owner) || !["pending", "in_progress", "completed"].includes(task.status)) continue;
      const time = Date.parse(task.scheduledFor ?? "");
      if (!(min <= time && time < max)) continue;
      if (task.lessonSource && (!canReadLearning || (task.status !== "completed" &&
        (await this.learningRoutes.getLearningRoute(owner, task.lessonSource.route_id))?.status !== "active"))) continue;
      rows.push(task);
    }
    return clone(rows);
  }
  async savePlanningSession(row: PlanningSession, expectedVersion?: number) {
    const key = rowKey(row); const saved = this.versioned(this.planningSessions.get(key), row, expectedVersion);
    this.planningSessions.set(key, saved); return clone(saved);
  }
  async getGuestIdentity(owner: LightTickOwner) { return clone(this.guestIdentities.get(ownerKey(owner))); }
  async getGuestIdentityByDevice(deviceId: string) {
    return clone([...this.guestIdentities.values()].find(row => row.deviceId === deviceId));
  }
  async saveGuestIdentity(row: LightTickGuestIdentityRow) {
    this.assertOwner(row);
    for (const [key, existing] of this.guestIdentities) if (existing.deviceId === row.deviceId && key !== ownerKey(row))
      this.guestIdentities.delete(key);
    this.guestIdentities.set(ownerKey(row), clone(row)); return clone(row);
  }

  async upgradeGuestAccount(command: LightTickAccountUpgradeCommand): Promise<LightTickAccountUpgradeResult> {
    const operationKey = `${command.appId}:${command.operationId}`;
    const previous = this.upgradeOperations.get(operationKey);
    if (previous) {
      if (previous.requestHash !== command.requestHash)
        throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");
      return clone({ ...previous.result, idempotencyReplayed: true });
    }
    return await this.transaction({ appId: command.appId, userId: command.guestUserId }, async () => {
      const guestKey = `${command.appId}:${command.guestUserId}`;
      const targetKey = `${command.appId}:${command.targetUserId}`;
      const guest = this.guestIdentities.get(guestKey);
      if (!guest || guest.deviceId !== command.deviceId || guest.upgradeTokenHash !== command.guestUpgradeTokenHash)
        throw new ApplicationError(401, "LIGHTTICK_GUEST_CREDENTIAL_INVALID", "Guest upgrade proof is invalid.");
      if (guest.revokedAt) throw new ApplicationError(410, "LIGHTTICK_GUEST_REVOKED", "Guest session is revoked.");
      if (new Date(guest.expiresAt) <= new Date(command.now))
        throw new ApplicationError(410, "LIGHTTICK_GUEST_EXPIRED", "Guest session is expired.");

      this.assertUpgradeRelationships(guestKey, targetKey);
      const counts = { goals: this.countOwner(this.goals, guestKey), plans: this.countOwner(this.plans, guestKey),
        tasks: this.countOwner(this.tasks, guestKey), reviews: this.countOwner(this.reviews, guestKey),
        proposals: this.countOwner(this.proposals, guestKey) };
      this.mergeProfile(guestKey, targetKey, command.targetUserId);
      for (const store of [this.goals, this.plans, this.tasks, this.taskSteps, this.reflections, this.reviews, this.proposals, this.aiRuns] as Map<string, any>[])
        this.moveOwnedRows(store, guestKey, targetKey, command.targetUserId);
      this.moveOwnedRows(this.operations as Map<string, any>, guestKey, targetKey, command.targetUserId, true);
      this.mergeDevices(guestKey, targetKey, command.targetUserId);
      this.events = this.events.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.insightAudits = this.insightAudits.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.chatMessages = this.chatMessages.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.dnaInsights = this.dnaInsights.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.changes = this.changes.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.guestIdentities.set(guestKey, { ...guest, revokedAt: command.now,
        upgradedToUserId: command.targetUserId, updatedAt: command.now });
      const lastSequence = this.changes.filter(row => ownerKey(row) === targetKey)
        .reduce((maximum, row) => Math.max(maximum, row.sequence), 0);
      const result: LightTickAccountUpgradeResult = { guestUserId: command.guestUserId,
        targetUserId: command.targetUserId, idempotencyReplayed: false, lastSequence,
        transferredResourceCounts: counts };
      this.upgradeOperations.set(operationKey, { requestHash: command.requestHash, result: clone(result) });
      return clone(result);
    });
  }

  private assertUpgradeRelationships(guestKey: string, targetKey: string) {
    const rules: [Map<string, any>, string, Map<string, any>][] = [
      [this.plans, "goalId", this.goals], [this.tasks, "goalId", this.goals],
      [this.tasks, "planId", this.plans],
      [this.taskSteps, "taskId", this.tasks],
      [this.reviews, "goalId", this.goals], [this.proposals, "planId", this.plans],
    ];
    for (const [children, foreignKey, parents] of rules) {
      for (const [key, child] of children) {
        if (!key.startsWith(`${guestKey}:`)) continue;
        const related = [...parents.values()].find(parent => parent.id === child[foreignKey]);
        if (!related || ![guestKey, targetKey].includes(ownerKey(related)))
          throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
            "Guest data contains a relationship owned by another account.");
      }
    }
  }

  private countOwner(store: Map<string, unknown>, prefix: string) {
    return [...store.keys()].filter(key => key.startsWith(`${prefix}:`)).length;
  }

  private mergeProfile(guestKey: string, targetKey: string, targetUserId: string) {
    const guest = this.profiles.get(guestKey); const target = this.profiles.get(targetKey);
    if (!guest) return;
    if (!target) { this.profiles.set(targetKey, { ...guest, userId: targetUserId }); this.profiles.delete(guestKey); return; }
    const rank = (state: string) => ({ not_started: 0, drafting: 1, starter_ready: 2,
      three_day_active: 3, completed: 4 } as Record<string, number>)[state] ?? 0;
    const guestAhead = rank(guest.onboardingState) > rank(target.onboardingState);
    this.profiles.set(targetKey, { ...target,
      onboardingState: guestAhead ? guest.onboardingState : target.onboardingState,
      onboardingDraft: guestAhead && Object.keys(target.onboardingDraft).length === 0
        ? guest.onboardingDraft : target.onboardingDraft,
      version: Math.max(target.version, guest.version),
      updatedAt: target.updatedAt >= guest.updatedAt ? target.updatedAt : guest.updatedAt });
    this.profiles.delete(guestKey);
  }

  private moveOwnedRows(store: Map<string, any>, guestKey: string, targetKey: string,
    targetUserId: string, operationStore = false) {
    for (const [key, row] of [...store]) {
      if (!key.startsWith(`${guestKey}:`)) continue;
      const suffix = key.slice(guestKey.length + 1); const destination = `${targetKey}:${suffix}`;
      const existing = store.get(destination);
      if (existing) {
        const equivalent = operationStore
          ? existing.action === row.action && existing.payloadHash === row.payloadHash
            && JSON.stringify(existing.resultPayload) === JSON.stringify(row.resultPayload)
          : JSON.stringify({ ...existing, userId: undefined }) === JSON.stringify({ ...row, userId: undefined });
        if (!equivalent) throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT", "Guest data conflicts with registered account data.");
        store.delete(key); continue;
      }
      store.set(destination, { ...row, userId: targetUserId }); store.delete(key);
    }
  }

  private mergeDevices(guestKey: string, targetKey: string, targetUserId: string) {
    for (const [key, row] of [...this.devices]) {
      if (!key.startsWith(`${guestKey}:`)) continue;
      const destination = `${targetKey}:${row.id}`;
      const duplicateToken = [...this.devices.values()].some(item => ownerKey(item) === targetKey
        && item.pushProvider === row.pushProvider && item.pushToken === row.pushToken);
      if (!this.devices.has(destination) && !duplicateToken)
        this.devices.set(destination, { ...row, userId: targetUserId });
      this.devices.delete(key);
    }
  }

  async getProfile(owner: LightTickOwner) { return clone(this.profiles.get(ownerKey(owner))); }
  async saveProfile(row: LightTickProfileRow, expectedVersion?: number) {
    const saved = this.versioned(this.profiles.get(ownerKey(row)), row, expectedVersion);
    this.profiles.set(ownerKey(row), saved); return clone(saved);
  }
  async getWeeklyPlanningBudget(owner: LightTickOwner) { return clone(this.weeklyPlanningBudgets.get(ownerKey(owner))); }
  async saveWeeklyPlanningBudget(owner: LightTickOwner, budget: LightTickWeeklyPlanningBudget) {
    if (budget.version !== (this.weeklyPlanningBudgets.get(ownerKey(owner))?.version ?? 0) + 1)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "The weekly planning budget changed.");
    this.weeklyPlanningBudgets.set(ownerKey(owner), clone(budget));
    return clone(budget);
  }
  async listGoals(owner: LightTickOwner) { return clone([...this.goals.values()].filter(row => ownerKey(row) === ownerKey(owner))); }
  async getGoal(owner: LightTickOwner, id: string) { return clone(this.goals.get(`${ownerKey(owner)}:${id}`)); }
  async saveGoal(row: LightTickGoalRow, write: LightTickAtomicWrite, expectedVersion?: number) {
    return await this.saveAggregate(this.goals, row, write, expectedVersion);
  }
  // C3 4.1：goal context 表 B 是列 A constraints 的镜像，读仍走列 A，这里只需能双写成功。
  private goalContexts = new Map<string, LightTickGoalContextRow>();
  async getGoalContext(owner: LightTickOwner, goalId: string) {
    return clone(this.goalContexts.get(`${ownerKey(owner)}:${goalId}`));
  }
  async saveGoalContext(row: LightTickGoalContextRow, expectedVersion?: number) {
    const key = `${ownerKey(row)}:${row.goalId}`;
    const current = this.goalContexts.get(key);
    if (current && expectedVersion !== undefined && current.version !== expectedVersion)
      throw new ApplicationError(409, 'LIGHTTICK_VERSION_CONFLICT', 'Goal context changed.');
    const next = { ...row, version: (current?.version ?? 0) + 1, createdAt: current?.createdAt ?? row.createdAt, updatedAt: row.updatedAt };
    this.goalContexts.set(key, clone(next));
    return clone(next);
  }
  async getPlan(owner: LightTickOwner, id: string) { return clone(this.plans.get(`${ownerKey(owner)}:${id}`)); }
  async listPlans(owner: LightTickOwner, goalId?: string) {
    return clone([...this.plans.values()].filter(row => ownerKey(row) === ownerKey(owner) && (!goalId || row.goalId === goalId))
      .sort((left, right) => right.periodStart.localeCompare(left.periodStart) || right.updatedAt.localeCompare(left.updatedAt)));
  }
  async getActivePlan(owner: LightTickOwner) {
    return clone([...this.plans.values()].filter(row => ownerKey(row) === ownerKey(owner) && row.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]);
  }
  async savePlan(row: LightTickPlanRow, write: LightTickAtomicWrite, expectedVersion?: number) {
    return await this.saveAggregate(this.plans, row, write, expectedVersion);
  }
  async listTasks(owner: LightTickOwner, planId?: string) {
    return clone([...this.tasks.values()].filter(row => ownerKey(row) === ownerKey(owner) && (!planId || row.planId === planId)));
  }
  async listPlanningAgendaTasks(owner: LightTickOwner, startsOn: string, endsOn: string, canReadLearning: boolean, goalId?: string) {
    const min = Date.parse(startsOn) - 86_400_000;
    const max = Date.parse(endsOn) + 2 * 86_400_000;
    const rows: LightTickTaskRow[] = [];
    for (const task of this.tasks.values()) {
      if (ownerKey(task) !== ownerKey(owner) || (goalId !== undefined && task.goalId !== goalId) ||
        !["pending", "in_progress", "completed"].includes(task.status)) continue;
      const time = Date.parse(task.scheduledFor ?? "");
      if (!(min <= time && time < max)) continue;
      if (task.lessonSource && (!canReadLearning || (task.status !== "completed" &&
        (await this.learningRoutes.getLearningRoute(owner, task.lessonSource.route_id))?.status !== "active"))) continue;
      rows.push(task);
    }
    return clone(rows);
  }
  async getTask(owner: LightTickOwner, id: string) { return clone(this.tasks.get(`${ownerKey(owner)}:${id}`)); }
  async saveTask(row: LightTickTaskRow, write: LightTickAtomicWrite, expectedVersion?: number) {
    return await this.saveAggregate(this.tasks, row, write, expectedVersion);
  }
  async listTaskSteps(owner: LightTickOwner, taskId?: string) {
    return clone([...this.taskSteps.values()].filter(row => ownerKey(row) === ownerKey(owner) && (!taskId || row.taskId === taskId))
      .sort((left, right) => left.position - right.position));
  }
  async getTaskStep(owner: LightTickOwner, taskId: string, id: string) {
    const row = this.taskSteps.get(`${ownerKey(owner)}:${id}`);
    return clone(row?.taskId === taskId ? row : undefined);
  }
  async saveTaskStep(row: LightTickTaskStepRow, expectedVersion?: number) {
    const saved = this.versioned(this.taskSteps.get(rowKey(row)), row, expectedVersion);
    this.taskSteps.set(rowKey(row), saved); return clone(saved);
  }
  private async saveAggregate<T extends VersionedOwnerRow & { id: string }>(store: Map<string, T>, row: T,
    write: LightTickAtomicWrite, expectedVersion?: number): Promise<T> {
    return await this.transaction(row, async () => {
      const saved = this.versioned(store.get(rowKey(row)), row, expectedVersion);
      store.set(rowKey(row), saved); this.append(write); return clone(saved);
    });
  }

  async listReflections(owner: LightTickOwner) {
    this.assertOwner(owner);
    return clone([...this.reflections.values()].filter(row => ownerKey(row) === ownerKey(owner))
      .sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  async saveReflection(row: LightTickReflectionRow, expectedVersion?: number) {
    const saved = this.versioned(this.reflections.get(rowKey(row)), row, expectedVersion);
    this.reflections.set(rowKey(row), saved); return clone(saved);
  }
  async listReviews(owner: LightTickOwner) { return clone([...this.reviews.values()].filter(row => ownerKey(row) === ownerKey(owner))); }
  async saveReview(row: LightTickReviewRow, expectedVersion?: number) {
    this.assertOwner(row);
    if (expectedVersion !== undefined && this.reviews.get(rowKey(row))?.version !== expectedVersion)
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource version is stale.");
    const saved = expectedVersion === undefined ? row : { ...row, version: expectedVersion + 1 };
    this.reviews.set(rowKey(row), clone(saved)); return clone(saved);
  }
  async getProposal(owner: LightTickOwner, id: string) { return clone(this.proposals.get(`${ownerKey(owner)}:${id}`)); }
  async listProposals(owner: LightTickOwner, planId?: string) {
    return clone([...this.proposals.values()].filter(row => ownerKey(row) === ownerKey(owner) && (!planId || row.planId === planId))
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)));
  }
  async saveProposal(row: LightTickChangeProposalRow, expectedVersion?: number) {
    const saved = this.versioned(this.proposals.get(rowKey(row)), row, expectedVersion);
    this.proposals.set(rowKey(row), saved); return clone(saved);
  }
  async getAiRun(owner: LightTickOwner, id: string) { return clone(this.aiRuns.get(`${ownerKey(owner)}:${id}`)); }
  async getLatestNextWeekAdvice(owner: LightTickOwner, goalId: string, periodStart: string, periodEnd: string) {
    return clone([...this.aiRuns.values()].filter(run => {
      const scope = run.inputContext.next_week as { period_start?: string; period_end?: string } | undefined;
      return run.appId === owner.appId && run.userId === owner.userId && run.kind === "next_week_advice" &&
        run.resourceId === goalId && scope?.period_start === periodStart && scope?.period_end === periodEnd;
    }).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))[0]);
  }
  async saveAiRun(row: LightTickAiRunRow) { this.assertOwner(row); this.aiRuns.set(rowKey(row), clone(row)); return clone(row); }
  async getOperation(owner: LightTickOwner, operationId: string) { return clone(this.operations.get(`${ownerKey(owner)}:${operationId}`)); }
  async saveOperation(row: LightTickOperationRow) {
    this.assertOwner(row); const key = `${ownerKey(row)}:${row.operationId}`;
    const existing = this.operations.get(key); if (existing) return clone(existing);
    this.operations.set(key, clone(row)); return clone(row);
  }
  async pullChanges(owner: LightTickOwner, afterSequence: number, limit: number) {
    return clone(this.changes.filter(row => ownerKey(row) === ownerKey(owner) && row.sequence > afterSequence).slice(0, limit));
  }
  async upsertDevice(row: LightTickDeviceRow) { this.assertOwner(row); this.devices.set(rowKey(row), clone(row)); return clone(row); }
  async listDevices(owner: LightTickOwner) { return clone([...this.devices.values()].filter(row => ownerKey(row) === ownerKey(owner))); }
  async deleteDevice(owner: LightTickOwner, id: string, deletedAt: string, expectedPushToken?: string) {
    const key = `${ownerKey(owner)}:${id}`; const row = this.devices.get(key); if (!row?.active) return false;
    if (expectedPushToken !== undefined && row.pushToken !== expectedPushToken) return false;
    this.devices.set(key, { ...row, active: false, deletedAt, updatedAt: deletedAt }); return true;
  }
  async deleteOwnerData(owner: LightTickOwner) {
    for (const [key, row] of this.continuationRows)
      if (row.appId === owner.appId && row.userId === owner.userId) this.continuationRows.delete(key);
    this.nativeLearning.deleteOwner(owner);
    this.researchAI.deleteOwner(owner);
    this.formRecords.deleteOwner(owner);
    this.github.deleteOwner(owner);
    this.personalModels.deleteOwner(owner);
    this.investments.deleteOwner(owner); this.knowledge.deleteOwner(owner); this.learningRoutes.deleteOwner(owner);
    for(const [key,r] of this.localClaims)if(r.userId===owner.userId)this.localClaims.set(key,{...r,userId:null,cloudId:null,payloadHash:null,sourcePayload:{},deleted:true});
    for(const [key,row] of this.recordTransfers)if(ownerKey(row)===ownerKey(owner))this.recordTransfers.delete(key);
    for(const [key,row] of this.recordTickets)if(ownerKey(row)===ownerKey(owner))this.recordTickets.delete(key);
    for(const key of this.sourceHistories.keys())if(key.startsWith(ownerKey(owner)+":"))this.sourceHistories.delete(key);
    const prefix = `${ownerKey(owner)}:`;
    this.learningPrivate.delete(ownerKey(owner));
    this.learningLibraries.delete(ownerKey(owner));
    this.actionWorkspaces.delete(ownerKey(owner));
    for(const store of [this.actionTickets,this.actionLinks])for(const [key,row] of store)if(ownerKey(row)===ownerKey(owner))store.delete(key);
    this.profiles.delete(ownerKey(owner));
    this.weeklyPlanningBudgets.delete(ownerKey(owner));
    this.guestIdentities.delete(ownerKey(owner));
    for (const [key, operation] of this.upgradeOperations)
      if (operation.result.guestUserId === owner.userId || operation.result.targetUserId === owner.userId)
        this.upgradeOperations.delete(key);
    for (const key of this.records.keys()) if (key.startsWith(ownerKey(owner)+":")) { this.records.delete(key); this.recordHistory.delete(key); }
    for (const store of [this.planningSessions,this.goals,this.plans,this.tasks,this.taskSteps,this.reflections,this.reviews,this.proposals,this.aiRuns,this.localGenerationRows,this.operations,this.devices]) {
      for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
    }
    this.events = this.events.filter(row => ownerKey(row) !== ownerKey(owner));
    this.insightAudits = this.insightAudits.filter(row => ownerKey(row) !== ownerKey(owner));
    this.chatMessages = this.chatMessages.filter(row => ownerKey(row) !== ownerKey(owner));
    this.dnaInsights = this.dnaInsights.filter(row => ownerKey(row) !== ownerKey(owner));
    this.changes = this.changes.filter(row => ownerKey(row) !== ownerKey(owner));
  }
  async listExecutionEvents(owner: LightTickOwner, from?: string, to?: string, goalId?: string) {
    return clone(this.events.filter(row => ownerKey(row) === ownerKey(owner) &&
      (!from || row.occurredAt >= from) && (!to || row.occurredAt < to) &&
      (goalId === undefined || (row.aggregateType === "task" &&
        this.tasks.get(rowKey({ ...owner, id: row.aggregateId }))?.goalId === goalId))));
  }
  async appendInsightAudit(row: LightTickInsightAuditRow): Promise<LightTickInsightAuditRow> {
    this.insightAudits.push(clone(row)); return clone(row);
  }
  async listInsightAudits(owner: LightTickOwner, from?: string, to?: string) {
    return clone(this.insightAudits.filter(row => ownerKey(row) === ownerKey(owner) &&
      (!from || row.createdAt >= from) && (!to || row.createdAt < to))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  }
  async saveChatMessage(row: LightTickChatMessageRow): Promise<LightTickChatMessageRow> {
    this.chatMessages.push(clone(row)); return clone(row);
  }
  async listChatMessages(owner: LightTickOwner, threadId: string, limit: number, goalId?: string): Promise<LightTickChatMessageRow[]> {
    const bounded = Math.min(Math.max(limit, 1), 200);
    return clone(this.chatMessages.filter(row => ownerKey(row) === ownerKey(owner) && row.threadId === threadId && (goalId === undefined || row.goalId === goalId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-bounded));
  }
  async getDnaInsight(owner: LightTickOwner, id: string): Promise<LightTickDnaInsightRow | undefined> {
    return clone(this.dnaInsights.find(row => ownerKey(row) === ownerKey(owner) && row.id === id));
  }
  async listDnaInsights(owner: LightTickOwner, goalId?: string): Promise<LightTickDnaInsightRow[]> {
    return clone(this.dnaInsights.filter(row => ownerKey(row) === ownerKey(owner) && (!goalId || row.goalId === goalId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }
  async saveDnaInsight(row: LightTickDnaInsightRow, expectedVersion?: number): Promise<LightTickDnaInsightRow> {
    const existing = this.dnaInsights.find(item => ownerKey(item) === ownerKey(row) && item.id === row.id);
    if (expectedVersion !== undefined) {
      if (!existing || existing.version !== expectedVersion)
        throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource version is stale.");
      const updated = clone({ ...existing, ...row, version: existing.version + 1, updatedAt: row.updatedAt });
      this.dnaInsights = this.dnaInsights.map(item => item.id === existing.id ? updated : item);
      return clone(updated);
    }
    const bySignature = this.dnaInsights.find(item => ownerKey(item) === ownerKey(row) && item.signature === row.signature
      && item.status === "proposed");
    if (bySignature && bySignature.id !== row.id) {
      const merged = clone({ ...bySignature, statement: row.statement, kind: row.kind, evidenceCount: row.evidenceCount,
        dataRange: row.dataRange, evidence: row.evidence, confidence: row.confidence, scope: row.scope, expiresAt: row.expiresAt,
        updatedAt: row.updatedAt, version: bySignature.version + 1 });
      this.dnaInsights = this.dnaInsights.map(item => item.id === bySignature.id ? merged : item);
      return clone(merged);
    }
    this.dnaInsights.push(clone(row)); return clone(row);
  }
  async getAdminOperationalSummary() {
    return { profiles: this.profiles.size, onboarding_completed: [...this.profiles.values()].filter(row => row.onboardingState === "completed").length,
      goals: this.goals.size, plans: this.plans.size, plan_confirmations: this.events.filter(row => row.eventType === "plan_confirmed").length,
      tasks: this.tasks.size, task_actions: this.events.filter(row => row.aggregateType === "task" && row.eventType.startsWith("task_")).length,
      reviews: this.reviews.size, pending_proposals: [...this.proposals.values()].filter(row => row.status === "pending").length,
      proposals_accepted: [...this.proposals.values()].filter(row => row.status === "accepted").length,
      ai_runs: this.aiRuns.size, ai_failures: [...this.aiRuns.values()].filter(row => row.status === "failed").length,
      ai_schema_failures: [...this.aiRuns.values()].filter(row => row.errorCode === "LIGHTTICK_AI_RUN_FAILED").length,
      ai_average_latency_ms: average([...this.aiRuns.values()].map(row => row.latencyMs).filter((value): value is number => value !== undefined)),
      ai_total_tokens: [...this.aiRuns.values()].reduce((sum, row) => sum + Number(row.usage.totalTokens ?? 0), 0),
      sync_conflicts: [...this.operations.values()].filter(row => row.status === "conflict").length,
      notification_failures: [...this.operations.values()].filter(row => row.entityType === "notification" && row.status !== "accepted").length,
      active_devices: [...this.devices.values()].filter(row => row.active).length };
  }
}

function average(values: number[]) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
