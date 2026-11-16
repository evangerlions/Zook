import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * 路由模块写好了却忘了注册，是这一域最容易漏的一类缺陷：
 * 模块本身能通过类型检查、单测也能过，但干净检出上所有接口直接 404。
 * 阅读域就真的发生过——路由文件提交了，backend-application.ts 里没有 import，
 * 而当时所有验收跑的都是工作区，所以没有任何测试挡住它。
 *
 * 这里用「源码层面」的断言把不变量钉住：
 *   1. 任何导出 tryHandle* 的 LightTick 路由模块，都必须被 backend-application 引用；
 *   2. 引用了还不够，必须真的被调用——只 import 不调用同样等于没接线。
 *
 * 范围只取 `lighttick-*-routes.ts`：admin / frogsleep / bodylog 等域由各自的入口注册，
 * 不归 backend-application 管，一并纳入只会制造假失败。
 *
 * 边界（别把这两条断言当成比它更强的保证）：都是源码文本检查，不是可达性分析。
 * 断言 2 能挡住「import 了却再没出现过」，但挡不住死引用——把调用改写成
 * `void (0 && handler(...))` 这类仍带标识符的写法依然会通过。
 * 真正的端到端保障是验收脚本打真实端口；这里只是补一道成本极低的静态闸门。
 */
const APP_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src', 'app');
const ENTRY = 'backend-application.ts';

function routeModules(): { file: string; handler: string }[] {
  return readdirSync(APP_DIR)
    .filter((name) => /^lighttick-.*-routes\.ts$/.test(name))
    .flatMap((name) => {
      const source = readFileSync(join(APP_DIR, name), 'utf8');
      // 名字里含数字（tryHandleLightTickV1Routes / ...Phase2Routes），字符集必须带 0-9，
      // 否则截出来的前缀会变成另一个名字，后面的「是否被调用」就永远匹配不上。
      const handler = source.match(/export (?:async )?function (tryHandle[A-Za-z0-9_]+)/)?.[1];
      return handler ? [{ file: name, handler }] : [];
    });
}

test('每个 tryHandle* 路由模块都在 backend-application 中被引用', () => {
  const entry = readFileSync(join(APP_DIR, ENTRY), 'utf8');
  const modules = routeModules();
  assert.ok(modules.length > 0, '没有找到任何 tryHandle* 路由模块，断言本身失效了');
  const missing = modules.filter((m) => !entry.includes(`./${m.file}`)).map((m) => m.file);
  assert.deepEqual(missing, [], `这些路由模块没有被注册，接口在干净检出上会 404：${missing.join(', ')}`);
});

test('引用的路由处理器必须真的被调用，不能只 import', () => {
  const entry = readFileSync(join(APP_DIR, ENTRY), 'utf8');
  // 去掉 import 段，避免把「只导入」误判成「已调用」。
  const body = entry.split('\n').filter((line) => !/^\s*import\b/.test(line)).join('\n');
  const uncalled = routeModules()
    .filter((m) => entry.includes(`./${m.file}`))
    .filter((m) => !new RegExp(`\\b${m.handler}\\s*\\(`).test(body))
    .map((m) => m.handler);
  assert.deepEqual(uncalled, [], `这些处理器被 import 了但没有调用：${uncalled.join(', ')}`);
});
