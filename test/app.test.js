// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake C.M.I. behind the transport. Timers and Date are mocked:
// the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { CmiApp } from '../src/app.js';
import { cmiKey } from '../src/config.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import { CONFIG, HOST, MINUTE, NOW, PASSWORD, SECOND, USER, answer } from './fixtures/cmi.js';
import { fakeCmi, memoryStore, settle } from './helpers/fakeCmi.js';

const dev = (node) => `ext:test-integration:cmi:node${node}`;
const GAP = TIMINGS.requestGap;

const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeCmi(),
    create = true,
    logs = [],
    now = NOW,
    mockTimers = true,
    // The wall clock seen by the app (its timers stay monotonic, as in Node).
    clock = { offset: 0 },
  } = {},
) {
  if (mockTimers) {
    t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  }
  const gladys = createFakeGladys({ config });
  const app = new CmiApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now() + clock.offset,
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 5 * SECOND) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  const createAll = async () => {
    for (const device of gladys.fake.discoveredDevices) {
      if (!(gladys.devices ?? []).some((d) => d.external_id === device.external_id)) {
        await gladys.fake.deviceCreated(device);
      }
    }
    await settle();
  };
  return { gladys, app, server, store, advance, logs, createAll, create };
}

const last = (gladys, node, role) => gladys.fake.lastState(`${dev(node)}:${role}`);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const badgeOf = (gladys, node) =>
  gladys.fake.transports.filter((b) => b.device_external_id === dev(node)).at(-1);

/** Every request starts at least 75 s after the end of the previous one. */
function assertSpaced(server) {
  for (let i = 1; i < server.requests.length; i += 1) {
    const gap = server.requests[i].at - server.requests[i - 1].end;
    assert.ok(gap >= GAP, `requests ${i - 1} and ${i} only ${gap} ms apart`);
  }
  assert.equal(server.tooFast, 0);
}

function assertNoSecret(where, text) {
  assert.ok(!text.includes(PASSWORD), `${where} holds the password`);
  const basic = Buffer.from(`${USER}:${PASSWORD}`).toString('base64');
  assert.ok(!text.includes(basic), `${where} holds the Authorization header`);
}

test('without a password, the status asks for it and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { host: HOST, password: '' } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).fr, /mot de passe/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /password/);
  assert.equal(server.requests.length, 0);
});

test('a URL with credentials pasted in the address is refused, never requested nor echoed', async (t) => {
  const pasted = `http://${USER}:${PASSWORD}@${HOST}/`;
  const { gladys, server, logs } = await setup(t, {
    config: { host: pasted, username: USER, password: PASSWORD },
  });
  assert.equal(server.requests.length, 0);
  assert.match(message(gladys).en, /holds a path or credentials/);
  assertNoSecret('status', JSON.stringify(gladys.fake.connectionStatuses));
  assertNoSecret('logs', logs.join('\n'));
});

test('start: the node list, then the node 75 s later; devices, states, connected', async (t) => {
  const { gladys, server, store, logs, advance, createAll } = await setup(t);
  // The node list first (nothing configured), nothing else yet.
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].path, '/INCLUDE/can_nodes.cgi?_=1');
  assert.equal(server.requests[0].hostname, HOST);
  assert.equal(server.requests[0].port, 80);
  assert.match(message(gladys).en, /Reading the C\.M\.I\./);
  await advance(GAP - 10 * SECOND);
  assert.equal(server.requests.length, 1, 'never before 75 s');
  await advance(15 * SECOND);
  assert.equal(server.requests.length, 2);
  // Type unknown: the default parameters of the reference.
  assert.equal(server.requests[1].path, '/INCLUDE/api.cgi?jsonnode=1&jsonparam=I,O');
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [dev(1)],
  );
  const device = gladys.fake.discoveredDevices[0];
  assert.equal(device.name, 'UVR16x2 (nœud 1)');
  const features = Object.fromEntries(
    device.features.map((f) => [f.external_id.split(':').at(-1), f]),
  );
  assert.equal(features['in-1'].category, 'temperature-sensor');
  assert.equal(features['in-1'].type, 'probe');
  assert.equal(features['in-1'].unit, 'celsius');
  assert.equal(features['in-1'].name, 'Entrée 1');
  assert.equal(features['in-3'].name, 'Entrée 3 (l/h)');
  assert.equal(features['in-3'].unit, undefined);
  assert.equal(features['in-4'].type, 'binary');
  assert.equal(features['out-3'].name, 'Sortie 3 (%)');
  assert.ok(device.features.every((f) => f.read_only === true));
  await createAll();
  await advance(2 * SECOND);
  assert.equal(last(gladys, 1, 'in-1'), 61.4);
  assert.equal(last(gladys, 1, 'in-2'), -3.2);
  assert.equal(last(gladys, 1, 'in-4'), 1);
  assert.equal(last(gladys, 1, 'out-1'), 1);
  assert.equal(last(gladys, 1, 'out-2'), 0, 'a digital output given as State');
  assert.equal(last(gladys, 1, 'out-3'), 70);
  assert.match(message(gladys).fr, /Connecté : 1\/1 nœud lu/);
  assert.equal(badgeOf(gladys, 1).transport, 'local');
  // The type learnt: the next cycle asks for the DL bus too.
  await advance(5 * MINUTE);
  assert.equal(server.requests.at(-1).path, '/INCLUDE/api.cgi?jsonnode=1&jsonparam=I,O,D');
  assert.deepEqual(store.data.types, { 1: '87' });
  assert.deepEqual(store.data.nodes.ids, [1]);
  assert.equal(store.data.key, cmiKey(HOST, 80));
  assertSpaced(server);
  assertNoSecret('logs', logs.join('\n'));
  assertNoSecret('requests to Gladys', JSON.stringify(gladys.fake.requests));
  assertNoSecret('/data', JSON.stringify(store.data));
});

test('one request per minute, strictly: several nodes, split reads, test button, Discovery', async (t) => {
  const server = fakeCmi({ nodes: { 1: '87', 2: '8D', 3: '80' } });
  const store = memoryStore({
    lastRequestAt: null,
    key: cmiKey(HOST, 80),
    types: { 1: '87', 2: '8D', 3: '80' },
  });
  const { gladys, advance } = await setup(t, {
    server,
    store,
    config: { ...CONFIG, nodes: '1, 2, 3', channels: 'all', poll_interval: 120 },
  });
  for (let i = 0; i < 40; i += 1) {
    await advance(20 * SECOND);
    // Pressing the button and asking a scan whenever possible never breaks the limit.
    await gladys.fake.action(ACTIONS.TEST_CONNECTION);
    await gladys.fake.scanRequest();
    await settle();
  }
  assertSpaced(server);
  const paths = server.requests.map((r) => r.path);
  // The CAN-BC2 asks 8 parameters: two requests, 7 then 1 (date and time never asked).
  assert.ok(paths.includes('/INCLUDE/api.cgi?jsonnode=2&jsonparam=M,AM,Ak,D,Sg,Ss,La'));
  assert.ok(paths.includes('/INCLUDE/api.cgi?jsonnode=2&jsonparam=Ld'));
  assert.ok(paths.includes('/INCLUDE/api.cgi?jsonnode=1&jsonparam=I,O,D,Sg,Ss,La,Ld'));
  assert.ok(paths.includes('/INCLUDE/api.cgi?jsonnode=3&jsonparam=I,O,Na,Nd'));
  assert.ok(!paths.some((p) => p.includes('can_nodes')), 'nodes configured: no list');
  assert.ok(server.requests.length >= 9);
});

test('a restart never sends a request before 75 s after the last one (kept in /data)', async (t) => {
  const store = memoryStore({ lastRequestAt: NOW - 30 * SECOND, key: '', types: {} });
  const { server, advance } = await setup(t, { store });
  assert.equal(server.requests.length, 0);
  await advance(40 * SECOND);
  assert.equal(server.requests.length, 0);
  await advance(10 * SECOND);
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].at, NOW + 45 * SECOND);
  // Kept BEFORE the request left.
  assert.equal(store.data.lastRequestAt, NOW + 45 * SECOND);
});

test('refused credentials stop the reads, spaced new tries, kept across a restart, lifted by new ones', async (t) => {
  const server = fakeCmi();
  const store = memoryStore();
  const wrong = { ...CONFIG, password: 'wrong' };
  const { gladys, advance, app } = await setup(t, { server, store, config: wrong });
  assert.equal(server.requests.length, 1);
  assert.match(message(gladys).en, /refused the user name or the password/);
  assert.ok(store.data.block);
  await advance(9 * MINUTE);
  assert.equal(server.requests.length, 1);
  await advance(2 * MINUTE);
  assert.equal(server.requests.length, 2, 'a new try after 10 min');
  await advance(55 * MINUTE);
  assert.equal(server.requests.length, 2);
  await advance(10 * MINUTE);
  assert.equal(server.requests.length, 3, 'then after 1 h');
  // A restart keeps the stop.
  app.stop();
  const again = await setup(t, { server, store, config: wrong, mockTimers: false });
  assert.equal(server.requests.length, 3);
  assert.match(message(again.gladys).en, /refused the user name or the password/);
  // New credentials lift it at once (the last request is 6 min old).
  await again.gladys.fake.configUpdated({ ...CONFIG });
  await settle();
  assert.equal(server.requests.length, 4);
  assert.equal(store.data.block, null);
  await again.advance(GAP + SECOND);
  assert.equal(server.requests.length, 5);
  assert.match(message(again.gladys).en, /Connected: 1\/1 node read/);
  assertSpaced(server);
});

test('status code 4: a pause of 5 min for every path, kept in /data', async (t) => {
  const server = fakeCmi();
  server.queue.push(answer({ code: 4, params: [] }));
  const store = memoryStore();
  const { gladys, advance } = await setup(t, { server, store, config: { ...CONFIG, nodes: '1' } });
  assert.equal(server.requests.length, 1);
  assert.match(message(gladys).en, /one per minute at most/);
  assert.equal(store.data.pause.kind, 'rate');
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /Pause of/);
  await advance(4 * MINUTE + 50 * SECOND);
  assert.equal(server.requests.length, 1);
  await advance(15 * SECOND);
  assert.equal(server.requests.length, 2);
  assertSpaced(server);
});

test('a node the C.M.I. cannot read is marked, the others go on', async (t) => {
  const server = fakeCmi({ nodes: { 1: '87', 2: '87' } });
  const { gladys, advance, createAll } = await setup(t, {
    server,
    config: { ...CONFIG, nodes: '1,2' },
  });
  await advance(GAP + SECOND);
  await createAll();
  // Node 2 busy at the next cycle.
  await advance(5 * MINUTE);
  server.queue.push(answer({ code: 7, params: [] }));
  await advance(5 * MINUTE);
  assert.match(
    message(gladys).fr,
    /Connecté : 1\/2 nœuds lu .*Non lus : nœud 1 \(bus CAN occupé\)/,
  );
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const badges = [badgeOf(gladys, 1), badgeOf(gladys, 2)];
  assert.ok(badges.some((b) => b.transport === 'unreachable' && b.degraded));
  assert.ok(badges.some((b) => b.transport === 'local'));
  assertSpaced(server);
});

test('read only: a command is refused and nothing is sent', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { ...CONFIG, nodes: '1' } });
  await advance(SECOND);
  const device = gladys.fake.discoveredDevices[0];
  const before = server.requests.length;
  const ack = await gladys.fake.setValue(device, device.features[0], 1);
  assert.equal(ack.success, false);
  assert.match(JSON.stringify(ack), /lecture seule|read only/);
  assert.equal(server.requests.length, before);
});

test('the test button waits for the limit, then sends one request', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: { ...CONFIG, nodes: '1' } });
  assert.equal(server.requests.length, 1);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /next request possible in 75 s/);
  assert.equal(server.requests.length, 1);
  await advance(GAP + SECOND);
  assert.equal(server.requests.length, 1, 'the cycle interval (5 min) is not over');
  const second = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.requests.length, 2);
  assert.match(second.data.message.en, /Connected: 1\/1 node read/);
  assertSpaced(server);
});

test('network errors back off, never faster than the interval', async (t) => {
  const server = fakeCmi();
  server.failNetwork();
  const { gladys, advance } = await setup(t, { server, config: { ...CONFIG, nodes: '1' } });
  assert.match(message(gladys).en, /cannot be reached/);
  await advance(4 * MINUTE + 50 * SECOND);
  assert.equal(server.requests.length, 1);
  await advance(15 * SECOND);
  assert.equal(server.requests.length, 2);
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a reconnection to Gladys resends the status and the Discovery list, keeps the pause', async (t) => {
  const server = fakeCmi();
  const { gladys, app, advance } = await setup(t, { server, config: { ...CONFIG, nodes: '1' } });
  await advance(SECOND);
  server.queue.push(answer({ code: 4, params: [] }));
  await advance(5 * MINUTE + 10 * SECOND);
  assert.equal(app.pauseKind, 'rate');
  const statuses = gladys.fake.connectionStatuses.length;
  const published = gladys.fake.discoveredDevices;
  await app.connected(CONFIG && { ...CONFIG, nodes: '1' });
  assert.ok(gladys.fake.connectionStatuses.length > statuses, 'status sent again');
  assert.deepEqual(gladys.fake.discoveredDevices, published);
  assert.equal(app.pauseKind, 'rate');
});

test('a created device keeps every feature; a channel whose unit changed gets no value', async (t) => {
  const server = fakeCmi();
  const { gladys, app, advance, createAll } = await setup(t, {
    server,
    config: { ...CONFIG, nodes: '1' },
  });
  await createAll();
  await advance(SECOND);
  // The controller changed: input 1 is now a %, input 3 is gone.
  const sections = {
    Inputs: [
      { Number: 1, AD: 'A', Value: { Value: 55, Unit: '8' } },
      { Number: 2, AD: 'A', Value: { Value: 4.5, Unit: '1' } },
    ],
  };
  server.queue.push({ ...answer({ params: [] }), Data: sections, Header: { Device: '87' } });
  await advance(5 * MINUTE + SECOND);
  await advance(2 * SECOND);
  const device = gladys.fake.discoveredDevices.find((d) => d.external_id === dev(1));
  const roles = device.features.map((f) => f.external_id.split(':').at(-1));
  for (const role of ['in-1', 'in-2', 'in-3', 'in-4', 'out-1', 'out-2', 'out-3']) {
    assert.ok(roles.includes(role), `${role} lost`);
  }
  const in1 = device.features.find((f) => f.external_id.endsWith(':in-1'));
  assert.equal(in1.category, 'temperature-sensor', 'the shape it was created with');
  assert.equal(last(gladys, 1, 'in-1'), 61.4, 'no % sent into a temperature');
  assert.equal(last(gladys, 1, 'in-2'), 4.5);
  assert.ok(app.nodeData.get(1));
});

// --- Review 1 ---------------------------------------------------------------

test('B1: a UVR65 (8E) and a CAN-MTx2 (8C) use the default parameters, the polling goes on', async (t) => {
  const server = fakeCmi({ nodes: { 1: '87', 4: '8C', 5: '8E' } });
  const { gladys, app, advance } = await setup(t, {
    server,
    config: { ...CONFIG, nodes: '1,4,5' },
  });
  await advance(3 * GAP);
  const before = server.requests.length;
  await advance(60 * MINUTE);
  assert.ok(server.requests.length >= before + 10, 'still polling after 1 h');
  assert.ok(app.timer !== undefined, 'a timer is armed');
  const paths = server.requests.map((r) => r.path);
  assert.ok(paths.includes('/INCLUDE/api.cgi?jsonnode=4&jsonparam=I,O'));
  assert.ok(paths.includes('/INCLUDE/api.cgi?jsonnode=5&jsonparam=I,O'));
  assert.match(message(gladys).en, /Connected: 3\/3 nodes read/);
  assertSpaced(server);
});

test('B1: a type 8E kept in /data never makes a restart fail', async (t) => {
  const store = memoryStore({
    lastRequestAt: NOW - 10 * MINUTE,
    key: cmiKey(HOST, 80),
    types: { 5: '8E' },
  });
  const logs = [];
  const server = fakeCmi({ nodes: { 5: '8E' } });
  const { app } = await setup(t, { server, store, logs, config: { ...CONFIG, nodes: '5' } });
  assert.equal(server.requests.length, 1);
  assert.equal(server.requests[0].path, '/INCLUDE/api.cgi?jsonnode=5&jsonparam=I,O');
  assert.ok(app.timer !== undefined);
  assert.ok(!logs.some((l) => /TypeError|failed/.test(l)), logs.join('\n'));
});

test('B1: an internal error never leaves the integration without a timer', async (t) => {
  const server = fakeCmi();
  const logs = [];
  const { app, advance, gladys } = await setup(t, {
    server,
    logs,
    config: { ...CONFIG, nodes: '1' },
  });
  assert.equal(server.requests.length, 1);
  // A bug outside the request handling (the cycle planning throws once).
  const startCycle = app.startCycle.bind(app);
  app.startCycle = () => {
    app.startCycle = startCycle;
    throw new TypeError('boom');
  };
  await advance(5 * MINUTE + SECOND);
  assert.equal(server.requests.length, 1);
  assert.ok(logs.some((l) => /refresh failed: boom/.test(l)));
  assert.ok(app.timer !== undefined, 'a timer is armed after the error');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  // A backoff never under the interval (5 min), then the reads go on.
  await advance(4 * MINUTE);
  assert.equal(server.requests.length, 1);
  await advance(2 * MINUTE);
  assert.equal(server.requests.length, 2);
  assert.match(message(gladys).en, /Connected: 1\/1 node read/);
  assertSpaced(server);
});

test('I1: a restart after a slow answer counts the 75 s from its end', async (t) => {
  const server = fakeCmi();
  server.delay = 18 * SECOND;
  // The previous request ended 70 s ago: the first one leaves 5 s after the start.
  const store = memoryStore({
    lastRequestAt: NOW - 70 * SECOND,
    key: cmiKey(HOST, 80),
    types: { 1: '87' },
  });
  const first = await setup(t, { server, store, config: { ...CONFIG, nodes: '1' } });
  assert.equal(server.requests.length, 0);
  await first.advance(5 * SECOND, SECOND);
  assert.equal(server.requests.length, 1);
  // Before it leaves, the latest possible end is kept.
  assert.equal(store.data.lastRequestAt, NOW + 5 * SECOND + TIMINGS.requestTimeout);
  await first.advance(18 * SECOND, SECOND);
  assert.equal(server.requests[0].end, NOW + 23 * SECOND);
  assert.equal(store.data.lastRequestAt, NOW + 23 * SECOND, 'then its real end');
  first.app.stop();
  server.delay = 0;
  const again = await setup(t, {
    server,
    store,
    config: { ...CONFIG, nodes: '1' },
    mockTimers: false,
  });
  assert.equal(server.requests.length, 1);
  await again.advance(GAP - 2 * SECOND, SECOND);
  assert.equal(server.requests.length, 1, 'never 75 s from the start only');
  await again.advance(3 * SECOND, SECOND);
  assert.equal(server.requests.length, 2);
  assert.ok(server.requests[1].at - server.requests[0].end >= GAP);
  assertSpaced(server);
});

test('M1: a restart during a 429 pause after successful reads still shows connected', async (t) => {
  const store = memoryStore({
    lastRequestAt: NOW - 2 * MINUTE,
    key: cmiKey(HOST, 80),
    pause: { kind: 'rate', until: NOW + 15 * MINUTE, failures: 2 },
    types: { 1: '87' },
    read: true,
  });
  const { gladys, server } = await setup(t, { store, config: { ...CONFIG, nodes: '1' } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /Pause of 15 min/);
});

test('M2: /data not writable: the first request waits 75 s, the failure is logged once', async (t) => {
  const store = memoryStore();
  store.save = async () => {
    throw new Error('EROFS');
  };
  const logs = [];
  const { server, advance } = await setup(t, { store, logs, config: { ...CONFIG, nodes: '1' } });
  assert.equal(server.requests.length, 0);
  await advance(GAP - 5 * SECOND);
  assert.equal(server.requests.length, 0);
  await advance(10 * SECOND);
  assert.equal(server.requests.length, 1);
  await advance(10 * MINUTE);
  assert.equal(logs.filter((l) => /Saving the state to \/data failed/.test(l)).length, 1);
  assertSpaced(server);
});

test('M2: /data unreadable: the first request waits 75 s', async (t) => {
  const store = memoryStore();
  store.load = async () => {
    throw new SyntaxError('broken');
  };
  const { server, advance } = await setup(t, { store, config: { ...CONFIG, nodes: '1' } });
  assert.equal(server.requests.length, 0);
  await advance(GAP + SECOND);
  assert.equal(server.requests.length, 1);
});

test('M3: the wall clock set back 1 h: the reads go on, one gap at most', async (t) => {
  const server = fakeCmi();
  const clock = { offset: 0 };
  const { advance } = await setup(t, {
    server,
    clock,
    config: { ...CONFIG, nodes: '1', poll_interval: 120 },
  });
  assert.equal(server.requests.length, 1);
  await advance(10 * SECOND);
  clock.offset = -60 * MINUTE;
  await advance(30 * MINUTE, 10 * SECOND);
  // A cycle every 120 s (the gate is 75 s): about 15 in 30 min, none lost to the jump.
  assert.ok(server.requests.length - 1 >= 13, `${server.requests.length - 1} requests in 30 min`);
  assertSpaced(server);
});
