// -----------------------------------------------------------------------------
// The only network access: one HTTP GET to the C.M.I., and the errors it ends
// with. The body read is bounded; the messages never hold the address, the
// user name nor the password (the Authorization header is built by the client
// and never logged).
// -----------------------------------------------------------------------------

import http from 'node:http';
import { LIMITS, TIMINGS } from './constants.js';

/**
 * A failed request. `kind`:
 * - `no_config`: no address, user or password (nothing sent);
 * - `refused`: the C.M.I. refused the user or the password (401, 403);
 * - `rate_limited`: status code 4 or HTTP 429, `retryAfter` in ms when given;
 * - `node`: the C.M.I. answered, but not for this node (status codes 1, 2, 3,
 *   5, 6, 7: `code`);
 * - `unavailable`: 5xx;
 * - `network`, `timeout`: no answer;
 * - `bad_response`, `size`, `empty`: not the expected answer;
 * - `http`: any other status.
 */
export class CmiError extends Error {
  constructor(kind, message, { status, retryAfter, code } = {}) {
    super(message);
    this.name = 'CmiError';
    this.kind = kind;
    this.status = status;
    this.retryAfter = retryAfter;
    this.code = code;
  }
}

const NETWORK_REASONS = {
  ECONNREFUSED: 'connection refused',
  ECONNRESET: 'connection reset',
  EHOSTUNREACH: 'host unreachable',
  ENETUNREACH: 'network unreachable',
  ENOTFOUND: 'unknown host name',
  EAI_AGAIN: 'host name not resolved',
  ETIMEDOUT: 'connection timed out',
  EPIPE: 'connection closed',
  HPE_INVALID_CONSTANT: 'not an HTTP answer',
};

/**
 * A socket error -> CmiError, from its code only: Node's own message holds the
 * address and the port.
 */
export function networkError(err) {
  if (err instanceof CmiError) {
    return err;
  }
  const code = typeof err?.code === 'string' && /^[A-Z_]{1,32}$/.test(err.code) ? err.code : '';
  return new CmiError('network', NETWORK_REASONS[code] ?? 'network error', {
    code: code || undefined,
  });
}

/** A short, secret-free reason for a log. */
export function errorReason(err) {
  if (err instanceof CmiError) {
    const details = [
      err.code !== undefined ? `code ${err.code}` : undefined,
      err.status ? `HTTP ${err.status}` : undefined,
    ].filter(Boolean);
    return details.length > 0 ? `${err.message} (${details.join(', ')})` : err.message;
  }
  return 'internal error';
}

/**
 * One GET; resolves `{ status, headers, body }` (body: a Buffer) whatever the
 * status. The promise settles once; the body read is bounded (a bigger answer
 * is an error, the socket is closed at once); the whole request is bounded in
 * time.
 */
export function httpGet(
  { hostname, port, path, headers = {} },
  { timeout = TIMINGS.requestTimeout, maxBytes = LIMITS.responseBytes } = {},
) {
  return new Promise((resolve, reject) => {
    let timer;
    let settled = false;
    let req;
    const settle = (fn, value) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        fn(value);
      }
    };
    try {
      req = http.get(
        {
          hostname,
          port,
          path,
          method: 'GET',
          headers: { Accept: 'application/json', Connection: 'close', ...headers },
          agent: false,
        },
        (res) => {
          const chunks = [];
          let size = 0;
          res.on('data', (chunk) => {
            size += chunk.length;
            if (size > maxBytes) {
              settle(reject, new CmiError('size', 'answer too large'));
              req.destroy();
              return;
            }
            chunks.push(chunk);
          });
          res.on('end', () =>
            settle(resolve, {
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
          res.on('error', (err) => settle(reject, networkError(err)));
          res.on('aborted', () => settle(reject, new CmiError('network', 'answer cut short')));
        },
      );
    } catch (err) {
      settle(reject, new CmiError('network', 'invalid address', { code: err?.code }));
      return;
    }
    timer = setTimeout(() => {
      settle(reject, new CmiError('timeout', `no answer within ${Math.round(timeout / 1000)} s`));
      req.destroy();
    }, timeout);
    req.on('error', (err) => settle(reject, networkError(err)));
  });
}

/** Retry-After (seconds or an HTTP date) -> milliseconds, undefined when absent. */
export function parseRetryAfter(value, now = Date.now()) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}
