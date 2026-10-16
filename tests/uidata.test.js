'use strict';
// v1.2 helpers: copy-value extraction, CSV/TXT export, log presets.  Run: node tests/uidata.test.js
const assert = require('assert');
const path = require('path');
['editor', 'validator', 'templates', 'export'].forEach((f) => require(path.join('..', 'js', f + '.js')));
const { modbus: MB, exporter: EX, templates: T, editor: ED } = globalThis.PL;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✔', name); };
const seg = (res, label) => res.segments.find((s) => s.label === label);
const vals = (s) => Object.fromEntries(s.copy);

t('copyValues: address → offset + Modicon (5- and 6-digit, with/without decimal part)', () => {
  assert.deepStrictEqual(MB.copyValues('Start Address', '0x0064 = 100  →  40101'), [['offset', '100'], ['Modicon', '40101']]);
  assert.deepStrictEqual(MB.copyValues('Start Address', '0xC350 = 50000  →  450001'), [['offset', '50000'], ['Modicon', '450001']]);
  assert.deepStrictEqual(MB.copyValues('Read Start Address', '0x0064 → 40101'), [['offset', '100'], ['Modicon', '40101']]);
});
t('copyValues: registers → unsigned / signed / hex, quantities → plain number', () => {
  assert.deepStrictEqual(MB.copyValues('Register +0', '0xFFFE = 65534 (signed -2)'), [['unsigned', '65534'], ['signed', '-2'], ['hex', '0xFFFE']]);
  assert.deepStrictEqual(MB.copyValues('Value +0', '0x000A = 10'), [['unsigned', '10'], ['hex', '0x000A']]);
  assert.deepStrictEqual(MB.copyValues('Quantity', '10 register(s)'), [['value', '10']]);
  assert.deepStrictEqual(MB.copyValues('Byte Count', '20 data byte(s) follow'), [['value', '20']]);
  assert.deepStrictEqual(MB.copyValues('Function Code', '0x03 — Read Holding Registers'), []);
  assert.deepStrictEqual(MB.copyValues('Slave Address', '1 (0x01) — valid'), []);
});
t('analyze(): segments carry copy values for a real request and response', () => {
  const body = [1, 3, 0x00, 0x64, 0x00, 0x0a]; let c = MB.crc16(body);
  const req = MB.analyze(body.concat([c & 0xff, c >> 8]));
  assert.deepStrictEqual(vals(seg(req, 'Start Address')), { offset: '100', Modicon: '40101' });
  assert.deepStrictEqual(vals(seg(req, 'Quantity')), { value: '10' });
  const rb = [1, 3, 4, 0xff, 0xfe, 0x00, 0x0b]; c = MB.crc16(rb);
  const res = MB.analyze(rb.concat([c & 0xff, c >> 8]));
  assert.deepStrictEqual(vals(seg(res, 'Register +0')), { unsigned: '65534', signed: '-2', hex: '0xFFFE' });
  assert.deepStrictEqual(vals(seg(res, 'Byte Count')), { value: '4' });
  // the example numbers from the field request: 0x0009000B → 589835 ... decoded elsewhere; here just make sure large values stay exact
  assert.deepStrictEqual(vals(seg(MB.analyze(ED.parseInput('00 01 00 00 00 06 01 03 FF FF 00 01').bytes), 'Start Address')), { offset: '65535', Modicon: '465536' });
});

t('CSV cell escaping, formula-injection guard, BOM and CRLF', () => {
  assert.strictEqual(EX.cell('plain'), 'plain'); assert.strictEqual(EX.cell('a,b'), '"a,b"'); assert.strictEqual(EX.cell('say "hi"'), '"say ""hi"""');
  assert.strictEqual(EX.cell('line1\nline2'), '"line1\nline2"'); assert.strictEqual(EX.cell('=SUM(A1)'), "'=SUM(A1)"); assert.strictEqual(EX.cell('@cmd'), "'@cmd");
  assert.strictEqual(EX.cell('01 03 00 00'), '01 03 00 00'); assert.strictEqual(EX.cell(null), ''); assert.strictEqual(EX.cell(42), '42');
});
t('toCsv merges frames, notes and logs chronologically with the documented header', () => {
  const frames = [{ ts: 2000, mode: 'rtu', hex: '01 03 00 00 00 0A C5 CD', summary: 'Read Holding Registers request — 10 register(s), slave 1' }];
  const notes = [{ ts: 1000, text: 'Slave ID is 17, fixed "A/B" swap' }, { ts: 3000, kind: 'log', text: 'line one\nline two' }];
  const csv = EX.toCsv(frames, notes);
  assert.ok(csv.startsWith('﻿type,timestamp_local,timestamp_iso,mode,hex,summary,text\r\n'));
  const lines = csv.slice(1).split('\r\n');
  assert.strictEqual(lines[1].split(',')[0], 'note'); assert.ok(lines[1].includes('"Slave ID is 17, fixed ""A/B"" swap"'));
  assert.strictEqual(lines[2].split(',')[0], 'frame'); assert.ok(lines[2].includes('01 03 00 00 00 0A C5 CD')); assert.ok(lines[2].includes('1970-01-01T00:00:02.000Z'));
  assert.ok(lines[3].startsWith('log,') && csv.includes('"line one\nline two"'));
  assert.ok(csv.endsWith('\r\n'));
});
t('toTxt is readable and reports an empty export', () => {
  const txt = EX.toTxt([{ ts: 5000, mode: 'tcp', hex: '00 01 00 00 00 06 01 03 00 00 00 0A', summary: 'Read request' }], [{ ts: 6000, kind: 'log', text: 'a\nb' }], 'My report');
  assert.ok(txt.startsWith('My report\r\nExported: ')); assert.ok(/FRAME \(TCP\)\r\n  00 01 00 00 00 06/.test(txt)); assert.ok(/LOG\r\n  a\r\n  b/.test(txt));
  assert.ok(EX.toTxt([], []).includes('(nothing saved)'));
});

t('log presets: five presets, each triggers the highlight categories it advertises', () => {
  assert.deepStrictEqual(T.logPresets.map((p) => p.id), ['smc', 'modbus', 'dcom', 'ua', 'ifix']);
  const count = (text, id) => { const r = T.logRules.find((x) => x.id === id); const re = new RegExp(r.pattern, r.flags); return (text.match(re) || []).length; };
  T.logPresets.forEach((p) => {
    assert.ok(p.text.split('\n').length >= 10, p.id + ' too short');
    assert.ok(count(p.text, 'error') >= 2, p.id + ' needs errors'); assert.ok(count(p.text, 'ts') >= 8, p.id + ' needs timestamps');
  });
  const by = Object.fromEntries(T.logPresets.map((p) => [p.id, p.text]));
  assert.ok(count(by.modbus, 'timeout') >= 3 && count(by.modbus, 'mbexc') >= 2 && count(by.modbus, 'quality') >= 1);
  assert.ok(count(by.dcom, 'code') >= 6 && count(by.dcom, 'drop') >= 1);
  assert.ok(count(by.ua, 'code') >= 8 && count(by.ua, 'timeout') >= 1);
  assert.ok(count(by.ifix, 'drop') >= 2 && count(by.ifix, 'timeout') >= 2 && count(by.ifix, 'warn') >= 3);
  assert.ok(count(by.smc, 'ww') >= 3);
  // every hex code in the presets must be explained by the built-in table (so the Findings panel has an answer)
  T.logPresets.forEach((p) => (p.text.match(/\b0x[0-9A-Fa-f]{8}\b/g) || []).forEach((c) => assert.ok(T.hresults[c.toLowerCase()], p.id + ': unknown code ' + c)));
});

console.log(`\n${n} ui-data test groups passed`);
