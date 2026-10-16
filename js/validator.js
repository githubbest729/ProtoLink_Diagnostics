/* ProtoLink Diagnostics — js/validator.js
 * Modbus RTU / TCP / ASCII frame parsing + CRC-16 / LRC validation + frame builder.
 * Pure functions, no DOM. Works in browser and Node (for tests).
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});

  const hex2 = (n) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');
  const hex4 = (n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const u16 = (d, i) => ((d[i] << 8) | d[i + 1]) & 0xffff;
  const i16 = (v) => (v & 0x8000 ? v - 0x10000 : v);
  const bin8 = (n) => (n & 0xff).toString(2).padStart(8, '0');

  const FC_NAMES = {
    1: 'Read Coils', 2: 'Read Discrete Inputs', 3: 'Read Holding Registers', 4: 'Read Input Registers',
    5: 'Write Single Coil', 6: 'Write Single Register', 7: 'Read Exception Status', 8: 'Diagnostics',
    11: 'Get Comm Event Counter', 12: 'Get Comm Event Log', 15: 'Write Multiple Coils',
    16: 'Write Multiple Registers', 17: 'Report Server ID', 20: 'Read File Record', 21: 'Write File Record',
    22: 'Mask Write Register', 23: 'Read/Write Multiple Registers', 24: 'Read FIFO Queue',
    43: 'Encapsulated Interface Transport (MEI)',
  };

  const EXC = {
    1: ['Illegal Function', 'The device does not support this function code (or not in its current mode).'],
    2: ['Illegal Data Address', 'Address/quantity is outside the device register map. Check 0- vs 1-based offset, the Modicon prefix (4xxxx), and the maximum block size.'],
    3: ['Illegal Data Value', 'A value or quantity is out of range (e.g. > 125 registers, bad coil value, byte count mismatch).'],
    4: ['Server Device Failure', 'Unrecoverable error while the device processed the request.'],
    5: ['Acknowledge', 'Request accepted, long-running; poll again later.'],
    6: ['Server Device Busy', 'Device busy with a long command; retry after a delay.'],
    7: ['Negative Acknowledge', 'Device cannot perform the programming function.'],
    8: ['Memory Parity Error', 'Extended-memory parity error on file-record access.'],
    10: ['Gateway Path Unavailable', 'Gateway cannot route to the target (misconfigured unit-ID → port map or overloaded).'],
    11: ['Gateway Target Device Failed to Respond', 'Nothing answered behind the gateway: check serial wiring, baud/parity, slave ID.'],
  };

  const DIAG_SUB = {
    0: 'Return Query Data (loopback)', 1: 'Restart Communications Option', 2: 'Return Diagnostic Register',
    3: 'Change ASCII Input Delimiter', 4: 'Force Listen Only Mode', 10: 'Clear Counters and Diagnostic Register',
    11: 'Return Bus Message Count', 12: 'Return Bus Communication Error Count',
    13: 'Return Bus Exception Error Count', 14: 'Return Server Message Count',
    15: 'Return Server No Response Count', 16: 'Return Server NAK Count', 17: 'Return Server Busy Count',
    18: 'Return Bus Character Overrun Count', 20: 'Clear Overrun Counter and Flag',
  };

  /** Modbus RTU CRC-16 (poly 0xA001, init 0xFFFF). Transmitted low byte first. */
  function crc16(b, s, e) {
    s = s || 0;
    e = e === undefined ? b.length : e;
    let crc = 0xffff;
    for (let i = s; i < e; i++) {
      crc ^= b[i] & 0xff;
      for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
    }
    return crc & 0xffff;
  }

  /** Modbus ASCII LRC: two's complement of the 8-bit sum. */
  function lrc(b, s, e) {
    s = s || 0;
    e = e === undefined ? b.length : e;
    let sum = 0;
    for (let i = s; i < e; i++) sum = (sum + (b[i] & 0xff)) & 0xff;
    return -sum & 0xff;
  }

  function modicon(fc, a) {
    const t = { 1: 0, 2: 1, 3: 4, 4: 3, 5: 0, 6: 4, 15: 0, 16: 4, 22: 4, 23: 4 }[fc];
    if (t === undefined) return '';
    const n = a + 1;
    return a < 9999 ? `${t}${String(n).padStart(4, '0')}` : `${t}${String(n).padStart(5, '0')}`;
  }

  /** Decode PDU data (everything after the function code). Offsets are relative to d[0]. */
  function decodePdu(fcRaw, d, dirOpt) {
    const out = { dir: 'unknown', fields: [], warnings: [], notes: [], hint: '', summary: '', registers: null, bits: null };
    const F = (label, off, len, text, cls) => out.fields.push({ label, off, len, text, cls: cls || 'data' });
    const W = (m) => out.warnings.push(m);
    const fc = fcRaw & 0x7f;
    const name = FC_NAMES[fc] || `Function ${fc}`;
    const pick = (auto) => (dirOpt === 'request' || dirOpt === 'response' ? dirOpt : auto());

    if (fcRaw & 0x80) {
      out.dir = 'response';
      if (d.length !== 1) W(`An exception response carries exactly 1 byte (the exception code); found ${d.length}.`);
      if (d.length) {
        const e = EXC[d[0]];
        F('Exception Code', 0, 1, `0x${hex2(d[0])} — ${e ? e[0] : 'Unknown / vendor-specific'}`, 'exc');
        if (e) out.hint = e[1];
        out.summary = `Exception response to ${name}: ${e ? e[0] : 'code 0x' + hex2(d[0])}`;
      } else out.summary = `Exception response to ${name} (no exception code!)`;
      if (d.length > 1) F('Unexpected extra bytes', 1, d.length - 1, 'ignored', 'err');
      return out;
    }

    switch (fc) {
      case 1: case 2: case 3: case 4: {
        const bit = fc <= 2;
        const dir = pick(() => (d.length === 4 ? 'request' : d.length >= 1 && d[0] === d.length - 1 ? 'response' : 'request'));
        out.dir = dir;
        if (dir === 'request') {
          if (d.length !== 4) W(`A read request carries 4 data bytes (address + quantity); found ${d.length}.`);
          let a = null, q = null;
          if (d.length >= 2) { a = u16(d, 0); F('Start Address', 0, 2, `0x${hex4(a)} = ${a}  →  ${modicon(fc, a)}`, 'reg'); }
          if (d.length >= 4) {
            q = u16(d, 2);
            const max = bit ? 2000 : 125;
            F('Quantity', 2, 2, `${q} ${bit ? 'point(s)' : 'register(s)'}`, 'qty');
            if (q < 1 || q > max) W(`Quantity ${q} is outside the legal range 1–${max}.`);
            if (a + q > 65536) W('Start address + quantity runs past address 65535.');
          }
          if (d.length > 4) F('Unexpected extra bytes', 4, d.length - 4, 'ignored', 'err');
          out.summary = a === null ? `${name} request (incomplete)` :
            `${name} request — ${q === null ? '?' : q} ${bit ? 'point(s)' : 'register(s)'} from address ${a} (${modicon(fc, a)})`;
          if (bit && d.length === 4 && d[0] === 3) out.notes.push('Ambiguous: with 4 data bytes starting 0x03 this could also be a 3-byte coil response. Set Direction manually if needed.');
        } else {
          if (!d.length) { W('Response has no data.'); out.summary = `${name} response (empty)`; return out; }
          const bc = d[0];
          F('Byte Count', 0, 1, `${bc} data byte(s) follow`, 'qty');
          const payload = d.slice(1);
          if (bc !== payload.length) W(`Byte count says ${bc} but ${payload.length} data byte(s) are present.`);
          if (bit) {
            out.bits = [];
            payload.forEach((byte, j) => {
              const bits = [];
              for (let k = 0; k < 8; k++) { const v = (byte >> k) & 1; bits.push(v); out.bits.push(v); }
              F(`Status byte ${j}`, 1 + j, 1, `0x${hex2(byte)} = ${bin8(byte)}b → points +${8 * j}…+${8 * j + 7} (LSB first): ${bits.join(' ')}`, 'data');
            });
            out.summary = `${name} response — ${payload.length} byte(s) = ${out.bits.length} bit(s) (padded to a whole byte)`;
          } else {
            if (payload.length % 2) W('Register data must be an even number of bytes.');
            out.registers = [];
            for (let i = 0; i + 1 < payload.length; i += 2) {
              const v = u16(payload, i);
              out.registers.push(v);
              F(`Register +${i / 2}`, 1 + i, 2, `0x${hex4(v)} = ${v} (signed ${i16(v)})`, 'data');
            }
            if (payload.length % 2) F('Stray byte', d.length - 1, 1, 'odd trailing byte', 'err');
            out.summary = `${name} response — ${out.registers.length} register(s)`;
          }
        }
        break;
      }
      case 5: case 6: {
        out.dir = pick(() => 'request');
        if (d.length !== 4) W(`${name} carries 4 data bytes; found ${d.length}.`);
        const a = d.length >= 2 ? u16(d, 0) : null;
        if (a !== null) F(fc === 5 ? 'Coil Address' : 'Register Address', 0, 2, `0x${hex4(a)} = ${a}  →  ${modicon(fc, a)}`, 'reg');
        if (d.length >= 4) {
          const v = u16(d, 2);
          if (fc === 5) {
            const t = v === 0xff00 ? 'ON (0xFF00)' : v === 0 ? 'OFF (0x0000)' : `0x${hex4(v)} — INVALID, must be 0xFF00 or 0x0000`;
            if (v !== 0xff00 && v !== 0) W('Coil value must be exactly 0xFF00 (ON) or 0x0000 (OFF).');
            F('Coil Value', 2, 2, t, 'data');
            out.summary = `${name} — coil ${a} (${modicon(fc, a)}) → ${v === 0xff00 ? 'ON' : v === 0 ? 'OFF' : 'invalid'}`;
          } else {
            F('Register Value', 2, 2, `0x${hex4(v)} = ${v} (signed ${i16(v)})`, 'data');
            out.summary = `${name} — register ${a} (${modicon(fc, a)}) = ${v}`;
          }
        } else out.summary = `${name} (incomplete)`;
        if (d.length > 4) F('Unexpected extra bytes', 4, d.length - 4, 'ignored', 'err');
        out.notes.push('Request and normal response are identical (the server echoes the request).');
        break;
      }
      case 15: case 16: {
        const coil = fc === 15;
        const dir = pick(() => (d.length === 4 ? 'response' : 'request'));
        out.dir = dir;
        const a = d.length >= 2 ? u16(d, 0) : null;
        const q = d.length >= 4 ? u16(d, 2) : null;
        if (a !== null) F('Start Address', 0, 2, `0x${hex4(a)} = ${a}  →  ${modicon(fc, a)}`, 'reg');
        if (q !== null) {
          F('Quantity', 2, 2, `${q} ${coil ? 'coil(s)' : 'register(s)'}`, 'qty');
          const max = coil ? 1968 : 123;
          if (q < 1 || q > max) W(`Quantity ${q} is outside the legal range 1–${max}.`);
        }
        if (dir === 'response') {
          if (d.length !== 4) W('A write-multiple response carries 4 data bytes (address + quantity).');
          out.summary = `${name} response — acknowledged ${q} ${coil ? 'coil(s)' : 'register(s)'} from address ${a}`;
        } else {
          if (d.length < 5) { W('Request too short: missing byte count.'); out.summary = `${name} request (incomplete)`; break; }
          const bc = d[4];
          F('Byte Count', 4, 1, `${bc} data byte(s)`, 'qty');
          const payload = d.slice(5);
          const exp = coil ? Math.ceil(q / 8) : q * 2;
          if (bc !== payload.length) W(`Byte count says ${bc} but ${payload.length} data byte(s) are present.`);
          if (q !== null && bc !== exp) W(`For ${q} ${coil ? 'coil(s)' : 'register(s)'} the byte count should be ${exp}, found ${bc}.`);
          if (coil) {
            payload.forEach((byte, j) => F(`Coil byte ${j}`, 5 + j, 1, `0x${hex2(byte)} = ${bin8(byte)}b → coils +${8 * j}…+${8 * j + 7} (LSB first)`, 'data'));
          } else {
            out.registers = [];
            for (let i = 0; i + 1 < payload.length; i += 2) {
              const v = u16(payload, i);
              out.registers.push(v);
              F(`Value +${i / 2}`, 5 + i, 2, `0x${hex4(v)} = ${v} (signed ${i16(v)})`, 'data');
            }
            if (payload.length % 2) F('Stray byte', d.length - 1, 1, 'odd trailing byte', 'err');
          }
          out.summary = `${name} request — ${q} ${coil ? 'coil(s)' : 'register(s)'} starting at ${a} (${a === null ? '' : modicon(fc, a)})`;
        }
        break;
      }
      case 22: {
        out.dir = pick(() => 'request');
        if (d.length !== 6) W('Mask Write Register carries 6 data bytes (address, AND mask, OR mask).');
        if (d.length >= 2) F('Reference Address', 0, 2, `0x${hex4(u16(d, 0))} → ${modicon(fc, u16(d, 0))}`, 'reg');
        if (d.length >= 4) F('AND Mask', 2, 2, `0x${hex4(u16(d, 2))} = ${bin8(d[2])} ${bin8(d[3])}b`, 'data');
        if (d.length >= 6) F('OR Mask', 4, 2, `0x${hex4(u16(d, 4))} = ${bin8(d[4])} ${bin8(d[5])}b`, 'data');
        out.summary = `${name}: result = (current AND AND-mask) OR (OR-mask AND NOT AND-mask)`;
        break;
      }
      case 23: {
        const dir = pick(() => (d.length >= 9 && d[8] === d.length - 9 ? 'request' : 'response'));
        out.dir = dir;
        if (dir === 'request') {
          if (d.length < 9) { W('Request too short.'); break; }
          F('Read Start Address', 0, 2, `0x${hex4(u16(d, 0))} → ${modicon(fc, u16(d, 0))}`, 'reg');
          F('Read Quantity', 2, 2, `${u16(d, 2)} register(s)`, 'qty');
          F('Write Start Address', 4, 2, `0x${hex4(u16(d, 4))} → ${modicon(fc, u16(d, 4))}`, 'reg');
          F('Write Quantity', 6, 2, `${u16(d, 6)} register(s)`, 'qty');
          F('Write Byte Count', 8, 1, `${d[8]}`, 'qty');
          if (d[8] !== d.length - 9) W('Write byte count does not match payload length.');
          if (d[8] !== u16(d, 6) * 2) W('Write byte count should equal 2 × write quantity.');
          for (let i = 9; i + 1 < d.length; i += 2) F(`Write value +${(i - 9) / 2}`, i, 2, `0x${hex4(u16(d, i))} = ${u16(d, i)}`, 'data');
          out.summary = `${name} request`;
        } else {
          if (!d.length) { W('No data.'); break; }
          F('Byte Count', 0, 1, `${d[0]}`, 'qty');
          out.registers = [];
          for (let i = 1; i + 1 < d.length; i += 2) { const v = u16(d, i); out.registers.push(v); F(`Register +${(i - 1) / 2}`, i, 2, `0x${hex4(v)} = ${v} (signed ${i16(v)})`, 'data'); }
          out.summary = `${name} response — ${out.registers.length} register(s)`;
        }
        break;
      }
      case 7: {
        out.dir = pick(() => (d.length === 0 ? 'request' : 'response'));
        if (out.dir === 'response' && d.length) F('Output Data', 0, 1, `0x${hex2(d[0])} = ${bin8(d[0])}b`, 'data');
        out.summary = `${name} ${out.dir}`;
        break;
      }
      case 8: {
        out.dir = pick(() => 'request');
        if (d.length >= 2) F('Sub-function', 0, 2, `0x${hex4(u16(d, 0))} — ${DIAG_SUB[u16(d, 0)] || 'unknown'}`, 'reg');
        if (d.length >= 4) F('Data', 2, d.length - 2, `0x${hex4(u16(d, 2))}`, 'data');
        out.summary = `${name}${d.length >= 2 ? ': ' + (DIAG_SUB[u16(d, 0)] || 'sub-function 0x' + hex4(u16(d, 0))) : ''}`;
        break;
      }
      case 11: {
        out.dir = pick(() => (d.length === 0 ? 'request' : 'response'));
        if (d.length >= 4) { F('Status', 0, 2, `0x${hex4(u16(d, 0))}`, 'data'); F('Event Count', 2, 2, `${u16(d, 2)}`, 'data'); }
        out.summary = `${name} ${out.dir}`;
        break;
      }
      case 17: {
        out.dir = pick(() => (d.length === 0 ? 'request' : 'response'));
        if (d.length) { F('Byte Count', 0, 1, `${d[0]}`, 'qty'); if (d.length > 1) F('Server ID / status / additional data', 1, d.length - 1, 'device specific', 'data'); }
        out.summary = `${name} ${out.dir}`;
        break;
      }
      default:
        out.dir = pick(() => 'unknown');
        if (d.length) F('Data', 0, d.length, 'raw (no decoder for this function code)', 'data');
        out.summary = `${name} — raw data shown`;
    }
    return out;
  }

  /**
   * Extract copy-ready plain values from a decoded field (so a technician can paste "655371", not retype it).
   * @returns {Array<[string,string]>} [title, value] pairs
   */
  function copyValues(label, text) {
    const out = [];
    let m;
    text = String(text || '');
    if ((m = /^0x([0-9A-F]{4})(?: = (\d+))?\s+→\s+(\d{5,6})\b/.exec(text))) {
      out.push(['offset', m[2] !== undefined ? m[2] : String(parseInt(m[1], 16))], ['Modicon', m[3]]);
    } else if ((m = /^0x([0-9A-F]{4}) = (\d+)(?: \(signed (-?\d+)\))?/.exec(text))) {
      out.push(['unsigned', m[2]]);
      if (m[3] !== undefined) out.push(['signed', m[3]]);
      out.push(['hex', '0x' + m[1]]);
    } else if (/^(Quantity|Byte Count|Read Quantity|Write Quantity|Write Byte Count)$/.test(label) && (m = /^(\d+)/.exec(text))) {
      out.push(['value', m[1]]);
    }
    return out;
  }

  function looksTcp(b) {
    return b.length >= 8 && b[2] === 0 && b[3] === 0 && u16(b, 4) === b.length - 6;
  }

  /**
   * Analyse a frame.
   * @param {number[]} bytes  RTU: full frame incl. CRC. TCP: MBAP+PDU. ASCII: decoded bytes incl. LRC.
   * @param {{mode?:'auto'|'rtu'|'tcp'|'ascii', dir?:'auto'|'request'|'response', ascii?:boolean}} opts
   */
  function analyze(bytes, opts) {
    opts = Object.assign({ mode: 'auto', dir: 'auto', ascii: false }, opts || {});
    const r = { mode: null, bytes, segments: [], issues: [], checksum: null, pdu: null, summary: '', ok: false, unit: null, fc: null };
    const issue = (level, msg) => r.issues.push({ level, msg });
    const seg = (label, off, len, cls, text) => r.segments.push({ label, off, len, cls, text: text || '', copy: copyValues(label, text) });
    const n = bytes.length;
    if (!n) { issue('error', 'No bytes to analyse.'); return r; }

    let mode = opts.mode;
    if (mode === 'auto') {
      if (opts.ascii) mode = 'ascii';
      else if (looksTcp(bytes)) mode = 'tcp';
      else if (n >= 4 && crc16(bytes, 0, n - 2) === (bytes[n - 2] | (bytes[n - 1] << 8))) mode = 'rtu';
      else if (n >= 8 && bytes[2] === 0 && bytes[3] === 0 && u16(bytes, 4) <= n) mode = 'tcp';
      else mode = 'rtu';
    }
    r.mode = mode;

    let unitIdx = 0, fcIdx = 1, dStart = 2, dEnd = n;

    if (mode === 'tcp') {
      if (n < 8) {
        issue('error', `Modbus TCP needs at least 8 bytes (7-byte MBAP header + function code); got ${n}.`);
        seg('Raw', 0, n, 'err', 'too short');
        r.summary = 'Frame too short';
        return r;
      }
      const txid = u16(bytes, 0), proto = u16(bytes, 2), len = u16(bytes, 4);
      seg('Transaction ID', 0, 2, 'hdr', `0x${hex4(txid)} (${txid}) — echoed back by the server`);
      seg('Protocol ID', 2, 2, 'hdr', proto === 0 ? '0x0000 — Modbus' : `0x${hex4(proto)} — must be 0x0000`);
      if (proto !== 0) issue('error', `Protocol ID is 0x${hex4(proto)}; Modbus TCP requires 0x0000. Is this really Modbus TCP (or an RTU frame)?`);
      seg('Length', 4, 2, 'hdr', `${len} — bytes that follow (Unit ID + PDU)`);
      if (len !== n - 6) {
        issue('error', len > n - 6
          ? `Length field says ${len} byte(s) follow but only ${n - 6} are present — frame truncated?`
          : `Length field says ${len} byte(s) follow but ${n - 6} are present — extra bytes (two frames concatenated?).`);
      }
      unitIdx = 6; fcIdx = 7; dStart = 8; dEnd = n;
      r.checksum = { type: 'none', ok: true, text: 'Modbus TCP has no CRC/LRC — integrity is handled by TCP.' };
    } else if (mode === 'ascii') {
      if (n < 3) { issue('error', `Modbus ASCII needs at least 3 decoded bytes (address, function, LRC); got ${n}.`); seg('Raw', 0, n, 'err', 'too short'); r.summary = 'Frame too short'; return r; }
      dEnd = n - 1;
      const calc = lrc(bytes, 0, n - 1), got = bytes[n - 1];
      const ok = calc === got;
      r.checksum = { type: 'LRC', ok, expected: hex2(calc), actual: hex2(got), text: ok ? `LRC 0x${hex2(got)} is correct.` : `LRC mismatch: frame has 0x${hex2(got)}, calculated 0x${hex2(calc)}.` };
      seg('LRC', n - 1, 1, ok ? 'crc' : 'err', r.checksum.text);
      if (!ok) issue('error', r.checksum.text);
    } else {
      if (n < 4) { issue('error', `Modbus RTU needs at least 4 bytes (address, function, CRC×2); got ${n}.`); seg('Raw', 0, n, 'err', 'too short'); r.summary = 'Frame too short'; return r; }
      dEnd = n - 2;
      const calc = crc16(bytes, 0, n - 2);
      const got = bytes[n - 2] | (bytes[n - 1] << 8);
      const ok = calc === got;
      const calcB = `${hex2(calc & 0xff)} ${hex2(calc >> 8)}`;
      r.checksum = { type: 'CRC-16', ok, expected: calcB, actual: `${hex2(bytes[n - 2])} ${hex2(bytes[n - 1])}`,
        text: ok ? `CRC-16 ${hex2(bytes[n - 2])} ${hex2(bytes[n - 1])} (low byte first) is correct.` : `CRC mismatch: frame has ${hex2(bytes[n - 2])} ${hex2(bytes[n - 1])}, calculated ${calcB} (low byte first).` };
      seg('CRC-16 (lo, hi)', n - 2, 2, ok ? 'crc' : 'err', r.checksum.text);
      if (!ok) {
        issue('error', r.checksum.text);
        if (((bytes[n - 2] << 8) | bytes[n - 1]) === calc) issue('warn', 'The CRC bytes look swapped (sent high byte first). Modbus RTU sends the low byte first.');
        const all = crc16(bytes, 0, n);
        issue('info', `If this capture has no CRC appended, the CRC for all ${n} bytes would be ${hex2(all & 0xff)} ${hex2(all >> 8)}.`);
      }
    }

    // Address + function
    r.unit = bytes[unitIdx];
    r.fc = bytes[fcIdx];
    const u = r.unit;
    let utext;
    if (mode === 'tcp') utext = u === 255 ? '255 (0xFF) — typical "not used / direct" Unit ID' : u === 0 ? '0 — often "not used"; some gateways treat as broadcast' : `${u} (0x${hex2(u)})`;
    else utext = u === 0 ? '0 — BROADCAST (no response expected)' : u <= 247 ? `${u} (0x${hex2(u)}) — valid` : `${u} — RESERVED (248–255 are not valid slave addresses)`;
    seg(mode === 'tcp' ? 'Unit ID' : 'Slave Address', unitIdx, 1, 'addr', utext);
    if (mode !== 'tcp' && u > 247) issue('warn', `Slave address ${u} is outside 1–247.`);
    if (mode !== 'tcp' && u === 0) issue('info', 'Broadcast frames are write-only and never answered.');
    const fcBase = r.fc & 0x7f;
    seg('Function Code', fcIdx, 1, r.fc & 0x80 ? 'exc' : 'fc', `0x${hex2(r.fc)} — ${r.fc & 0x80 ? 'EXCEPTION for ' : ''}${FC_NAMES[fcBase] || 'unknown / vendor function ' + fcBase}`);
    if (!FC_NAMES[fcBase]) issue('warn', `Function code ${fcBase} is not a standard public code.`);

    // PDU
    const data = bytes.slice(dStart, Math.max(dStart, dEnd));
    r.pdu = decodePdu(r.fc, data, opts.dir);
    r.pdu.fields.forEach((f) => seg(f.label, dStart + f.off, f.len, f.cls, f.text));
    r.pdu.warnings.forEach((w) => issue('warn', w));
    r.pdu.notes.forEach((w) => issue('info', w));
    if (r.pdu.hint) issue('info', r.pdu.hint);

    r.summary = `${r.pdu.summary} · ${mode === 'tcp' ? 'unit' : 'slave'} ${u} · ${mode.toUpperCase()}`;
    r.ok = !r.issues.some((i) => i.level === 'error');
    if (r.ok && r.checksum && r.checksum.type !== 'none' && !r.issues.some((i) => i.level === 'warn')) issue('ok', 'Structure and checksum are valid.');
    return r;
  }

  /** Build a frame. Throws Error with a readable message on invalid input. */
  function buildFrame(o) {
    const p16 = (arr, v) => arr.push((v >> 8) & 0xff, v & 0xff);
    const chk = (name, v, lo, hi) => { if (!Number.isInteger(v) || v < lo || v > hi) throw new Error(`${name} must be an integer ${lo}–${hi}.`); };
    chk('Slave/Unit ID', o.slave, 0, 255);
    chk('Address', o.addr, 0, 65535);
    const pdu = [o.fc];
    switch (o.fc) {
      case 1: case 2: chk('Quantity', o.qty, 1, 2000); p16(pdu, o.addr); p16(pdu, o.qty); break;
      case 3: case 4: chk('Quantity', o.qty, 1, 125); p16(pdu, o.addr); p16(pdu, o.qty); break;
      case 5: p16(pdu, o.addr); p16(pdu, o.on ? 0xff00 : 0); break;
      case 6: chk('Value', o.value, -32768, 65535); p16(pdu, o.addr); p16(pdu, o.value & 0xffff); break;
      case 15: {
        const bits = o.bits || [];
        chk('Coil count', bits.length, 1, 1968);
        p16(pdu, o.addr); p16(pdu, bits.length);
        const bc = Math.ceil(bits.length / 8);
        pdu.push(bc);
        for (let j = 0; j < bc; j++) { let v = 0; for (let k = 0; k < 8; k++) if (bits[j * 8 + k]) v |= 1 << k; pdu.push(v); }
        break;
      }
      case 16: {
        const vals = o.values || [];
        chk('Register count', vals.length, 1, 123);
        p16(pdu, o.addr); p16(pdu, vals.length); pdu.push(vals.length * 2);
        vals.forEach((v) => { chk('Value', v, -32768, 65535); p16(pdu, v & 0xffff); });
        break;
      }
      default: throw new Error(`Builder does not support function code ${o.fc}.`);
    }
    let bytes, text;
    if (o.mode === 'tcp') {
      chk('Transaction ID', o.txid || 0, 0, 65535);
      bytes = [];
      p16(bytes, o.txid || 0); p16(bytes, 0); p16(bytes, pdu.length + 1);
      bytes.push(o.slave, ...pdu);
    } else if (o.mode === 'ascii') {
      const core = [o.slave, ...pdu];
      bytes = core.concat([lrc(core)]);
      text = ':' + bytes.map(hex2).join('') + '\r\n';
    } else {
      const core = [o.slave, ...pdu];
      const c = crc16(core);
      bytes = core.concat([c & 0xff, c >> 8]);
    }
    return { bytes, hex: bytes.map(hex2).join(' '), text: text || null };
  }

  PL.modbus = { crc16, lrc, analyze, buildFrame, decodePdu, copyValues, FC_NAMES, EXC, modicon };
})(typeof window !== 'undefined' ? window : globalThis);
