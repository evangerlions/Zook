import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {createApplication} from '../support/create-test-application.ts';
import {PersistentFileStore} from '../../src/infrastructure/files/persistent-file-store.ts';
import {publicSourceAddress,sourceInputs,collectLearningSources,fetchLearningSource} from '../../src/modules/lighttick/learning/learning-sources.ts';
test('HTTPS source adapter pins resolved addresses, rejects mixed private DNS, redirects and oversized suppliers',async()=>{
 let requests=0,status=200,body='<script>untrusted()</script><p>Reviewed page</p>';
 const io:any={lookup:async()=>[{address:'93.184.216.34',family:4}],request:(url:URL,options:any,onResponse:any)=>{
  requests++;assert.equal(url.hostname,'example.com');assert.equal(options.rejectUnauthorized,undefined,'keep Node TLS certificate verification enabled');
  options.lookup(url.hostname,{all:true},(err:any,addresses:any)=>{assert.equal(err,null);assert.deepEqual(addresses,[{address:'93.184.216.34',family:4}]);});
  const req:any=new EventEmitter();req.setTimeout=()=>req;req.end=()=>queueMicrotask(()=>{const response:any=new PassThrough();response.statusCode=status;response.headers={'content-type':'text/html; charset=utf-8'};onResponse(response);if(!response.destroyed)response.end(body);});
  req.destroy=(error:any)=>{req.emit('error',error);return req;};return req;
 }};
 assert.equal(await fetchLearningSource('https://example.com/source',new AbortController().signal,io),' Reviewed page ');
 io.lookup=async()=>[{address:'93.184.216.34',family:4},{address:'127.0.0.1',family:4}];
 await assert.rejects(fetchLearningSource('https://example.com/source',new AbortController().signal,io),/SOURCE_ADDRESS_FORBIDDEN/);assert.equal(requests,1);
 io.lookup=async()=>[{address:'93.184.216.34',family:4}];status=302;
 await assert.rejects(fetchLearningSource('https://example.com/source',new AbortController().signal,io),/SOURCE_RESPONSE_UNSUPPORTED/);assert.equal(requests,2);
 status=200;body='x'.repeat(80001);await assert.rejects(fetchLearningSource('https://example.com/source',new AbortController().signal,io),/SOURCE_TOO_LARGE/);
});
test('source addresses reject private, reserved, mapped IPv6 and unreviewed schemes before any fetch',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','172.31.0.1','192.168.1.1','169.254.169.254','100.64.0.1','0.0.0.0','224.1.1.1','::1','::ffff:127.0.0.1','2001:db8::1','2001:0db8::1','2001:0000::1','2002:7f00:1::'])assert.equal(publicSourceAddress(ip),false,ip);
 for(const ip of ['8.8.8.8','93.184.216.34','2606:4700:4700::1111','2001:4860:4860::8888'])assert.equal(publicSourceAddress(ip),true,ip);
 for(const url of ['file:///etc/passwd','http://127.0.0.1/','https://user:secret@example.com','https://example.com:8080/','not a URL'])assert.throws(()=>sourceInputs([{kind:'url',title:'Explicit source',url}]));
});
test('platform file identity is idempotent, owner authorization and bounded UTF-8 ingestion reject cross-owner paths',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'lighttick-source-fixture-'));
 try{
  const app=await createApplication({fileStorageRoot:dir}),storage=app.services.storageService,store=new PersistentFileStore(dir),owner={appId:'lighttick',userId:'user_alice'};
  const first=await storage.storeOwnerText(store,owner,'fixture.txt','Explicit synthetic file content','original-file-id');
  assert.deepEqual(await storage.storeOwnerText(store,owner,'fixture.txt','Explicit synthetic file content','original-file-id'),first);
  assert.equal(await storage.readOwnerText(store,owner,first.storage_key),'Explicit synthetic file content');
  await assert.rejects(storage.readOwnerText(store,{...owner,userId:'user_bob'},first.storage_key));
  await assert.rejects(storage.storeOwnerText(store,owner,'fixture.txt','Changed body','original-file-id'));
  await assert.rejects(store.readBoundedText(first.storage_key,5));
  const external=join(dir,'..','outside-source-'+process.pid+'.txt');await writeFile(external,'Forbidden external fixture');
  try{await symlink(external,join(dir,'outside-link'));await assert.rejects(store.readBoundedText('outside-link',80000));}finally{await rm(external);}
  await writeFile(join(dir,'invalid-utf8'),Buffer.from([0xff,0xfe]));await assert.rejects(store.readBoundedText('invalid-utf8',80000));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('collected sources retain exact provenance and reject oversized or cancelled inputs without switching suppliers',async()=>{
 let files=0,urls=0;const owner={appId:'lighttick' as const,userId:'user_alice'},adapters={readFile:async()=>{files++;throw Error('File supplier failure');},fetchUrl:async()=>{urls++;return 'A different supplier';}};
 await assert.rejects(collectLearningSources(owner,sourceInputs([{kind:'file',title:'File',storage_key:'files/lighttick/fixture.txt'}]),adapters,new AbortController().signal));
 assert.equal(files,1);assert.equal(urls,0);
 const c=new AbortController();c.abort();await assert.rejects(collectLearningSources(owner,sourceInputs([{kind:'url',title:'URL',url:'https://example.com/'}]),adapters,c.signal));assert.equal(urls,0);
});
