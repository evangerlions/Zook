import {pathToFileURL} from 'node:url';
import {writeFile} from 'node:fs/promises';
export async function checkBodyLogLinks(base) {
 const origin=new URL(base);
 if(origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
  !(origin.protocol==='https:'||(origin.protocol==='http:'&&['localhost','127.0.0.1'].includes(origin.hostname))))throw new Error('Use an HTTPS origin, or an explicit loopback HTTP test origin.');
 const checks=[];
 const check=(name,passed,detail='')=>checks.push({name,passed,detail});
 const get=path=>fetch(new URL(path,origin),{redirect:'manual',signal:AbortSignal.timeout(10000)});
 try {
  const response=await get('/.well-known/apple-app-site-association');
  check('AASA status and JSON content type',response.status===200&&(response.headers.get('content-type')??'').includes('application/json'));
  if(checks.at(-1).passed){const value=await response.json();const detail=value.applinks?.details?.find(row=>row.appID==='LTN9Y4UXN3.com.youwoai.habittap');
   check('AASA app and bounded canonical/legacy paths',Boolean(detail)&&['/i/*','/invite/*','/b/*','/g/*','/invite-code'].every(path=>detail.paths?.includes(path))&&!detail.paths?.includes('/*'));}
 } catch {check('AASA reachable without redirect or TLS failure',false,'Connection, JSON, or TLS check failed.');}
 for(const [path,link] of [['/i/acceptance-probe','bodylog://invite/acceptance-probe'],['/invite/acceptance-probe','bodylog://invite/acceptance-probe'],['/b/acceptance-probe','bodylog://buddy/acceptance-probe'],['/g/acceptance-probe?token=acceptance-token','bodylog://group/acceptance-probe?token=acceptance-token'],['/invite-code?code=ABC234','bodylog://invite-code/ABC234']]){
  try{const response=await get(path);const html=await response.text();
   check(`explicit handoff ${path.split('?')[0]}`,response.status===200&&(response.headers.get('content-type')??'').includes('text/html')&&html.includes(link)&&!/<script|http-equiv\s*=\s*["']?refresh/i.test(html));
   check(`private browser response ${path.split('?')[0]}`,response.headers.get('referrer-policy')==='no-referrer'&&response.headers.get('cache-control')?.includes('no-store')&&Boolean(response.headers.get('content-security-policy')));
  }catch{check(`handoff reachable ${path.split('?')[0]}`,false,'Connection failed.');}
 }
 return {origin:origin.origin,at:new Date().toISOString(),passed:checks.every(row=>row.passed),checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const base=process.argv[process.argv.indexOf('--base')+1];
 if(!process.argv.includes('--base'))throw new Error('Required: --base https://bodylog.app');
 const report=await checkBodyLogLinks(base);const output=process.env.BODYLOG_LINK_REPORT;
 if(output)await writeFile(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify(report,null,2));process.exitCode=report.passed?0:1;
}
