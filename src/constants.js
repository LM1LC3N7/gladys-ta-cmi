// -----------------------------------------------------------------------------
// Constants of the C.M.I. JSON API and of the integration.
//
// The API values come from DeerMaximum/ta-cmi 3.7.1 (MIT, see
// THIRD_PARTY_NOTICES.md): the two endpoints, the device type ids, the
// parameters each device type supports, the channel types, the unit codes and
// the status codes of the answer. The C.M.I. accepts ONE request per minute
// (status code 4 otherwise): every request goes through src/gate.js.
// -----------------------------------------------------------------------------

/** The manifest action keys. */
export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** The endpoints (reference cmi_api.py). */
export const API = {
  nodes: '/INCLUDE/can_nodes.cgi?_=1',
  data: (node, params) => `/INCLUDE/api.cgi?jsonnode=${node}&jsonparam=${params}`,
  defaultPort: 80,
};

/** The "Status code" of an answer (reference cmi_api.py, and the C.M.I. JSON API manual). */
export const STATUS = {
  OK: 0,
  NODE_ERROR: 1,
  FAIL: 2,
  SYNTAX_ERROR: 3,
  TOO_MANY_REQUESTS: 4,
  DEVICE_NOT_SUPPORTED: 5,
  TOO_FEW_ARGUMENTS: 6,
  CAN_BUSY: 7,
};

/** Device type ids of the answer header -> names (reference const.py DEVICES). */
export const DEVICES = {
  22: 'DUMMY-NO-IO',
  80: 'UVR1611',
  87: 'UVR16x2',
  88: 'RSM610',
  89: 'CAN-I/O45',
  '8B': 'CAN-EZ2',
  '8C': 'CAN-MTx2',
  '8D': 'CAN-BC2',
  '8E': 'UVR65',
  '8F': 'CAN-EZ3',
  91: 'UVR610',
  92: 'UVR67',
};

/** The parameters each device type supports (reference const.py SUPPORTED_PARAMS_FOR_DEVICE). */
export const SUPPORTED_PARAMS = {
  22: ['AM'],
  80: ['I', 'O', 'Na', 'Nd'],
  87: ['I', 'O', 'D', 'Sg', 'Sd', 'St', 'Ss', 'La', 'Ld'],
  88: ['I', 'O', 'D', 'M'],
  89: ['I', 'O', 'D'],
  '8B': ['I', 'O', 'Sp'],
  '8D': ['M', 'AM', 'Ak', 'D', 'Sg', 'Sd', 'St', 'Ss', 'La', 'Ld'],
  '8F': ['D', 'Sg', 'Sd', 'St', 'Ss', 'Sp', 'AM', 'La', 'Ld'],
  91: ['I', 'O', 'D', 'M', 'AM', 'La', 'Ld'],
  92: ['I', 'O', 'AM', 'AK'],
};

/** The parameters of a device whose type is not known yet (reference device.py). */
export const DEFAULT_PARAMS = ['I', 'O'];

/** At most this many parameters in one request (reference device.py splits above 7). */
export const MAX_PARAMS_PER_REQUEST = 7;

/**
 * The channel sets of the configuration: "main" (inputs, outputs, DL bus),
 * "all" (plus system values, logging, network inputs, M-Bus, Modbus, KNX,
 * electrical power). The date and time system values are never read (no use
 * in Gladys).
 */
export const CHANNEL_SETS = {
  main: new Set(['I', 'O', 'D']),
  all: new Set(['I', 'O', 'D', 'Sg', 'Ss', 'Sp', 'Na', 'Nd', 'M', 'AM', 'Ak', 'AK', 'La', 'Ld']),
};

/**
 * The sections of `Data` (reference const.py ChannelType) -> the short code
 * used in the feature external ids. Those codes are published forever: never
 * rename them. "Date" and "Time" are not read.
 */
export const SECTIONS = {
  Inputs: 'in',
  Outputs: 'out',
  'DL-Bus': 'dl',
  General: 'sg',
  Sun: 'ss',
  'Electrical power': 'sp',
  'Network Analog': 'na',
  'Network Digital': 'nd',
  MBus: 'mb',
  Modbus: 'mo',
  KNX: 'knx',
  'Logging Analog': 'la',
  'Logging Digital': 'ld',
};

/** The sections each parameter of a request asks for (by their short code). */
export const PARAM_SECTIONS = {
  I: ['in'],
  O: ['out'],
  D: ['dl'],
  Sg: ['sg'],
  Ss: ['ss'],
  Sp: ['sp'],
  Na: ['na'],
  Nd: ['nd'],
  M: ['mb'],
  AM: ['mo'],
  Ak: ['knx'],
  AK: ['knx'],
  La: ['la'],
  Ld: ['ld'],
};

/** Gladys values (server/utils/constants.js of the core). */
export const GLADYS = {
  ON: 1,
  OFF: 0,
};

/** The refresh interval of the configuration, in seconds. */
export const POLL_INTERVAL = { default: 300, min: 120, max: 3600 };

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** One request to the C.M.I. (a CAN read behind it may be slow). */
  requestTimeout: 20 * SECOND,
  /**
   * The C.M.I. accepts one request per minute. Two requests are never closer
   * than this, counted from the END of the previous one (its answer, error or
   * timeout), whatever asks for them, across restarts (kept in /data). The
   * reference waits 75 s between the two halves of a split read.
   */
  requestGap: 75 * SECOND,
  /** Pauses after failures, never shorter than the refresh interval. */
  backoff: [MINUTE, 2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  /** After refused credentials: a new try after 10 min, 1 h, then every 6 h. */
  refusedRetry: [10 * MINUTE, HOUR, 6 * HOUR],
  /** Status code 4 or HTTP 429: a pause of 5, 10, then 15 min (Retry-After within 60 s to 6 h). */
  rateLimit: [5 * MINUTE, 10 * MINUTE, 15 * MINUTE],
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  /** The node list is asked again at most every 6 h (Discovery), never at each cycle. */
  nodesRefresh: 6 * HOUR,
  /** States flushed to Gladys every second; unchanged ones again every 30 min. */
  flushInterval: SECOND,
  stateHeartbeat: 30 * MINUTE,
};

export const LIMITS = {
  /** Gladys accepts 300 states per minute. */
  statesPerMinute: 280,
  statesPerRequest: 100,
  /** The biggest answer read (a full UVR16x2 answer is a few tens of KB). */
  responseBytes: 256 * 1024,
  /** The node list ("1;2;…"). */
  nodesBytes: 4 * 1024,
  /** CAN node ids: 1 to 62. */
  nodeMin: 1,
  nodeMax: 62,
  /** Nodes read at most. */
  nodes: 16,
  /** Channels read per section of an answer. */
  channelsPerSection: 128,
  /** Features of one device at most. */
  featuresPerDevice: 512,
  /** The largest absolute value accepted. */
  maxValue: 1e9,
};
