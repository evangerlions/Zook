import { NoopRegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";
import { createServer } from 'node:http';
import { createApplication } from './create-test-application.ts';
import { badRequest } from '../../src/shared/errors.ts';
import { PostgresDatabase } from '../../src/infrastructure/database/postgres/postgres-database.ts';

// Local-only acceptance harness. Real provider registration remains unconfigured.
const port = Number(process.env.IDENTITY_TEST_PORT || 41387);
const url = process.env.IDENTITY_TEST_DATABASE_URL;
if (!url) throw new Error('A disposable IDENTITY_TEST_DATABASE_URL is required');
const mockProviders = process.env.IDENTITY_TEST_PROVIDERS === '1';
const verifier = {async verify(attempt: any, credential: any) {
  const valid = attempt.provider === 'wechat' ? credential.code === 'fixture-code' && credential.state === attempt.state
    : (credential.idToken || credential.identityToken) === `fixture-${attempt.nonce}`;
  if (!valid) badRequest('AUTH_PROVIDER_PROOF_INVALID','Fixture proof does not match the attempt');
  return {kind:attempt.provider,subject:`fixture-${attempt.provider}-account`};
}};
const identityAuth = mockProviders ? {clients:{async get(){return {clientId:'local-fixture',secretKey:'fixture-secret',teamId:'fixture',keyId:'fixture'}},
  async readSecret(){return 'local-only-fixture'}}, verifiers:{google:verifier,apple:verifier,wechat:verifier}} : undefined;
const runtime = await createApplication({identityAuth,emitLogs:true,databaseFactory:seed => PostgresDatabase.create(url,seed),
  registrationCodeGenerator:()=> '123456',
  registrationEmailSender: new NoopRegistrationEmailSender(),
  smsVerificationSender:{async sendVerificationCode(input) {return {provider:'tencent_sms',phoneNumber:input.phoneNumber};}},
});
const server = createServer(async (req,res) => {
  const chunks:Buffer[]=[];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const url = new URL(req.url || '/',`http://127.0.0.1:${port}`);
  const raw=Buffer.concat(chunks).toString();
  const reply=await runtime.app.handle({method:req.method || 'GET',path:url.pathname,
    headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v])),
    query:Object.fromEntries(url.searchParams),body:raw?JSON.parse(raw):undefined,ipAddress:'127.0.0.1'});
  res.statusCode=reply.statusCode;
  res.setHeader('content-type','application/json');
  for(const [key,value] of Object.entries(reply.headers || {})) res.setHeader(key,value);
  res.end(JSON.stringify(reply.body));
});
server.listen(port,'127.0.0.1',()=> runtime.logger.info('identity.acceptance_server.ready',{port,providerMode:mockProviders?'local fixture':'unconfigured',deliveryMode:'local fixture'}));
for(const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>server.close(()=>process.exit(0)));
