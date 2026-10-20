// -----------------------------------------------------------------------------
// A fake C.M.I. behind the transport of the client (no network): it checks the
// Basic authentication, answers the node list and the data of each node, and
// answers status code 4 to a request less than 60 s after the previous one,
// like the C.M.I. It records every request with its time.
// -----------------------------------------------------------------------------

import { CmiError } from '../../src/http.js';
import { MINUTE, PASSWORD, USER, answer } from '../fixtures/cmi.js';

export function fakeCmi({ user = USER, password = PASSWORD, nodes = { 1: '87' } } = {}) {
  const server = {
    user,
    password,
    /** node -> device type id */
    nodes,
    /** Answers to give first: { status, body?, headers? }, a document (object), or an Error. */
    queue: [],
    requests: [],
    /** Requests the C.M.I. would have refused (closer than 60 s). */
    tooFast: 0,
    delay: 0,
    transport: async ({ hostname, port, path, headers }, { timeout } = {}) => {
      const at = Date.now();
      const previous = server.requests.at(-1);
      server.requests.push({ at, hostname, port, path, headers, timeout });
      if (server.delay > 0) {
        await new Promise((resolve) => setTimeout(resolve, server.delay));
      }
      if (previous && at - previous.end < MINUTE) {
        server.tooFast += 1;
      }
      try {
        return await respond(server, path, headers);
      } finally {
        server.requests.at(-1).end = Date.now();
      }
    },
    failNetwork(code = 'EHOSTUNREACH') {
      server.queue.push(new CmiError('network', 'host unreachable', { code }));
    },
  };
  return server;
}

const json = (document) => ({
  status: 200,
  headers: {},
  body: Buffer.from(JSON.stringify(document)),
});

async function respond(server, path, headers) {
  const next = server.queue.shift();
  if (next instanceof Error) {
    throw next;
  }
  if (next?.status !== undefined) {
    return { headers: {}, body: Buffer.alloc(0), ...next };
  }
  if (next) {
    return json(next);
  }
  const expected = `Basic ${Buffer.from(`${server.user}:${server.password}`).toString('base64')}`;
  if (headers?.Authorization !== expected) {
    return { status: 401, headers: {}, body: Buffer.from('Unauthorized') };
  }
  if (path === '/INCLUDE/can_nodes.cgi?_=1') {
    return {
      status: 200,
      headers: {},
      body: Buffer.from(`${Object.keys(server.nodes).join(';')};`),
    };
  }
  const match = /^\/INCLUDE\/api\.cgi\?jsonnode=(\d+)&jsonparam=([A-Za-z,]+)$/.exec(path);
  if (!match) {
    return { status: 404, headers: {}, body: Buffer.from('Not found') };
  }
  const device = server.nodes[match[1]];
  if (!device) {
    return json(answer({ code: 1, params: [] }));
  }
  return json(answer({ device, params: match[2].split(',') }));
}

export function memoryStore(initial = null) {
  return {
    data: initial,
    saves: 0,
    async load() {
      return this.data === null ? null : structuredClone(this.data);
    },
    async save(data) {
      this.saves += 1;
      this.data = structuredClone(data);
    },
  };
}

/** Lets the pending promises settle (no timer involved). */
export const settle = async (rounds = 30) => {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};
