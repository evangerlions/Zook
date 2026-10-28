import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {checkBodyLogLinks} from '../../scripts/check-bodylog-links.mjs';
test('domain gate rejects a healthy SPA fallback and redirects rather than calling them AASA',async()=>{
 const server=createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<html>Admin SPA</html>');});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{const report=await checkBodyLogLinks(`http://127.0.0.1:${(server.address() as any).port}`);assert.equal(report.passed,false);assert.ok(report.checks.some(row=>!row.passed));}
 finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('domain gate refuses credentials, nested origins and non-loopback HTTP',async()=>{
 for(const base of ['http://example.com','https://name:secret@example.com','https://example.com/path','https://example.com/?token=secret'])await assert.rejects(()=>checkBodyLogLinks(base));
});

test('live acceptance stops before credentials or mutation on a mismatched release version',async()=>{
 const paths:string[]=[];
 const server=createServer((req,res)=>{paths.push(req.url!);res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({data:{version:'unexpected'}}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const process=spawn(globalThis.process.execPath,['scripts/bodylog-dev-acceptance.mjs'],{env:{...globalThis.process.env,BODYLOG_QA_BASE_URL:`http://127.0.0.1:${(server.address() as any).port}`,BODYLOG_EXPECTED_VERSION:'expected',BODYLOG_QA_MUTATIONS:'1'},stdio:['ignore','pipe','pipe']});
  let output='';process.stdout.on('data',chunk=>{output+=chunk;});
  const code=await new Promise<number|null>((resolve,reject)=>{process.on('close',resolve);process.on('error',reject);});
  assert.equal(code,1);assert.equal(JSON.parse(output).passed,false);assert.deepEqual(paths,['/api/health']);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
