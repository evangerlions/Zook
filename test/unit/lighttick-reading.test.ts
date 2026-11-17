import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, urlHashOf, pickDaily, feedbackHasContent } from '../../src/modules/lighttick/reading/reading.service.ts';
import type { LightTickReadingFeedbackRow } from '../../src/modules/lighttick/reading/reading.types.ts';

test('normalizeUrl 抹掉跟踪参数、排序查询、统一主机名与尾斜杠', () => {
  assert.equal(normalizeUrl('https://Example.COM/a/?utm_source=x&b=2&a=1#frag'),
    'https://example.com/a?a=1&b=2');
  assert.equal(normalizeUrl('https://example.com/a/?utm_source=x&utm_medium=y'), 'https://example.com/a');
  assert.equal(normalizeUrl('https://example.com:443/x'), 'https://example.com/x');
  assert.equal(normalizeUrl('http://example.com:80/x'), 'http://example.com/x');
  assert.equal(normalizeUrl('  https://example.com/x/  '), 'https://example.com/x');
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
  // 有意义的参数必须保留，否则带 id 的文章会被判成同一篇
  assert.equal(normalizeUrl('https://example.com/post?id=42&utm_campaign=z'), 'https://example.com/post?id=42');
});

test('normalizeUrl 拒绝非 http/https 与非法链接', () => {
  assert.throws(() => normalizeUrl('javascript:alert(1)'), /http/);
  assert.throws(() => normalizeUrl('ftp://example.com/x'), /http/);
  assert.throws(() => normalizeUrl('not a url'), /链接/);
});

test('urlHashOf 让同一篇文章的多种写法落到同一个哈希', () => {
  const variants = [
    'https://example.com/post/1',
    'https://example.com/post/1/',
    'https://EXAMPLE.com/post/1?utm_source=twitter',
    'https://example.com/post/1?fbclid=abc#top',
  ];
  const hashes = new Set(variants.map(urlHashOf));
  assert.equal(hashes.size, 1, `同一篇应只有一个哈希，实际 ${[...hashes].join(',')}`);
  assert.notEqual(urlHashOf('https://example.com/post/1'), urlHashOf('https://example.com/post/2'));
  assert.match(urlHashOf('https://example.com/post/1'), /^[0-9a-f]{64}$/);
});

test('pickDaily 先按主题轮转保证覆盖', () => {
  const picks = pickDaily([
    { id: 'a1', topic: '心理' }, { id: 'a2', topic: '心理' },
    { id: 'b1', topic: '科技' }, { id: 'c1', topic: '社会' },
  ], new Set(), '2026-11-14');
  assert.equal(picks.length, 3);
  assert.deepEqual(picks.map((p) => p.ordinal), [1, 2, 3]);
  const topics = picks.map((p) => p.reason);
  assert.equal(new Set(picks.map((p) => p.articleId)).size, 3, '不能重复推荐同一篇');
  assert.ok(topics.every((reason) => reason.startsWith('主题覆盖：')), topics.join(' | '));
  assert.equal(new Set(picks.map((p) => p.reason)).size, 3, '三个不同主题各取一篇');
});

test('pickDaily 主题不够时补位并改口径为探索', () => {
  const picks = pickDaily([
    { id: 'a1', topic: '心理' }, { id: 'a2', topic: '心理' }, { id: 'a3', topic: '心理' }, { id: 'a4', topic: '心理' },
  ], new Set(), '2026-11-14');
  assert.equal(picks.length, 3);
  assert.match(picks[0]!.reason, /^主题覆盖：心理$/);
  assert.match(picks[1]!.reason, /^探索：心理$/);
  assert.match(picks[2]!.reason, /^探索：心理$/);
});

test('pickDaily 排除近期已推荐，不足就少给而不是拿读过的凑', () => {
  const candidates = [{ id: 'a1', topic: '心理' }, { id: 'b1', topic: '科技' }];
  const picks = pickDaily(candidates, new Set(['a1']), '2026-11-14');
  assert.deepEqual(picks.map((p) => p.articleId), ['b1']);
  assert.deepEqual(pickDaily(candidates, new Set(['a1', 'b1']), '2026-11-14'), []);
  assert.deepEqual(pickDaily([], new Set(), '2026-11-14'), []);
});

test('pickDaily 同一业务日、同一候选池结果稳定', () => {
  const candidates = [
    { id: 'a1', topic: '心理' }, { id: 'a2', topic: '心理' },
    { id: 'b1', topic: '科技' }, { id: 'c1', topic: '社会' },
  ];
  const first = pickDaily(candidates, new Set(), '2026-11-14');
  const second = pickDaily([...candidates].reverse(), new Set(), '2026-11-14');
  assert.deepEqual(first, second, '候选顺序变化不应改变当天结果');
  const other = pickDaily(candidates, new Set(), '2026-11-15');
  assert.equal(other.length, 3);
});

test('feedbackHasContent：只有标签也算有反馈，全空不算', () => {
  const base: LightTickReadingFeedbackRow = {
    appId: 'lighttick', userId: 'u', articleId: 'a', valueRating: null, difficulty: null,
    takeaway: '', question: '', application: '', tags: [], revision: 1, updatedAt: '2026-11-14T00:00:00.000Z',
  };
  assert.equal(feedbackHasContent(undefined), false);
  assert.equal(feedbackHasContent(base), false);
  assert.equal(feedbackHasContent({ ...base, tags: ['注意力'] }), true);
  assert.equal(feedbackHasContent({ ...base, valueRating: 3 }), true);
  assert.equal(feedbackHasContent({ ...base, difficulty: 1 }), true);
  assert.equal(feedbackHasContent({ ...base, takeaway: '  ' }), false, '空白不算写过了');
  assert.equal(feedbackHasContent({ ...base, application: '明天试一次' }), true);
});
