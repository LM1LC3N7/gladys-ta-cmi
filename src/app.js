// -----------------------------------------------------------------------------
// The integration: the address and the account of the C.M.I., its CAN nodes
// read one request at a time, the Gladys devices and their states, the
// transport badges.
//
// Read only: the JSON API of the C.M.I. only reads; every command Gladys could
// send is refused.
//
// The one-minute limit of the C.M.I., strictly: every request (node list,
// node data, test button, Discovery) goes through the client's gate, 75 s
// after the end of the previous one, kept in /data across restarts. A cycle
// (every refresh interval, 5 min by default) is a queue of requests, one per
// step: the node list when it is not known (or 6 h old), then each node (two
// requests for a device asked more than 7 parameters, as the reference does).
//
// Errors: refused credentials stop the reads (new try after 10 min, 1 h, then
// every 6 h, or at once on new settings or the test button); status code 4 or
// a 429 pauses every path for 5 to 15 min; other errors back off, never faster
// than the interval. A node the C.M.I. cannot read (status codes 1, 2, 5, 7)
// is marked unreachable, the others go on. The pause, the stop, the node list
// and the device types are kept in /data. A reconnection to Gladys resends
// what Gladys keeps in memory only (status, Discovery list, badges) and keeps
// the pause, the stop and the client.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { CmiClient } from './client.js';
import { normalizeConfig } from './config.js';
import {
  CHANNEL_SETS,
  DEFAULT_PARAMS,
  MAX_PARAMS_PER_REQUEST,
  PARAM_SECTIONS,
  SUPPORTED_PARAMS,
  TIMINGS,
} from './constants.js';
import {
  buildDevice,
  channelsOf,
  deviceIds,
  deviceTypeOf,
  featureShape,
  parseDeviceId,
  roleOf,
  sameShape,
  stateOf,
} from './devices.js';
import { errorReason } from './http.js';
import { T, age, both, join, nodeReasonOf, reasonOf, word } from './i18n.js';
import { StatePublisher } from './publisher.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors after which the C.M.I. did not answer at all. */
const OFFLINE = new Set(['network', 'timeout']);

export class CmiApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'ta-cmi' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new CmiClient({
      transport,
      now,
      onRequest: (at) => this.requestSent(at),
    });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null);
    /** node -> { channels: Map<role, channel>, readAt, error } */
    this.nodeData = new Map();
    /** The requests left in the current cycle: { kind: 'list' } | { kind: 'node', node, params }. */
    this.queue = [];
    this.cycleStartedAt = -Infinity;
    this.readAt = undefined;
    this.published = undefined;
    /** deviceId -> badge last published (JSON) */
    this.badges = new Map();
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.pausedUntil = 0;
    /** 'rate' (status code 4, 429) or 'backoff' (failures): no request before `pausedUntil`. */
    this.pauseKind = undefined;
    this.lastStatus = undefined;
    this.started = false;
  }

  // --- Lifecycle -------------------------------------------------------------

  /** `fresh`: the user changed the address or the account, the stop is lifted. */
  async start(raw = {}, { fresh = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    const saved = normalizeMemory(await this.store.load().catch(() => null), this.now());
    // The time of the last request applies whatever the C.M.I. (strict limit).
    this.client.remember(saved.lastRequestAt ?? undefined);
    this.memory = saved;
    if (this.memory.key !== this.config.key) {
      // Another C.M.I.: the pause, the stop, the nodes and the types of the previous one are not its own.
      this.memory = {
        lastRequestAt: saved.lastRequestAt,
        key: this.config.key,
        pause: null,
        block: null,
        nodes: null,
        types: {},
      };
    }
    if (fresh) {
      this.memory.block = null;
    }
    const { pause, block } = this.memory;
    if (pause && pause.until > this.now()) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
      this.failures = pause.failures;
    }
    if (block) {
      this.blocked = true;
      this.retries = block.retries;
      this.retryAt = block.retryAt;
    }
    this.client.configure(this.config);
    await this.saveMemory();
    this.publisher.start();
    const missing = this.configMessage();
    if (missing) {
      await this.setStatus(false, missing);
      return;
    }
    if (this.blocked) {
      await this.setStatus(false, T.refused(age(Math.max(0, this.retryAt - this.now()))));
      this.scheduleNext();
      return;
    }
    if (this.now() < this.pausedUntil) {
      await this.setStatus(
        false,
        this.pauseMessage() ?? T.waiting(age(this.pausedUntil - this.now())),
      );
      this.scheduleNext();
      return;
    }
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** What the configuration lacks, as a status message; undefined when complete. */
  configMessage() {
    if (this.config.addressError === 'path') {
      return T.addressPath;
    }
    if (this.config.addressError === 'https') {
      return T.addressHttps;
    }
    if (this.config.addressError === 'invalid') {
      return T.addressInvalid;
    }
    if (this.config.nodesError) {
      return T.nodesInvalid;
    }
    return this.client.configured ? undefined : T.noConfig;
  }

  get configured() {
    return this.configMessage() === undefined;
  }

  get ratePaused() {
    return this.pauseKind === 'rate' && this.now() < this.pausedUntil;
  }

  reset() {
    this.nodeData.clear();
    this.queue = [];
    this.cycleStartedAt = -Infinity;
    this.readAt = undefined;
    this.published = undefined;
    this.badges.clear();
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    this.pausedUntil = 0;
    this.pauseKind = undefined;
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only. The pause, the stop
   * and the client stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges.clear();
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    await this.publishBadges();
  }

  /** New address or account: restart (and lift the stop); new nodes or channels: next cycle. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (
      next.host !== previous.host ||
      next.port !== previous.port ||
      next.username !== previous.username ||
      next.password !== previous.password ||
      next.addressError !== previous.addressError ||
      next.nodesError !== previous.nodesError
    ) {
      return this.start(raw, { fresh: true });
    }
    this.config = next;
    if (next.channels !== previous.channels || next.nodes.join(',') !== previous.nodes.join(',')) {
      // The current cycle is dropped; the next one, at the gate, follows the new settings.
      this.queue = [];
      this.cycleStartedAt = -Infinity;
      if (!this.running) {
        this.scheduleNext();
      }
    } else if (next.pollInterval !== previous.pollInterval && this.timer) {
      this.scheduleNext();
    }
    if (next.language !== previous.language) {
      this.published = undefined;
      await this.publishDevices();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The time of a request, kept in /data BEFORE the request leaves. */
  async requestSent(at) {
    this.memory.lastRequestAt = at;
    await this.saveMemory();
  }

  async persist() {
    this.memory.key = this.config.key;
    this.memory.pause =
      this.pauseKind && this.now() < this.pausedUntil
        ? { kind: this.pauseKind, until: this.pausedUntil, failures: this.failures }
        : null;
    this.memory.block = this.blocked ? { retries: this.retries, retryAt: this.retryAt } : null;
    await this.saveMemory();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Scheduling ------------------------------------------------------------

  get interval() {
    return this.config.pollInterval * 1000;
  }

  /** The next step: after the pause or the stop, the gate, and the cycle interval. */
  scheduleNext() {
    this.clearTimer();
    if (!this.configured) {
      return;
    }
    const now = this.now();
    let at = this.client.nextAllowedAt();
    if (this.blocked) {
      at = Math.max(at, this.retryAt, this.pausedUntil);
    } else if (now < this.pausedUntil) {
      at = Math.max(at, this.pausedUntil);
    }
    if (this.queue.length === 0) {
      at = Math.max(at, this.cycleStartedAt + this.interval);
    }
    this.scheduleAt(at);
  }

  scheduleAt(at) {
    this.clearTimer();
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch((err) => this.logger.error(`C.M.I. refresh failed: ${err.message}`));
        }
      },
      Math.max(0, at - this.now()),
    );
  }

  /**
   * One step at a time: a tick during a step joins it. `force`: the test
   * button retrying refused credentials before the scheduled new try.
   * `manual`: the test button or Discovery, which may start a cycle early.
   */
  tick({ force = false, manual = false } = {}) {
    if (!this.running) {
      this.running = this.run({ force, manual }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  /** The nodes to read: those of the configuration, else the list of the C.M.I. */
  get nodes() {
    return this.config.nodes.length > 0 ? this.config.nodes : (this.memory.nodes?.ids ?? []);
  }

  /** The parameters to ask a node for, in requests of 7 at most. */
  requestsFor(node) {
    const type = this.memory.types[String(node)];
    const supported = type ? SUPPORTED_PARAMS[type] : DEFAULT_PARAMS;
    const wanted = supported.filter((p) => CHANNEL_SETS[this.config.channels].has(p));
    const requests = [];
    for (let i = 0; i < wanted.length; i += MAX_PARAMS_PER_REQUEST) {
      requests.push(wanted.slice(i, i + MAX_PARAMS_PER_REQUEST));
    }
    return requests;
  }

  queueNodes() {
    for (const node of this.nodes) {
      for (const params of this.requestsFor(node)) {
        this.queue.push({ kind: 'node', node, params });
      }
    }
  }

  startCycle() {
    this.cycleStartedAt = this.now();
    this.queue = [];
    const listed = this.memory.nodes;
    const listNeeded =
      this.config.nodes.length === 0 &&
      (!listed || listed.ids.length === 0 || this.now() - listed.at >= TIMINGS.nodesRefresh);
    if (listNeeded) {
      this.queue.push({ kind: 'list' });
    } else {
      this.queueNodes();
    }
  }

  async run({ force = false, manual = false } = {}) {
    const generation = this.generation;
    if (!this.configured) {
      return;
    }
    // A stop is only lifted by a successful request.
    const retryDue = this.blocked && (force || this.now() >= this.retryAt);
    if ((this.blocked && !retryDue) || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    if (this.client.wait() > 0) {
      await this.waitingStatus();
      this.scheduleNext();
      return;
    }
    if (this.queue.length === 0) {
      if (!manual && !retryDue && this.now() < this.cycleStartedAt + this.interval) {
        this.scheduleNext();
        return;
      }
      this.startCycle();
      if (this.queue.length === 0) {
        // Nothing to ask (no node, or no parameter of the chosen set).
        await this.setStatus(this.readAt !== undefined, this.statusMessage());
        this.scheduleNext();
        return;
      }
    }
    if (retryDue) {
      this.logger.info('C.M.I.: trying again after refused credentials');
    }
    if (this.readAt === undefined && this.lastMessage === undefined) {
      await this.setStatus(false, T.reading);
    }
    const job = this.queue[0];
    try {
      if (job.kind === 'list') {
        const ids = await this.client.listNodes();
        if (generation !== this.generation) {
          return;
        }
        this.queue.shift();
        this.memory.nodes = ids.length > 0 ? { ids, at: this.now() } : null;
        this.queueNodes();
      } else {
        const root = await this.client.readNode(job.node, job.params);
        if (generation !== this.generation) {
          return;
        }
        this.queue.shift();
        this.ingest(job, root);
        this.readAt = this.now();
      }
      await this.succeeded();
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      if (err?.kind === 'node' && job.kind === 'node') {
        // The C.M.I. answered, this node only could not be read.
        this.queue.shift();
        this.nodeFailed(job.node, err);
        await this.succeeded();
      } else if (err?.kind === 'too_soon') {
        // Never sent: the gate holds.
      } else {
        this.queue = [];
        await this.failed(err);
      }
    }
    await this.publishDevices();
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /** The C.M.I. answered: the stop, the backoff and the failures are over. */
  async succeeded() {
    this.blocked = false;
    this.retries = 0;
    this.retryAt = 0;
    this.offline = false;
    this.failures = 0;
    if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
      this.pauseKind = undefined;
      this.pausedUntil = 0;
    }
    // The stop and the pause lifted, the node list and the types learnt.
    await this.persist();
    const read = [...this.nodeData.values()].some((d) => d.readAt !== undefined);
    await this.setStatus(read, this.statusMessage());
  }

  /** "Connected: 2/3 nodes read. Not read: node 5 (CAN bus busy)." */
  statusMessage() {
    const nodes = this.nodes;
    if (nodes.length === 0) {
      return T.noNode;
    }
    const read = nodes.filter((n) => {
      const data = this.nodeData.get(n);
      return data?.readAt !== undefined && !data.error;
    }).length;
    const failed = nodes
      .map((n) => [n, this.nodeData.get(n)?.error])
      .filter(([, error]) => error !== undefined);
    if (read === 0 && failed.length === 0) {
      // The node list read, the nodes not yet (one request per minute).
      return T.reading;
    }
    const base = T.connected(read, nodes.length);
    if (failed.length === 0) {
      return base;
    }
    const list = both(
      failed.map(([n, code]) => `node ${n} (${nodeReasonOf(code).en})`).join(', '),
      failed.map(([n, code]) => `nœud ${n} (${nodeReasonOf(code).fr})`).join(', '),
    );
    return join(base, T.nodeErrors(list));
  }

  /** Before a request: the wait the gate imposes, while nothing was read yet. */
  async waitingStatus() {
    if (this.readAt === undefined && !this.blocked) {
      await this.setStatus(false, T.connecting(age(this.client.wait())));
    }
  }

  /** One answer of a node: its channels (the sections asked are replaced), its type, its states. */
  ingest(job, root) {
    const type = deviceTypeOf(root);
    if (type !== undefined) {
      this.memory.types[String(job.node)] = type;
    }
    const data = this.nodeData.get(job.node) ?? { channels: new Map() };
    const covered = new Set(job.params.flatMap((p) => PARAM_SECTIONS[p] ?? []));
    for (const [role, channel] of data.channels) {
      if (covered.has(channel.section)) {
        data.channels.delete(role);
      }
    }
    for (const channel of channelsOf(root)) {
      data.channels.set(roleOf(channel), channel);
    }
    data.readAt = this.now();
    data.error = undefined;
    this.nodeData.set(job.node, data);
    this.queueStates(job.node);
  }

  nodeFailed(node, err) {
    const data = this.nodeData.get(node) ?? { channels: new Map() };
    data.error = err.code ?? 0;
    this.nodeData.set(node, data);
    this.logger.warn(`C.M.I.: node ${node} not read: ${errorReason(err)}`);
  }

  /** A failure of the C.M.I. itself: a stop, a pause, or a backoff. Never a dead integration. */
  async failed(err) {
    const reason = errorReason(err);
    if (err?.kind === 'no_config') {
      await this.setStatus(false, T.noConfig);
      return;
    }
    if (err?.kind === 'refused') {
      const wait = TIMINGS.refusedRetry[Math.min(this.retries, TIMINGS.refusedRetry.length - 1)];
      this.retries += 1;
      this.blocked = true;
      this.offline = true;
      this.retryAt = this.now() + wait;
      this.logger.warn(`C.M.I.: ${reason}; one new try in ${Math.round(wait / 60_000)} min`);
      await this.persist();
      await this.setStatus(false, T.refused(age(wait)));
      return;
    }
    let wait;
    let message;
    if (err?.kind === 'rate_limited') {
      wait = this.pause(err);
      message = T.rateLimited(age(wait));
    } else {
      // Never read again faster than the refresh interval.
      wait = Math.max(
        this.interval,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = this.ratePaused ? 'rate' : 'backoff';
      this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
      this.offline = OFFLINE.has(err?.kind) || this.offline;
      message = T.unreachable(reasonOf(err), age(wait));
    }
    this.failures += 1;
    await this.persist();
    const connected = err?.kind === 'rate_limited' && this.readAt !== undefined;
    await this.setStatus(connected, message);
    this.logger.warn(`C.M.I.: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  /** Status code 4 or 429: 5, 10, then 15 min (Retry-After within 60 s to 6 h), every path. */
  pause(err) {
    const steps = TIMINGS.rateLimit;
    const asked = err.retryAfter ?? steps[Math.min(this.failures, steps.length - 1)];
    const wait = Math.max(TIMINGS.rateLimitMin, Math.min(TIMINGS.rateLimitMax, asked));
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    this.pauseKind = 'rate';
    return wait;
  }

  // --- Gladys ----------------------------------------------------------------

  createdDevices() {
    return (this.gladys.devices ?? []).filter((d) => parseDeviceId(d.external_id) !== undefined);
  }

  createdDevice(node) {
    const externalId = deviceIds(this.gladys, node).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === externalId);
  }

  /**
   * The nodes to publish: those read, plus those already created in Gladys
   * (with all their features), so the Discovery list never drops a device.
   */
  nodesToPublish() {
    const list = [...this.nodeData.entries()]
      .filter(([, data]) => data.readAt !== undefined)
      .map(([node]) => node);
    for (const device of this.createdDevices()) {
      const node = parseDeviceId(device.external_id);
      if (!list.includes(node)) {
        list.push(node);
      }
    }
    return list.sort((a, b) => a - b);
  }

  async publishDevices() {
    if (this.readAt === undefined && this.createdDevices().length === 0) {
      return;
    }
    const devices = this.nodesToPublish().map((node) =>
      buildDevice(
        this.gladys,
        {
          node,
          type: this.memory.types[String(node)],
          channels: [...(this.nodeData.get(node)?.channels.values() ?? [])],
        },
        this.config.language,
        this.createdDevice(node),
      ),
    );
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  /** The features created in Gladys, by external id. */
  createdFeatures() {
    return new Map(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => [f.external_id, f])),
    );
  }

  /**
   * Queues the states of a node, for the features created in Gladys only,
   * and only when the feature still has the shape of the channel.
   */
  queueStates(node, created = this.createdFeatures()) {
    const data = this.nodeData.get(node);
    if (!data) {
      return;
    }
    const ids = deviceIds(this.gladys, node);
    for (const channel of data.channels.values()) {
      const state = stateOf(channel);
      if (!state) {
        continue;
      }
      const id = ids.feature(state.role);
      const feature = created.get(id);
      if (feature && sameShape(feature, featureShape(channel))) {
        this.publisher.push(id, { state: state.state });
      }
    }
  }

  badge(node) {
    if (this.blocked || this.offline) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE };
    }
    const data = this.nodeData.get(node);
    if (data?.error !== undefined) {
      return {
        transport: DEVICE_TRANSPORTS.UNREACHABLE,
        degraded: true,
        message: nodeReasonOf(data.error),
      };
    }
    if (this.readAt !== undefined && data?.readAt === undefined && this.queue.length === 0) {
      return { transport: DEVICE_TRANSPORTS.UNREACHABLE, degraded: true, message: T.notInAnswer };
    }
    return { transport: DEVICE_TRANSPORTS.LOCAL };
  }

  async publishBadges() {
    const entries = [];
    for (const device of this.createdDevices()) {
      const node = parseDeviceId(device.external_id);
      const entry = { external_id: device.external_id, ...this.badge(node) };
      const json = JSON.stringify(entry);
      if (this.badges.get(device.external_id) !== json) {
        entries.push([device.external_id, json, entry]);
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries.map(([, , entry]) => entry));
      for (const [externalId, json] of entries) {
        this.badges.set(externalId, json);
      }
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badges.delete(device?.external_id);
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.set(f.external_id, f);
    }
    const node = parseDeviceId(device?.external_id);
    if (node !== undefined) {
      this.queueStates(node, created);
    }
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badges.delete(device?.external_id);
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: a fresh step only when the gate allows it. */
  async scan() {
    if (
      this.configured &&
      !this.blocked &&
      this.now() >= this.pausedUntil &&
      this.client.wait() === 0 &&
      !this.running
    ) {
      if (this.queue.length === 0 && this.config.nodes.length === 0 && this.memory.nodes) {
        // Asked by hand: the node list is read again at the start of the cycle.
        this.memory.nodes = { ...this.memory.nodes, at: 0 };
      }
      await this.tick({ manual: true });
      return;
    }
    await this.publishDevices();
  }

  /** Every feature is read only: a command is refused, nothing is sent. */
  async setValue() {
    throw new Error(word(T.readOnly, this.config.language));
  }

  // --- Configuration button --------------------------------------------------

  pauseMessage() {
    return this.ratePaused ? T.rateLimited(age(this.pausedUntil - this.now())) : undefined;
  }

  async testConnection() {
    const missing = this.configMessage();
    if (missing) {
      return missing;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    if (this.running) {
      return T.busy;
    }
    const withLast = (first) => (this.lastMessage ? join(first, this.lastMessage) : first);
    if (this.pauseKind === 'backoff' && this.now() < this.pausedUntil) {
      return withLast(T.test.wait(age(this.pausedUntil - this.now())));
    }
    const wait = this.client.wait();
    if (wait > 0) {
      return withLast(T.test.wait(age(wait)));
    }
    await this.tick({ force: this.blocked, manual: true });
    return this.lastMessage ?? T.noConfig;
  }
}
