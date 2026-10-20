# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the project below. The ported parts were rewritten
in JavaScript; they are changed from the original (another language, another
structure, only what this integration needs, read only). None of the original
code is copied as is.

## ta-cmi

- Project: [DeerMaximum/ta-cmi](https://gitlab.com/DeerMaximum/ta-cmi),
  version 3.7.1, "A Python wrapper to read out sensors from Technische
  Alternative using the C.M.I.", by DeerMaximum.
- What is ported (in `src/constants.js`, `src/client.js` and
  `src/devices.js`): the two endpoints of the C.M.I. JSON API
  (`/INCLUDE/can_nodes.cgi` and `/INCLUDE/api.cgi?jsonnode=…&jsonparam=…`),
  the parsing of the node list, the status codes of the answer (code 4: one
  request per minute), the device type ids and the parameters each type
  supports, the split of a request above 7 parameters, the default
  parameters of an unknown device, the channel types (sections of `Data`),
  the fields of a channel (`Number`, `AD`, `Value`, `Unit`) and the unit
  codes.
- Changes: rewritten in JavaScript for a Gladys external integration; the
  CoE part of the reference is not ported; a strict gate of one request per
  75 s, counted from the end of the previous request and kept across
  restarts, for every request (the reference only waits between the two
  halves of a split read); the answers are read with a size limit and as
  untrusted data; the date and time system values are not read; no Home
  Assistant code.
- Licence: MIT. Full text below.

```
MIT License

Copyright (c) 2021 DeerMaximum

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
