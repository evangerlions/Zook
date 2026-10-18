import { writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { runSleepDevAcceptance } from './lib/frogsleep-dev-acceptance.mjs';
const env = process.env;
const readAccount = prefix => env[prefix+'_ACCOUNT'] && env[prefix+'_PASSWORD'] ? { account: env[prefix+'_ACCOUNT'], password: env[prefix+'_PASSWORD'] } : undefined;
const result = await runSleepDevAcceptance({
  baseUrl: env.FROGSLEEP_DEV_BASE_URL ?? 'https://app-dev.youwoai.net',
  account: readAccount('FROGSLEEP_DEV'), deletionAccount: readAccount('FROGSLEEP_DEV_DELETE'),
  expectedVersion: env.FROGSLEEP_DEV_EXPECTED_VERSION,
  onCheck: item => console.log(`${item.label}: HTTP ${item.status} ${item.code}`),
});
if (env.FROGSLEEP_DEV_EVIDENCE_FILE) {
  await mkdir(dirname(env.FROGSLEEP_DEV_EVIDENCE_FILE), { recursive: true });
  await writeFile(env.FROGSLEEP_DEV_EVIDENCE_FILE, JSON.stringify(result,null,2)+'\n', { mode: 0o600 });
}
console.log(JSON.stringify(result,null,2));
process.exitCode = !result.passed ? 1 : result.complete ? 0 : 2;
