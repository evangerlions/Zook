import test from 'node:test';import assert from 'node:assert/strict';import Ajv2020 from 'ajv/dist/2020.js';import addFormats from 'ajv-formats';
import {LightTickGrowBridgeRequestSchema,LightTickActionSourceEventSchema,LightTickActionSourceReceiptSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const bridge=ajv.compile(LightTickGrowBridgeRequestSchema),event=ajv.compile(LightTickActionSourceEventSchema),receipt=ajv.compile(LightTickActionSourceReceiptSchema);
test('source contract requires explicit normalized proof, binding, version and signed origin context',()=>{
 const e={event_id:'source-'+'a'.repeat(32),normalized_target:{kind:'article',course:'article-contract'},confirmed_at:'2026-10-21T10:00:00Z',source_proof:{version:1,confirmation:'article_read'}};
 assert.equal(event(e),true,JSON.stringify(event.errors));
 const b={action:'source-confirmation',action_schema_version:2,binding_id:'binding-contract',event:e};assert.equal(bridge(b),true,JSON.stringify(bridge.errors));
 for(const v of [{...b,action_schema_version:1},{action:'source-confirmation'}, {...b,event:undefined},{...b,target_version:0}])assert.equal(bridge(v),false);
 for(const v of [{...e,owner_id:'arbitrary'},{...e,consumed_by:'action-other'},{...e,private_note:'not allowed'}, {...e,source_proof:{version:1,confirmation:'lesson_completed'}},
  {...e,normalized_target:{kind:'book'}},{...e,origin_action_id:'action-a'},{...e,confirmed_at:'yesterday'}])assert.equal(event(v),false,JSON.stringify(v));
 assert.equal(event({...e,origin_action_id:'action-a',origin_context:'opaque-signed-context'}),true);
 const r={accepted:true,binding_id:'binding-contract',target_user_id:'owner',event_id:e.event_id,payload_hash:'a'.repeat(64),status:'pending',completed_arrangements:[],record_id:null,reason:'RUNNING_CONFLICT'};
 assert.equal(receipt(r),true,JSON.stringify(receipt.errors));assert.equal(receipt({...r,completed_arrangements:['action-a','action-b']}),false);
});
