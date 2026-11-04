export interface FilePurgeTask {
  id: string;
  appId: string;
  userId: string;
  storageKey: string;
  attempt: number;
  leaseToken: string;
}
