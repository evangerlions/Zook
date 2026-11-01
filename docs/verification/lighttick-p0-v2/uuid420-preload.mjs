import crypto from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
const uuid=crypto.randomUUID;
crypto.randomUUID=()=> '420'+uuid().slice(3);
syncBuiltinESMExports();
const stringify=JSON.stringify;
JSON.stringify=function(value,...args){
 if(value?.redacted===true&&value?.id)process.stderr.write('REDACTED_TEST_METADATA id='+value.id+' keys='+Object.keys(value).join(',')+'\n');
 return stringify.call(JSON,value,...args);
};
