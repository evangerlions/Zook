/** Local-only blank-account fixture. Never prints or exports provider credentials. */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, randomBytes } from 'node:crypto';
import { applyLocalDefaults } from './local-dev-config.ts';
applyLocalDefaults(process.env, existsSync('deploy_configs/local.env') ? readFileSync('deploy_configs/local.env','utf8') : '');
if(process.env.APP_ENV!=='local') throw Error('Blank web fixture is local-only');
const {resolveRuntimeDatabaseUrl}=await import('../src/infrastructure/runtime/runtime-readiness.ts');
const url=new URL(resolveRuntimeDatabaseUrl()!);
if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Refusing non-loopback database');
const {init}=await import('../src/infrastructure/runtime/init.ts');
const runtime=await init({serviceName:'api',emitLogs:false});
const path='/tmp/lighttick-blank-web-account.json';
try {
 if(process.argv.includes('--configure-model')) {
  const account=JSON.parse(readFileSync(path,'utf8'));
  const service=runtime.services.lighttickRuntime!.personalModel!;
  const source={appId:'lighttick',userId:'user_alice'} as const;
  const state=await runtime.services.lighttickRepository.personalModels.get(source);
  if(!state||state.mode!=='personal')throw Error('No previously authorized personal model configured');
  const credentials=await service.credentials(source,{mode:'personal',revision:state.revision});
  const target={appId:'lighttick',userId:account.user_id} as const;
  await service.configure(target,{base_revision:0,mode:'personal',...credentials},'blank-fixture-'+randomUUID());
  console.log('Configured the authorized model for the isolated test account; credentials stayed on the server.');
 } else {
  const id='web-blank-'+randomUUID(),account=id+'@example.test',password='Qa!'+randomBytes(18).toString('hex'),now=new Date().toISOString();
  await runtime.database.insertUser({id,email:account,passwordHash:runtime.passwordHasher.hash(password),passwordAlgo:runtime.passwordHasher.algorithm,status:'ACTIVE',createdAt:now});
  await runtime.database.insertAppUser({id:'member-'+randomUUID(),appId:'lighttick',userId:id,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:now});
  const doc=await runtime.services.adminConsoleService.getConfig('lighttick');
  const config=JSON.parse(doc.rawJson);
  if(config.featureFlags?.conversationalPlanning!==true) {
    config.featureFlags={...config.featureFlags,conversationalPlanning:true};
    await runtime.services.adminConsoleService.updateConfig('lighttick',JSON.stringify(config),'Local Web blank-account AI planning acceptance 2026-11-18');
  }
  writeFileSync(path,JSON.stringify({user_id:id,account,password}),{mode:0o600});
  console.log(JSON.stringify({user_id:id,private_fixture:path,delivery_revision:'created through versioned admin config service'}));
 }
} finally {await runtime.close();}
process.exit(0);
