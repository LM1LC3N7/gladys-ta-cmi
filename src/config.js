// -----------------------------------------------------------------------------
// The configuration of the manifest `config_schema`, normalized.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { API, CHANNEL_SETS, LIMITS, POLL_INTERVAL } from './constants.js';

/** Defaults, mirrored by the manifest (checked by test/manifest.test.js). */
export const DEFAULTS = {
  username: 'admin',
  channels: 'main',
  poll_interval: POLL_INTERVAL.default,
  language: 'fr',
};

export const LANGUAGES = ['fr', 'en'];
export const CHANNEL_SET_KEYS = Object.keys(CHANNEL_SETS);

const HOSTNAME =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

/**
 * The address typed by the user: `{ host, port }`, `{ error: 'path' }` when it
 * holds a path, a query or credentials (a pasted URL), `{ error: 'https' }`
 * for https (the C.M.I. JSON API is read over http on the local network),
 * `{ error: 'invalid' }` when it is no IP address nor host name, `{}` when
 * empty. "http://" and ":port" are accepted.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return {};
  }
  if (/^https:\/\//i.test(text)) {
    return { error: 'https' };
  }
  text = text.replace(/^http:\/\//i, '').replace(/\/$/, '');
  if (/[/?#@\s]/.test(text)) {
    return { error: 'path' };
  }
  let host = text;
  let port;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(text);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2];
  } else if (isIP(text) !== 6) {
    const withPort = /^([^:]+):(\d{1,5})$/.exec(text);
    if (withPort) {
      host = withPort[1];
      port = withPort[2];
    } else if (text.includes(':')) {
      return { error: 'invalid' };
    }
  }
  if (isIP(host) === 0 && !HOSTNAME.test(host)) {
    return { error: 'invalid' };
  }
  const portNumber = port === undefined ? API.defaultPort : Number(port);
  if (portNumber < 1 || portNumber > 65535) {
    return { error: 'invalid' };
  }
  return { host: host.toLowerCase(), port: portNumber };
}

/**
 * The CAN nodes typed by the user ("1, 2, 45"): `{ nodes: [ids] }` (empty:
 * read the list from the C.M.I.), `{ error: 'nodes' }` when a part is no node
 * id (1 to 62).
 */
export function parseNodeList(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') {
    return { nodes: [] };
  }
  if (text.length > 256) {
    return { error: 'nodes' };
  }
  const nodes = [];
  for (const part of text.split(/[,;\s]+/)) {
    if (part === '') {
      continue;
    }
    if (!/^\d{1,2}$/.test(part)) {
      return { error: 'nodes' };
    }
    const id = Number(part);
    if (id < LIMITS.nodeMin || id > LIMITS.nodeMax) {
      return { error: 'nodes' };
    }
    if (!nodes.includes(id)) {
      nodes.push(id);
    }
  }
  return nodes.length > LIMITS.nodes ? { error: 'nodes' } : { nodes };
}

/**
 * The key of a C.M.I. in /data: a hash of its address and port, never the
 * user name nor the password.
 */
export const cmiKey = (host, port) =>
  host
    ? createHash('sha256').update(`ta-cmi:${host}:${port}`, 'utf8').digest('hex').slice(0, 32)
    : '';

const number = (value) =>
  value === undefined || value === null || value === '' ? NaN : Number(value);

const clamp = (value, { min, max }, fallback) =>
  Number.isFinite(value) ? Math.round(Math.max(min, Math.min(max, value))) : fallback;

export function normalizeConfig(raw = {}) {
  const address = parseAddress(raw?.host);
  const nodes = parseNodeList(raw?.nodes);
  const username =
    typeof raw?.username === 'string' && raw.username.trim() !== ''
      ? raw.username.trim()
      : DEFAULTS.username;
  // Kept as typed: a password may start or end with a space.
  const password = typeof raw?.password === 'string' ? raw.password : '';
  const language = String(raw?.language ?? DEFAULTS.language)
    .trim()
    .toLowerCase();
  const channels = String(raw?.channels ?? DEFAULTS.channels).trim();
  return {
    host: address.host ?? '',
    port: address.port ?? API.defaultPort,
    addressError: address.error,
    username,
    password,
    nodes: nodes.nodes ?? [],
    nodesError: nodes.error,
    key: cmiKey(address.host, address.port ?? API.defaultPort),
    channels: CHANNEL_SET_KEYS.includes(channels) ? channels : DEFAULTS.channels,
    pollInterval: clamp(number(raw?.poll_interval), POLL_INTERVAL, DEFAULTS.poll_interval),
    language: LANGUAGES.includes(language) ? language : DEFAULTS.language,
  };
}
