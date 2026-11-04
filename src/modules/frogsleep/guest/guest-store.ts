export interface SleepGuestIdentity {
  userId:string; deviceHash:string; secretHash:string; tokenHash:string; platform:'ios'|'android'; createdAt:string; expiresAt:string; upgradedTo?:string;
}
export interface SleepGuestCreation { operationHash:string; requestHash:string; userId:string }
export interface SleepGuestUpgradeResult { user_id:string; previous_guest_user_id:string; migrated_data_count:number; deduplicated_data_count:number; sync_epoch:string }
export interface SleepGuestUpgradeReceipt { guestUserId:string; targetUserId:string; operationHash:string; requestHash:string; result:SleepGuestUpgradeResult }
/** All methods join run's transaction. Only credential hashes are persisted. */
export interface SleepGuestStore {
  run<T>(locks:string[],operation:()=>Promise<T>):Promise<T>;
  lockMemberships(users:string[]):Promise<void>;
  find(userId:string):Promise<SleepGuestIdentity|undefined>;
  findProof(deviceHash:string,secretHash:string):Promise<SleepGuestIdentity|undefined>;
  save(identity:SleepGuestIdentity):Promise<void>;
  creation(operationHash:string):Promise<SleepGuestCreation|undefined>;
  saveCreation(receipt:SleepGuestCreation):Promise<void>;
  upgrade(guestUserId:string):Promise<SleepGuestUpgradeReceipt|undefined>;
  saveUpgrade(receipt:SleepGuestUpgradeReceipt):Promise<void>;
}
