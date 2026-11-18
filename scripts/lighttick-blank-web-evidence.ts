/** Read-only, allowlisted model provenance for the locally created acceptance actor. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {Pool} from 'pg';
import {applyLocalDefaults} from './local-dev-config.ts';
import {resolveRuntimeDatabaseUrl} from '../src/infrastructure/runtime/runtime-readiness.ts';
applyLocalDefaults(process.env,existsSync('deploy_configs/local.env')?readFileSync('deploy_configs/local.env','utf8'):'');
const connectionString=resolveRuntimeDatabaseUrl()!,url=new URL(connectionString);
if(process.env.APP_ENV!=='local'||!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Local evidence only');
const {user_id}=JSON.parse(readFileSync('/tmp/lighttick-blank-web-account.json','utf8'));
if(!/^web-blank-[a-f0-9-]+$/.test(user_id))throw Error('Acceptance actor only');
const pool=new Pool({connectionString});
try{
 const runs=(await pool.query("SELECT id,scene_key,status,provider,model,error_code FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND user_id=$1 ORDER BY created_at",[user_id])).rows;
 const work=(await pool.query("SELECT id,payload->>'kind' AS kind,status,payload->'output'->>'model' AS model,payload->>'errorCode' AS error_code FROM zook_lighttick_learning_work WHERE app_id='lighttick' AND user_id=$1 ORDER BY created_at",[user_id])).rows;
 writeFileSync('/tmp/lighttick-blank-model-provenance.json',JSON.stringify({user_id,runs,work},null,2));
 console.log(JSON.stringify({runs:runs.length,work:work.length,output:'/tmp/lighttick-blank-model-provenance.json'}));
}finally{await pool.end();}
