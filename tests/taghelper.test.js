'use strict';
// Wonderware DBLoad / iFIX tag helper.  Run: node tests/taghelper.test.js
const assert = require('assert');
const path = require('path');
require(path.join('..', 'js', 'tag-converter.js'));
require(path.join('..', 'js', 'tag-helper.js'));
const TH = globalThis.PL.taghelper;

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ✔', name); };
const O = { access: 'PLC1', group: '$System', eu: '', min: 0, max: 100, type: 'real', delim: ',', customHeader: '' };
const SAMPLE = [
  '# comment line',
  'Tank1_Level, 400001, R, Tank 1 level, %, 0, 100',
  'Tank1_Temp; 400003; R; Tank 1 temperature; degC; -50; 150',
  'Pump1_Run\t000001\tD\tPump 1 running',
  'Pump1_Speed, 400010, I, Pump 1 speed, rpm, 0, 3000',
  'Valve1_Pos, 400020, Valve 1 position',
].join('\n');

t('parseLines: delimiters, comments, optional type column, defaults', () => {
  const p = TH.parseLines(SAMPLE, { type: 'real' });
  assert.strictEqual(p.rows.length, 5); assert.strictEqual(p.issues.length, 0);
  assert.deepStrictEqual(p.rows.map((r) => r.type), ['real', 'real', 'disc', 'int', 'real']);
  assert.strictEqual(p.rows[1].min, '-50'); assert.strictEqual(p.rows[2].comment, 'Pump 1 running');
  assert.strictEqual(p.rows[4].comment, 'Valve 1 position'); assert.strictEqual(p.rows[4].type, 'real'); // 3rd column was a comment
  assert.ok(TH.parseLines('  \n# only comment', { type: 'real' }).issues.length === 1);
});
t('buildDbLoad: sections, header/row column counts, field placement', () => {
  const p = TH.parseLines(SAMPLE, { type: 'real' });
  const r = TH.buildDbLoad(p.rows, O);
  assert.ok(!r.issues.some((i) => i.level === 'error'), JSON.stringify(r.issues));
  const lines = r.text.trim().split('\r\n');
  const heads = lines.filter((l) => l[0] === ':');
  assert.deepStrictEqual(heads.map((h) => h.split(',')[0]), [':IODisc', ':IOInt', ':IOReal']);
  assert.deepStrictEqual(r.counts, { IODisc: 1, IOInt: 1, IOReal: 3 });
  let cols = 0;
  lines.forEach((l) => { if (l[0] === ':') cols = TH.splitCsv(l, ',').length - 1; else assert.strictEqual(TH.splitCsv(l, ',').length, cols, l); });
  const real = lines.filter((l) => l[0] !== ':' && l.startsWith('Tank1_Level'))[0];
  const hdr = TH.splitCsv(lines.find((l) => l.startsWith(':IOReal')), ',').slice(1); const f = TH.splitCsv(real, ',');
  const at = (c) => f[hdr.indexOf(c)];
  assert.strictEqual(at('Tagname'), 'Tank1_Level'); assert.strictEqual(at('AccessName'), 'PLC1'); assert.strictEqual(at('ItemName'), '400001');
  assert.strictEqual(at('Group'), '$System'); assert.strictEqual(at('EngUnits'), '%'); assert.strictEqual(at('MinEU'), '0'); assert.strictEqual(at('MaxEU'), '100');
  assert.strictEqual(at('MinRaw'), '0'); assert.strictEqual(at('MaxRaw'), '100'); assert.strictEqual(at('Conversion'), 'Linear'); assert.strictEqual(at('ReadOnly'), 'No');
  assert.strictEqual(at('HiAlarmState'), 'Off'); assert.strictEqual(at('HiAlarmPri'), '1');
  assert.ok(r.text.endsWith('\r\n'));
});
t('buildDbLoad: semicolon delimiter and quoting of values containing the delimiter', () => {
  const p = TH.parseLines('A1, 40001, R, "Level; main tank", m, 0, 10', { type: 'real' });
  const r = TH.buildDbLoad(p.rows, Object.assign({}, O, { delim: ';' }));
  assert.ok(r.text.includes('"Level; main tank"')); assert.ok(r.text.startsWith(':IOReal;Tagname;Group'));
  assert.strictEqual(TH.splitCsv(r.text.split('\r\n')[1], ';').length, TH.splitCsv(r.text.split('\r\n')[0], ';').length - 1);
});
t('buildDbLoad: reports duplicates, missing address/access name, long names, bad ranges', () => {
  const p = TH.parseLines('Dup, 1\ndup, 2\nThis_Tag_Name_Is_Definitely_Longer_Than_32_Chars, 3\nNoAddr,\nBad Name, 5\nRng, 6, R, , , 10, 5', { type: 'real' });
  const r = TH.buildDbLoad(p.rows, Object.assign({}, O, { access: '' }));
  const msgs = r.issues.map((i) => i.level + ':' + i.msg).join('\n');
  assert.ok(/error:Duplicate tag name "dup"/.test(msgs)); assert.ok(/Access Name is required/.test(msgs)); assert.ok(/characters/.test(msgs));
  assert.ok(/missing item\/address/.test(msgs)); assert.ok(/spaces or punctuation/.test(msgs)); assert.ok(/MinEU \(10\) should be below MaxEU \(5\)/.test(msgs));
});
t('buildDbLoad: custom header from DBDump is honoured (columns filled by name, delimiter taken from header)', () => {
  const p = TH.parseLines('T1, 400001, R, Level, bar, 0, 10', { type: 'real' });
  const r = TH.buildDbLoad(p.rows, Object.assign({}, O, { customHeader: ':IOReal;Tagname;Comment;MinEU;MaxEU;AccessName;ItemName;ReadOnly;MyExtraColumn' }));
  const [h, row] = r.text.trim().split('\r\n');
  assert.strictEqual(h, ':IOReal;Tagname;Comment;MinEU;MaxEU;AccessName;ItemName;ReadOnly;MyExtraColumn');
  assert.strictEqual(row, 'T1;Level;0;10;PLC1;400001;No;');
});
t('validateDbLoad accepts generated files and flags broken ones', () => {
  const gen = TH.buildDbLoad(TH.parseLines(SAMPLE, { type: 'real' }).rows, O).text;
  const ok = TH.validateDbLoad(gen);
  assert.ok(!ok.issues.some((i) => i.level === 'error'), JSON.stringify(ok.issues)); assert.strictEqual(ok.stats.tags, 5); assert.strictEqual(ok.stats.sections, 3);
  const broken = gen.replace('Tank1_Temp', 'Tank1_Level').replace('Pump1_Speed,', 'Pump1_Speed,EXTRA,');
  const b = TH.validateDbLoad(broken);
  assert.ok(b.issues.some((i) => /Duplicate tag/.test(i.msg))); assert.ok(b.issues.some((i) => /columns but/.test(i.msg)));
  assert.ok(TH.validateDbLoad('just,some,text').issues.some((i) => /Data row before|No ":Section"/.test(i.msg)));
  assert.ok(TH.validateDbLoad(':Bogus,Tagname\nX').issues.some((i) => /Unknown section/.test(i.msg)));
  assert.ok(TH.validateDbLoad(':IOInt,Tagname\nX').issues.some((i) => /AccessName and ItemName/.test(i.msg)));
});
t('iFIX tag references NODE.TAG.FIELD and node-name checks', () => {
  const p = TH.parseLines('Tank1_Level, 1\nPump1, 2', { type: 'real' });
  const r = TH.ifixRefs(p.rows, { node: 'scada1', fields: ['F_CV', 'A_CV'] });
  assert.deepStrictEqual(r.text.trim().split('\r\n'), ['SCADA1.TANK1_LEVEL.F_CV', 'SCADA1.TANK1_LEVEL.A_CV', 'SCADA1.PUMP1.F_CV', 'SCADA1.PUMP1.A_CV']);
  assert.ok(TH.ifixRefs(p.rows, { node: '' }).issues.some((i) => i.level === 'error'));
  assert.ok(TH.ifixRefs(p.rows, { node: 'VERYLONGNODE' }).issues.some((i) => /8 characters/.test(i.msg)));
});
t('fillByHeader maps iFIX-style export headers by column name', () => {
  const p = TH.parseLines('Tank1_Level, 400001, R, Tank level, bar, 0, 10\nPump1, 000001, D, Pump', { type: 'real' });
  const r = TH.fillByHeader(p.rows, 'Tag Name,Description,I/O Driver,I/O Address,LOEGU,HIEGU,Unknown', { driver: 'MB1', eu: '', min: 0, max: 100 });
  const lines = r.text.trim().split('\r\n');
  assert.strictEqual(lines[1], 'Tank1_Level,Tank level,MB1,400001,0,10,');
  assert.strictEqual(lines[2], 'Pump1,Pump,MB1,000001,,,');
  assert.ok(TH.fillByHeader(p.rows, 'Foo,Bar', {}).issues.some((i) => /tag-name column/.test(i.msg)));
  assert.ok(TH.fillByHeader(p.rows, '', {}).issues.length);
});

console.log(`\n${n} tag-helper test groups passed`);
