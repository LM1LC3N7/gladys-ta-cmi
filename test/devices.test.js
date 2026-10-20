import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SECTIONS } from '../src/constants.js';
import {
  UNITS,
  buildDevice,
  channelsOf,
  deviceTypeOf,
  featureName,
  featureShape,
  parseDeviceId,
  parseFeatureId,
  sameShape,
  stateOf,
} from '../src/devices.js';
import { answer } from './fixtures/cmi.js';

/**
 * The units the core accepts per category (server/utils/constants.js,
 * DEVICE_FEATURE_UNITS_BY_CATEGORY), for the categories this integration uses.
 */
const CORE_UNITS = {
  'temperature-sensor': ['celsius', 'fahrenheit', 'kelvin'],
  duration: [
    'microseconds',
    'milliseconds',
    'seconds',
    'minutes',
    'hours',
    'days',
    'weeks',
    'months',
    'years',
  ],
  'volume-sensor': ['liter', 'milliliter', 'cubicmeter'],
  'speed-sensor': ['meter-per-second', 'kilometer-per-hour'],
  'pressure-sensor': ['pascal', 'hectopascal', 'kilopascal', 'bar', 'psi', 'milli-bar'],
  'distance-sensor': ['mm', 'cm', 'm', 'km', 'inch', 'feet', 'mile'],
  'precipitation-sensor': ['millimeter-per-hour', 'millimeter-per-day', 'milli-volt'],
  currency: ['euro', 'dollar', 'bitcoin', 'litecoin', 'ethereum', 'dogecoin', 'pound-sterling'],
  'co2-sensor': ['ppm'],
  'light-sensor': ['lux'],
};

test('every unit is one the core lists for its category', () => {
  for (const [code, entry] of Object.entries(UNITS)) {
    if (!entry.feature) {
      continue;
    }
    const { category, unit } = entry.feature;
    assert.ok(CORE_UNITS[category], `${code}: category ${category} not checked`);
    assert.ok(CORE_UNITS[category].includes(unit), `${code}: ${unit} not allowed in ${category}`);
  }
  // No energy-sensor, no index: a kWh of the C.M.I. may be thermal.
  assert.ok(!Object.values(UNITS).some((u) => u.feature?.category?.startsWith('energy')));
});

test('the section codes are frozen (external ids are forever)', () => {
  assert.deepEqual(Object.values(SECTIONS), [
    'in',
    'out',
    'dl',
    'sg',
    'ss',
    'sp',
    'na',
    'nd',
    'mb',
    'mo',
    'knx',
    'la',
    'ld',
  ]);
});

test('channels: own keys only, bounded, bad entries dropped, date and time ignored', () => {
  const root = answer({ params: ['I', 'O', 'Sd', 'St', 'La'] });
  const channels = channelsOf(root);
  assert.ok(channels.every((c) => ['in', 'out', 'la'].includes(c.section)));
  assert.equal(channels.find((c) => c.section === 'in' && c.number === 1).value, 61.4);
  const hostile = JSON.parse(
    '{"Data":{"Inputs":[{"Number":1,"AD":"A","Value":{"Value":1e300,"Unit":"1"}},{"Number":"2","AD":"A","Value":{"Value":1,"Unit":"1"}},{"Number":3,"AD":"X","Value":{"Value":1}},{"Number":4,"AD":"D","Value":{"Value":7,"Unit":"43"}},{"Number":4,"AD":"A","Value":{"Value":2,"Unit":"1"}},null,"x"],"__proto__":[{"Number":1}],"Outputs":{"Number":1}}}',
  );
  const parsed = channelsOf(hostile);
  assert.deepEqual(
    parsed.map((c) => [c.number, c.value]),
    [
      [1, undefined],
      [4, undefined],
    ],
  );
  assert.equal({}.Number, undefined);
  assert.deepEqual(channelsOf(null), []);
  assert.deepEqual(channelsOf({ Data: [] }), []);
  const many = {
    Data: {
      Inputs: Array.from({ length: 500 }, (_, i) => ({
        Number: i + 1,
        AD: 'A',
        Value: { Value: i, Unit: '0' },
      })),
    },
  };
  assert.equal(channelsOf(many).length, 128);
});

test('shapes and names', () => {
  const temp = { section: 'in', number: 1, digital: false, unit: '1', value: 20 };
  assert.deepEqual(featureShape(temp), {
    category: 'temperature-sensor',
    type: 'probe',
    unit: 'celsius',
    min: -100,
    max: 1000,
  });
  assert.equal(featureName(temp, 'en'), 'Input 1');
  const kwh = { section: 'la', number: 2, digital: false, unit: '11', value: 1 };
  assert.equal(featureShape(kwh).category, 'unknown');
  assert.equal(featureShape(kwh).unit, undefined);
  assert.equal(featureName(kwh, 'fr'), 'Journalisation analogique 2 (kWh)');
  const clock = { section: 'sg', number: 1, digital: false, unit: '60', value: 1 };
  assert.equal(featureName(clock, 'fr'), 'Valeur système (générale) 1 (heure)');
  const unknown = { section: 'dl', number: 3, digital: false, unit: '999', value: 1 };
  assert.equal(featureShape(unknown).category, 'unknown');
  assert.equal(featureName(unknown, 'en'), 'DL input 3');
  const relay = { section: 'out', number: 4, digital: true, unit: '43', value: 1 };
  assert.equal(featureShape(relay).type, 'binary');
  assert.deepEqual(stateOf(relay), { role: 'out-4', state: 1 });
  assert.equal(stateOf({ ...temp, value: undefined }), undefined);
  assert.ok(sameShape(featureShape(temp), { ...featureShape(temp), name: 'x' }));
  assert.ok(!sameShape(featureShape(temp), featureShape(kwh)));
});

test('ids: device and feature external ids parsed strictly', () => {
  assert.equal(parseDeviceId('ext:x:cmi:node5'), 5);
  assert.equal(parseDeviceId('ext:x:cmi:node63'), undefined);
  assert.equal(parseDeviceId('ext:x:cmi:node0'), undefined);
  assert.deepEqual(parseFeatureId('ext:x:cmi:node5:in-12'), { node: 5, role: 'in-12' });
  assert.equal(parseFeatureId('ext:x:cmi:node5:zz-1'), undefined);
  assert.equal(deviceTypeOf(answer({ device: '8f' })), '8F');
  assert.equal(deviceTypeOf(answer({ device: '99' })), undefined);
  // A numeric header (review M4).
  assert.equal(deviceTypeOf({ Header: { Device: 87 } }), '87');
  assert.equal(deviceTypeOf({ Header: { Device: 8.5 } }), undefined);
  assert.equal(deviceTypeOf({ Header: { Device: 999 } }), undefined);
});

test('a republished device keeps the features and the shapes it was created with', () => {
  const gladys = createFakeGladys({ config: {} });
  const channels = channelsOf(answer({ params: ['I'] }));
  const first = buildDevice(gladys, { node: 1, type: '87', channels }, 'fr');
  assert.equal(first.name, 'UVR16x2 (nœud 1)');
  assert.equal(first.external_id, 'ext:test-integration:cmi:node1');
  const created = { ...first, name: 'Chaufferie' };
  const changed = [{ section: 'in', number: 1, digital: false, unit: '8', value: 50 }];
  const again = buildDevice(gladys, { node: 1, type: '87', channels: changed }, 'en', created);
  assert.equal(again.name, 'Chaufferie');
  assert.deepEqual(
    again.features.map((f) => f.external_id),
    first.features.map((f) => f.external_id),
  );
  assert.equal(again.features[0].category, 'temperature-sensor');
  assert.equal(buildDevice(gladys, { node: 2, channels: [] }, 'en').name, 'TA (node 2)');
});
