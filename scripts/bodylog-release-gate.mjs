import {mkdir,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const database=new URL(process.env.BODYLOG_TEST_DATABASE_URL??'invalid:');
if(!['postgres:','postgresql:'].includes(database.protocol)||!['127.0.0.1','localhost',''].includes(database.hostname)||!/^\/bodylog_[a-z0-9_]+$/.test(database.pathname)||database.searchParams.has('host'))throw new Error('A dedicated loopback bodylog_* PostgreSQL test database is required; no silent integration skip.');
const out=resolve(process.env.BODYLOG_GATE_REPORT_DIR??'.artifacts/bodylog-release-gate');await mkdir(out,{recursive:true});
const steps=[
 ['contracts','npm',['run','check:api-contracts']],['line-count','npm',['run','check:line-count']],
 ['admin-typecheck','npm',['run','admin:typecheck']],['admin-build','npm',['run','admin:build']],
 ['unit','npm',['test']],
 ['postgres-http',process.execPath,['--experimental-transform-types','--test','--test-concurrency=1','test/integration/bodylog-retention-postgres.test.ts','test/integration/bodylog-retention-http.test.ts']],
];
const results=[];
for(const [name,cmd,args] of steps){const started=Date.now();const result=spawnSync(cmd,args,{env:process.env,encoding:'utf8',maxBuffer:64*1024*1024,timeout:600000});
 await writeFile(resolve(out,`${name}.log`),(result.stdout??'')+(result.stderr??''));
 const passed=result.status===0&&!result.error;results.push({name,passed,elapsedMs:Date.now()-started});
 console.log(`${passed?'PASS':'FAIL'} ${name}`);if(!passed)break;
}
const report={at:new Date().toISOString(),passed:results.length===steps.length&&results.every(row=>row.passed),results};
await writeFile(resolve(out,'report.json'),JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
