import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, symlink, rm, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { chromium } from 'playwright';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const admin = path.join(repo, 'apps/admin-web');
const requireAdmin = createRequire(path.join(admin, 'package.json'));
const { createServer } = await import(requireAdmin.resolve('vite'));

test('provider controls preserve minimum widths, wrap, and align despite optional hints', async () => {
  const fixture = await realpath(await mkdtemp(path.join(tmpdir(), 'zook-provider-layout-')));
  const artifacts = path.join(repo, '.artifacts/admin-provider-layout');
  let server; let browser;
  try {
    await mkdir(artifacts, { recursive: true });
    await symlink(path.join(admin, 'node_modules'), path.join(fixture, 'node_modules'));
    await writeFile(path.join(fixture, 'index.html'), '<div id="root"></div><script type="module" src="/main.tsx"></script>');
    await writeFile(path.join(fixture, 'main.tsx'), `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import 'antd/dist/reset.css';
      import ${JSON.stringify(path.join(admin, 'app/app.css'))};
      import { LlmProviderCard } from ${JSON.stringify(path.join(admin, 'app/components/llm-config-cards.tsx'))};
      const providers = ['bailian_token_plan', 'volcengine_agent_plan'].map(type => ({
        type, key: type, label: type === 'bailian_token_plan' ? '百炼 Token Plan' : 'Volcengine Ark Agent Plan',
        enabled: true, baseUrl: 'https://example.com/compatible-mode/v1',
        apiKey: '{{zook.ps.preview_api_key}}', timeoutMs: '12000',
      }));
      createRoot(document.getElementById('root')).render(
        <main className="llm-config-page" style={{ padding: 24 }}>
          <div className="provider-list">{providers.map(provider => <LlmProviderCard key={provider.key} provider={provider} onChange={() => {}} onRemove={() => {}} />)}</div>
        </main>);
    `);
    server = await createServer({ configFile: false, root: fixture, esbuild: { jsx: 'automatic' },
      resolve: { dedupe: ['react', 'react-dom'] },
      server: { host: '127.0.0.1', port: 0, fs: { allow: [repo, fixture] } }, logLevel: 'error' });
    await server.listen();
    browser = await chromium.launch({ headless: true, channel: 'chromium' });
    const page = await browser.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('.field--provider-secret .ant-input-affix-wrapper').first().waitFor();
    for (const width of [1600, 1300, 1180, 760, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layout = await page.locator('.provider-list .config-form-grid').first().evaluate(form => {
        const fields = [...form.querySelectorAll(':scope > .field')].map(field => {
          const box = field.getBoundingClientRect();
          const control = field.querySelector(':scope > .ant-input, :scope > .ant-select, :scope > .ant-input-affix-wrapper').getBoundingClientRect();
          return { label: field.querySelector('.field-label').textContent, top: box.top, bottom: box.bottom,
            width: box.width, controlBottom: control.bottom };
        });
        return { fields, available: form.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth };
      });

      assert.equal(layout.overflow, false, `no horizontal overflow at ${width}`);
      for (const [label, minimum] of [['类型', 220], ['API Key', 260]]) {
        assert.ok(layout.fields.find(field => field.label === label).width >= Math.min(minimum, layout.available) - 1, `${label} width at ${width}`);
      }
      assert.ok(new Set(layout.fields.map(field => Math.round(field.top))).size > 1, `fields wrap at ${width}`);
      for (const field of layout.fields) {
        const row = layout.fields.filter(other => Math.abs(other.top - field.top) < 1);
        assert.ok(row.every(other => Math.abs(other.controlBottom - field.controlBottom) < 1), `control bottoms align at ${width}: ${JSON.stringify(layout.fields)}`);
        assert.ok(row.every(other => Math.abs(other.bottom - field.bottom) < 1), `hint rows align at ${width}`);
      }
      await page.locator('.llm-config-page').screenshot({ path: path.join(artifacts, `providers-${width}.png`) });
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await server?.close(); await rm(fixture, { recursive: true, force: true });
  }
});
