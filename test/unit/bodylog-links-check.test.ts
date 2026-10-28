import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
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
