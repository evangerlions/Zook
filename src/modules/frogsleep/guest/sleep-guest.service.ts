import { randomBytes,randomUUID } from 'node:crypto';
import type { ApplicationDatabase } from '../../../infrastructure/database/application-database.ts';
import type { AppRegistryService } from '../../app-registry/app-registry.service.ts';
import { ApplicationError,badRequest,conflict,forbidden } from '../../../shared/errors.ts';
import { personalSyncCapabilities } from '../personal-sync/personal-sync.service.ts';
import { guestHash,guestToken,guestFields,guestString,guestKey,guestUnavailable,sameHash } from './guest-validation.ts';
import { transferGuestSync } from './guest-sync-transfer.ts';
/** Dependencies only; identity and transaction state stay local to each invocation. */
export class SleepGuestService {
  constructor(private readonly db:ApplicationDatabase,private readonly registry:AppRegistryService) {}
  async create(body:Record<string,unknown>,key:unknown,now=new Date()) {
    guestFields(body,['device_id','device_secret','platform']);
    const device=guestString(body.device_id,'device_id'),secret=guestString(body.device_secret,'device_secret',43,128);
    if(!/^[A-Za-z0-9_-]+$/.test(secret)) badRequest('REQ_INVALID_BODY','device_secret must be a random base64url secret of at least 32 bytes.');
    if(body.platform!=='ios'&&body.platform!=='android') badRequest('REQ_INVALID_BODY','platform must be ios or android.');
    const platform=body.platform,operationHash=guestHash(guestKey(key)),deviceHash=guestHash(device),secretHash=guestHash(secret),requestHash=guestHash(JSON.stringify([deviceHash,secretHash,platform]));
    await this.registry.getAppOrThrow('frogsleep');
    const store=this.db.getSleepGuestStore();
    return store.run(['proof:'+deviceHash+secretHash,'creation:'+operationHash],async()=>{
      const receipt=await store.creation(operationHash);
      if(receipt&&receipt.requestHash!==requestHash) conflict('FROGSLEEP_GUEST_IDEMPOTENCY_CONFLICT','Idempotency key was reused with another request.');
      let identity=receipt?await store.find(receipt.userId):await store.findProof(deviceHash,secretHash);
      if(receipt&&!identity) guestUnavailable();
      if(identity) {
        await store.lockMemberships([identity.userId]);
        identity=await store.find(identity.userId);
        if(!identity||identity.upgradedTo||Date.parse(identity.expiresAt)<=now.getTime()||(await this.db.findAppUser('frogsleep',identity.userId))?.status!=='ACTIVE'||(await this.db.findUserById(identity.userId))?.status!=='ACTIVE') guestUnavailable();
      } else {
        const userId='sleep_guest_'+randomUUID(),token=guestToken(secret,userId,device);
        identity={userId,deviceHash,secretHash,tokenHash:guestHash(token),platform,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+30*86400000).toISOString()};
        await this.db.insertUser({id:userId,passwordHash:guestHash(randomBytes(32).toString('base64url')),passwordAlgo:'frogsleep-guest',status:'ACTIVE',createdAt:now.toISOString()});
        await this.registry.ensureMembership('frogsleep',userId,now);
        await store.save(identity);
      }
      if(!receipt) await store.saveCreation({operationHash,requestHash,userId:identity.userId});
      return {guest_user_id:identity.userId,guest_upgrade_token:guestToken(secret,identity.userId,device),guest_expires_at:identity.expiresAt,is_guest:true};
    });
  }
  async upgrade(target:string,body:Record<string,unknown>,key:unknown,epoch:unknown,now=new Date()) {
    guestFields(body,['guest_user_id','guest_upgrade_token','device_id','confirmed']);
    const source=guestString(body.guest_user_id,'guest_user_id'),proof=guestString(body.guest_upgrade_token,'guest_upgrade_token',40,128),device=guestString(body.device_id,'device_id');
    const operationHash=guestHash(guestKey(key));
    if(typeof epoch!=='string'||!epoch||epoch.length>200) badRequest('REQ_INVALID_HEADER','X-Sync-Epoch is required.');
    if(body.confirmed!==true) badRequest('REQ_INVALID_BODY','Explicit confirmation is required.');
    if(!personalSyncCapabilities().write||!personalSyncCapabilities().read) throw new ApplicationError(503,'FROGSLEEP_SYNC_DISABLED','Personal sync is temporarily unavailable.');
    const store=this.db.getSleepGuestStore(),requestHash=guestHash(JSON.stringify([source,target,guestHash(proof),guestHash(device),epoch,true]));
    return store.run(['upgrade:'+source],async()=>{
      await store.lockMemberships([source,target]);
      const identity=await store.find(source);
      if(!identity||!sameHash(identity.tokenHash,guestHash(proof))||!sameHash(identity.deviceHash,guestHash(device))) guestUnavailable();
      const user=await this.db.findUserById(target),membership=await this.db.findAppUser('frogsleep',target);
      if(source===target||!user||user.status!=='ACTIVE'||user.passwordAlgo==='frogsleep-guest'||!user.email&&!user.phone||membership?.status!=='ACTIVE') forbidden('FROGSLEEP_REGISTERED_ACCOUNT_REQUIRED','Upgrade requires an active registered target account.');
      const receipt=await store.upgrade(source);
      if(receipt) {
        if(receipt.targetUserId!==target||receipt.operationHash!==operationHash||receipt.requestHash!==requestHash) conflict('FROGSLEEP_GUEST_ALREADY_UPGRADED','Guest identity was already transferred.');
        await this.db.getPersonalSyncRepository().run(target,async tx=>{if(tx.state.epoch!==epoch) conflict('FROGSLEEP_SYNC_EPOCH_MISMATCH','Target account epoch changed.');});
        return receipt.result;
      }
      const sourceUser=await this.db.findUserById(source);
      if(sourceUser?.status!=='ACTIVE'||identity.upgradedTo||Date.parse(identity.expiresAt)<=now.getTime()||(await this.db.findAppUser('frogsleep',source))?.status!=='ACTIVE'||sourceUser.passwordAlgo!=='frogsleep-guest') guestUnavailable();
      const transferred=await transferGuestSync(this.db.getPersonalSyncRepository(),source,target,epoch);
      const result={user_id:target,previous_guest_user_id:source,...transferred};
      await this.db.updateAppUserStatus('frogsleep',source,'DELETED');
      await store.save({...identity,upgradedTo:target});
      await store.saveUpgrade({guestUserId:source,targetUserId:target,operationHash,requestHash,result});
      await this.db.insertAuditLog({id:'audit_'+randomUUID(),appId:'frogsleep',actorUserId:target,action:'frogsleep.guest.upgrade',resourceType:'sleep_guest',resourceId:source,payload:{migrated_count:result.migrated_data_count,deduplicated_count:result.deduplicated_data_count},createdAt:now.toISOString()});
      return result;
    });
  }
}
