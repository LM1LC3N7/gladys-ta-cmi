# gladys-ta-cmi

[Gladys Assistant](https://gladysassistant.com) external integration for
**Technische Alternative** controllers (UVR16x2, UVR1611, UVR610, RSM610,
CAN-EZ, CAN-BC2…) through the official JSON API of the **C.M.I.**, **read
only**: inputs, outputs, DL bus, and on request system values, logging,
network inputs, M-Bus, Modbus, KNX and electrical power. One device per CAN
node. Unofficial, not affiliated with Technische Alternative.

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

> **Work in progress (milestone 1).** Never tested with a real device: tested
> against a fake C.M.I. only.

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (CmiApp) ⇄ src/client.js (gate) ⇄ http://<ip>/INCLUDE/…
                                   ├─ src/devices.js    answers -> Gladys devices and states (pure)
                                   ├─ src/store.js      /data: last request, pause, stop, nodes, types
                                   └─ src/publisher.js  300 states/min
```

- **One request per minute, strictly.** The C.M.I. accepts one request per
  minute on its JSON API (status code 4 otherwise). Every request (node list,
  node data, test button, Discovery) goes through the gate of
  `src/client.js`: one at a time, never earlier than **75 s after the end of
  the previous one**. The time of each request is written to `/data` before
  the request leaves, so a restart never sends early. The gate never waits by
  itself: a request asked too soon is refused, the app schedules the next
  one.
- **Cycles.** Every refresh interval (5 min by default, 120 to 3600 s), a
  queue of requests, one per step: `/INCLUDE/can_nodes.cgi?_=1` when the
  nodes are not configured and the list is unknown or 6 h old, then
  `/INCLUDE/api.cgi?jsonnode=<n>&jsonparam=<params>` per node, with the
  parameters its device type supports (learnt from the first answer, kept in
  `/data`), split in requests of 7 at most as the reference does. "Main"
  values: `I,O,D`; "All": also `Sg,Ss,Sp,Na,Nd,M,AM,Ak,La,Ld`. The date and
  time system values are never asked.
- **Basic authentication** built in `src/client.js` only, never logged.
- **The answer is untrusted**: read up to 256 KB, `JSON.parse`, own keys only
  (`Object.hasOwn`), 128 channels per section, 16 nodes, finite numbers
  within ±1e9.
- **Devices**: `ext:<selector>:cmi:node<n>`, features `<section>-<number>`
  (`in-1`, `out-3`, `dl-2`, `la-12`…). Shapes from the unit code: °C as
  `temperature-sensor/probe`, durations, pressures, volumes, distances,
  speeds, CO2, lux, precipitation and currencies with their core unit; every
  other unit (kWh, kW, K, l/h, %…) a plain `unknown/decimal` sensor with the
  unit in its name (no energy dashboard: a kWh may be thermal). A device
  already created keeps every feature with its own shape; a channel whose
  shape changed gets no value.
- **Errors**: 401/403 stop the reads (10 min, 1 h, 6 h; lifted by new
  credentials or the button); code 4 / 429 pause 5, 10, 15 min; network,
  5xx, bad answers back off (1 to 15 min, never under the interval); node
  codes 1, 2, 5, 7 mark the node only.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
npx github:GladysAssistant/integration-store .
```

Tests run against the SDK's fake Gladys and a fake C.M.I. that answers status
code 4 to requests closer than one minute. See `CLAUDE.md` for the rules and
`TODO.md` for the status and the decisions.

## Credits

- [ta-cmi](https://gitlab.com/DeerMaximum/ta-cmi) 3.7.1 by DeerMaximum (MIT):
  the JSON API endpoints, status codes, device types and their parameters,
  channel types and unit codes are ported to JavaScript. See
  `THIRD_PARTY_NOTICES.md`.

## License

Apache-2.0, see `LICENSE`. Technische Alternative, C.M.I. and UVR are
trademarks of Technische Alternative RT GmbH.
