import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP } from "node:net";
import { digest, object, keys, text, fail } from "./native-learning.validation.ts";
import type { LearningSource, LearningSourceInput } from "./learning-work.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
export interface LearningSourceAdapters {
  writeFile?(owner: LightTickOwner, id: string, name: string, content: string): Promise<{storage_key:string;file_name:string;size_bytes:number}>;
  readFile(owner: LightTickOwner, key: string): Promise<string>;
  fetchUrl(url: string, signal: AbortSignal): Promise<string>;
}
export function sourceInputs(value: unknown): LearningSourceInput[] {
  if (!Array.isArray(value) || !value.length || value.length > 10) fail(422,"Select one to ten reviewed sources.");
  return value.map(v=>{
    const s=object(v);keys(s,["kind","title","text","storage_key","url"]);
    const title=text(s.title,500,true);
    if(s.kind==='text')return {kind:'text',title,text:text(s.text,15000,true)};
    if(s.kind==='file')return {kind:'file',title,storage_key:text(s.storage_key,1500,true)};
    if(s.kind==='url'){let url:URL;try{url=new URL(text(s.url,1500,true));}catch{fail(422,"Invalid source URL.");}if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')fail(422,"Sources require credential-free HTTPS on port 443.");return {kind:'url',title,url:url.toString()};}
    return fail(422,"Unsupported source type.");
  });
}
export function publicSourceAddress(ip: string): boolean {
  if(isIP(ip)===4){const p=ip.split('.').map(Number),[a,b,c]=p;
    return !(a===0||a===10||a===127||a>=224||a===100&&b>=64&&b<=127||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&(b===168||b===0||b===2)||a===198&&(b===18||b===19||b===51&&c===100)||a===203&&b===0&&c===113);
  }
  if(isIP(ip)!==6)return false;
  const parts=ip.split(':'),first=parseInt(parts[0],16),second=parseInt(parts[1]||'0',16);
  return first>=0x2000&&first<0x4000&&first!==0x2002&&!(first===0x2001&&(second<0x0200||second===0x0db8));
}
/** Resolve and pin a public address, keep TLS hostname verification, reject redirects and bounded response data. */
export async function fetchLearningSource(raw: string, signal: AbortSignal, io = { lookup, request }): Promise<string> {
  const url=new URL(raw);
  if(url.protocol!=='https:'||url.username||url.password||url.port&&url.port!=='443')throw Error("SOURCE_URL_FORBIDDEN");
  const hostname=url.hostname.replace(/^\[|\]$/g,''),addresses=await io.lookup(hostname,{all:true});
  if(!addresses.length||addresses.some(a=>!publicSourceAddress(a.address)))throw Error("SOURCE_ADDRESS_FORBIDDEN");
  const pinned=addresses[0];
  return new Promise<string>((resolve,reject)=>{
    signal.throwIfAborted();
    const req=io.request(url,{signal,lookup:(_host,options,callback)=>{
      if(typeof options==='object'&&options.all)(callback as any)(null,[pinned]);else callback(null,pinned.address,pinned.family);
    },headers:{Accept:'text/plain,text/markdown,text/html','User-Agent':'Zook-LightTick-Learning/1'}},response=>{
      const type=String(response.headers['content-type']??'').toLowerCase();
      if(response.statusCode!==200||!/^text\/(plain|markdown|html)(?:;|$)/.test(type)||/charset=(?!["']?(utf-8|us-ascii))/.test(type)){response.destroy();reject(Error("SOURCE_RESPONSE_UNSUPPORTED"));return;}
      const chunks:Buffer[]=[];let size=0;
      response.on('data',(part:Buffer)=>{size+=part.length;if(size>80000){response.destroy(Error("SOURCE_TOO_LARGE"));return;}chunks.push(part);});
      response.on('error',reject);response.on('end',()=>{try{let value=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));if(type.startsWith('text/html'))value=value.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'').replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');resolve(value);}catch(error){reject(error);}});
    });
    req.setTimeout(15000,()=>req.destroy(Error("SOURCE_TIMEOUT")));req.on('error',reject);req.end();
  });
}
export async function collectLearningSources(owner: LightTickOwner, inputs: LearningSourceInput[], adapters: LearningSourceAdapters, signal: AbortSignal): Promise<LearningSource[]> {
  const values=await Promise.all(inputs.map(async input=>{
    signal.throwIfAborted();
    const raw=input.kind==='text'?input.text!:input.kind==='file'?await adapters.readFile(owner,input.storage_key!):await adapters.fetchUrl(input.url!,signal);
    signal.throwIfAborted();const content=text(raw,15000,true);
    return {title:input.title,content,digest:digest(content),source:{kind:input.kind,...(input.kind==='file'?{storage_key:input.storage_key}:input.kind==='url'?{url:input.url}:{})}};
  }));
  if(Buffer.byteLength(JSON.stringify(values))>80000)fail(422,"Source collection exceeds 80000 bytes; review and shorten it.");
  return values;
}
