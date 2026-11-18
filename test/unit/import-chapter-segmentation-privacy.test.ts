import assert from 'node:assert/strict';
import test from 'node:test';
import { StructuredLogger } from '../../src/infrastructure/logging/pino-logger.module.ts';
import { BailianOpenAICompatibleProvider } from '../../src/services/bailian-openai-compatible-provider.ts';
import { OpenRouterOpenAICompatibleProvider } from '../../src/services/openrouter-openai-compatible-provider.ts';
import type { ResolvedLLMCompletionRequest } from '../../src/services/llm-manager.ts';
import { isLlmBalanceFailure } from '../../src/services/llm-balance-failure.ts';

const marker = 'private-manuscript-test-marker';
for (const providerKind of ['bailian', 'openrouter'] as const) {
  for (const mode of ['complete', 'stream'] as const) {
    test(`${providerKind} ${mode} suppresses request and response plaintext while forwarding content`, async () => {
      const oldEnvironment = process.env.APP_ENV;
      const oldFullBody = process.env.ZOOK_LOG_FULL_PROVIDER_BODY;
      process.env.APP_ENV = 'local';
      process.env.ZOOK_LOG_FULL_PROVIDER_BODY = '1';
      const logger = new StructuredLogger('api', { emitToConsole: false });
      let upstreamBody = '';
      const options = {
        apiKey: 'fixture-only', logger,
        fetchImplementation: async (_input: unknown, init?: RequestInit) => {
          upstreamBody = String(init?.body);
          if (mode === 'stream') {
            return new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: marker } }] })}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } });
          }
          return new Response(JSON.stringify({ choices: [{ message: { content: marker }, finish_reason: 'stop' }] }));
        },
      };
      const provider = providerKind === 'openrouter' ? new OpenRouterOpenAICompatibleProvider(options) : new BailianOpenAICompatibleProvider(options);
      const request: ResolvedLLMCompletionRequest = {
        model: { provider: providerKind, modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
        messages: [{ role: 'user', content: marker }],
        providerOptions: { zookLogBodyMode: 'suppress', enable_thinking: false },
      };
      try {
        if (mode === 'complete') await provider.complete(request);
        else for await (const _ of provider.stream(request)) { /* consume */ }
        assert.match(upstreamBody, new RegExp(marker));
        assert.equal((JSON.parse(upstreamBody) as Record<string, unknown>).zookLogBodyMode, undefined);
        assert.doesNotMatch(JSON.stringify(logger.records), new RegExp(marker));
        assert.equal(logger.records.some(r => r.message.startsWith('ai_novel local provider')), false);
      } finally {
        if (oldEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = oldEnvironment;
        if (oldFullBody === undefined) delete process.env.ZOOK_LOG_FULL_PROVIDER_BODY; else process.env.ZOOK_LOG_FULL_PROVIDER_BODY = oldFullBody;
      }
    });
  }
}

for (const providerKind of ['bailian', 'openrouter'] as const) {
  for (const mode of ['complete', 'stream'] as const) {
    for (const failure of ['http-json', 'http-non-json', 'malformed-success', 'sse-json-error'] as const) {
      if (failure === 'sse-json-error' && mode === 'complete') continue;
      test(`${providerKind} ${mode} suppresses manuscript echoed in ${failure} error`, async () => {
        const logger = new StructuredLogger('api', { emitToConsole: false });
        const diagnostics: unknown[] = [];
        const options = {
          apiKey: 'fixture-only', logger,
          diagnostics: { reportFailure: (value: unknown) => { diagnostics.push(value); } },
          fetchImplementation: async () => {
            if (failure === 'http-json') return new Response(JSON.stringify({ error: { code: 'bad', message: marker } }), { status: 400 });
            if (failure === 'http-non-json') return new Response(marker, { status: 502 });
            if (failure === 'sse-json-error') return new Response(`data: ${JSON.stringify({ error: { message: marker } })}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
            return mode === 'stream'
              ? new Response(`data: ${marker}\n\n`, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
              : new Response(marker, { status: 200 });
          },
        };
        const provider = providerKind === 'openrouter' ? new OpenRouterOpenAICompatibleProvider(options) : new BailianOpenAICompatibleProvider(options);
        const request: ResolvedLLMCompletionRequest = {
          model: { provider: providerKind, modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
          messages: [{ role: 'user', content: marker }], providerOptions: { zookLogBodyMode: 'suppress', enable_thinking: false },
        };
        let thrown: unknown;
        try {
          if (mode === 'complete') await provider.complete(request);
          else for await (const _ of provider.stream(request)) { /* consume */ }
        } catch (error) { thrown = error; }
        assert.ok(thrown instanceof Error);
        assert.doesNotMatch(String(thrown), new RegExp(marker));
        assert.doesNotMatch(JSON.stringify(thrown), new RegExp(marker));
        assert.doesNotMatch(JSON.stringify(logger.records), new RegExp(marker));
        assert.doesNotMatch(JSON.stringify(diagnostics), new RegExp(marker));
        assert.match(JSON.stringify(thrown), /LLM_PROVIDER_/);
      });
    }
  }
}

test('suppressed Bai balance errors retain structured quota classification', async () => {
  const provider = new BailianOpenAICompatibleProvider({ apiKey: 'fixture-only', providerName: 'bai',
    fetchImplementation: async () => new Response(JSON.stringify({ error: { code: 'insufficient_user_quota', message: marker } }), { status: 403 }) });
  let thrown: unknown;
  try {
    await provider.complete({ model: { provider: 'bai', modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
      messages: [{ role: 'user', content: marker }], providerOptions: { zookLogBodyMode: 'suppress' } });
  } catch (error) { thrown = error; }
  assert.equal(isLlmBalanceFailure('bai', thrown), true);
  assert.doesNotMatch(JSON.stringify(thrown), new RegExp(marker));
});

for (const [reason, expectedBalance] of [[undefined, true], ['unknown', false], ['weight_exceeds_budget', false]] as const) {
  test(`suppressed OpenRouter credit error preserves ${reason ?? 'unqualified'} classification`, async () => {
    const provider = new OpenRouterOpenAICompatibleProvider({ apiKey: 'fixture-only',
      fetchImplementation: async () => new Response(JSON.stringify({ error: { code: 402, message: marker,
        metadata: { limit_source: 'openrouter_credits', ...(reason === undefined ? {} : { reason }) } } }), { status: 402 }) });
    let thrown: unknown;
    try {
      await provider.complete({ model: { provider: 'openrouter', modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
        messages: [{ role: 'user', content: marker }], providerOptions: { zookLogBodyMode: 'suppress' } });
    } catch (error) { thrown = error; }
    assert.equal(isLlmBalanceFailure('openrouter', thrown), expectedBalance);
    assert.doesNotMatch(JSON.stringify(thrown), new RegExp(marker));
  });
}

for (const mode of ['complete', 'stream'] as const) {
  test(`suppressed ${mode} still sanitizes an echoed provider error racing cancellation`, async () => {
    const controller = new AbortController();
    const provider = new BailianOpenAICompatibleProvider({ apiKey: 'fixture-only',
      fetchImplementation: async () => { controller.abort(); return new Response(JSON.stringify({ error: { message: marker } }), { status: 400 }); } });
    const request: ResolvedLLMCompletionRequest = { model: { provider: 'bailian', modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
      messages: [{ role: 'user', content: marker }], providerOptions: { zookLogBodyMode: 'suppress' }, signal: controller.signal };
    let thrown: unknown;
    try {
      if (mode === 'complete') await provider.complete(request);
      else for await (const _ of provider.stream(request)) { /* consume */ }
    } catch (error) { thrown = error; }
    assert.ok(thrown instanceof Error);
    assert.doesNotMatch(String(thrown), new RegExp(marker));
    assert.doesNotMatch(JSON.stringify(thrown), new RegExp(marker));
  });
}

test('non-suppressed provider errors keep existing upstream diagnostics', async () => {
  const provider = new BailianOpenAICompatibleProvider({ apiKey: 'fixture-only',
    fetchImplementation: async () => new Response(JSON.stringify({ error: { code: 'bad', message: marker } }), { status: 400 }) });
  await assert.rejects(provider.complete({ model: { provider: 'bailian', modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
    messages: [{ role: 'user', content: 'request' }] }), new RegExp(marker));
});

test('redacted content-safety mode retains its metadata logging behavior', async () => {
  const oldEnvironment = process.env.APP_ENV;
  const oldFullBody = process.env.ZOOK_LOG_FULL_PROVIDER_BODY;
  process.env.APP_ENV = 'local';
  process.env.ZOOK_LOG_FULL_PROVIDER_BODY = '1';
  const logger = new StructuredLogger('api', { emitToConsole: false });
  try {
    const provider = new BailianOpenAICompatibleProvider({ apiKey: 'fixture-only', logger,
      fetchImplementation: async () => new Response(JSON.stringify({ choices: [{ message: { content: 'safe' }, finish_reason: 'stop' }] })) });
    await provider.complete({ model: { provider: 'bailian', modelKey: 'fixture', resolvedModelKey: 'fixture', providerModel: 'fixture' },
      messages: [{ role: 'user', content: marker }], providerOptions: { zookLogBodyMode: 'redacted' } });
    const requestLog = logger.records.find(r => r.message === 'ai_novel local provider chat request started');
    assert.ok(requestLog);
    assert.doesNotMatch(JSON.stringify(requestLog), new RegExp(marker));
    assert.ok(logger.records.some(r => r.message === 'ai_novel local provider chat response completed'));
  } finally {
    if (oldEnvironment === undefined) delete process.env.APP_ENV; else process.env.APP_ENV = oldEnvironment;
    if (oldFullBody === undefined) delete process.env.ZOOK_LOG_FULL_PROVIDER_BODY; else process.env.ZOOK_LOG_FULL_PROVIDER_BODY = oldFullBody;
  }
});
