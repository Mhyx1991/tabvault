import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup, workspaceExport } from '../src/core/backup.js';

const good = {
  format: 'tabvault-backup',
  version: 1,
  exportedAt: 1700000000000,
  workspaces: [
    { id: 'w1', name: 'Work project', createdAt: 1, updatedAt: 2, tabs: [{ url: 'https://a.com/', title: 'A' }] }
  ],
  snapshots: [
    { id: 's1', createdAt: 123, trigger: 'auto', windows: [{ id: 1, tabs: [{ url: 'https://b.com/', title: 'B', pinned: false, index: 0 }] }] }
  ],
  settings: { theme: 'dark', bogus: 'ignored', staleDays: 'not-a-number' }
};

test('valid backup passes with normalized data', () => {
  const v = validateBackup(good);
  assert.equal(v.ok, true, v.errors.join('; '));
  assert.equal(v.summary.workspaces, 1);
  assert.equal(v.summary.snapshots, 1);
  assert.equal(v.summary.tabs, 2);
  assert.equal(v.data.settings.theme, 'dark');
  assert.ok(!('bogus' in v.data.settings));
  assert.equal(v.data.settings.staleDays, undefined, 'invalid-typed setting dropped');
});

test('non-JSON-object is rejected', () => {
  assert.equal(validateBackup('nope').ok, false);
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup([1, 2]).ok, false);
});

test('wrong format/version is rejected', () => {
  assert.equal(validateBackup({ ...good, format: 'other' }).ok, false);
  assert.equal(validateBackup({ ...good, version: 99 }).ok, false);
});

test('malformed workspaces are rejected', () => {
  assert.equal(validateBackup({ ...good, workspaces: 'nope' }).ok, false);
  assert.equal(validateBackup({ ...good, workspaces: [{ name: '', tabs: [] }] }).ok, false);
  assert.equal(validateBackup({ ...good, workspaces: [{ name: 'x', tabs: 'nope' }] }).ok, false);
});

test('oversized backups are rejected (memory-bomb guard)', () => {
  const many = Array.from({ length: 501 }, () => ({ name: 'x', tabs: [] }));
  assert.equal(validateBackup({ ...good, workspaces: many }).ok, false);
});

test('missing sections default to empty', () => {
  const v = validateBackup({ format: 'tabvault-backup', version: 1 });
  assert.equal(v.ok, true);
  assert.equal(v.summary.workspaces, 0);
  assert.equal(v.summary.snapshots, 0);
});

test('ids and timestamps are generated when missing', () => {
  const v = validateBackup({ format: 'tabvault-backup', version: 1, workspaces: [{ name: 'x', tabs: [{ url: 'https://a.com/' }] }] });
  assert.equal(v.ok, true);
  assert.ok(v.data.workspaces[0].id, 'id generated');
  assert.ok(v.data.workspaces[0].createdAt > 0);
});

test('workspace exports render in all four formats', () => {
  const ws = { name: 'My Trip!', updatedAt: 1700000000000, tabs: [{ url: 'https://a.com/?x=1', title: 'A <cool> page' }] };
  for (const fmt of ['json', 'markdown', 'html', 'txt']) {
    const out = workspaceExport(ws, fmt);
    assert.ok(out.filename.startsWith('my-trip'), `${fmt}: filename ${out.filename}`);
    assert.ok(out.content.length > 10, `${fmt}: content`);
  }
  const html = workspaceExport(ws, 'html');
  assert.ok(!html.content.includes('A <cool> page'), 'HTML escapes titles');
  assert.ok(html.content.includes('&lt;cool&gt;'));
  const md = workspaceExport(ws, 'markdown');
  assert.ok(md.content.includes('](https://a.com/?x=1)'));
});
