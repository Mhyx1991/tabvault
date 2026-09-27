import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchTabs, searchWorkspaces } from '../src/core/search.js';

function tab(id, url, title = '', extra = {}) {
  return { id, url, title, groupId: -1, lastAccessed: 1000, ...extra };
}

test('matches title, host and url tokens', () => {
  const tabs = [
    tab(1, 'https://github.com/tabvault/repo', 'TabVault repository'),
    tab(2, 'https://mail.google.com/u/0', 'Inbox'),
    tab(3, 'https://github.com/other/x', 'Chrome extension API docs')
  ];
  const hits = searchTabs('github', tabs, new Map());
  assert.equal(hits.length, 2);
  const vault = searchTabs('tabvault', tabs, new Map());
  assert.equal(vault.length, 1);
  assert.equal(vault[0].tab.id, 1);
});

test('all tokens must match (AND)', () => {
  const tabs = [
    tab(1, 'https://github.com/chrome/extension', 'Chrome extension'),
    tab(2, 'https://github.com/other/repo', 'Some repo')
  ];
  const hits = searchTabs('chrome extension', tabs, new Map());
  assert.equal(hits.length, 1);
  assert.equal(hits[0].tab.id, 1);
});

test('group names are searchable', () => {
  const tabs = [tab(1, 'https://a.com/', 'Page A', { groupId: 5 })];
  const groups = new Map([[5, { title: 'Development', color: 'green' }]]);
  const hits = searchTabs('development', tabs, groups);
  assert.equal(hits.length, 1);
});

test('empty query returns recents (max 8)', () => {
  const tabs = Array.from({ length: 20 }, (_, i) => tab(i, `https://a.com/${i}`, `T${i}`, { lastAccessed: i }));
  const hits = searchTabs('', tabs, new Map());
  assert.equal(hits.length, 8);
  assert.equal(hits[0].tab.id, 19);
});

test('new-tab pages are never searchable', () => {
  const tabs = [tab(1, 'chrome://newtab/', 'New Tab')];
  assert.equal(searchTabs('tab', tabs, new Map()).length, 0);
});

test('workspace search matches names and contents', () => {
  const ws = [
    { id: '1', name: 'Job search', tabs: [{ url: 'https://linkedin.com/jobs', title: 'Jobs' }] },
    { id: '2', name: 'Trip', tabs: [{ url: 'https://example.com/hotel', title: 'Hotel' }] }
  ];
  const byName = searchWorkspaces('job', ws);
  assert.equal(byName.length, 1);
  assert.equal(byName[0].workspace.id, '1');
  const byContent = searchWorkspaces('hotel', ws);
  assert.equal(byContent.length, 1);
  assert.equal(byContent[0].workspace.id, '2');
});
