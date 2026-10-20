import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, cmiKey, normalizeConfig, parseAddress, parseNodeList } from '../src/config.js';

test('the address: IP or host name, optional port and http://, nothing else', () => {
  assert.deepEqual(parseAddress('192.168.1.60'), { host: '192.168.1.60', port: 80 });
  assert.deepEqual(parseAddress(' http://CMI.local:8080/ '), { host: 'cmi.local', port: 8080 });
  assert.deepEqual(parseAddress('[fe80::1]:81'), { host: 'fe80::1', port: 81 });
  assert.deepEqual(parseAddress('fe80::1'), { host: 'fe80::1', port: 80 });
  assert.deepEqual(parseAddress(''), {});
  assert.deepEqual(parseAddress('http://admin:secret@192.168.1.60'), { error: 'path' });
  assert.deepEqual(parseAddress('192.168.1.60/INCLUDE/api.cgi'), { error: 'path' });
  assert.deepEqual(parseAddress('https://192.168.1.60'), { error: 'https' });
  assert.deepEqual(parseAddress('192.168.1.60:0'), { error: 'invalid' });
  assert.deepEqual(parseAddress('not a host!'), { error: 'path' });
  assert.deepEqual(parseAddress('bad_host'), { error: 'invalid' });
});

test('the CAN nodes: 1 to 62, 16 at most, empty means the list of the C.M.I.', () => {
  assert.deepEqual(parseNodeList(''), { nodes: [] });
  assert.deepEqual(parseNodeList('1, 2;45 2'), { nodes: [1, 2, 45] });
  assert.deepEqual(parseNodeList('0'), { error: 'nodes' });
  assert.deepEqual(parseNodeList('63'), { error: 'nodes' });
  assert.deepEqual(parseNodeList('1,a'), { error: 'nodes' });
  assert.deepEqual(parseNodeList(Array.from({ length: 17 }, (_, i) => i + 1).join(',')), {
    error: 'nodes',
  });
});

test('normalized configuration: defaults, bounds, key without the account', () => {
  const config = normalizeConfig({ host: '192.168.1.60', password: ' p ' });
  assert.equal(config.username, DEFAULTS.username);
  assert.equal(config.password, ' p ', 'kept as typed');
  assert.equal(config.channels, 'main');
  assert.equal(config.pollInterval, 300);
  assert.equal(config.language, 'fr');
  assert.equal(normalizeConfig({ poll_interval: 10 }).pollInterval, 120);
  assert.equal(normalizeConfig({ poll_interval: 99999 }).pollInterval, 3600);
  assert.equal(normalizeConfig({ channels: 'evil' }).channels, 'main');
  assert.equal(normalizeConfig({ language: 'EN' }).language, 'en');
  assert.equal(config.key, cmiKey('192.168.1.60', 80));
  assert.equal(normalizeConfig({}).key, '');
  assert.notEqual(
    normalizeConfig({ host: '192.168.1.60', password: 'a' }).key,
    normalizeConfig({ host: '192.168.1.61', password: 'a' }).key,
  );
  assert.equal(
    normalizeConfig({ host: '192.168.1.60', password: 'a' }).key,
    normalizeConfig({ host: '192.168.1.60', password: 'b' }).key,
  );
});
