import test from "node:test";
import assert from "node:assert/strict";
import { inspectRetentionExperiment, requiredMatureUsers } from "../../src/modules/bodylog/bodylog-retention-experiment.ts";
const design={owner:"analysis-owner",primaryMetric:"d7_local_goal_retention",baselineRate:0.1,minimumDetectableEffect:0.1,targetMaturePerVariant:199,minimumEnrollmentDays:14,followupDays:8,lateArrivalDays:7,stopPolicy:"fixed_horizon_no_peeking",guardrails:{maxAuthFailureRate:0.02,maxDuplicateOperations:0,maxLocalActionP95Millis:500}};
const config={id:"continue-v2",enabled:false,treatmentPercent:20,design};
test("sample planning matches independent proportion normal approximation and respects smaller effects",()=>{
 assert.equal(requiredMatureUsers(0.1,0.1),199);
 assert.ok(requiredMatureUsers(0.1,0.05)>199);
 assert.ok(inspectRetentionExperiment(JSON.stringify(config)).valid);
});
test("incomplete, undersized, mutable-horizon and unsafe experiment plans cannot enable assignment",()=>{
 for(const patch of [{design:undefined},{treatmentPercent:51},{treatmentPercent:0},{design:{...design,owner:""}},{design:{...design,targetMaturePerVariant:198}},{design:{...design,minimumDetectableEffect:-0.1}},{design:{...design,followupDays:7}},{design:{...design,stopPolicy:"stop_when_significant"}},{design:{...design,guardrails:{...design.guardrails,maxDuplicateOperations:1}}}]) {
  assert.equal(inspectRetentionExperiment(JSON.stringify({...config,enabled:true,...patch})).valid,false);
 }
});
