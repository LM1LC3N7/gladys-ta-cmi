// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), bounded when read back:
// - `lastRequestAt`: the time of the last request to the C.M.I., whatever the
//   C.M.I. (a restart never sends a request before the one-minute limit);
// - with the C.M.I. it belongs to (a hash of its address and port): a pause
//   (status code 4 / 429, or the backoff after failures), a stop on refused
//   credentials, the node list and the device type of each node (so a restart
//   does not spend requests to learn them again).
// Never the user name nor the password. The file is readable by the container
// user only (0600).
// -----------------------------------------------------------------------------

import { open, readFile, rename } from 'node:fs/promises';
import { DEVICES, LIMITS, POLL_INTERVAL, TIMINGS } from './constants.js';

export const STATE_FILE = '/data/ta-cmi-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        const file = await open(temporary, 'w', 0o600);
        try {
          await file.writeFile(text, 'utf8');
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

/** The longest backoff: 15 min, or the interval when it is longer (1 h at most). */
const BACKOFF_MAX = Math.max(TIMINGS.backoff.at(-1), POLL_INTERVAL.max * 1000);

const time = (value) => (Number.isFinite(value) && value > 0 ? value : undefined);

const nodeId = (value) =>
  Number.isInteger(value) && value >= LIMITS.nodeMin && value <= LIMITS.nodeMax;

/**
 * The persisted state, repaired; the end of a pause or of a stop is capped
 * from `now`, so a clock jump or a hand-edited file never stops for good.
 */
export function normalizeMemory(raw, now = Date.now()) {
  const lastRequestAt = time(raw?.lastRequestAt);
  const key = typeof raw?.key === 'string' && /^[0-9a-f]{32}$/.test(raw.key) ? raw.key : '';
  const p = raw?.pause;
  const kind = p?.kind === 'backoff' ? 'backoff' : 'rate';
  const pause =
    key && p && typeof p === 'object' && time(p.until)
      ? {
          kind,
          until: Math.min(p.until, now + (kind === 'rate' ? TIMINGS.rateLimitMax : BACKOFF_MAX)),
          failures: Number.isInteger(p.failures) && p.failures >= 0 ? Math.min(p.failures, 10) : 0,
        }
      : null;
  const b = raw?.block;
  const block =
    key && b && typeof b === 'object'
      ? {
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          retryAt: Math.min(time(b.retryAt) ?? now, now + TIMINGS.refusedRetry.at(-1)),
        }
      : null;
  const n = raw?.nodes;
  const nodes =
    key && n && typeof n === 'object' && Array.isArray(n.ids)
      ? {
          ids: [...new Set(n.ids.filter(nodeId))].slice(0, LIMITS.nodes),
          at: Math.min(time(n.at) ?? 0, now),
        }
      : null;
  const types = {};
  if (key && raw?.types && typeof raw.types === 'object') {
    for (const [id, type] of Object.entries(raw.types)) {
      if (nodeId(Number(id)) && String(Number(id)) === id && Object.hasOwn(DEVICES, type)) {
        types[id] = type;
      }
    }
  }
  return {
    lastRequestAt: lastRequestAt === undefined ? null : Math.min(lastRequestAt, now),
    key,
    pause,
    block,
    nodes,
    types,
  };
}
