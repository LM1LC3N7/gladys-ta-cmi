# TODO — TA C.M.I. v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- The `gladys-assistant-integration` topic is added at the first real release
  only. No forum topic of its own, no forum post from a module session.

## Status

- [x] **Milestone 1 — core, read only** (2026-10-20): C.M.I. JSON API (node
      list, node data), strict gate of one request per 75 s from the end of
      the previous one (kept in `/data`), cycles of one request per step,
      device types learnt and kept, split above 7 parameters, "main"/"all"
      channel sets, one device per node, units of the core, refused
      credentials stop, code 4 / 429 pause, backoff, node errors, badges,
      test button, en/fr, docs, cover. Tested against a fake C.M.I. only
      (Node 22 and 24).
- [ ] **Milestone 2 — real C.M.I.**: run against a real C.M.I. with a
      UVR16x2 (see "To check"); turn the answers (anonymized) into fixtures.
- [ ] **Milestone 3 — first release**: Docker image build check, Release
      workflow, topic, GHCR package public.

## To check on a real C.M.I.

- Whether `can_nodes.cgi` counts toward the one-minute limit (counted here,
  to be safe) and its exact format (the reference splits on `;`).
- The answer to wrong credentials (401 expected) and the user levels allowed
  on the JSON API (admin by default here).
- The first request of a node of unknown type uses `I,O` (reference): what a
  CAN-BC2 or CAN-EZ3 (no inputs, no outputs) answers then (status code 2?
  then the type is never learnt: a "device type" option would be needed).
- Digital outputs: `Value.Value` or `Value.State` (both read here).
- Whether the gap of 75 s can be shortened to ~62 s safely (counted from the
  end of the previous request).
- The size of a full "all" answer of a UVR16x2 (256 KB limit here).

## Decisions

- **Not a duplicate** (lot 10, wave 2, line 8 of `_ref/lot10/proposition.md`):
  the reservation checks are the main session's.
- **Reference reused: DeerMaximum/ta-cmi 3.7.1** (MIT, GitLab, the library of
  the Home Assistant custom integration), cloned read only in `_ref/ta-cmi`
  (commit b0015f3, `pyproject.toml` 3.7.1). Licence checked in its `LICENSE`
  file: MIT, Copyright (c) 2021 DeerMaximum. Python: ported, credited in the
  README and `THIRD_PARTY_NOTICES.md` (full MIT notice). The CoE part is not
  ported. Only runtime dependency: the SDK.
- **Neighbour module**: LM1LC3N7/gladys-oekofen (local JSON, read only): same
  structure (app, client, http, store, publisher, handlers), its review
  lessons applied (bounded answers, no prototype pollution, careful reads,
  status and Discovery sent again at each `connected`, no lost feature,
  pause and stop in `/data`, no secret in logs).
- **Read only**: the C.M.I. JSON API cannot write. Every feature `read_only`,
  `onSetValue` refuses every command, no switch, no thermostat, no scene
  action, no boolean option. No sensitive command exists in v1.
- **One request per minute, strictly** (brief): one gate in `CmiClient.get`
  for every path (polling, list, test button, Discovery); one request at a
  time; never earlier than 75 s after the END of the previous request (the
  reference waits 75 s between the halves of a split read; counting from the
  end adds the answer time as a margin); the time of each request is saved
  to `/data` BEFORE it leaves and read back at start (capped at now: a clock
  jump never blocks), for every C.M.I. (not keyed by address, the strict
  choice). The gate refuses a request asked too soon (`too_soon`, nothing
  sent) instead of waiting, so the test button never hangs past its timeout.
  The node list counts as a request. A fake C.M.I. in the tests answers code
  4 to any request closer than 60 s and every end-to-end test asserts the
  spacing.
- **Cycles**: every refresh interval (default 300 s, 120 to 3600), one queue
  of requests; one request per step; the next step at the gate; the next
  cycle at max(cycle start + interval, gate). The test button and a Discovery
  scan may start a cycle early, never earlier than the gate. A Discovery scan
  also asks the node list again (when the nodes are not configured).
- **Parameters**: the reference's `SUPPORTED_PARAMS_FOR_DEVICE`, filtered by
  the channel set ("main": `I,O,D`; "all": everything but the date `Sd` and
  time `St` system values), split by 7. An unknown type uses `I,O` (reference
  default); the type of the header is learnt and kept in `/data` (known types
  only). With "main", a UVR16x2 needs one request; with "all", a UVR16x2
  needs one (7 parameters), a CAN-BC2 two.
- **Node list**: the `nodes` option (comma list, 1 to 62, 16 at most) wins;
  empty, `can_nodes.cgi` is read and kept in `/data`, again after 6 h (one
  request per 6 h) or on a Discovery scan; an empty list is never kept.
- **Errors**: 401/403 = refused credentials: a stop with new tries after 10
  min, 1 h, then every 6 h, lifted at once by a new address, user or
  password, retried by the test button once the gate allows, lifted only by
  a successful request. Code 4 or HTTP 429 = pause 5, 10, 15 min
  (Retry-After within 60 s to 6 h) for every path. Network, timeout, 5xx,
  unexpected answer: backoff 1, 2, 5, 10, 15 min, never under the interval;
  the cycle is dropped. Codes 1, 2, 3, 5, 6, 7 = this node only (badge
  degraded, listed in the status), the cycle goes on. The stop and the pause
  are in `/data`, capped when read back; a reconnection to Gladys keeps them.
- **`/data` key without the account**: a hash of address and port. Never the
  user nor the password.
- **External ids**: `ext:<selector>:cmi:node<n>`; features
  `<section>-<number>` with frozen section codes (`in`, `out`, `dl`, `sg`,
  `ss`, `sp`, `na`, `nd`, `mb`, `mo`, `knx`, `la`, `ld`). The C.M.I. gives no
  serial number; one integration reads one C.M.I., the node id is unique on
  its CAN bus.
- **No lost feature, frozen shapes**: the devices published keep every
  feature of the device created in Gladys (from `gladys.devices`), with its
  own name, category, type, unit, min and max; a created node missing from
  the answers is still published (degraded badge). A channel whose current
  shape differs from the created feature (unit changed on the controller)
  gets no value (documented: delete and add the device again).
- **Units** (core `DEVICE_FEATURE_UNITS_BY_CATEGORY`, checked in
  `test/devices.test.js`): °C → `temperature-sensor/probe` (out of the room
  averages); s, min, h, days → `duration`; l, m³ → `volume-sensor`; km/h,
  m/s → `speed-sensor`; bar, mbar, Pa → `pressure-sensor`; mm, cm, m, km →
  `distance-sensor`; ppm → `co2-sensor`; lx → `light-sensor`; mm/h, mm/d →
  `precipitation-sensor`; €, $ → `currency`; codes 43/44 and digital channels
  → `binary`. Every other unit (K, W/m², l/h, %, kW, kWh, MWh, V, mA, A, Hz,
  kΩ, …) → `unknown/decimal`, no unit, the unit in the name.
- **Energy**: no energy-sensor feature and no `publishEnergyConsumption`:
  the C.M.I. does not say whether a kWh is electrical or thermal (heat
  meters are common on these controllers), and the core would count it as
  electricity (lesson of wave 3). The approved energy guard of
  gladys-p1-monitor is therefore not used (brief: "sinon capteur simple").
- **Values**: finite numbers within ±1e9, rounded to 3 decimals; digital
  channels 0 or 1 only (`Value.Value`, else `Value.State`).
- **No scene trigger** in v1 (Gladys scenes can already trigger on a feature
  state); no `publishSceneEvent`.
- **Logs**: never the address, the user, the password nor the header;
  `errorReason` never prints an unknown error's message.
- **Template demo files removed** (devices, scenes, widgets, weather and
  their tests).
- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag: the one-time exception to "versions
  belong to the Release workflow" (the template's 1.0.0 had to be replaced);
  the first patch release gives 0.1.1.
- **LICENSE**: the standard Apache-2.0 text (appendix placeholder, no
  personal name); `THIRD_PARTY_NOTICES.md` credits ta-cmi with its full MIT
  notice; both copied into the image.
- **Cover**: `cover.png` 800×534 generated by a plain Node script (no
  dependency), not kept in the repository.
