// -----------------------------------------------------------------------------
// Answers of the C.M.I. JSON API, shaped as in the reference's tests
// (DeerMaximum/ta-cmi 3.7.1) and the C.M.I. JSON API manual. Never seen on a
// real C.M.I.
// -----------------------------------------------------------------------------

export const SECOND = 1_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const NOW = Date.UTC(2026, 9, 20, 10, 0, 0);

export const HOST = '192.168.1.60';
export const USER = 'admin';
export const PASSWORD = 'Sécret-p@ss';
export const CONFIG = { host: HOST, username: USER, password: PASSWORD };

const analog = (number, value, unit) => ({
  Number: number,
  AD: 'A',
  Value: { Value: value, Unit: unit },
});
const digital = (number, value, unit = '43') => ({
  Number: number,
  AD: 'D',
  Value: { Value: value, Unit: unit },
});

/** A UVR16x2 (type 87): the sections of its parameters. */
export const UVR16X2_SECTIONS = {
  Inputs: [analog(1, 61.4, '1'), analog(2, -3.2, '1'), analog(3, 450, '3'), digital(4, 1)],
  Outputs: [
    digital(1, 1),
    { Number: 2, AD: 'D', Value: { State: 0, Unit: '43' } },
    analog(3, 70, '8'),
  ],
  'DL-Bus': [analog(1, 21.5, '1'), analog(2, 1.8, '23')],
  General: [analog(1, 230, '13')],
  Date: [analog(1, 20, '0')],
  Time: [analog(1, 600, '60')],
  Sun: [analog(1, 32.5, '54')],
  'Logging Analog': [analog(1, 1234.5, '11'), analog(2, 3.4, '10')],
  'Logging Digital': [digital(1, 0)],
};

/** The answer to some parameters: the sections they ask for. */
const PARAMS = {
  I: 'Inputs',
  O: 'Outputs',
  D: 'DL-Bus',
  Sg: 'General',
  Sd: 'Date',
  St: 'Time',
  Ss: 'Sun',
  La: 'Logging Analog',
  Ld: 'Logging Digital',
};

export function answer({
  device = '87',
  params = ['I', 'O'],
  sections = UVR16X2_SECTIONS,
  code = 0,
} = {}) {
  const data = {};
  for (const p of params) {
    const name = PARAMS[p];
    if (name && sections[name]) {
      data[name] = sections[name];
    }
  }
  return {
    Header: { Version: 7, Device: device, Timestamp: 1_760_000_000 },
    Data: data,
    Status: code === 0 ? 'OK' : 'ERROR',
    'Status code': code,
  };
}
