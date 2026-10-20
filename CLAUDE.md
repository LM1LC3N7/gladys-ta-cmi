# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Technische Alternative
controllers, read only, through the JSON API of the C.M.I.: a Node.js service
(Node 22+, ESM, no build step) that runs in its own sandboxed Docker container
and talks to Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.
`TODO.md` holds the status and the decisions.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "minute"  # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only
src/handlers.js                   SDK handlers -> CmiApp (shared with the tests)
src/app.js                        lifecycle, cycles (one request per step), errors, devices, badges
src/client.js                     the JSON API: the 75 s gate, Basic auth, status codes
src/http.js                       bounded GET, errors without secrets
src/devices.js                    answers -> Gladys devices and states (pure)
src/config.js                     config_schema normalized (address, nodes)
src/store.js                      /data: last request, pause, stop, nodes, types
src/publisher.js                  states within Gladys' limits
gladys-assistant-integration.json manifest
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys and a fake C.M.I.
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **One request per minute to the C.M.I., strictly.** Every request goes
  through `CmiClient.get` (one at a time, 75 s after the end of the previous
  one, time kept in `/data` before sending). Never add a retry inside a step,
  never bypass the gate, never call the transport elsewhere.
- **Read only.** No feature is writable, `onSetValue` refuses every command.
- **Credentials.** The Authorization header is built in `src/client.js` only;
  never log it, never put the user or the password in an error, a status or
  `/data`.
- **The answer is untrusted.** Bounded size, own keys only (`Object.hasOwn`),
  bounded lists, linear parsing.
- **External ids are forever.** `ext:<selector>:cmi:node<n>` and the feature
  roles `<section>-<number>` (section codes frozen in
  `test/devices.test.js`). A republished device never loses a feature and
  keeps the shape it was created with.
- **Units of the core only** (`DEVICE_FEATURE_UNITS_BY_CATEGORY`); no
  energy-sensor feature (a kWh of the C.M.I. may be thermal).
- **The container rootfs is read-only.** Write only under `/data`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md`. Never write a version heading.
- **User-facing text** is bilingual (English and French), docs kept in sync.
  A `secret` field is described as kept by Gladys in its database, never shown
  again: never as protected by a cipher.
- **Files** are UTF-8 without BOM (`test/encoding.test.js`).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (loopback only).
