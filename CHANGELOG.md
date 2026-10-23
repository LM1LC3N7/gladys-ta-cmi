# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-20

### Added

- Technische Alternative controllers through the JSON API of the C.M.I., read
  only (ported from ta-cmi 3.7.1).
- One device per CAN node, one feature per channel: inputs, outputs and DL
  bus by default; system values, logging, network inputs, M-Bus, Modbus, KNX
  and electrical power on request.
- The C.M.I. limit of one request per minute kept strictly: 75 s at least
  after the end of the previous request, for every path, kept in `/data`
  across restarts.
- Nodes configured by hand, or the list of the C.M.I. (read again every 6 h).
- Units of the core only; temperatures as probes; energy and power as plain
  sensors (never in the energy dashboard).
- Refused credentials stop the reads (new try after 10 min, 1 h, then every
  6 h); "too many requests" pauses 5 to 15 min; other errors back off; all
  kept in `/data`. A node the C.M.I. cannot read is marked, the others go on.
- "Test the connection" button; the status, the Discovery list and the badges
  are sent again at each reconnection to Gladys.
- Device and feature names in French or English.

### Fixed

- A UVR65 or CAN-MTx2 on the CAN bus no longer stops the reads: it is read
  with the default parameters, and an internal error never leaves the
  integration without its next read.
- After a restart, the next request waits 75 s from the end of the previous
  one (not its start); when the state in `/data` cannot be read or written,
  the first request waits 75 s.
- A restart during a "too many requests" pause no longer shows the
  integration as disconnected after successful reads.
- A wall clock set back no longer holds the reads for that long.
- A device type sent as a number in the answer is recognized.

[Unreleased]: https://github.com/LM1LC3N7/gladys-ta-cmi/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-ta-cmi/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-ta-cmi/releases/tag/v0.1.1
