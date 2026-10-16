/* ProtoLink Diagnostics — js/tag-converter.js
 * Modicon address <-> protocol offset, 32-bit register decode/encode, linear scaling.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});
  const hex2 = (n) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const hex4 = (n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');

  const TABLES = {
    0: { name: 'Coil (0x)', read: 'FC01', write: 'FC05 / FC15' },
    1: { name: 'Discrete Input (1x)', read: 'FC02', write: 'read-only' },
    3: { name: 'Input Register (3x)', read: 'FC04', write: 'read-only' },
    4: { name: 'Holding Register (4x)', read: 'FC03', write: 'FC06 / FC16 (FC22/23)' },
  };

  /** Parse a 5- or 6-digit Modicon reference (e.g. 40001 / 400001). */
  function parseModicon(str) {
    const s = String(str).trim();
    if (!/^\d{5,6}$/.test(s)) return { error: 'Enter a 5- or 6-digit Modicon address, e.g. 40001 or 400001.' };
    const t = Number(s[0]);
    if (!(t in TABLES)) return { error: `Leading digit ${t} is not a Modicon table — use 0, 1, 3 or 4.` };
    const ref = parseInt(s.slice(1), 10);
    if (ref < 1) return { error: 'Reference number must be ≥ 1 (Modicon numbering is 1-based).' };
    if (ref > 65536) return { error: 'Reference number exceeds 65536.' };
    const offset = ref - 1;
    return Object.assign({ table: t, ref, offset, hex: '0x' + hex4(offset), digits: s.length }, TABLES[t]);
  }

  /** Build a Modicon string from table digit + 0-based protocol offset. */
  function toModicon(table, offset, digits) {
    if (!(table in TABLES)) return { error: 'Unknown table.' };
    if (!Number.isInteger(offset) || offset < 0 || offset > 65535) return { error: 'Offset must be 0–65535.' };
    const ref = offset + 1;
    const d = digits === 6 ? 6 : 5;
    if (d === 5 && ref > 9999) return { error: 'Offset too large for the 5-digit format — use 6-digit.' };
    return { text: `${table}${String(ref).padStart(d - 1, '0')}` };
  }

  function fmtFloat(f) {
    if (Number.isNaN(f)) return 'NaN';
    if (!Number.isFinite(f)) return f > 0 ? '+Inf' : '-Inf';
    return Number(f.toPrecision(8)).toString();
  }

  const ORDERS = {
    ABCD: { label: 'ABCD — big-endian (Modbus standard, high word first)', map: [0, 1, 2, 3] },
    CDAB: { label: 'CDAB — word-swapped (low word first)', map: [2, 3, 0, 1] },
    BADC: { label: 'BADC — byte-swapped within words', map: [1, 0, 3, 2] },
    DCBA: { label: 'DCBA — little-endian (fully reversed)', map: [3, 2, 1, 0] },
  };

  /** Interpret two 16-bit registers (w0 = first register read, w1 = second) in all four byte orders. */
  function decode32(w0, w1) {
    const raw = [(w0 >> 8) & 0xff, w0 & 0xff, (w1 >> 8) & 0xff, w1 & 0xff];
    const out = {};
    Object.keys(ORDERS).forEach((k) => {
      const b = ORDERS[k].map.map((i) => raw[i]);
      const dv = new DataView(new Uint8Array(b).buffer);
      out[k] = { label: ORDERS[k].label, bytes: b.map(hex2).join(' '), u32: dv.getUint32(0), i32: dv.getInt32(0), f32: fmtFloat(dv.getFloat32(0)) };
    });
    return out;
  }

  /** Encode a number into two registers for each byte order. type: 'f32' | 'i32' | 'u32' */
  function encode32(value, type) {
    const dv = new DataView(new ArrayBuffer(4));
    if (type === 'f32') dv.setFloat32(0, value);
    else if (type === 'i32') { if (value < -2147483648 || value > 2147483647) return { error: 'Out of int32 range.' }; dv.setInt32(0, value); }
    else { if (value < 0 || value > 4294967295) return { error: 'Out of uint32 range.' }; dv.setUint32(0, value); }
    const a = [0, 1, 2, 3].map((i) => dv.getUint8(i)); // ABCD as bytes A,B,C,D
    const out = {};
    Object.keys(ORDERS).forEach((k) => {
      const b = ORDERS[k].map.map((i) => a[i]); // inverse mapping is its own inverse for these four orders
      const w0 = (b[0] << 8) | b[1], w1 = (b[2] << 8) | b[3];
      out[k] = { label: ORDERS[k].label, w0, w1, text: `0x${hex4(w0)} (${w0})   0x${hex4(w1)} (${w1})` };
    });
    return out;
  }

  /** Linear scaling raw → engineering units. */
  function scale(raw, rmin, rmax, emin, emax) {
    if (rmax === rmin) return { error: 'Raw min and max must differ.' };
    const v = emin + ((raw - rmin) * (emax - emin)) / (rmax - rmin);
    return { value: v, pct: ((raw - rmin) / (rmax - rmin)) * 100 };
  }

  /** Parse "123", "0x7B", "-5" → number or NaN. */
  function num(s) {
    s = String(s).trim();
    if (!s) return NaN;
    if (/^[-+]?0x[0-9a-f]+$/i.test(s)) return (s[0] === '-' ? -1 : 1) * parseInt(s.replace(/^[-+]/, ''), 16);
    if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
    return Number(s);
  }

  PL.convert = { TABLES, ORDERS, parseModicon, toModicon, decode32, encode32, scale, num };
})(typeof window !== 'undefined' ? window : globalThis);
