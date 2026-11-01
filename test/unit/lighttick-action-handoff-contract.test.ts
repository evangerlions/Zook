import test from 'node:test';import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';import addFormats from 'ajv-formats';
import {LightTickActionHandoffSnapshotSchema,LightTickActionHandoffReceiptSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {ActionLinkService} from '../../src/modules/lighttick/actions/action-link.service.ts';
import {ActionHandoffService} from '../../src/modules/lighttick/actions/action-handoff.service.ts';
import {digest} from '../../src/modules/lighttick/actions/action.validation.ts';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const snapshot=ajv.compile(LightTickActionHandoffSnapshotSchema),receipt=ajv.compile(LightTickActionHandoffReceiptSchema);
const packageV2={snapshot_version:2,source_account_id:'grow-contract',plans:[],records:[],reviews:[],reports:[],operations:[],claims:[],content_sources:[],content_events:[]};
test('canonical C3 snapshot requires all inventories and rejects unproven event fields',()=>{
 assert.equal(snapshot(packageV2),true,JSON.stringify(snapshot.errors));
 for(const missing of ['plans','records','operations','claims','content_events','content_sources']){
  const value={...packageV2};delete (value as any)[missing];assert.equal(snapshot(value),false);
 }
 const event={event_id:'source-'+'a'.repeat(32),owner:'grow-contract',normalized_target:{kind:'article',course:'article-contract'},confirmed_at:'2026-10-21T12:00:00Z',request_key:'old-source-key',request_hash:'a'.repeat(64)};
 assert.equal(snapshot({...packageV2,content_events:[event]}),true);
 for(const patch of [{owner_id:'browser-selected'},{delivery_hash:'invented'},{source_result:{private_note:'not exported'}}])assert.equal(snapshot({...packageV2,content_events:[{...event,...patch}]}),false);
});
test('real preflight/import receipts match the unique schema; malformed counts and ambiguous phase are rejected',async()=>{
 const repository=new InMemoryLightTickRepository(),actions=new ActionService(repository),links=new ActionLinkService(actions,'fixture-secret-012345678901234567890123456789');
 const owner={appId:'lighttick',userId:'contract-owner'} as const,ticket=await links.ticket(owner),link=await links.claim(ticket.code,'grow-contract'),handoff=new ActionHandoffService(links);
 const input={snapshot:packageV2,snapshot_hash:digest(packageV2),binding_id:link.binding_id};
 const pre=await handoff.preflight('grow-contract',input);assert.equal(receipt(pre),true,JSON.stringify(receipt.errors));
 const imported=await handoff.import('grow-contract',{...input,target_version:pre.target_version});assert.equal(receipt(imported),true,JSON.stringify(receipt.errors));
 for(const bad of [{...pre,source_counts:{...pre.source_counts,records:false}},{...pre,target_version:false},{...pre,validated:false},{...pre,imported_at:imported.imported_at},{...imported,imported_at:'yesterday'},{...imported,source_counts:{...imported.source_counts,unknown:1}}])assert.equal(receipt(bad),false);
});
