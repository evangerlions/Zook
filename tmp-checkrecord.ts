import {createApplication} from './test/support/create-test-application.ts';
import {buildDefaultSeed} from './src/infrastructure/database/prisma/default-seed.ts';
const seed=buildDefaultSeed(undefined,{includeLightTick:true});
const app=await createApplication({seed,lighttickEnabled:true});
const rt:any=(app.services as any).lighttickRuntime;
rt.planningEnabled=true;
const rec=await rt.scopePolicy.record();
console.log('rec?',!!rec, (rec as any)?.configValue?.slice(0,200));
