'use strict';
// Run: node tests/validator.test.js   (no dependencies)
const assert = require('assert');
const path = require('path');
['editor', 'validator', 'tag-converter'].forEach((f) => require(path.join('..', 'js', f + '.js')));
const { editor: ED, modbus: MB, convert: CV } = globalThis.PL;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✔', name); };
const hx = (s) => ED.parseInput(s).bytes;

t('CRC-16 known vector 01 03 00 00 00 0A → C5 CD (lo,hi)', () => {
  const c = MB.crc16(hx('01 03 00 00 00 0A'));
  assert.strictEqual(c & 0xff, 0xc5); assert.strictEqual(c >> 8, 0xcd);
});
t('CRC-16 of frame including its CRC is 0', () => assert.strictEqual(MB.crc16(hx('01 03 00 00 00 0A C5 CD')), 0));
t('LRC known vector :010300000001FB', () => assert.strictEqual(MB.lrc(hx('01 03 00 00 00 01')), 0xfb));

t('RTU request parses and CRC validates', () => {
  const r = MB.analyze(hx('01 03 00 00 00 0A C5 CD'));
  assert.strictEqual(r.mode, 'rtu'); assert.ok(r.ok); assert.ok(r.checksum.ok);
  assert.strictEqual(r.pdu.dir, 'request');
  assert.ok(/10 register/.test(r.summary));
});
t('RTU bad CRC is flagged with expected value', () => {
  const r = MB.analyze(hx('01 03 00 00 00 0A C5 00'));
  assert.ok(!r.ok); assert.ok(!r.checksum.ok); assert.strictEqual(r.checksum.expected, 'C5 CD');
});
t('RTU response decodes registers', () => {
  const c = MB.buildFrame({ mode: 'rtu', slave: 1, fc: 3, addr: 0, qty: 1 }); // just to have builder run
  assert.ok(c.bytes.length === 8);
  const body = [1, 3, 4, 0, 10, 0, 11];
  const crc = MB.crc16(body);
  const r = MB.analyze(body.concat([crc & 0xff, crc >> 8]));
  assert.strictEqual(r.pdu.dir, 'response'); assert.deepStrictEqual(r.pdu.registers, [10, 11]); assert.ok(r.ok);
});
t('Exception response decoded', () => {
  const body = [1, 0x83, 2]; const c = MB.crc16(body);
  const r = MB.analyze(body.concat([c & 0xff, c >> 8]));
  assert.ok(/Illegal Data Address/.test(r.summary)); assert.ok(r.ok);
});
t('TCP request auto-detected', () => {
  const r = MB.analyze(hx('00 01 00 00 00 06 01 03 00 00 00 0A'));
  assert.strictEqual(r.mode, 'tcp'); assert.ok(r.ok); assert.strictEqual(r.unit, 1);
});
t('TCP response with 10 registers', () => {
  const r = MB.analyze(hx('00 01 00 00 00 17 01 03 14 00 0A 00 0B 00 0C 00 0D 00 0E 00 0F 00 10 00 11 00 12 00 13'));
  assert.strictEqual(r.mode, 'tcp'); assert.ok(r.ok); assert.strictEqual(r.pdu.registers.length, 10);
});
t('TCP bad length flagged', () => {
  const r = MB.analyze(hx('00 01 00 00 00 09 01 03 00 00 00 0A'));
  assert.strictEqual(r.mode, 'tcp'); assert.ok(!r.ok);
  assert.ok(r.issues.some((i) => /Length field/.test(i.msg)));
});
t('ASCII frame validates LRC', () => {
  const p = ED.parseInput(':010300000001FB');
  assert.ok(p.ascii);
  const r = MB.analyze(p.bytes, { ascii: true });
  assert.strictEqual(r.mode, 'ascii'); assert.ok(r.ok);
  const bad = MB.analyze(ED.parseInput(':010300000001FC').bytes, { ascii: true });
  assert.ok(!bad.ok);
});
t('ASCII frame given as raw ASCII character bytes (3A 30 31 …)', () => {
  const p = ED.parseInput('3A 30 31 30 33 30 30 30 30 30 30 30 31 46 42 0D 0A');
  assert.ok(p.ascii); assert.deepStrictEqual(p.bytes, [1, 3, 0, 0, 0, 1, 0xfb]);
});
t('FC16 request: byte count mismatch warned', () => {
  const body = [1, 0x10, 0, 0x64, 0, 2, 3, 0, 10, 1]; const c = MB.crc16(body);
  const r = MB.analyze(body.concat([c & 0xff, c >> 8]));
  assert.ok(r.issues.some((i) => i.level === 'warn' && /byte count/i.test(i.msg)));
});
t('FC05 invalid coil value warned', () => {
  const body = [1, 5, 0, 1, 0x12, 0x34]; const c = MB.crc16(body);
  const r = MB.analyze(body.concat([c & 0xff, c >> 8]));
  assert.ok(r.issues.some((i) => i.level === 'warn' && /0xFF00/.test(i.msg)));
});
t('Coil response bit order (LSB first)', () => {
  const body = [0x11, 1, 2, 0xcd, 0x6b]; const c = MB.crc16(body);
  const r = MB.analyze(body.concat([c & 0xff, c >> 8]));
  assert.deepStrictEqual(r.pdu.bits.slice(0, 8), [1, 0, 1, 1, 0, 0, 1, 1]);
});
t('Builder round-trips through analyzer (RTU/TCP/ASCII, FC 1-6, 15, 16)', () => {
  const cases = [
    { fc: 1, qty: 8 }, { fc: 2, qty: 3 }, { fc: 3, qty: 10 }, { fc: 4, qty: 2 }, { fc: 5, on: true }, { fc: 6, value: -2 },
    { fc: 15, bits: [1, 0, 1, 1, 0, 0, 1, 1, 1] }, { fc: 16, values: [1, 2, 0xffff] },
  ];
  ['rtu', 'tcp', 'ascii'].forEach((mode) => cases.forEach((c) => {
    const f = MB.buildFrame(Object.assign({ mode, slave: 5, addr: 100, txid: 7 }, c));
    const r = MB.analyze(f.bytes, { mode, ascii: mode === 'ascii' });
    assert.ok(r.ok, `${mode} fc${c.fc}: ${JSON.stringify(r.issues)}`);
    assert.strictEqual(r.fc, c.fc);
  }));
});
t('Builder rejects bad input', () => {
  assert.throws(() => MB.buildFrame({ mode: 'rtu', slave: 1, fc: 3, addr: 0, qty: 200 }));
  assert.throws(() => MB.buildFrame({ mode: 'rtu', slave: 300, fc: 3, addr: 0, qty: 1 }));
});

t('Input parsing: separators, 0x, odd tokens, errors', () => {
  assert.deepStrictEqual(hx('0x01,0x03, 0x00'), [1, 3, 0]);
  assert.deepStrictEqual(hx('01:03:00'), [1, 3, 0]);
  assert.deepStrictEqual(hx('010300'), [1, 3, 0]);
  const odd = ED.parseInput('1 3 0A'); assert.deepStrictEqual(odd.bytes, [1, 3, 10]); assert.ok(odd.warnings.length);
  assert.ok(ED.parseInput('01 0G').error); assert.ok(ED.parseInput('01030').error); assert.ok(ED.parseInput('  ').error);
});

t('Modicon parse/convert', () => {
  const a = CV.parseModicon('40001'); assert.strictEqual(a.offset, 0); assert.strictEqual(a.read, 'FC03');
  const b = CV.parseModicon('400101'); assert.strictEqual(b.offset, 100);
  const c = CV.parseModicon('30010'); assert.strictEqual(c.offset, 9); assert.strictEqual(c.read, 'FC04');
  assert.ok(CV.parseModicon('50001').error); assert.ok(CV.parseModicon('4001').error); assert.ok(CV.parseModicon('40000').error);
  assert.strictEqual(CV.toModicon(4, 0, 5).text, '40001'); assert.strictEqual(CV.toModicon(4, 100, 6).text, '400101');
  assert.ok(CV.toModicon(4, 20000, 5).error);
});
t('32-bit decode/encode (float 3.14)', () => {
  const d = CV.decode32(0x4048, 0xf5c3);
  assert.ok(Math.abs(parseFloat(d.ABCD.f32) - 3.14) < 1e-5);
  const d2 = CV.decode32(0xf5c3, 0x4048);
  assert.ok(Math.abs(parseFloat(d2.CDAB.f32) - 3.14) < 1e-5);
  const e = CV.encode32(3.14, 'f32'); assert.strictEqual(e.ABCD.w0, 0x4048); assert.strictEqual(e.CDAB.w0, 0xf5c3);
  assert.strictEqual(CV.decode32(0x0001, 0x0000).CDAB.u32, 1); // word-swapped: low word was sent first
  assert.strictEqual(CV.decode32(0x0001, 0x0000).ABCD.u32, 65536);
});
t('Scaling', () => {
  assert.strictEqual(CV.scale(13824, 0, 27648, 0, 100).value, 50);
  assert.ok(CV.scale(1, 5, 5, 0, 1).error);
});

console.log(`\n${n} test groups passed`);
