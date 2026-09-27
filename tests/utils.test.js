import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, hostOf, djb2, chunk } from '../src/shared/utils.js';

test('normalizeUrl strips tracking params, hash, www, trailing slash', () => {
  assert.equal(
    normalizeUrl('https://www.github.com/facebook/react/?utm_source=newsletter&fbclid=x#readme'),
    'https://github.com/facebook/react'
  );
});

test('normalizeUrl keeps meaningful query params and strips path slash', () => {
  assert.equal(
    normalizeUrl('https://youtube.com/watch/?v=abc123&t=42'),
    'https://youtube.com/watch?v=abc123&t=42'
  );
});

test('normalizeUrl lowercases host', () => {
  assert.equal(normalizeUrl('https://GitHub.COM/Foo'), 'https://github.com/Foo');
});

test('normalizeUrl survives garbage input', () => {
  assert.equal(normalizeUrl('not a url'), 'not a url');
  assert.equal(normalizeUrl(''), '');
  assert.equal(normalizeUrl(null), '');
});

test('normalizeUrl treats http and https as distinct (safe default)', () => {
  assert.notEqual(normalizeUrl('http://example.com/a'), normalizeUrl('https://example.com/a'));
});

test('hostOf strips www and lowercases', () => {
  assert.equal(hostOf('https://www.Example.com/x'), 'example.com');
  assert.equal(hostOf('garbage'), '');
});

test('djb2 is stable and differs for different input', () => {
  assert.equal(djb2('abc'), djb2('abc'));
  assert.notEqual(djb2('abc'), djb2('abd'));
});

test('chunk splits evenly', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});
