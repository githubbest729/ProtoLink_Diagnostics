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

  // ------------------------------------------------------------------ 32/64-bit endianness & word swapper
  // "raw" = bytes in the order they arrive: register 0 high byte, register 0 low byte, register 1 high byte, ...
  // "canonical" = big-endian bytes of the value. All four index maps are their own inverse, so the same map
  // converts raw → canonical and canonical → raw.
  const ENDIAN = [
    { key: 'ABCD', name: 'Big-Endian', note: 'typical Siemens S7 / TIA Portal' },
    { key: 'DCBA', name: 'Little-Endian', note: 'typical Rockwell / Allen-Bradley Logix' },
    { key: 'BADC', name: 'Mid-Big (byte swap)', note: 'bytes swapped inside each 16-bit word' },
    { key: 'CDAB', name: 'Mid-Little (word swap)', note: '16-bit words in reverse order' },
  ];

  function orderIdx(n, key) {
    const idx = Array.from({ length: n }, (_, i) => i);
    if (key === 'ABCD') return idx;
    if (key === 'DCBA') return idx.slice().reverse();
    if (key === 'BADC') return idx.map((i) => i ^ 1);
    if (key === 'CDAB') { const o = []; for (let k = n / 2 - 1; k >= 0; k--) o.push(2 * k, 2 * k + 1); return o; }
    throw new Error('Unknown byte order ' + key);
  }
  const applyOrder = (bytes, key) => orderIdx(bytes.length, key).map((i) => bytes[i]);

  /** Display label, e.g. ABCD → "ABCDEFGH" for 64-bit. */
  const orderLabel = (key, n) => {
    const L = 'ABCDEFGH'.slice(0, n).split('');
    return orderIdx(n, key).map((i) => L[i]).join('');
  };

  const fmtNum = (f, digits) => {
    if (Number.isNaN(f)) return 'NaN';
    if (!Number.isFinite(f)) return f > 0 ? '+Inf' : '-Inf';
    return Number(f.toPrecision(digits)).toString();
  };

  /** Decode 4 or 8 raw bytes under one order. */
  function decodeBytes(raw, key) {
    const n = raw.length;
    if (n !== 4 && n !== 8) throw new Error('Need 4 or 8 bytes.');
    const canon = applyOrder(raw, key);
    const dv = new DataView(new Uint8Array(canon).buffer);
    const hex = canon.map(hex2).join(' ');
    if (n === 4) return { canon: hex, u: String(dv.getUint32(0)), i: String(dv.getInt32(0)), f: fmtNum(dv.getFloat32(0), 8) };
    return { canon: hex, u: dv.getBigUint64(0).toString(), i: dv.getBigInt64(0).toString(), f: fmtNum(dv.getFloat64(0), 16) };
  }

  /** Decode under all four orders. */
  function decodeAll(raw) {
    const out = {};
    ENDIAN.forEach((e) => { out[e.key] = Object.assign({ label: orderLabel(e.key, raw.length) }, e, decodeBytes(raw, e.key)); });
    return out;
  }

  /** Convert raw bytes laid out in order `from` into the layout of order `to`. */
  function convertOrder(raw, from, to) { return applyOrder(applyOrder(raw, from), to); }

  const toWords = (bytes) => { const w = []; for (let i = 0; i < bytes.length; i += 2) w.push((bytes[i] << 8) | bytes[i + 1]); return w; };
  const wordsText = (bytes) => toWords(bytes).map((w) => '0x' + hex4(w)).join(' ');

  /** Parse "123, 0x4048" (registers) or "40 48 F5 C3" (bytes) into bytes. width = 32|64. */
  function parseRaw(str, mode, width) {
    const need = width / 8;
    if (!String(str).trim()) return { error: 'Enter the raw value.' };
    if (mode === 'bytes') {
      const p = g.PL.editor ? g.PL.editor.parseInput(str) : { error: 'editor.js missing' };
      if (p.error) return { error: p.error };
      if (p.bytes.length !== need) return { error: `Expected ${need} bytes for ${width}-bit, got ${p.bytes.length}.` };
      return { bytes: p.bytes };
    }
    const toks = String(str).trim().split(/[\s,;]+/).filter(Boolean);
    if (toks.length !== need / 2) return { error: `Expected ${need / 2} registers for ${width}-bit, got ${toks.length}.` };
    const bytes = [];
    for (const t of toks) {
      const v = num(t);
      if (!Number.isInteger(v) || v < -32768 || v > 65535) return { error: `"${t}" is not a 16-bit register value (0–65535 or 0x0000–0xFFFF).` };
      bytes.push((v >> 8) & 0xff, v & 0xff);
    }
    return { bytes };
  }

  /** Parse integer text (decimal / 0x hex) to BigInt, or null. */
  function parseBig(s) {
    s = String(s).trim();
    try { if (/^[-+]?\d+$/.test(s)) return BigInt(s); if (/^[-+]?0x[0-9a-f]+$/i.test(s)) return s[0] === '-' ? -BigInt(s.slice(1)) : BigInt(s.replace(/^\+/, '')); } catch (e) { /* fall through */ }
    return null;
  }

  /** Encode a value into raw bytes for each order. type: 'f' | 'i' | 'u'. width: 32 | 64. */
  function encodeValue(text, type, width) {
    const n = width / 8;
    const dv = new DataView(new ArrayBuffer(n));
    if (type === 'f') {
      const v = num(text);
      if (Number.isNaN(v)) return { error: 'Not a number.' };
      if (n === 4) dv.setFloat32(0, v); else dv.setFloat64(0, v);
    } else {
      const b = parseBig(text);
      if (b === null) return { error: 'Enter a whole number (decimal or 0x hex).' };
      const bits = BigInt(width);
      const lo = type === 'i' ? -(1n << (bits - 1n)) : 0n, hi = type === 'i' ? (1n << (bits - 1n)) - 1n : (1n << bits) - 1n;
      if (b < lo || b > hi) return { error: `Out of ${type === 'i' ? 'signed' : 'unsigned'} ${width}-bit range (${lo} … ${hi}).` };
      if (n === 4) { if (type === 'i') dv.setInt32(0, Number(b)); else dv.setUint32(0, Number(b)); }
      else if (type === 'i') dv.setBigInt64(0, b); else dv.setBigUint64(0, b);
    }
    const canon = Array.from(new Uint8Array(dv.buffer));
    const out = {};
    ENDIAN.forEach((e) => { const raw = applyOrder(canon, e.key); out[e.key] = Object.assign({ label: orderLabel(e.key, n), raw, hex: raw.map(hex2).join(' '), words: wordsText(raw) }, e); });
    return out;
  }

  PL.convert = { TABLES, ORDERS, ENDIAN, parseModicon, toModicon, decode32, encode32, scale, num, orderIdx, applyOrder, orderLabel, decodeBytes, decodeAll, convertOrder, parseRaw, parseBig, encodeValue, wordsText };
})(typeof window !== 'undefined' ? window : globalThis);
