# TA C.M.I.

Unofficial integration, not affiliated with Technische Alternative. It brings
the controllers of **Technische Alternative** (UVR16x2, UVR1611, UVR610,
UVR65, UVR67, RSM610, CAN-I/O45, CAN-EZ2, CAN-EZ3, CAN-BC2, CAN-MTx2…) into
Gladys through the **official JSON API of the C.M.I.** (Control and
Monitoring Interface), on your local network, **read only**.

> **Warning: never tested with a real device.** This integration was written
> from the ta-cmi Python library and tested against a fake C.M.I. only.
> Feedback is welcome.

## What you get

One Gladys device per **CAN node** behind the C.M.I. (for example "UVR16x2
(node 1)"), with one feature per channel:

| Values read      | Features                                                                                                                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Main (default)   | Inputs ("Input 1"…), outputs ("Output 1"…), DL bus inputs ("DL input 1"…).                                                                      |
| All (on request) | Also, when the device has them: system values (general, sun), analog and digital logging, network inputs, M-Bus, Modbus, KNX, electrical power. |

The JSON API gives no channel names, only their number and unit: rename the
features in Gladys (the name you give is never overwritten).

- Temperatures (°C) are **probes**: they stay out of the room average.
- Durations, pressures, volumes, distances, speeds, CO2, illuminance,
  precipitation and amounts (€, $) have their Gladys unit.
- The other units (K, W/m², l/h, %, kW, kWh, MWh, V, A, Hz…) have no category
  in Gladys: the feature is a plain sensor with the unit in its name ("Input
  3 (l/h)").
- Energy and power are **not** sent to the Gladys energy dashboard: the
  C.M.I. does not say whether a kWh is electrical or thermal (a heat meter),
  and Gladys would count it as electricity.
- A digital channel (on/off, yes/no) is 0 or 1.

The badge of each device shows "local", or "unreachable" when the C.M.I. does
not answer or refuses the credentials (with an orange dot when only this node
could not be read: node not available, CAN bus busy…).

## Setup

1. Note the **IP address** of the C.M.I. (give it a reserved DHCP lease), a
   **user** of its web interface (admin by default) and its **password**.
2. Optional: note the numbers of the **CAN nodes** to read (shown by the web
   interface of the C.M.I.). Without this list, the integration asks the
   C.M.I. for it (one more request, every 6 hours).
3. In Gladys, install the TA C.M.I. integration, enter the address, the user
   and the password, and save.
4. Add the devices from the **Discovery** tab.

## One request per minute

The C.M.I. accepts **one request per minute** on its JSON API (it answers
"too many requests" otherwise). The integration keeps to this limit
strictly:

- two requests are always **at least 75 seconds** apart, counted from the end
  of the previous one (answer, error or timeout), whatever asks for them
  (regular read, button, Discovery);
- the time of the last request is kept in `/data` **before** each request: a
  restart never sends anything too early;
- all the nodes are read every **5 minutes** by default (120 to 3600
  seconds); with several nodes, each takes one request (two for some devices
  with "All", such as the CAN-BC2), so a full read of 4 nodes takes at least
  4 × 75 seconds.

If another program also reads the C.M.I. (or you open its web interface at
the same time), the C.M.I. may refuse a request: the integration then pauses
for 5, 10, then 15 minutes.

The **Test the connection** button sends a request only when the limit allows
it; otherwise it shows the status and the time left.

## Read only

The JSON API of the C.M.I. only reads: this integration **controls nothing**.
Every feature is read only; a command from Gladys (scene, dashboard, voice
assistant) is refused and nothing is sent.

## Credentials and privacy

- The password is **kept by Gladys in its database, never shown again, and
  sent only to the C.M.I.** (HTTP Basic authentication). It never appears in
  the logs, the status messages nor `/data`.
- The `/data` volume of the integration keeps the time of the last request,
  the current pause, a stop on refused credentials, the node list and the
  type of each node, with a hash of the address and port. Neither the user
  nor the password.
- Everything stays on your local network, over HTTP: anyone listening on that
  network can read the credentials, as with the web interface of the C.M.I.
  Prefer a dedicated user.

## Errors

- **Credentials refused** (HTTP 401 or 403): the reads stop; a new try after
  10 min, 1 h, then every 6 h, or at once when you change the address, the
  user or the password. **Test the connection** also tries again as soon as
  the limit allows it. The stop is kept across restarts.
- **Too many requests** (C.M.I. code 4 or HTTP 429): a pause of 5, 10, then 15
  minutes (Retry-After when given, 6 h at most), kept across restarts.
- **Node not available, CAN bus busy, device not supported** (codes 1, 2, 5,
  7): this node is marked unreachable, the others go on; it is read again at
  the next cycle.
- **C.M.I. unreachable** or unexpected answer: a new try after 1, 2, 5, 10,
  then every 15 minutes, never faster than the interval.
- An answer that is too large (over 256 KB) or not the expected JSON is
  refused.

## Limits

- Never tested with a real device.
- No channel names (the JSON API does not give them).
- The date and time system values are not read.
- When the unit of a channel changes on the controller, the feature already
  created keeps its old unit and gets no more values: delete the device, then
  add it again from Discovery (its history is lost).
- No CoE (CAN over Ethernet), no command.

## Credits

- [ta-cmi](https://gitlab.com/DeerMaximum/ta-cmi) by DeerMaximum (MIT): the
  endpoints of the JSON API, the status codes, the device types, their
  parameters and the unit codes are ported to JavaScript.
- See `THIRD_PARTY_NOTICES.md`.

Technische Alternative, C.M.I. and UVR are trademarks of Technische
Alternative RT GmbH; this project is not affiliated with Technische
Alternative.
