import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {execFileSync} from "node:child_process";
test("quality preparation never invents outputs, provider coverage, or human scores",async()=>{
 const out=await mkdtemp(join(tmpdir(),"planning-quality-test-"));
 try{
  execFileSync(process.execPath,["--experimental-transform-types","scripts/lighttick-planning-quality.ts","--out",out],{stdio:"pipe"});
  const report=JSON.parse(await readFile(join(out,"review.json"),"utf8"));
  assert.equal(report.cases.length,25);assert.equal(report.realProviderCases,0);assert.equal(report.status,"prepared");
  assert.ok(report.cases.every((c:any)=>c.result===null&&c.human.reviewer===null&&Object.values(c.human.scores).every(v=>v===null)));
  assert.throws(()=>execFileSync(process.execPath,["--experimental-transform-types","scripts/lighttick-planning-quality.ts","--out",out],{stdio:"pipe"}));
 }finally{await rm(out,{recursive:true,force:true});}
});
