import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TIMINGS } from '../src/constants.js';
import { fileStore, normalizeMemory } from '../src/store.js';

const KEY = '0123456789abcdef0123456789abcdef';
const NOW = 1_800_000_000_000;

test('the memory is repaired and bounded when read back', () => {
  assert.deepEqual(normalizeMemory(null, NOW), {
    lastRequestAt: null,
    key: '',
    pause: null,
    block: null,
    nodes: null,
    types: {},
    read: false,
  });
  const memory = normalizeMemory(
    {
      lastRequestAt: NOW + 3_600_000,
      key: KEY,
      pause: { kind: 'rate', until: NOW + 100 * 3_600_000, failures: 99 },
      block: { retries: 3, retryAt: NOW + 100 * 3_600_000 },
      nodes: { ids: [1, 1, 0, 63, 'x', 5], at: NOW + 1 },
      types: { 1: '87', 2: 'ZZ', __proto__: '87', '05': '87', 3: '8F' },
    },
    NOW,
  );
  assert.equal(memory.lastRequestAt, NOW, 'never in the future');
  assert.equal(memory.pause.until, NOW + TIMINGS.rateLimitMax);
  assert.equal(memory.pause.failures, 10);
  assert.equal(memory.block.retryAt, NOW + TIMINGS.refusedRetry.at(-1));
  assert.deepEqual(memory.nodes, { ids: [1, 5], at: NOW });
  assert.deepEqual(memory.types, { 1: '87', 3: '8F' });
  // Without a key, nothing but the time of the last request.
  const keyless = normalizeMemory({ lastRequestAt: NOW - 1, pause: { until: NOW + 1 } }, NOW);
  assert.equal(keyless.lastRequestAt, NOW - 1);
  assert.equal(keyless.pause, null);
});

test('the file store writes atomically, readable by its owner only', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'ta-cmi-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = fileStore(join(dir, 'state.json'));
  assert.equal(await store.load(), null, 'no file: a fresh install');
  await Promise.all([store.save({ a: 1 }), store.save({ a: 2 })]);
  assert.deepEqual(await store.load(), { a: 2 });
  // A file that cannot be parsed is not a fresh install: the app must know it.
  await writeFile(join(dir, 'state.json'), '{broken', 'utf8');
  await assert.rejects(store.load());
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(dir, 'state.json'))).mode & 0o777, 0o600);
  }
});
