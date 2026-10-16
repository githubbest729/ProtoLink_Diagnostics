'use strict';
// Endianness / word-swap, 4–20 mA scaling, Ohm's law and subnet math.  Run: node tests/converters.test.js
const assert = require('assert');
const path = require('path');
['editor', 'validator', 'tag-converter', 'instrument', 'subnet'].forEach((f) => require(path.join('..', 'js', f + '.js')));
const { convert: CV, instrument: LP, subnet: SN } = globalThis.PL;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✔', name); };
const near = (a, b, eps) => assert.ok(Math.abs(a - b) <= (eps === undefined ? 1e-9 : eps), `${a} !≈ ${b}`);
const hex = (b) => b.map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');

// ---------------------------------------------------------------- endianness
t('32-bit: same float 3.14 decodes in each layout from the matching raw bytes', () => {
  // canonical (big-endian) bytes of float32 3.14 = 40 48 F5 C3
  const raws = { ABCD: [0x40, 0x48, 0xf5, 0xc3], DCBA: [0xc3, 0xf5, 0x48, 0x40], BADC: [0x48, 0x40, 0xc3, 0xf5], CDAB: [0xf5, 0xc3, 0x40, 0x48] };
  Object.keys(raws).forEach((k) => near(parseFloat(CV.decodeBytes(raws[k], k).f), 3.14, 1e-6));
});
t('32-bit: one raw word pair decoded under all four layouts (Siemens vs Rockwell view)', () => {
  const d = CV.decodeAll([0x40, 0x48, 0xf5, 0xc3]);
  near(parseFloat(d.ABCD.f), 3.14, 1e-6);
  assert.notStrictEqual(d.DCBA.f, d.ABCD.f);
  assert.strictEqual(d.ABCD.label, 'ABCD'); assert.strictEqual(d.DCBA.label, 'DCBA'); assert.strictEqual(d.BADC.label, 'BADC'); assert.strictEqual(d.CDAB.label, 'CDAB');
  assert.strictEqual(d.ABCD.u, '1078523331'); // 0x4048F5C3
});
t('32-bit int: 0x00010002 under each layout', () => {
  const raw = [0, 1, 0, 2];
  assert.strictEqual(CV.decodeBytes(raw, 'ABCD').u, '65538');
  assert.strictEqual(CV.decodeBytes(raw, 'CDAB').u, String(0x00020001));
  assert.strictEqual(CV.decodeBytes(raw, 'BADC').u, String(0x01000200));
  assert.strictEqual(CV.decodeBytes(raw, 'DCBA').u, String(0x02000100));
});
t('64-bit double 3.14 = 40 09 1E B8 51 EB 85 1F in all layouts', () => {
  const e = CV.encodeValue('3.14', 'f', 64);
  assert.strictEqual(e.ABCD.hex, '40 09 1E B8 51 EB 85 1F');
  assert.strictEqual(e.DCBA.hex, '1F 85 EB 51 B8 1E 09 40');
  assert.strictEqual(e.BADC.hex, '09 40 B8 1E EB 51 1F 85');
  assert.strictEqual(e.CDAB.hex, '85 1F 51 EB 1E B8 40 09');
  ['ABCD', 'DCBA', 'BADC', 'CDAB'].forEach((k) => near(parseFloat(CV.decodeBytes(e[k].raw, k).f), 3.14, 1e-12));
});
t('64-bit integers use BigInt (no precision loss) and respect ranges', () => {
  const e = CV.encodeValue('-2', 'i', 64);
  assert.strictEqual(e.ABCD.hex, 'FF FF FF FF FF FF FF FE');
  assert.strictEqual(CV.decodeBytes(e.ABCD.raw, 'ABCD').i, '-2');
  const big = CV.encodeValue('9223372036854775807', 'i', 64);
  assert.strictEqual(CV.decodeBytes(big.CDAB.raw, 'CDAB').i, '9223372036854775807');
  assert.strictEqual(CV.decodeBytes(CV.encodeValue('18446744073709551615', 'u', 64).DCBA.raw, 'DCBA').u, '18446744073709551615');
  assert.ok(CV.encodeValue('9223372036854775808', 'i', 64).error);
  assert.ok(CV.encodeValue('-1', 'u', 32).error);
  assert.ok(CV.encodeValue('abc', 'i', 32).error);
});
t('convertOrder is reversible and matches expected swaps', () => {
  const raw = [1, 2, 3, 4];
  assert.deepStrictEqual(CV.convertOrder(raw, 'ABCD', 'DCBA'), [4, 3, 2, 1]);
  assert.deepStrictEqual(CV.convertOrder(raw, 'ABCD', 'BADC'), [2, 1, 4, 3]);
  assert.deepStrictEqual(CV.convertOrder(raw, 'ABCD', 'CDAB'), [3, 4, 1, 2]);
  ['DCBA', 'BADC', 'CDAB'].forEach((k) => assert.deepStrictEqual(CV.convertOrder(CV.convertOrder(raw, 'ABCD', k), k, 'ABCD'), raw));
  const r8 = [1, 2, 3, 4, 5, 6, 7, 8];
  ['ABCD', 'DCBA', 'BADC', 'CDAB'].forEach((a) => ['ABCD', 'DCBA', 'BADC', 'CDAB'].forEach((b) => assert.deepStrictEqual(CV.convertOrder(CV.convertOrder(r8, a, b), b, a), r8)));
});
t('encode → decode round trip for every layout (32-bit float/int)', () => {
  ['ABCD', 'DCBA', 'BADC', 'CDAB'].forEach((k) => {
    near(parseFloat(CV.decodeBytes(CV.encodeValue('-123.5', 'f', 32)[k].raw, k).f), -123.5, 1e-6);
    assert.strictEqual(CV.decodeBytes(CV.encodeValue('305419896', 'u', 32)[k].raw, k).u, '305419896');
    assert.strictEqual(CV.decodeBytes(CV.encodeValue('-70000', 'i', 32)[k].raw, k).i, '-70000');
  });
});
t('parseRaw: registers / bytes / widths / errors', () => {
  assert.deepStrictEqual(CV.parseRaw('0x4048 0xF5C3', 'regs', 32).bytes, [0x40, 0x48, 0xf5, 0xc3]);
  assert.deepStrictEqual(CV.parseRaw('16456, 62915', 'regs', 32).bytes, [0x40, 0x48, 0xf5, 0xc3]);
  assert.strictEqual(CV.parseRaw('40 48 F5 C3', 'bytes', 32).bytes.length, 4);
  assert.strictEqual(CV.parseRaw('1 2 3 4', 'regs', 64).bytes.length, 8);
  assert.ok(CV.parseRaw('1 2 3', 'regs', 64).error);
  assert.ok(CV.parseRaw('40 48 F5', 'bytes', 32).error);
  assert.ok(CV.parseRaw('70000 1', 'regs', 32).error);
  assert.ok(CV.parseRaw('', 'regs', 32).error);
});

// ---------------------------------------------------------------- 4–20 mA
t('4–20 mA ⇄ engineering units (0–100 bar, −50…150 °C)', () => {
  const bar = { mode: '4-20', euLo: 0, euHi: 100 };
  near(LP.loopToEU(4, bar), 0); near(LP.loopToEU(20, bar), 100); near(LP.loopToEU(12, bar), 50); near(LP.loopToEU(8, bar), 25);
  near(LP.euToLoop(0, bar), 4); near(LP.euToLoop(100, bar), 20); near(LP.euToLoop(50, bar), 12);
  const temp = { mode: '4-20', euLo: -50, euHi: 150 };
  near(LP.loopToEU(12, temp), 50); near(LP.loopToEU(4, temp), -50); near(LP.euToLoop(0, temp), 8);
  near(LP.euToLoop(LP.loopToEU(13.37, temp), temp), 13.37, 1e-9);
});
t('0–20 mA mapping and % of span', () => {
  const o = { mode: '0-20', euLo: 0, euHi: 10 };
  near(LP.loopToEU(10, o), 5); near(LP.euToLoop(10, o), 20); near(LP.pctOfSpan(5, '0-20'), 25); near(LP.pctOfSpan(12, '4-20'), 50);
});
t('loop status thresholds (under/over-range, fault)', () => {
  assert.strictEqual(LP.loopStatus(12, '4-20').level, 'good');
  assert.strictEqual(LP.loopStatus(3.7, '4-20').level, 'warn');
  assert.strictEqual(LP.loopStatus(3.5, '4-20').level, 'bad');
  assert.strictEqual(LP.loopStatus(20.8, '4-20').level, 'warn');
  assert.strictEqual(LP.loopStatus(22, '4-20').level, 'bad');
  assert.strictEqual(LP.loopStatus(0, '0-20').level, 'good');
});
t("Ohm's law: 250 Ω HART resistor gives 1–5 V", () => {
  near(LP.voltage(4, 250), 1.0); near(LP.voltage(20, 250), 5.0); near(LP.voltage(12, 250), 3.0);
  near(LP.current(1, 250), 4); near(LP.current(5, 250), 20); assert.ok(Number.isNaN(LP.current(1, 0)));
  const tab = LP.dropTable(250, '4-20'); assert.deepStrictEqual(tab.map((r) => r.mA), [4, 8, 12, 16, 20]); near(tab[0].volts, 1);
  assert.deepStrictEqual(LP.dropTable(100, '0-20').map((r) => r.mA), [0, 5, 10, 15, 20]);
});
t('Siemens raw counts for a 4–20 mA signal', () => {
  assert.strictEqual(LP.siemensRaw(4, '4-20'), 0); assert.strictEqual(LP.siemensRaw(20, '4-20'), 27648); assert.strictEqual(LP.siemensRaw(12, '4-20'), 13824);
  assert.strictEqual(LP.siemensRaw(4, '0-20'), 5530);
});

// ---------------------------------------------------------------- subnet
t('192.168.1.50/24', () => {
  const p = SN.parse('192.168.1.50/24'); const c = SN.calc(p.ip, p.prefix);
  assert.strictEqual(c.maskStr, '255.255.255.0'); assert.strictEqual(c.networkStr, '192.168.1.0'); assert.strictEqual(c.broadcastStr, '192.168.1.255');
  assert.strictEqual(c.firstStr, '192.168.1.1'); assert.strictEqual(c.lastStr, '192.168.1.254'); assert.strictEqual(c.usable, 254); assert.strictEqual(c.total, 256);
  assert.strictEqual(c.wildcardStr, '0.0.0.255'); assert.ok(/RFC 1918/.test(c.kind));
});
t('192.168.1.50/28', () => {
  const p = SN.parse('192.168.1.50/28'); const c = SN.calc(p.ip, p.prefix);
  assert.strictEqual(c.maskStr, '255.255.255.240'); assert.strictEqual(c.networkStr, '192.168.1.48'); assert.strictEqual(c.broadcastStr, '192.168.1.63');
  assert.strictEqual(c.firstStr, '192.168.1.49'); assert.strictEqual(c.lastStr, '192.168.1.62'); assert.strictEqual(c.usable, 14);
});
t('edge prefixes: /30, /31 (RFC 3021), /32, /8, /0', () => {
  let c = SN.calc(SN.parseIPv4('10.0.0.5'), 30); assert.strictEqual(c.networkStr, '10.0.0.4'); assert.strictEqual(c.broadcastStr, '10.0.0.7'); assert.strictEqual(c.usable, 2);
  c = SN.calc(SN.parseIPv4('10.0.0.5'), 31); assert.strictEqual(c.firstStr, '10.0.0.4'); assert.strictEqual(c.lastStr, '10.0.0.5'); assert.strictEqual(c.usable, 2);
  c = SN.calc(SN.parseIPv4('10.0.0.5'), 32); assert.strictEqual(c.firstStr, '10.0.0.5'); assert.strictEqual(c.usable, 1); assert.strictEqual(c.maskStr, '255.255.255.255');
  c = SN.calc(SN.parseIPv4('10.1.2.3'), 8); assert.strictEqual(c.networkStr, '10.0.0.0'); assert.strictEqual(c.broadcastStr, '10.255.255.255'); assert.strictEqual(c.usable, 16777214);
  c = SN.calc(SN.parseIPv4('1.2.3.4'), 0); assert.strictEqual(c.maskStr, '0.0.0.0'); assert.strictEqual(c.broadcastStr, '255.255.255.255'); assert.strictEqual(c.usable, 4294967294);
});
t('mask forms accepted; invalid input rejected', () => {
  assert.strictEqual(SN.parse('10.0.0.5 255.255.255.240').prefix, 28);
  assert.strictEqual(SN.parse('10.0.0.5/255.255.0.0').prefix, 16);
  assert.ok(SN.parse('10.0.0.5/255.0.255.0').error);   // non-contiguous
  assert.ok(SN.parse('300.1.1.1/24').error); assert.ok(SN.parse('10.0.0/24').error); assert.ok(SN.parse('10.0.0.1/33').error);
  assert.ok(SN.parse('10.0.0.1').error); assert.ok(SN.parse('').error); assert.ok(SN.parse('10.0.0.1/-1').error);
  assert.strictEqual(SN.prefixFromMask(SN.parseIPv4('255.255.255.252')), 30);
});
t('membership and split', () => {
  const c = SN.calc(SN.parseIPv4('192.168.1.50'), 24);
  assert.ok(SN.contains(c, SN.parseIPv4('192.168.1.200'))); assert.ok(!SN.contains(c, SN.parseIPv4('192.168.2.1')));
  const s = SN.split(c, 26);
  assert.strictEqual(s.count, 4); assert.deepStrictEqual(s.list.map((x) => x.networkStr), ['192.168.1.0', '192.168.1.64', '192.168.1.128', '192.168.1.192']);
  assert.strictEqual(s.list[1].firstStr, '192.168.1.65'); assert.strictEqual(s.list[1].lastStr, '192.168.1.126'); assert.strictEqual(s.list[3].broadcastStr, '192.168.1.255');
  assert.ok(SN.split(c, 24).error); assert.ok(SN.split(c, 33).error);
  const big = SN.split(SN.calc(SN.parseIPv4('10.0.0.0'), 8), 24, 64); assert.strictEqual(big.count, 65536); assert.ok(big.truncated); assert.strictEqual(big.list.length, 64);
});
t('classification of special ranges', () => {
  assert.ok(/APIPA/.test(SN.classify(SN.parseIPv4('169.254.3.4')))); assert.ok(/Private/.test(SN.classify(SN.parseIPv4('172.20.1.1'))));
  assert.strictEqual(SN.classify(SN.parseIPv4('172.32.1.1')), 'Public'); assert.ok(/Loopback/.test(SN.classify(SN.parseIPv4('127.0.0.1'))));
});

console.log(`\n${n} converter test groups passed`);
