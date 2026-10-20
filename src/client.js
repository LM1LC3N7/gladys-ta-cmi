// -----------------------------------------------------------------------------
// The client of the C.M.I. JSON API, and the gate of its rate limit.
//
// The C.M.I. accepts one request per minute. This client sends one request at
// a time and never before `nextAllowedAt()`: 75 s after the END of the
// previous request (answer, error or timeout), whatever asks for it (polling,
// test button, Discovery). It never waits by itself: a request asked too soon
// is refused (`too_soon`, nothing sent), the app schedules the next one.
// `onRequest` is awaited BEFORE the request leaves with the latest time it can
// end (start + timeout), then after it with its real end: the app keeps it in
// /data, so a restart (even during the request) never sends early.
//
// Basic authentication: the header is built here only, never logged nor put
// in an error.
//
// Ported in part from DeerMaximum/ta-cmi 3.7.1 (MIT), changed: see
// THIRD_PARTY_NOTICES.md.
// -----------------------------------------------------------------------------

import { API, LIMITS, STATUS, TIMINGS } from './constants.js';
import { CmiError, httpGet, parseRetryAfter } from './http.js';

const NODE_MESSAGES = {
  [STATUS.NODE_ERROR]: 'node not available',
  [STATUS.FAIL]: 'CAN request failed, or parameter not available for this device',
  [STATUS.SYNTAX_ERROR]: 'request refused (syntax)',
  [STATUS.DEVICE_NOT_SUPPORTED]: 'device not supported by the JSON API',
  [STATUS.TOO_FEW_ARGUMENTS]: 'request refused (arguments)',
  [STATUS.CAN_BUSY]: 'CAN bus busy',
};

export class CmiClient {
  constructor({
    transport = httpGet,
    now = Date.now,
    onRequest = async () => {},
    gap = TIMINGS.requestGap,
  } = {}) {
    this.transport = transport;
    this.now = now;
    this.onRequest = onRequest;
    this.gap = gap;
    this.host = '';
    this.port = 0;
    this.username = '';
    this.password = '';
    /** The last request: its start, then its end. -Infinity: none known. */
    this.lastAt = -Infinity;
    this.busy = false;
  }

  configure({ host, port, username, password }) {
    this.host = host ?? '';
    this.port = port ?? 0;
    this.username = username ?? '';
    this.password = password ?? '';
  }

  get configured() {
    return this.host !== '' && this.port > 0 && this.username !== '' && this.password !== '';
  }

  /** A time kept in /data (a request before a restart): the gate counts from it. */
  remember(at) {
    if (Number.isFinite(at)) {
      // Never in the future (a clock jump or a hand-edited file never blocks for good).
      this.lastAt = Math.max(this.lastAt, Math.min(at, this.now()));
    }
  }

  /** When the next request may leave. */
  nextAllowedAt() {
    // The wall clock went back: the last request is "now" at most, so the
    // gate never holds longer than one gap.
    if (!this.busy && this.lastAt > this.now()) {
      this.lastAt = this.now();
    }
    return this.lastAt + this.gap;
  }

  /** Milliseconds before the next request may leave (0: now). */
  wait() {
    return this.busy ? this.gap : Math.max(0, this.nextAllowedAt() - this.now());
  }

  /** The CAN node ids behind the C.M.I. (reference get_devices_ids). */
  async listNodes() {
    const body = await this.get(API.nodes, LIMITS.nodesBytes);
    return parseNodes(body.toString('latin1'));
  }

  /** The data of one node for some parameters: the answer, status code 0 only. */
  async readNode(node, params) {
    const body = await this.get(API.data(node, params.join(',')), LIMITS.responseBytes);
    return parseData(body);
  }

  async get(path, maxBytes) {
    if (!this.configured) {
      throw new CmiError('no_config', 'no address, user or password');
    }
    if (this.wait() > 0) {
      throw new CmiError('too_soon', 'the previous request is too recent');
    }
    this.busy = true;
    try {
      const start = this.now();
      this.lastAt = start;
      // Kept before the request leaves: the latest time it can end, so a
      // crash or a restart during the request still counts from its end.
      await this.onRequest(start + TIMINGS.requestTimeout);
      const { status, headers, body } = await this.transport(
        {
          hostname: this.host,
          port: this.port,
          path,
          headers: { Authorization: this.authorization() },
        },
        { timeout: TIMINGS.requestTimeout, maxBytes },
      );
      if (status === 200) {
        return body;
      }
      if (status === 401 || status === 403) {
        throw new CmiError('refused', 'the C.M.I. refused the user or the password', { status });
      }
      if (status === 429) {
        throw new CmiError('rate_limited', 'too many requests', {
          status,
          retryAfter: parseRetryAfter(headers?.['retry-after'], this.now()),
        });
      }
      if (status >= 500 && status < 600) {
        throw new CmiError('unavailable', 'the C.M.I. answered an error', { status });
      }
      throw new CmiError('http', 'unexpected answer', { status });
    } finally {
      // The gap counts from the end of the request, whatever ended it.
      this.lastAt = Math.max(this.lastAt, this.now());
      // Then its real end, kept too (a restart counts the gap from it).
      await this.onRequest(this.lastAt);
      this.busy = false;
    }
  }

  /** Never logged. */
  authorization() {
    return `Basic ${Buffer.from(`${this.username}:${this.password}`, 'utf8').toString('base64')}`;
  }
}

/** "1;2;45;" -> [1, 2, 45]: valid CAN node ids only, without duplicates, bounded. */
export function parseNodes(text) {
  if (!/^[\d;\s]*$/.test(text)) {
    throw new CmiError('bad_response', 'the node list is not the expected answer');
  }
  const ids = [];
  for (const part of text.split(';')) {
    const trimmed = part.trim();
    if (!/^\d{1,3}$/.test(trimmed)) {
      continue;
    }
    const id = Number(trimmed);
    if (id >= LIMITS.nodeMin && id <= LIMITS.nodeMax && !ids.includes(id)) {
      ids.push(id);
    }
    if (ids.length >= LIMITS.nodes) {
      break;
    }
  }
  return ids;
}

/** The answer of api.cgi: the parsed object when its status code is 0, a CmiError otherwise. */
export function parseData(body) {
  const text = Buffer.from(body ?? []).toString('utf8');
  if (text.trim() === '') {
    throw new CmiError('empty', 'empty answer');
  }
  let root;
  try {
    root = JSON.parse(text);
  } catch {
    throw new CmiError('bad_response', 'the answer is not JSON');
  }
  if (root === null || typeof root !== 'object' || Array.isArray(root)) {
    throw new CmiError('bad_response', 'the answer is not the expected JSON');
  }
  const code = Object.hasOwn(root, 'Status code') ? root['Status code'] : undefined;
  if (!Number.isInteger(code)) {
    throw new CmiError('bad_response', 'the answer has no status code');
  }
  if (code === STATUS.OK) {
    return root;
  }
  if (code === STATUS.TOO_MANY_REQUESTS) {
    throw new CmiError('rate_limited', 'only one request per minute is permitted', { code });
  }
  throw new CmiError('node', NODE_MESSAGES[code] ?? 'unknown error', {
    code: code >= 0 && code <= 99 ? code : undefined,
  });
}
