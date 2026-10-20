import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { CmiClient, parseData, parseNodes } from '../src/client.js';
import { TIMINGS } from '../src/constants.js';
import { CmiError, errorReason, httpGet } from '../src/http.js';
import { PASSWORD, USER, answer } from './fixtures/cmi.js';

const configured = (client) => {
  client.configure({ host: '192.168.1.60', port: 80, username: USER, password: PASSWORD });
  return client;
};

test('the node list: valid ids only, no duplicates, bounded', () => {
  assert.deepEqual(parseNodes('1;2;'), [1, 2]);
  assert.deepEqual(parseNodes('1;1;0;63;45;'), [1, 45]);
  assert.deepEqual(parseNodes(''), []);
  assert.throws(() => parseNodes('<html>login</html>'), { kind: 'bad_response' });
  const many = Array.from({ length: 62 }, (_, i) => i + 1).join(';');
  assert.equal(parseNodes(many).length, 16);
});

test('the data answer: status code 0 only, the others as errors', () => {
  const ok = parseData(Buffer.from(JSON.stringify(answer())));
  assert.equal(ok['Status code'], 0);
  assert.throws(() => parseData(Buffer.from(JSON.stringify(answer({ code: 4 })))), {
    kind: 'rate_limited',
  });
  for (const code of [1, 2, 3, 5, 6, 7, 55]) {
    assert.throws(() => parseData(Buffer.from(JSON.stringify(answer({ code })))), {
      kind: 'node',
      code,
    });
  }
  assert.throws(() => parseData(Buffer.from('')), { kind: 'empty' });
  assert.throws(() => parseData(Buffer.from('<html>')), { kind: 'bad_response' });
  assert.throws(() => parseData(Buffer.from('[1]')), { kind: 'bad_response' });
  assert.throws(() => parseData(Buffer.from('{"Status code":"0"}')), { kind: 'bad_response' });
  // An own "__proto__" key is data, never a prototype.
  const root = parseData(Buffer.from('{"__proto__":{"polluted":1},"Status code":0}'));
  assert.equal({}.polluted, undefined);
  assert.equal(root.polluted, undefined);
});

test('the gate: one request at a time, 75 s after the end of the previous one, never waits by itself', async () => {
  let now = 1_000_000;
  const sent = [];
  const kept = [];
  const client = configured(
    new CmiClient({
      now: () => now,
      onRequest: async (at) => kept.push(at),
      transport: async (options) => {
        sent.push({ at: now, options });
        now += 5_000; // a slow answer
        return { status: 200, headers: {}, body: Buffer.from(JSON.stringify(answer())) };
      },
    }),
  );
  await client.readNode(1, ['I', 'O']);
  assert.equal(sent.length, 1);
  assert.deepEqual(kept, [1_000_000], 'kept before the request left');
  assert.equal(sent[0].options.path, '/INCLUDE/api.cgi?jsonnode=1&jsonparam=I,O');
  assert.equal(
    sent[0].options.headers.Authorization,
    `Basic ${Buffer.from(`${USER}:${PASSWORD}`, 'utf8').toString('base64')}`,
  );
  assert.equal(client.wait(), TIMINGS.requestGap, 'counted from the end (5 s later)');
  now += TIMINGS.requestGap - 1;
  await assert.rejects(client.readNode(1, ['I']), { kind: 'too_soon' });
  assert.equal(sent.length, 1);
  now += 1;
  await client.listNodes().catch(() => {});
  assert.equal(sent.length, 2);
});

test('a failed request is spaced too; a time from /data is never in the future', async () => {
  let now = 5_000_000;
  const client = configured(
    new CmiClient({
      now: () => now,
      transport: async () => {
        throw new CmiError('timeout', 'no answer');
      },
    }),
  );
  await assert.rejects(client.readNode(1, ['I']), { kind: 'timeout' });
  assert.equal(client.wait(), TIMINGS.requestGap);
  const fresh = configured(new CmiClient({ now: () => now }));
  fresh.remember(now + 10 * 3_600_000);
  assert.equal(fresh.wait(), TIMINGS.requestGap);
  now += TIMINGS.requestGap;
  assert.equal(fresh.wait(), 0);
});

test('HTTP statuses: 401/403 refused, 429 with Retry-After, 5xx unavailable', async () => {
  for (const [status, kind] of [
    [401, 'refused'],
    [403, 'refused'],
    [429, 'rate_limited'],
    [503, 'unavailable'],
    [302, 'http'],
  ]) {
    let now = 0;
    const client = configured(
      new CmiClient({
        now: () => (now += 1),
        transport: async () => ({
          status,
          headers: { 'retry-after': '120' },
          body: Buffer.alloc(0),
        }),
      }),
    );
    const err = await client.readNode(1, ['I']).catch((e) => e);
    assert.equal(err.kind, kind, String(status));
    if (status === 429) {
      assert.equal(err.retryAfter, 120_000);
    }
    assert.ok(!errorReason(err).includes(PASSWORD));
  }
});

test('not configured: nothing sent', async () => {
  let sent = 0;
  const client = new CmiClient({
    transport: async () => {
      sent += 1;
    },
  });
  await assert.rejects(client.listNodes(), { kind: 'no_config' });
  assert.equal(sent, 0);
});

test('httpGet: bounded body, Basic header sent, loopback only', async (t) => {
  let auth;
  const server = http.createServer((req, res) => {
    auth = req.headers.authorization;
    if (req.url.startsWith('/big')) {
      res.end('x'.repeat(10_000));
      return;
    }
    res.end('1;2;');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address();
  const ok = await httpGet({
    hostname: '127.0.0.1',
    port,
    path: '/INCLUDE/can_nodes.cgi?_=1',
    headers: { Authorization: 'Basic abc' },
  });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.toString(), '1;2;');
  assert.equal(auth, 'Basic abc');
  await assert.rejects(httpGet({ hostname: '127.0.0.1', port, path: '/big' }, { maxBytes: 1000 }), {
    kind: 'size',
  });
  const closed = await httpGet({ hostname: '127.0.0.1', port: 1, path: '/' }).catch((e) => e);
  assert.equal(closed.kind, 'network');
  assert.ok(!closed.message.includes('127.0.0.1'));
});
