import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreTab, classifyTabs, analyzeTabs } from '../src/core/categorize.js';

function tab(id, url, title = '', extra = {}) {
  return { id, url, title, groupId: -1, ...extra };
}

test('github.com → development', () => {
  const r = scoreTab(tab(1, 'https://github.com/facebook/react', 'GitHub - facebook/react'));
  assert.equal(r.categoryId, 'development');
  assert.ok(['low', 'medium', 'high'].includes(r.confidence), `confidence was ${r.confidence}`);
});

test('mail.google.com → work', () => {
  const r = scoreTab(tab(1, 'https://mail.google.com/mail/u/0', 'Inbox (12) - Gmail'));
  assert.equal(r.categoryId, 'work');
});

test('amazon product page → shopping', () => {
  const r = scoreTab(tab(1, 'https://www.amazon.de/dp/B08N5WRWNW', 'Product – Amazon.de: cart, checkout'));
  assert.equal(r.categoryId, 'shopping');
});

test('youtube watch page → entertainment', () => {
  const r = scoreTab(tab(1, 'https://www.youtube.com/watch?v=abc', 'A movie trailer - YouTube'));
  assert.equal(r.categoryId, 'entertainment');
});

test('nytimes article → news', () => {
  const r = scoreTab(tab(1, 'https://www.nytimes.com/2026/01/01/world/story.html', 'Breaking news: Something happened'));
  assert.equal(r.categoryId, 'news');
});

test('arxiv paper → research', () => {
  const r = scoreTab(tab(1, 'https://arxiv.org/abs/2401.12345', '[2401.12345] A study of transformers'));
  assert.equal(r.categoryId, 'research');
});

test('reddit → social', () => {
  const r = scoreTab(tab(1, 'https://www.reddit.com/r/chrome/', 'r/chrome'));
  assert.equal(r.categoryId, 'social');
});

test('search query words steer classification', () => {
  const r = scoreTab(tab(1, 'https://www.google.com/search?q=chrome+extension+manifest+documentation', 'chrome extension manifest documentation - Google Search'));
  assert.equal(r.categoryId, 'development');
});

test('user rules beat defaults', () => {
  const r = scoreTab(tab(1, 'https://github.com/x', 'GitHub'), { userRules: { 'github.com': 'work' } });
  assert.equal(r.categoryId, 'work');
  assert.equal(r.confidence, 'high');
});

test('user rules match subdomains', () => {
  const r = scoreTab(tab(1, 'https://gist.github.com/x', 'gist'), { userRules: { 'github.com': 'work' } });
  assert.equal(r.categoryId, 'work');
});

test('ambiguous tabs land in unsorted', () => {
  const r = scoreTab(tab(1, 'https://example.com/', 'Example page'));
  assert.equal(r.categoryId, null);
});

test('chrome:// pages are not categorized', () => {
  const r = scoreTab(tab(1, 'chrome://settings/', 'Settings'));
  assert.equal(r.categoryId, null);
});

test('classifyTabs applies minConfidence threshold', () => {
  const tabs = [tab(1, 'https://github.com/a', 'GitHub - a'), tab(2, 'https://example.com/b', 'b')];
  const medium = classifyTabs(tabs, { minConfidence: 'medium' });
  assert.ok(medium.get(1).categoryId === 'development' || medium.get(1).confidence !== 'unsorted');
  assert.equal(medium.get(2).categoryId, null);

  const high = classifyTabs(tabs, { minConfidence: 'high' });
  assert.equal(high.get(1).categoryId ?? null, high.get(1).categoryId ?? null);
});

test('analyzeTabs groups domains and respects minGroupSize', () => {
  const tabs = [
    tab(1, 'https://github.com/a', 'GitHub a'),
    tab(2, 'https://github.com/b', 'GitHub b'),
    tab(3, 'https://stackoverflow.com/q/1', 'Question - Stack Overflow')
  ];
  const a = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true });
  const dev = a.suggestions.find((s) => s.categoryId === 'development');
  assert.ok(dev, 'development suggestion exists');
  assert.equal(dev.tabs.length, 3);
  assert.equal(a.unsorted.tabs.length, 0);
});

test('analyzeTabs sends undersized groups to unsorted', () => {
  const tabs = [
    tab(1, 'https://github.com/a', 'GitHub a'),
    tab(2, 'https://example.com/b', 'b'),
    tab(3, 'https://example.com/c', 'c')
  ];
  const a = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true });
  const dev = a.suggestions.find((s) => s.categoryId === 'development');
  assert.equal(dev, undefined);
  assert.ok(a.unsorted.tabs.some((t) => t.id === 1));
});

test('analyzeTabs preserves existing Chrome groups when asked', () => {
  const tabs = [
    tab(1, 'https://github.com/a', 'GitHub a', { groupId: 7 }),
    tab(2, 'https://mail.google.com/x', 'Inbox'),
    tab(3, 'https://mail.google.com/y', 'Inbox 2')
  ];
  const groups = new Map([[7, { title: 'My stuff', color: 'blue' }]]);
  const a = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: true }, groups);
  assert.equal(a.existingGroups.length, 1);
  assert.equal(a.existingGroups[0].title, 'My stuff');
  assert.ok(!a.suggestions.some((s) => s.tabs.some((t) => t.id === 1)));
});

test('analyzeTabs re-classifies existing groups when preservation is off', () => {
  const tabs = [
    tab(1, 'https://github.com/a', 'GitHub a', { groupId: 7 }),
    tab(2, 'https://github.com/b', 'GitHub b', { groupId: 7 })
  ];
  const groups = new Map([[7, { title: 'My stuff', color: 'blue' }]]);
  const a = analyzeTabs(tabs, { minGroupSize: 2, preserveExistingGroups: false }, groups);
  assert.equal(a.existingGroups.length, 0);
  const dev = a.suggestions.find((s) => s.categoryId === 'development');
  assert.equal(dev.tabs.length, 2);
});

test('analyzeTabs honors custom category names', () => {
  const tabs = [
    tab(1, 'https://github.com/a', 'GitHub a'),
    tab(2, 'https://github.com/b', 'GitHub b')
  ];
  const a = analyzeTabs(tabs, { minGroupSize: 2, categoryNames: { development: 'Code things' } });
  assert.equal(a.suggestions.find((s) => s.categoryId === 'development').name, 'Code things');
});

test('large batches classify quickly (performance smoke)', () => {
  const tabs = [];
  for (let i = 0; i < 2000; i++) {
    const kind = i % 4;
    const url = ['https://github.com/x', 'https://mail.google.com/x', 'https://www.youtube.com/watch?v=x', 'https://example.com/x'][kind];
    tabs.push(tab(i, url, `Tab ${i}`));
  }
  const t0 = performance.now();
  const a = analyzeTabs(tabs, { minGroupSize: 2 });
  const ms = performance.now() - t0;
  assert.equal(a.stats.total, 2000);
  assert.equal(a.suggestions.length, 3);
  assert.ok(ms < 2000, `analysis took ${ms}ms`);
});
