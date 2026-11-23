import type {
  LightTickOperationRow,
  LightTickOwner,
} from "../lighttick.types.ts";
export type LearningAuthorityPhase =
  | "legacy"
  | "frozen"
  | "imported"
  | "verified"
  | "zook";
export interface LearningAuthority extends LightTickOwner {
  module: "learning";
  readingEnabled: boolean;
  privateEnabled: boolean;
  consentRevision?: number;
  phase: LearningAuthorityPhase;
  epoch: number;
  revision: number;
  manifestHash: string | null;
  sourceBinding: string | null;
  updatedAt: string;
}
export interface LearningCollection extends LightTickOwner {
  id: string;
  moduleId: string | null;
  title: string;
  description: string;
  revision: number;
  archived: boolean;
  updatedAt: string;
}
export interface NativeLesson extends LightTickOwner {
  id: string;
  moduleId: string | null;
  collectionId: string;
  number: number;
  title: string;
  revision: number;
  publishedVersion: string | null;
  sourceCompleted?: boolean;
  sourceCompletedVersion?: string | null;
  archived: boolean;
  updatedAt: string;
}
export interface LessonPublication extends LightTickOwner {
  lessonId: string;
  contentVersion: string;
  content: string;
  references: string;
  sourceUrl: string;
  tutorTopic?: string | null;
  createdAt: string;
}
export interface LearningAnswer {
  id: string;
  prompt: string;
  answer: string;
}
export interface NativePrivateState extends LightTickOwner {
  moduleId: string | null;
  lessonId: string;
  contentVersion: string;
  revision: number;
  draftVersion?: string;
  notesRevision: number;
  positionRevision: number;
  completionRevision: number;
  notes: string;
  answers: LearningAnswer[];
  position: number;
  completed: boolean;
  completedAt: string | null;
  updatedAt: string;
}
export interface LearningHistoryEntry extends LightTickOwner {
  id: string;
  lessonId: string;
  contentVersion: string;
  component: "initial" | "notes" | "position" | "completion" | "import";
  revision: number;
  state: NativePrivateState;
  createdAt: string;
}
export interface LearningModule extends LightTickOwner {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  sourceType: "github" | "local" | "manual";
  sourceUrl: string | null;
  sourcePath: string | null;
  // 新增字段（107 迁移）
  ownerId?: string | null;
  isPublic?: boolean;
  subscriberCount?: number;
  lastSyncedAt?: string | null;
  syncStatus?: "idle" | "syncing" | "error" | "disabled";
  storageUsed?: number;
  sourceConfig?: SourceConfig | null;
  storageConfig?: StorageConfig | null;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

// 新增：来源配置
export interface SourceConfig {
  github?: {
    repository: string;
    branch: string;
    prefix: string;
    token?: string;
    syncInterval: "manual" | "hourly" | "daily" | "webhook";
    lastCommitSha?: string;
  };
  url?: {
    url: string;
    fetchInterval: "manual" | "daily" | "weekly";
    selector?: string;
    format: "markdown" | "html" | "json";
  };
  subscription?: {
    moduleId: string;
    ownerId: string;
    autoSync: boolean;
  };
}

// 新增：存储配置
export interface StorageConfig {
  type: "cloud" | "github" | "local" | "hybrid";
  github?: {
    repository: string;
    branch: string;
    token: string;
    prefix: string;
  };
  local?: {
    directory: string;
    autoSync: boolean;
  };
  cloud?: {
    region: string;
    bucket?: string;
  };
}

export interface UserStorageConfig extends StorageConfig {
  userId: string;
  id?: string;
  isDefault?: boolean;
}

// 新增：用户订阅（付费套餐）
export interface UserSubscription {
  userId: string;
  planId: "basic" | "premium" | "professional" | "enterprise";
  status: "active" | "cancelled" | "expired" | "pending";
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  paymentMethod?: {
    type: "alipay" | "wechat" | "stripe";
    last4?: string;
  };
  createdAt: string;
  updatedAt: string;
}

// 新增：存储使用统计
export interface StorageUsage {
  userId: string;
  totalUsed: number;
  totalLimit: number;
  percentage: number;
  breakdown: {
    modules: { count: number; size: number };
    lessons: { count: number; size: number };
    attachments: { count: number; size: number };
    versions: { count: number; size: number };
  };
  topModules: Array<{
    moduleId: string;
    title: string;
    size: number;
  }>;
  updatedAt: string;
}

// 新增：存储配额定义
export interface StorageQuota {
  totalSpace: number;
  maxFileSize: number;
  maxFiles: number;
  maxVersions: number;
  maxModules: number;
  githubStorage: boolean;
  cloudStorage: boolean;
  urlImport: boolean;
  marketplace: boolean;
}
export interface LearningModuleTemplate {
  id: string;
  title: string;
  description: string;
  sourceType: "github" | "local" | "manual";
  sourceUrl: string | null;
  sourcePath: string | null;
  displayOrder: number;
}
export interface NativeLearningRepository {
  getNativeLearningCounts(
    owner: LightTickOwner,
  ): Promise<Record<string, number>>;
  clearNativeLearningStaging(owner: LightTickOwner): Promise<void>;
  listLearningReceipts(
    owner: LightTickOwner,
    lessonId: string,
  ): Promise<LightTickOperationRow[]>;
  getLearningAuthority(
    owner: LightTickOwner,
  ): Promise<LearningAuthority | undefined>;
  saveLearningAuthority(
    row: LearningAuthority,
    expectedRevision: number,
  ): Promise<void>;
  listLearningCollections(
    owner: LightTickOwner,
    after: string,
    limit: number,
    moduleId?: string,
  ): Promise<LearningCollection[]>;
  getLearningCollection(
    owner: LightTickOwner,
    id: string,
  ): Promise<LearningCollection | undefined>;
  saveLearningCollection(
    row: LearningCollection,
    expectedRevision: number,
  ): Promise<void>;
  listNativeLessons(
    owner: LightTickOwner,
    after: string,
    limit: number,
    collectionId?: string,
    moduleId?: string,
  ): Promise<NativeLesson[]>;
  getNativeLesson(
    owner: LightTickOwner,
    id: string,
  ): Promise<NativeLesson | undefined>;
  saveNativeLesson(row: NativeLesson, expectedRevision: number): Promise<void>;
  getLessonPublication(
    owner: LightTickOwner,
    lessonId: string,
    version: string,
  ): Promise<LessonPublication | undefined>;
  insertLessonPublication(row: LessonPublication): Promise<void>;
  getNativePrivateState(
    owner: LightTickOwner,
    lessonId: string,
    version: string,
  ): Promise<NativePrivateState | undefined>;
  saveNativePrivateState(
    row: NativePrivateState,
    expectedRevision: number,
  ): Promise<void>;
  appendLearningHistory(row: LearningHistoryEntry): Promise<void>;
  listLearningHistory(
    owner: LightTickOwner,
    lessonId: string,
    version: string,
    before: string,
    limit: number,
  ): Promise<LearningHistoryEntry[]>;
  listLearningModules(owner: LightTickOwner): Promise<LearningModule[]>;
  getLearningModule(
    owner: LightTickOwner,
    id: string,
  ): Promise<LearningModule | undefined>;
  saveLearningModule(
    row: LearningModule,
    expectedRevision: number,
  ): Promise<void>;
  listLearningModuleTemplates(): Promise<LearningModuleTemplate[]>;
}

export interface LearningStorageRepository {
  getUserSubscription(
    owner: LightTickOwner,
  ): Promise<UserSubscription | undefined>;
  saveUserSubscription(row: UserSubscription): Promise<void>;
  // 新增：存储使用统计
  getStorageUsage(owner: LightTickOwner): Promise<StorageUsage>;
  // 新增：存储配置管理
  getUserStorage(
    owner: LightTickOwner,
    id: string,
  ): Promise<UserStorageConfig | undefined>;
  listUserStorage(owner: LightTickOwner): Promise<UserStorageConfig[]>;
  saveUserStorage(row: UserStorageConfig): Promise<void>;
  deleteUserStorage(owner: LightTickOwner, id: string): Promise<void>;
}
