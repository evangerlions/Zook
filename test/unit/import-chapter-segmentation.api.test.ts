import assert from 'node:assert/strict';
import test from 'node:test';
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from '../support/credits-http-runtime.ts';
import { AiNovelCreditsService } from '../../src/modules/ai-novel/credits/ai-novel-credits.service.ts';
import { BailianOpenAICompatibleProvider } from '../../src/services/bailian-openai-compatible-provider.ts';
import { StructuredLogger } from '../../src/infrastructure/logging/pino-logger.module.ts';

const small = 'qwen3.6-plus';
const marker = 'private-manuscript-test-marker';
const policy = (enabled: boolean) => ({
  schemaVersion: 1,
  chat: { default: [{ modelKey: small, weight: 100 }] },
  autoFree: { enabled },
});

type Fixture = Awaited<ReturnType<typeof startCreditsHttpRuntime>>;
function headers(f: Fixture) {
  return { authorization: `Bearer ${f.token}`, 'X-App-Id': 'ai_novel', 'X-App-Version': '1.8.0+1080000', 'Content-Type': 'application/json' };
}
async function configure(f: Fixture, modelKey = small) {
  await f.runtime.services.appConfigService.setValue('ai_novel', 'ai_novel.import_chapter_segmentation', JSON.stringify({ modelKey }));
}
async function balance(f: Fixture): Promise<bigint> {
  const response = await fetch(`${f.url}/api/v1/ai_novel/credits`, { headers: headers(f) });
  const data = await response.json();
  return BigInt(data.data.remainingMicros);
}
async function send(f: Fixture, selection?: unknown, includeLocalDebugPlaintext = false, suppliedTools = ['match', 'read_lines', 'preview_chapters', 'submit_chapters'], prompt = marker, clientThinking?: boolean) {
  const payload = { sceneKey: 'import_chapter_segmentation', agentProtocol: 'pi-v1', stream: true, temperature: 0.3,
    context: { suppliedTools, ...(clientThinking === undefined ? {} : { enableThinking: clientThinking }) },
    messages: [{ role: 'user', content: prompt }], ...(selection === undefined ? {} : { modelSelection: selection }) };
  const response = await fetch(`${f.url}/api/v1/ai_novel/ai/chat-completions`, {
    headers: headers(f), method: 'POST', body: JSON.stringify({ ...encryptCreditsFixture(payload), ...(includeLocalDebugPlaintext ? { localDebugRequestPlaintext: JSON.stringify(payload) } : {}) }),
  });
  const text = await response.text();
  const events = text.split('\n').filter(line => line.startsWith('data: ')).map(line => decodeCreditsFixture(JSON.parse(line.slice(6))));
  return { status: response.status, events };
}
function terminalTypes(result: Awaited<ReturnType<typeof send>>) {
  return result.events.map(event => ((event.data ?? event) as Record<string, unknown>).type);
}
async function conversations(f: Fixture) {
  return await f.runtime.database.aiNovelConversationStore.list({ appId: 'ai_novel', userId: 'user_alice' });
}
function assertNoPlaintext(f: Fixture) {
  assert.doesNotMatch(JSON.stringify(f.runtime.logger.records), new RegExp(marker));
}

test('upstream error echo is absent from encrypted SSE, logs, and stored conversations', async () => {
  const logger = new StructuredLogger('api', { emitToConsole: false });
  const provider = new BailianOpenAICompatibleProvider({ apiKey: 'fixture-only', logger,
    fetchImplementation: async () => new Response(JSON.stringify({ error: { code: 'bad', message: marker } }), { status: 400 }) });
  const f = await startCreditsHttpRuntime(0, 'test', undefined, provider);
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    const result = await send(f, { mode: 'auto' });
    assert.equal(result.status, 200);
    assert.ok(result.events.some((event) => event.code === 'AI_UPSTREAM_INVALID_REQUEST'));
    assert.doesNotMatch(JSON.stringify(result.events), new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(logger.records), new RegExp(marker));
    assertNoPlaintext(f);
    assert.deepEqual(await conversations(f), []);
  } finally { await f.close(); await f.runtime.close(); }
});

test('chapter routing honors fixed model and charges actual model under auto and manual policy', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    const before = await balance(f);
    const autoFree = await send(f, { mode: 'auto' });
    assert.ok(terminalTypes(autoFree).includes('done'));
    assert.equal(await balance(f), before, 'auto free must not debit');
    const manual = await send(f, { mode: 'manual', modelKey: 'manual-fixture' });
    assert.ok(terminalTypes(manual).includes('done'));
    const afterManual = await balance(f);
    assert.equal(before - afterManual, 1_400_000n, 'debit must use qwen pricing, not selected manual model pricing');
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(false));
    const autoPaid = await send(f, { mode: 'auto' });
    assert.ok(terminalTypes(autoPaid).includes('done'));
    assert.equal(afterManual - await balance(f), 1_400_000n);
    assert.deepEqual(f.observedModels(), [small, small, small]);
    assert.deepEqual(f.observedTemperatures(), [undefined, undefined, undefined]);
    assert.deepEqual(await conversations(f), []);
    assertNoPlaintext(f);
  } finally { await f.close(); await f.runtime.close(); }
});

test('server chapter configuration controls thinking with backward-compatible default', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    assert.ok(terminalTypes(await send(f, { mode: 'auto' }, false, undefined, marker, true)).includes('done'));
    await f.runtime.services.appConfigService.setValue('ai_novel', 'ai_novel.import_chapter_segmentation', JSON.stringify({ modelKey: small, enableThinking: true }));
    assert.ok(terminalTypes(await send(f, { mode: 'auto' }, false, undefined, marker, false)).includes('done'));
    assert.deepEqual(f.observedThinking(), [false, true]);
  } finally { await f.close(); await f.runtime.close(); }
});

test('fixed chapter model does not override the later manual import analysis model', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    const selection = { mode: 'manual', modelKey: 'manual-fixture' };
    assert.ok(terminalTypes(await send(f, selection)).includes('done'));
    const payload = {
      sceneKey: 'import_book_agent', agentProtocol: 'pi-v1', stream: true,
      modelSelection: selection, messages: [{ role: 'user', content: 'analysis-fixture' }],
    };
    const response = await fetch(`${f.url}/api/v1/ai_novel/ai/chat-completions`, {
      headers: headers(f), method: 'POST', body: JSON.stringify(encryptCreditsFixture(payload)),
    });
    assert.equal(response.status, 200);
    const events = (await response.text()).split('\n').filter(line => line.startsWith('data: '))
      .map(line => decodeCreditsFixture(JSON.parse(line.slice(6))));
    assert.ok(terminalTypes({ status: response.status, events }).includes('done'));
    assert.deepEqual(f.observedModels(), [small, 'manual-fixture']);
  } finally { await f.close(); await f.runtime.close(); }
});

test('temperature is omitted for non-stream chapter requests but preserved for other scenes', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    for (const [sceneKey, stream] of [['import_chapter_segmentation', false], ['write_turn', true]] as const) {
      const payload = { sceneKey, agentProtocol: 'pi-v1', stream, temperature: 0.42,
        messages: [{ role: 'user', content: 'temperature-fixture' }] };
      const response = await fetch(`${f.url}/api/v1/ai_novel/ai/chat-completions`, {
        headers: headers(f), method: 'POST', body: JSON.stringify(encryptCreditsFixture(payload)),
      });
      assert.equal(response.status, 200);
      const body = await response.text();
      if (stream) {
        const events = body.split('\n').filter(line => line.startsWith('data: '))
          .map(line => decodeCreditsFixture(JSON.parse(line.slice(6))));
        assert.ok(terminalTypes({ status: response.status, events }).includes('done'));
      } else {
        const result = decodeCreditsFixture(JSON.parse(body));
        assert.ok(result.data);
      }
    }
    assert.deepEqual(f.observedTemperatures(), [undefined, 0.42]);
  } finally { await f.close(); await f.runtime.close(); }
});

test('chapter match pagination reaches the upstream provider schema', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    const result = await send(f, { mode: 'auto' }, false, ['match'], 'related-pagination-fixture');
    assert.ok(terminalTypes(result).includes('done'));
    const tools = f.observedToolDefinitions()[0] as Array<{ function: { name: string; parameters: { properties: Record<string, unknown>; required: string[] } } }>;
    const rule = tools.find((tool) => tool.function.name === 'match');
    assert.ok(rule);
    assert.deepEqual(rule.function.parameters.required, ['patterns']);
    assert.equal((rule.function.parameters.properties.patterns as { type: string }).type, 'array');
    const toolEvent = result.events.map((event) => (event.data ?? event) as Record<string, unknown>)
      .find((event) => event.type === 'tool_call');
    const toolCall = toolEvent?.toolCall as { name: string; input: Record<string, unknown> } | undefined;
    assert.equal(toolCall?.name, 'match');
    assert.equal((toolCall?.input.patterns as Array<{offset: number}>)[0]?.offset, 20);
    assert.doesNotMatch(JSON.stringify(result.events), /related-pagination-fixture/);
    assert.doesNotMatch(JSON.stringify(f.runtime.logger.records), /related-pagination-fixture/);
  } finally { await f.close(); await f.runtime.close(); }
});

test('missing, malformed and unknown chapter model fail before provider or debit', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(false));
    const before = await balance(f);
    for (const [raw, expectedCode] of [[undefined, 'IMPORT_CHAPTER_MODEL_MISSING'], ['{invalid', 'IMPORT_CHAPTER_MODEL_INVALID'], [JSON.stringify({ modelKey: 'does-not-exist' }), 'IMPORT_CHAPTER_MODEL_UNAVAILABLE']] as const) {
      if (raw !== undefined) await f.runtime.services.appConfigService.setValue('ai_novel', 'ai_novel.import_chapter_segmentation', raw);
      const result = await send(f, { mode: 'auto' });
      assert.equal(result.status, 200);
      assert.equal(result.events[0]?.code, expectedCode);
      assert.equal(terminalTypes(result).includes('done'), false);
      assert.equal(f.calls(), 0);
      assert.equal(await balance(f), before);
    }
    assert.deepEqual(await conversations(f), []);
    assertNoPlaintext(f);
  } finally { await f.close(); await f.runtime.close(); }
});

test('unpriced model and withdrawn manual selection fail before provider or debit', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(false));
    await f.runtime.services.aiNovelModelPointPricingConfigService.updateConfig({ schemaVersion: 1, models: [{ modelKey: 'manual-fixture', inputPointsPerMillionTokens: 200, outputPointsPerMillionTokens: 800 }] });
    const before = await balance(f);
    const unpriced = await send(f, { mode: 'auto' });
    assert.equal(unpriced.events[0]?.code, 'AINOVEL_CREDITS_PRICE_UNAVAILABLE');
    assert.equal(terminalTypes(unpriced).includes('done'), false);
    assert.equal(f.calls(), 0);
    assert.equal(await balance(f), before);
    const invalidManual = await send(f, { mode: 'manual', modelKey: 'does-not-exist' });
    assert.equal(invalidManual.events[0]?.code, 'AI_MODEL_NOT_AVAILABLE');
    assert.equal(terminalTypes(invalidManual).includes('done'), false);
    assert.equal(f.calls(), 0);
    assert.equal(await balance(f), before);
    assert.deepEqual(await conversations(f), []);
    assertNoPlaintext(f);
  } finally { await f.close(); await f.runtime.close(); }
});

test('quota denial does not call provider or record manuscript in conversation history', async () => {
  const f = await startCreditsHttpRuntime();
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(false));
    const credits = new AiNovelCreditsService(f.runtime.database.aiNovelCreditsStore, async () => 'free');
    await credits.begin('user_alice', 'exhaust-fixture', 'exhaust-fixture');
    await credits.record('user_alice', 'exhaust-fixture', 'exhaust-fixture', { callId: 'exhaust-fixture', modelKey: small, pointMicros: '200000000',
      pricing: { inputPointsPerMillionTokens: 100, outputPointsPerMillionTokens: 400 }, usage: { promptTokens: 2000000, completionTokens: 0, totalTokens: 2000000 } });
    await credits.releaseRequest('user_alice', 'exhaust-fixture', 'exhaust-fixture');
    const result = await send(f, { mode: 'manual', modelKey: 'manual-fixture' });
    assert.ok(terminalTypes(result).includes('client_action'), JSON.stringify({ status: result.status, types: terminalTypes(result), calls: f.calls(), remaining: String(await balance(f)) }));
    assert.equal(f.calls(), 0);
    assert.deepEqual(await conversations(f), []);
    assertNoPlaintext(f);
  } finally { await f.close(); await f.runtime.close(); }
});

test('local debug mode does not echo or log chapter source plaintext', async () => {
  const f = await startCreditsHttpRuntime(0, 'local');
  try {
    await configure(f);
    await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig(policy(true));
    const result = await send(f, { mode: 'auto' }, true);
    assert.ok(terminalTypes(result).includes('done'));
    assert.doesNotMatch(JSON.stringify(result.events), /localDebugLlmRequest|local_debug_llm_request/);
    assert.deepEqual(await conversations(f), []);
    assertNoPlaintext(f);
  } finally { await f.close(); await f.runtime.close(); }
});
