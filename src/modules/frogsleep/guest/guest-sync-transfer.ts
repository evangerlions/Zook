import type { PersonalSyncRepository,PersonalVersion } from '../personal-sync/personal-sync.types.ts';
import { ApplicationError,conflict } from '../../../shared/errors.ts';
import { createHash } from 'node:crypto';
function stable(v:unknown):string {if(Array.isArray(v))return '['+v.map(stable).join(',')+']';if(v&&typeof v==='object')return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable((v as Record<string,unknown>)[k])).join(',')+'}';return JSON.stringify(v);}
/** Both memberships must already be locked; every nested repository joins the same unit of work. */
export async function transferGuestSync(repository:PersonalSyncRepository,source:string,target:string,epoch:string) {
  return repository.run(source,async from=>repository.run(target,async to=>{
    if(to.state.epoch!==epoch) conflict('FROGSLEEP_SYNC_EPOCH_MISMATCH','Restore the current target epoch before upgrading.');
    const rows:PersonalVersion[]=[];let after=0,bytes=0;
    while(true) {
      const page=await from.page('restore',from.state.sequence,after,100);
      if(!page.length)break;
      for(const row of page) {bytes+=Buffer.byteLength(JSON.stringify(row));rows.push(row);}
      if(rows.length>10000||bytes>32*1024*1024) throw new ApplicationError(409,'FROGSLEEP_GUEST_TRANSFER_TOO_LARGE','Guest history exceeds the atomic transfer limit; use confirmed local import.');
      after=page.at(-1)!.sequence;
    }
    let migrated=0,deduplicated=0;
    for(const row of rows) {
      const existing=await to.current(row.kind,row.id);
      if(existing) {
        if(existing.deleted!==row.deleted||!row.deleted&&stable(existing.data)!==stable(row.data)) conflict('FROGSLEEP_GUEST_DATA_CONFLICT','Target history has a conflicting resource; no guest data was transferred.');
        deduplicated++;continue;
      }
      const now=new Date().toISOString();
      const version={...row,revision:1,sequence:to.state.sequence+1,updated_at:now};
      const hash=createHash('sha256').update(JSON.stringify([source,row.kind,row.id])).digest('hex');
      await to.commit(version,'guest-transfer:'+hash,hash);migrated++;
    }
    await from.reset();
    return {migrated_data_count:migrated,deduplicated_data_count:deduplicated,sync_epoch:to.state.epoch};
  }));
}
