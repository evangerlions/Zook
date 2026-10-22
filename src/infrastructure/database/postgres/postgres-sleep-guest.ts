import type { SleepGuestStore,SleepGuestIdentity,SleepGuestCreation,SleepGuestUpgradeReceipt } from '../../../modules/frogsleep/guest/guest-store.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]} >;
/** Uses the database ambient client so identity, membership and sync ownership commit together. */
export class PostgresSleepGuestStore implements SleepGuestStore {
  constructor(private readonly query:Query,private readonly transaction:<T>(operation:()=>Promise<T>)=>Promise<T>) {}
  async run<T>(locks:string[],operation:()=>Promise<T>):Promise<T> {
    return this.transaction(async()=>{
      for(const key of [...new Set(locks)].sort()) await this.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['frogsleep-guest:'+key]);
      return operation();
    });
  }
  async lockMemberships(users:string[]) { await this.query("SELECT user_id FROM zook_app_users WHERE app_id='frogsleep' AND user_id=ANY($1::text[]) ORDER BY user_id FOR UPDATE",[[...new Set(users)].sort()]); }
  async find(userId:string) {return (await this.query('SELECT document FROM zook_frogsleep_guest_identities WHERE user_id=$1',[userId])).rows[0]?.document as SleepGuestIdentity|undefined;}
  async findProof(deviceHash:string,secretHash:string) {return (await this.query('SELECT document FROM zook_frogsleep_guest_identities WHERE device_hash=$1 AND secret_hash=$2',[deviceHash,secretHash])).rows[0]?.document as SleepGuestIdentity|undefined;}
  async save(identity:SleepGuestIdentity) {await this.query('INSERT INTO zook_frogsleep_guest_identities(user_id,device_hash,secret_hash,document) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(user_id) DO UPDATE SET document=EXCLUDED.document',[identity.userId,identity.deviceHash,identity.secretHash,JSON.stringify(identity)]);}
  async creation(key:string) {return (await this.query('SELECT document FROM zook_frogsleep_guest_creations WHERE operation_hash=$1',[key])).rows[0]?.document as SleepGuestCreation|undefined;}
  async saveCreation(receipt:SleepGuestCreation) {await this.query('INSERT INTO zook_frogsleep_guest_creations(operation_hash,user_id,document) VALUES($1,$2,$3::jsonb)',[receipt.operationHash,receipt.userId,JSON.stringify(receipt)]);}
  async upgrade(userId:string) {return (await this.query('SELECT document FROM zook_frogsleep_guest_upgrades WHERE guest_user_id=$1',[userId])).rows[0]?.document as SleepGuestUpgradeReceipt|undefined;}
  async saveUpgrade(receipt:SleepGuestUpgradeReceipt) {await this.query('INSERT INTO zook_frogsleep_guest_upgrades(guest_user_id,target_user_id,document) VALUES($1,$2,$3::jsonb)',[receipt.guestUserId,receipt.targetUserId,JSON.stringify(receipt)]);}
}
