import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateGroups, closePlan, countDuplicateTabs } from '../src/core/duplicates.js';

function tab(id, url, extra = {}) {
  return { id, url, title: `T${id}`, index: id, lastAccessed: 1000 + id, ...extra };
}

test('detects exact duplicates ignoring tracking params and hash', () => {
  const tabs = [
    tab(1, 'https://github.com/p/a'),
    tab(2, 'https://github.com/p/a#readme'),
    tab(3, 'https://www.github.com/p/a?utm_source=x'),
    tab(4, 'https://github.com/p/b')
  ];
  const groups = findDuplicateGroups(tabs);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].tabs.length, 3);
  assert.equal(countDuplicateTabs(groups), 2);
});

test('near-duplicates with different paths are not duplicates', () => {
  const tabs = [tab(1, 'https://a.com/x'), tab(2, 'https://a.com/y')];
  assert.equal(findDuplicateGroups(tabs).length, 0);
});

test('keep priority: active > pinned > recent', () => {
  const tabs = [
    tab(1, 'https://a.com/', { lastAccessed: 900 }),
    tab(2, 'https://a.com/', { pinned: true, lastAccessed: 500 }),
    tab(3, 'https://a.com/', { active: true, lastAccessed: 100 })
  ];
  const { keep, close } = closePlan(findDuplicateGroups(tabs)[0]);
  assert.equal(keep.id, 3);
  assert.deepEqual(close.sort(), [1, 2]);
});

test('explicit keepId wins', () => {
  const tabs = [tab(1, 'https://a.com/'), tab(2, 'https://a.com/', { active: true })];
  const { keep } = closePlan(findDuplicateGroups(tabs)[0], { keepId: 1 });
  assert.equal(keep.id, 1);
});

test('ignores new-tab pages and non-http URLs', () => {
  const tabs = [tab(1, 'chrome://newtab/'), tab(2, 'chrome://newtab/'), tab(3, 'about:blank'), tab(4, 'about:blank')];
  assert.equal(findDuplicateGroups(tabs).length, 0);
});
