import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLightTickPublicConfiguration} from '../../src/modules/lighttick/lighttick-public-config.ts';
const config={configValue:JSON.stringify({enabled:true,featureFlags:{aiPlanning:true,conversationalPlanning:true}})} as any;
test('optional conversational planning is absent by default and needs both runtime and delivery switches',()=>{
  assert.equal((buildLightTickPublicConfiguration(true,config) as any).features.conversational_planning,false);
  assert.equal((buildLightTickPublicConfiguration(true,config,'local',true) as any).features.conversational_planning,true);
  assert.equal((buildLightTickPublicConfiguration(false,config,'local',true) as any).features.conversational_planning,false);
  assert.equal((buildLightTickPublicConfiguration(true,{configValue:'{"enabled":true,"featureFlags":{"aiPlanning":true}}'} as any,'local',true) as any).features.conversational_planning,false);
});
