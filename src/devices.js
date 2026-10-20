// -----------------------------------------------------------------------------
// The answers of the C.M.I. -> Gladys devices, and their states (pure).
//
// One Gladys device per CAN node, `ext:<selector>:cmi:node<id>`: one
// integration reads one C.M.I., the node id is unique on its CAN bus and does
// not change with the IP address. One feature per channel of the answer,
// keyed `<section>-<number>` (`in-1`, `out-3`, `dl-2`, `la-12`…): those keys
// are published forever, never rename them. A device already created keeps
// all its features when it is published again, with the shape it was created
// with (Gladys freezes the category, the type and the unit); a channel whose
// shape changed since (its unit changed on the controller) gets no value.
//
// Read only: every feature is `read_only`, no switch, no setpoint. The JSON
// API gives no channel name, only a number and a unit code. Units are only
// those the core lists for the category (DEVICE_FEATURE_UNITS_BY_CATEGORY);
// the others (K, W/m², l/h, kW, kWh, V, A, %…) have no category: no unit, the
// unit in the feature name. Energy and power stay simple sensors: the C.M.I.
// does not say whether a kWh is electrical or thermal (a heat meter), and the
// core would count it as electricity.
//
// Temperatures are `temperature-sensor/probe`: a collector, tank or flow
// temperature must not enter the room averages.
//
// Ported in part from DeerMaximum/ta-cmi 3.7.1 (MIT), changed (the unit
// codes, the channel types): see THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DEVICES, GLADYS, LIMITS, SECTIONS } from './constants.js';
import { NODE_NAME, SECTION_NAMES, both, word } from './i18n.js';

// --- Feature shapes ----------------------------------------------------------

const BIG = LIMITS.maxValue;

const shape = (category, type, unit, min = -BIG, max = BIG) =>
  unit === undefined ? { category, type, min, max } : { category, type, unit, min, max };

const decimal = shape(C.UNKNOWN, TYPES.SENSOR.DECIMAL);
const binary = shape(C.UNKNOWN, TYPES.SENSOR.BINARY, undefined, 0, 1);

/**
 * Unit codes of the C.M.I. (reference const.py UNITS_EN / UNITS_DE): the
 * feature shape when the core has a category listing the unit, and the label
 * put in the name otherwise.
 */
export const UNITS = {
  0: { label: '' },
  1: {
    feature: shape(C.TEMPERATURE_SENSOR, TYPES.TEMPERATURE_SENSOR.PROBE, U.CELSIUS, -100, 1000),
  },
  2: { label: 'W/m²' },
  3: { label: 'l/h' },
  4: { feature: shape(C.DURATION, TYPES.DURATION.DECIMAL, U.SECONDS, 0) },
  5: { feature: shape(C.DURATION, TYPES.DURATION.DECIMAL, U.MINUTES, 0) },
  6: { label: 'l/imp' },
  7: { label: 'K' },
  8: { label: '%' },
  10: { label: 'kW' },
  11: { label: 'kWh' },
  12: { label: 'MWh' },
  13: { label: 'V' },
  14: { label: 'mA' },
  15: { feature: shape(C.DURATION, TYPES.DURATION.DECIMAL, U.HOURS, 0) },
  16: { feature: shape(C.DURATION, TYPES.DURATION.DECIMAL, U.DAYS, 0) },
  17: { label: 'imp' },
  18: { label: 'kΩ' },
  19: { feature: shape(C.VOLUME_SENSOR, TYPES.VOLUME_SENSOR.DECIMAL, U.LITER) },
  20: { feature: shape(C.SPEED_SENSOR, TYPES.SPEED_SENSOR.DECIMAL, U.KILOMETER_PER_HOUR) },
  21: { label: 'Hz' },
  22: { label: 'l/min' },
  23: { feature: shape(C.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, U.BAR) },
  24: { label: '' },
  25: { feature: shape(C.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, U.KM) },
  26: { feature: shape(C.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, U.M) },
  27: { feature: shape(C.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, U.MM) },
  28: { feature: shape(C.VOLUME_SENSOR, TYPES.VOLUME_SENSOR.DECIMAL, U.CUBIC_METER) },
  35: { label: 'l/d' },
  36: { feature: shape(C.SPEED_SENSOR, TYPES.SPEED_SENSOR.DECIMAL, U.METER_PER_SECOND) },
  37: { label: 'm³/min' },
  38: { label: 'm³/h' },
  39: { label: 'm³/d' },
  40: { label: 'mm/min' },
  41: {
    feature: shape(
      C.PRECIPITATION_SENSOR,
      TYPES.PRECIPITATION_SENSOR.DECIMAL,
      U.MILLIMETER_PER_HOUR,
    ),
  },
  42: {
    feature: shape(
      C.PRECIPITATION_SENSOR,
      TYPES.PRECIPITATION_SENSOR.DECIMAL,
      U.MILLIMETER_PER_DAY,
    ),
  },
  43: { binary: true },
  44: { binary: true },
  46: {
    feature: shape(C.TEMPERATURE_SENSOR, TYPES.TEMPERATURE_SENSOR.PROBE, U.CELSIUS, -100, 1000),
  },
  50: { feature: shape(C.CURRENCY, TYPES.CURRENCY.DECIMAL, U.EURO) },
  51: { feature: shape(C.CURRENCY, TYPES.CURRENCY.DECIMAL, U.DOLLAR) },
  52: { label: 'g/m³' },
  54: { label: '°' },
  56: { label: '°' },
  57: { feature: shape(C.DURATION, TYPES.DURATION.DECIMAL, U.SECONDS, 0) },
  59: { label: '%' },
  60: { label: both('time of day', 'heure') },
  63: { label: 'A' },
  65: { feature: shape(C.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, U.MILLIBAR) },
  66: { feature: shape(C.PRESSURE_SENSOR, TYPES.SENSOR.DECIMAL, U.PASCAL) },
  67: { feature: shape(C.CO2_SENSOR, TYPES.SENSOR.DECIMAL, U.PPM, 0) },
  69: { label: 'W' },
  70: { label: 't' },
  71: { label: 'kg' },
  72: { label: 'g' },
  73: { feature: shape(C.DISTANCE_SENSOR, TYPES.SENSOR.DECIMAL, U.CM) },
  74: { label: 'K' },
  75: { feature: shape(C.LIGHT_SENSOR, TYPES.SENSOR.DECIMAL, U.LUX, 0) },
  76: { label: 'Bq/m³' },
};

/** The unit entry of a code ('1', 1…), undefined when unknown. */
const unitOf = (code) => {
  const key = typeof code === 'number' ? String(code) : code;
  return typeof key === 'string' && /^\d{1,3}$/.test(key) && Object.hasOwn(UNITS, key)
    ? UNITS[key]
    : undefined;
};

// --- Ids ---------------------------------------------------------------------

const SECTION_CODES = Object.values(SECTIONS);

export const deviceIds = (gladys, node) => gladys.externalIds('cmi', `node${node}`);

/** The node of a device external id. */
export function parseDeviceId(externalId) {
  const match = /:cmi:node([1-9][0-9]?)$/.exec(String(externalId ?? ''));
  const node = match ? Number(match[1]) : undefined;
  return node >= LIMITS.nodeMin && node <= LIMITS.nodeMax ? node : undefined;
}

/** The node and the role of a feature external id. */
export function parseFeatureId(externalId) {
  const match = /:cmi:node([1-9][0-9]?):([a-z]{2,3})-([1-9][0-9]{0,2})$/.exec(
    String(externalId ?? ''),
  );
  if (!match || !SECTION_CODES.includes(match[2])) {
    return undefined;
  }
  return { node: Number(match[1]), role: `${match[2]}-${match[3]}` };
}

// --- Answers -----------------------------------------------------------------

/** A finite number within the bounds, rounded to 3 decimals; undefined otherwise. */
export function readNumber(raw) {
  if (typeof raw !== 'number' || !Number.isFinite(raw) || Math.abs(raw) > LIMITS.maxValue) {
    return undefined;
  }
  return Math.round(raw * 1000) / 1000;
}

/**
 * The channels of one answer (or of the two halves of a split read): `[{
 * section, number, digital, unit, value }]`, own keys only, bounded. `value`
 * is undefined when the answer holds no usable number.
 */
export function channelsOf(root) {
  const data =
    root !== null && typeof root === 'object' && Object.hasOwn(root, 'Data')
      ? root.Data
      : undefined;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return [];
  }
  const channels = [];
  for (const [name, section] of Object.entries(SECTIONS)) {
    const list = Object.hasOwn(data, name) ? data[name] : undefined;
    if (!Array.isArray(list)) {
      continue;
    }
    const seen = new Set();
    for (const entry of list.slice(0, LIMITS.channelsPerSection)) {
      const channel = channelOf(section, entry);
      if (channel && !seen.has(channel.number)) {
        seen.add(channel.number);
        channels.push(channel);
      }
    }
  }
  return channels;
}

const own = (object, key) =>
  object !== null && typeof object === 'object' && Object.hasOwn(object, key)
    ? object[key]
    : undefined;

function channelOf(section, entry) {
  const number = own(entry, 'Number');
  if (!Number.isInteger(number) || number < 1 || number > 999) {
    return undefined;
  }
  const ad = own(entry, 'AD');
  if (ad !== 'A' && ad !== 'D') {
    return undefined;
  }
  const value = own(entry, 'Value');
  const unitRaw = own(value, 'Unit');
  const unit =
    (typeof unitRaw === 'string' && /^\d{1,3}$/.test(unitRaw)) ||
    (Number.isInteger(unitRaw) && unitRaw >= 0 && unitRaw <= 999)
      ? String(unitRaw)
      : undefined;
  const digital = ad === 'D';
  let reading;
  if (digital) {
    // Digital outputs may give their state as `State` (on/off).
    const raw = typeof own(value, 'Value') === 'number' ? own(value, 'Value') : own(value, 'State');
    reading = raw === 0 || raw === 1 ? raw : undefined;
  } else {
    reading = readNumber(own(value, 'Value'));
  }
  return { section, number, digital, unit, value: reading };
}

/**
 * The device type of an answer (its header), undefined when unknown. A string
 * ("87", "8f") or an integer (87: a firmware may send the decimal-looking ids
 * as numbers).
 */
export function deviceTypeOf(root) {
  const device = own(own(root, 'Header'), 'Device');
  const id =
    typeof device === 'string'
      ? device.trim().toUpperCase()
      : Number.isInteger(device) && device >= 0 && device <= 99
        ? String(device)
        : undefined;
  return id !== undefined && Object.hasOwn(DEVICES, id) ? id : undefined;
}

// --- Devices -----------------------------------------------------------------

/** The role of a channel: `in-1`, `out-3`… */
export const roleOf = (channel) => `${channel.section}-${channel.number}`;

/** The feature shape of a channel. */
export function featureShape(channel) {
  if (channel.digital) {
    return binary;
  }
  const unit = unitOf(channel.unit);
  if (unit?.binary) {
    return binary;
  }
  return unit?.feature ?? decimal;
}

/** "Entrée 3", "Sortie 2 (%)", "Entrée DL 1 (kWh)". */
export function featureName(channel, language) {
  const base = `${word(SECTION_NAMES[channel.section], language)} ${channel.number}`;
  if (channel.digital) {
    return base;
  }
  const unit = unitOf(channel.unit);
  if (unit?.feature || unit?.binary) {
    return base;
  }
  const label = typeof unit?.label === 'object' ? word(unit.label, language) : unit?.label;
  return label ? `${base} (${label})` : base;
}

/** "UVR16x2 (nœud 1)". */
export function nodeName(node, type, language) {
  return word(NODE_NAME(type ? DEVICES[type] : 'TA', node), language);
}

const FEATURE_KEYS = ['category', 'type', 'unit', 'min', 'max'];

/** The shape of a feature created in Gladys, to compare with the current one. */
export const sameShape = (a, b) =>
  FEATURE_KEYS.every((key) => (a?.[key] ?? null) === (b?.[key] ?? null));

/**
 * The Gladys device of one node. `channels`: those of its last answer (empty
 * when not read yet); `created`: the device already created in Gladys, whose
 * features are all kept, with their own shape.
 */
export function buildDevice(gladys, { node, type, channels }, language, created) {
  const ids = deviceIds(gladys, node);
  const features = [];
  const roles = new Set();
  for (const feature of created?.features ?? []) {
    const parsed = parseFeatureId(feature.external_id);
    if (parsed?.node !== node || roles.has(parsed.role)) {
      continue;
    }
    roles.add(parsed.role);
    features.push({
      name: typeof feature.name === 'string' ? feature.name : parsed.role,
      external_id: ids.feature(parsed.role),
      read_only: true,
      has_feedback: false,
      keep_history: feature.keep_history !== false,
      ...pick(feature),
    });
  }
  for (const channel of channels) {
    const role = roleOf(channel);
    if (roles.has(role) || features.length >= LIMITS.featuresPerDevice) {
      continue;
    }
    roles.add(role);
    features.push({
      name: featureName(channel, language),
      external_id: ids.feature(role),
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...featureShape(channel),
    });
  }
  return {
    name:
      typeof created?.name === 'string' && created.name !== ''
        ? created.name
        : nodeName(node, type, language),
    external_id: ids.device,
    features,
    params: [{ name: 'node', value: String(node) }],
  };
}

function pick(feature) {
  const out = {};
  for (const key of FEATURE_KEYS) {
    if (feature[key] !== undefined && feature[key] !== null) {
      out[key] = feature[key];
    }
  }
  return out;
}

/** The state of a channel: `{ role, state }`, or undefined when it has no usable value. */
export function stateOf(channel) {
  if (channel.value === undefined) {
    return undefined;
  }
  if (featureShape(channel) === binary) {
    if (channel.value !== 0 && channel.value !== 1) {
      return undefined;
    }
    return { role: roleOf(channel), state: channel.value === 1 ? GLADYS.ON : GLADYS.OFF };
  }
  return { role: roleOf(channel), state: channel.value };
}
