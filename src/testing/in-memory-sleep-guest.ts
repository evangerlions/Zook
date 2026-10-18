import type { SleepGuestStore,SleepGuestIdentity,SleepGuestCreation,SleepGuestUpgradeReceipt } from '../modules/frogsleep/guest/guest-store.ts';
import type { InMemoryDatabase } from './in-memory-database.ts';
import type { InMemoryPersonalSyncRepository } from './in-memory-personal-sync.ts';
/** Scoped rollback matches the SQL guest transaction, including nested personal-sync writes. */
export class InMemorySleepGuestStore implements SleepGuestStore {
  private identities=new Map<string,SleepGuestIdentity>();
  private creations=new Map<string,SleepGuestCreation>();
  private upgrades=new Map<string,SleepGuestUpgradeReceipt>();
  constructor(private readonly db:InMemoryDatabase,private readonly sync:InMemoryPersonalSyncRepository) {}
  async run<T>(_locks:string[],operation:()=>Promise<T>):Promise<T> {
    return this.db.withExclusiveSession(async()=>{
      const snapshot=structuredClone({identities:this.identities,creations:this.creations,upgrades:this.upgrades,users:this.db.users,appUsers:this.db.appUsers,userRoles:this.db.userRoles,auditLogs:this.db.auditLogs});
      const personal=this.sync.snapshot();
      try { return await operation(); }
      catch(error) {this.identities=snapshot.identities;this.creations=snapshot.creations;this.upgrades=snapshot.upgrades;
        for(const key of ['users','appUsers','userRoles','auditLogs'] as const) this.db[key].splice(0,this.db[key].length,...snapshot[key] as never[]);
        this.sync.restore(personal);throw error;
      }
    });
  }
  async lockMemberships(_users:string[]) {}
  async find(id:string) { return structuredClone(this.identities.get(id)); }
  async findProof(device:string,secret:string) {return structuredClone([...this.identities.values()].find(i=>i.deviceHash===device&&i.secretHash===secret));}
  async save(identity:SleepGuestIdentity) {this.identities.set(identity.userId,structuredClone(identity));}
  async creation(key:string) {return structuredClone(this.creations.get(key));}
  async saveCreation(receipt:SleepGuestCreation) {if(this.creations.has(receipt.operationHash)) throw new Error('Duplicate guest creation receipt');this.creations.set(receipt.operationHash,structuredClone(receipt));}
  async upgrade(id:string) {return structuredClone(this.upgrades.get(id));}
  async saveUpgrade(receipt:SleepGuestUpgradeReceipt) {if(this.upgrades.has(receipt.guestUserId)) throw new Error('Duplicate guest upgrade receipt');this.upgrades.set(receipt.guestUserId,structuredClone(receipt));}
}
