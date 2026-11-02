import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { PasswordLoginRequestSchema, RefreshRequestSchema, LightTickRecordSchema, LightTickRecordWriteRequestSchema, LightTickRecordPageEnvelopeSchema, LightTickRecordEnvelopeSchema, LightTickManualDraftSchema, LightTickManualPlanEnvelopeSchema, LightTickManualConfirmSchema, LightTickTodayDataSchema } from '../src/generated/openapi/public-contracts.generated.ts';
const index = process.argv.indexOf('--output');
if (index < 0 || !process.argv[index + 1]) throw Error('Pass --output /absolute/path/to/contracts.json');
writeFileSync(process.argv[index + 1], JSON.stringify({ product: 'lighttick', source_commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), schemas: { PasswordLoginRequest: PasswordLoginRequestSchema, RefreshRequest: RefreshRequestSchema, Record: LightTickRecordSchema, RecordWrite: LightTickRecordWriteRequestSchema, RecordPage: LightTickRecordPageEnvelopeSchema, RecordEnvelope: LightTickRecordEnvelopeSchema, LightTickManualDraftSchema, LightTickManualPlanEnvelopeSchema, LightTickManualConfirmSchema, LightTickTodayDataSchema } }, null, 2) + '\n');
