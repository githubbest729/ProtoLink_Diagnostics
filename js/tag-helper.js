/* ProtoLink Diagnostics — js/tag-helper.js
 * Tag-list helper: build / validate Wonderware InTouch DBLoad CSV text and generate GE iFIX
 * tag references / header-mapped import rows. Pure functions, no DOM.
 *
 * IMPORTANT: DBLoad column sets differ between InTouch versions. The built-in column lists are the
 * commonly documented ones; if DBLoad rejects them, export one tag of each type with DBDump and paste
 * that header into "Custom header" — the generator then fills exactly those columns by name.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});

  const ANALOG_COLS = ['Tagname', 'Group', 'Comment', 'Logged', 'EventLogged', 'EventLoggingPriority', 'RetentiveValue', 'RetentiveAlarmParameters', 'AlarmValueDeadband', 'AlarmDevDeadband', 'EngUnits', 'InitialValue', 'MinEU', 'MaxEU', 'Deadband', 'LogDeadband', 'LoLoAlarmState', 'LoLoAlarmValue', 'LoLoAlarmPri', 'LoAlarmState', 'LoAlarmValue', 'LoAlarmPri', 'HiAlarmState', 'HiAlarmValue', 'HiAlarmPri', 'HiHiAlarmState', 'HiHiAlarmValue', 'HiHiAlarmPri', 'MinorDevAlarmState', 'MinorDevAlarmValue', 'MinorDevAlarmPri', 'MajorDevAlarmState', 'MajorDevAlarmValue', 'MajorDevAlarmPri', 'DevTarget', 'ROCAlarmState', 'ROCAlarmValue', 'ROCAlarmPri', 'ROCTimeBase', 'MinRaw', 'MaxRaw', 'Conversion', 'AccessName', 'ItemUseTagname', 'ItemName', 'ReadOnly', 'AlarmComment', 'AlarmAckModel', 'LoLoAlarmDisable', 'LoAlarmDisable', 'HiAlarmDisable', 'HiHiAlarmDisable', 'MinDevAlarmDisable', 'MajDevAlarmDisable', 'RocAlarmDisable', 'LoLoAlarmInhibitor', 'LoAlarmInhibitor', 'HiAlarmInhibitor', 'HiHiAlarmInhibitor', 'MinDevAlarmInhibitor', 'MajDevAlarmInhibitor', 'RocAlarmInhibitor', 'SymbolicName'];
  const DISC_COLS = ['Tagname', 'Group', 'Comment', 'Logged', 'EventLogged', 'EventLoggingPriority', 'RetentiveValue', 'InitialDisc', 'OffMsg', 'OnMsg', 'AlarmState', 'AlarmPri', 'DConversion', 'AccessName', 'ItemUseTagname', 'ItemName', 'ReadOnly', 'AlarmComment', 'AlarmAckModel', 'DSCAlarmDisable', 'DSCAlarmInhibitor', 'SymbolicName'];
  const SECTIONS = { disc: 'IODisc', int: 'IOInt', real: 'IOReal' };
  const COLS = { IODisc: DISC_COLS, IOInt: ANALOG_COLS, IOReal: ANALOG_COLS };
  const KNOWN_SECTIONS = ['memdisc', 'memint', 'memreal', 'memmsg', 'iodisc', 'ioint', 'ioreal', 'iomsg', 'groupvar', 'histtrend', 'tagid', 'indirectdisc', 'indirectanalog', 'indirecttext'];

  function typeOf(s) {
    s = String(s || '').trim().toLowerCase();
    if (/^(d|disc|discrete|bool|bit|iodisc)$/.test(s)) return 'disc';
    if (/^(i|int|integer|dint|word|ioint)$/.test(s)) return 'int';
    if (/^(r|real|float|ioreal)$/.test(s)) return 'real';
    return null;
  }

  function detectDelim(s) {
    const c = { '\t': (s.match(/\t/g) || []).length, ';': (s.match(/;/g) || []).length, ',': (s.match(/,/g) || []).length };
    return c['\t'] ? '\t' : c[';'] >= c[','] && c[';'] ? ';' : ',';
  }

  /** Quote-aware split. */
  function splitCsv(line, d) {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === d) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  }
  const quote = (v, d) => { v = String(v); return /["\r\n]/.test(v) || v.includes(d) || /^\s|\s$/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };

  /**
   * Parse the user's tag list. Line format: tag, address[, type][, comment][, EU][, min][, max]
   * (delimiter: tab, semicolon or comma). Lines starting with # are ignored.
   */
  function parseLines(text, defaults) {
    const rows = [], issues = [];
    String(text || '').split(/\r\n|\r|\n/).forEach((raw, i) => {
      const line = raw.trim();
      if (!line || line[0] === '#') return;
      let f = splitCsv(line, detectDelim(line)).map((x) => x.trim());
      if (f[2] && !typeOf(f[2])) f = [f[0], f[1], '', f[2], f[3], f[4], f[5]]; // 3rd column is a comment, not a type
      const r = { line: i + 1, tag: f[0] || '', addr: f[1] || '', type: typeOf(f[2]) || defaults.type, comment: f[3] || '', eu: f[4] || '', min: f[5] || '', max: f[6] || '' };
      rows.push(r);
    });
    if (!rows.length) issues.push({ level: 'error', line: 0, msg: 'No tags found. Enter one per line: TagName, Address' });
    return { rows, issues };
  }

  function checkTag(tag, line, issues, maxLen, product) {
    if (!tag) { issues.push({ level: 'error', line, msg: 'Missing tag name.' }); return; }
    if (tag.length > maxLen) issues.push({ level: 'warn', line, msg: `"${tag}" is ${tag.length} characters; ${product} tag names are normally limited to ${maxLen}.` });
    if (/[\s,."'\[\]=<>]/.test(tag)) issues.push({ level: 'warn', line, msg: `"${tag}" contains spaces or punctuation that ${product} usually rejects in tag names.` });
    if (/^\d/.test(tag)) issues.push({ level: 'warn', line, msg: `"${tag}" starts with a digit; ${product} tag names normally start with a letter.` });
  }

  function valueFor(col, r, o) {
    const n = col.toLowerCase();
    const num = (s, d) => (s !== '' && s != null && !Number.isNaN(Number(s)) ? Number(s) : d);
    const euLo = num(r.min, o.min), euHi = num(r.max, o.max);
    switch (n) {
      case 'tagname': return r.tag;
      case 'group': return o.group;
      case 'comment': return r.comment;
      case 'accessname': return o.access;
      case 'itemname': return r.addr;
      case 'engunits': return r.eu || o.eu;
      case 'mineu': return euLo; case 'maxeu': return euHi;
      case 'minraw': return euLo; case 'maxraw': return euHi;
      case 'conversion': return 'Linear';
      case 'dconversion': return 'Direct';
      case 'initialdisc': return 'Off';
      case 'offmsg': return 'Off'; case 'onmsg': return 'On';
      case 'initialvalue': return 0;
      case 'roctimebase': return 'Min';
      case 'eventloggingpriority': return 0;
      case 'logged': case 'eventlogged': case 'retentivevalue': case 'retentivealarmparameters': case 'itemusetagname': case 'readonly': return 'No';
      case 'alarmackmodel': return 0;
      case 'symbolicname': case 'alarmcomment': return '';
      default: break;
    }
    if (/Deadband$/i.test(col) || /DevTarget$/i.test(col)) return 0;
    if (/AlarmState$/i.test(col)) return 'Off';
    if (/(AlarmValue|DevValue|AlarmDev)$/i.test(col)) return 0;
    if (/Pri$/i.test(col)) return 1;
    if (/Disable$/i.test(col)) return 0;
    if (/Inhibitor$/i.test(col)) return '0';
    return '';
  }

  /** Parse pasted DBDump header lines (":IOInt;Tagname;...") into {iodisc:[cols], ...} + delimiter. */
  function parseCustomHeaders(text) {
    const map = {}; let delim = null;
    String(text || '').split(/\r\n|\r|\n/).forEach((l) => {
      l = l.trim();
      if (l[0] !== ':') return;
      const d = detectDelim(l);
      const parts = splitCsv(l, d);
      const sec = parts.shift().replace(/^:/, '').trim().toLowerCase();
      if (!delim) delim = d;
      map[sec] = parts.map((x) => x.trim()).filter(Boolean);
    });
    return { map, delim };
  }

  /**
   * Build DBLoad text. o = {access, group, eu, min, max, type, delim, customHeader}
   * @returns {{text:string, issues:object[], counts:object}}
   */
  function buildDbLoad(rows, o) {
    const issues = [];
    const custom = parseCustomHeaders(o.customHeader);
    const delim = custom.delim || o.delim || ',';
    const seen = new Set();
    const groups = { IODisc: [], IOInt: [], IOReal: [] };
    if (!o.access) issues.push({ level: 'error', line: 0, msg: 'Access Name is required (the InTouch Access Name that points to your DAServer topic).' });
    rows.forEach((r) => {
      checkTag(r.tag, r.line, issues, 32, 'InTouch');
      if (!r.addr) issues.push({ level: 'error', line: r.line, msg: `"${r.tag}": missing item/address (ItemName).` });
      const key = r.tag.toLowerCase();
      if (r.tag && seen.has(key)) issues.push({ level: 'error', line: r.line, msg: `Duplicate tag name "${r.tag}" (InTouch tag names are case-insensitive).` });
      seen.add(key);
      if (r.type !== 'disc') {
        const lo = r.min === '' ? o.min : Number(r.min), hi = r.max === '' ? o.max : Number(r.max);
        if (Number.isNaN(lo) || Number.isNaN(hi)) issues.push({ level: 'error', line: r.line, msg: `"${r.tag}": min/max must be numbers.` });
        else if (lo >= hi) issues.push({ level: 'warn', line: r.line, msg: `"${r.tag}": MinEU (${lo}) should be below MaxEU (${hi}).` });
        if (r.type === 'int' && (!Number.isInteger(lo) || !Number.isInteger(hi))) issues.push({ level: 'warn', line: r.line, msg: `"${r.tag}": integer tag with non-integer EU range.` });
      }
      groups[SECTIONS[r.type]].push(r);
    });
    const out = [];
    const counts = {};
    Object.keys(groups).forEach((sec) => {
      if (!groups[sec].length) return;
      const cols = custom.map[sec.toLowerCase()] || COLS[sec];
      counts[sec] = groups[sec].length;
      out.push(':' + sec + delim + cols.map((c) => quote(c, delim)).join(delim));
      groups[sec].forEach((r) => out.push(cols.map((c) => quote(valueFor(c, r, o), delim)).join(delim)));
    });
    return { text: out.join('\r\n') + (out.length ? '\r\n' : ''), issues, counts };
  }

  /** Validate pasted DBLoad CSV text. */
  function validateDbLoad(text) {
    const issues = [], stats = { sections: 0, tags: 0 };
    let cols = null, delim = ',', sec = '', tagIdx = -1, aIdx = -1, iIdx = -1, loIdx = -1, hiIdx = -1;
    const seen = new Map();
    String(text || '').split(/\r\n|\r|\n/).forEach((raw, i) => {
      const ln = i + 1, line = raw.replace(/\s+$/, '');
      if (!line.trim()) return;
      if (line[0] === ':') {
        delim = detectDelim(line);
        const parts = splitCsv(line, delim);
        sec = parts.shift().replace(/^:/, '').trim();
        cols = parts.map((x) => x.trim());
        stats.sections++;
        if (!KNOWN_SECTIONS.includes(sec.toLowerCase())) issues.push({ level: 'warn', line: ln, msg: `Unknown section ":${sec}".` });
        const idx = (n) => cols.findIndex((c) => c.toLowerCase() === n);
        tagIdx = idx('tagname'); aIdx = idx('accessname'); iIdx = idx('itemname'); loIdx = idx('mineu'); hiIdx = idx('maxeu');
        if (tagIdx < 0) issues.push({ level: 'error', line: ln, msg: 'Header has no "Tagname" column.' });
        if (/^io/i.test(sec) && (aIdx < 0 || iIdx < 0)) issues.push({ level: 'error', line: ln, msg: 'I/O section needs AccessName and ItemName columns.' });
        return;
      }
      if (!cols) { issues.push({ level: 'error', line: ln, msg: 'Data row before any ":Section" header line.' }); return; }
      const f = splitCsv(line, delim);
      if (f.length !== cols.length) { issues.push({ level: 'error', line: ln, msg: `${f.length} columns but the ${sec} header has ${cols.length} (check delimiter/quotes).` }); return; }
      stats.tags++;
      const tag = (f[tagIdx] || '').trim();
      checkTag(tag, ln, issues, 32, 'InTouch');
      const k = tag.toLowerCase();
      if (tag && seen.has(k)) issues.push({ level: 'error', line: ln, msg: `Duplicate tag "${tag}" (first on line ${seen.get(k)}).` });
      else seen.set(k, ln);
      if (/^io/i.test(sec)) {
        if (aIdx >= 0 && !f[aIdx].trim()) issues.push({ level: 'error', line: ln, msg: `"${tag}": empty AccessName.` });
        if (iIdx >= 0 && !f[iIdx].trim()) issues.push({ level: 'error', line: ln, msg: `"${tag}": empty ItemName.` });
      }
      if (loIdx >= 0 && hiIdx >= 0 && Number(f[loIdx]) >= Number(f[hiIdx])) issues.push({ level: 'warn', line: ln, msg: `"${tag}": MinEU ≥ MaxEU.` });
    });
    if (!stats.sections) issues.push({ level: 'error', line: 0, msg: 'No ":Section" header lines found — this does not look like a DBLoad file.' });
    return { issues, stats };
  }

  /** iFIX tag references NODE.TAG.FIELD (default F_CV = current value, formatted). */
  function ifixRefs(rows, o) {
    const issues = [];
    const node = String(o.node || '').trim().toUpperCase();
    if (!node) issues.push({ level: 'error', line: 0, msg: 'Enter the iFIX node name.' });
    else if (node.length > 8 || /[^A-Z0-9_]/.test(node)) issues.push({ level: 'warn', line: 0, msg: `Node name "${node}": iFIX node names are normally ≤ 8 characters, letters/digits/underscore.` });
    const fields = (o.fields && o.fields.length ? o.fields : ['F_CV']);
    const seen = new Set(), lines = [];
    rows.forEach((r) => {
      checkTag(r.tag, r.line, issues, 30, 'iFIX');
      if (r.tag && seen.has(r.tag.toLowerCase())) issues.push({ level: 'error', line: r.line, msg: `Duplicate tag "${r.tag}".` });
      seen.add(r.tag.toLowerCase());
      fields.forEach((f) => lines.push(`${node}.${r.tag.toUpperCase()}.${f}`));
    });
    return { text: lines.join('\r\n') + (lines.length ? '\r\n' : ''), issues };
  }

  function classifyCol(c) {
    const n = String(c).toLowerCase().replace(/[\s_/]/g, '');
    if (/^(tagname|tag|name)$/.test(n)) return 'tag';
    if (/^(desc|description|comment)$/.test(n)) return 'desc';
    if (/^(ioad|ioaddress|address|itemname|item)$/.test(n)) return 'addr';
    if (/^(iodv|iodriver|driver|drv)$/.test(n)) return 'driver';
    if (/^(egudesc|engunits|eu|units)$/.test(n)) return 'eu';
    if (/^(loegu|mineu|eulo)$/.test(n)) return 'min';
    if (/^(hiegu|maxeu|euhi)$/.test(n)) return 'max';
    if (/^(type|blocktype|tagtype)$/.test(n)) return 'type';
    return '';
  }

  /** Generic header-mapped import rows (for iFIX Database Manager exports and similar): fills matching columns, leaves the rest blank. */
  function fillByHeader(rows, header, o) {
    const line = String(header || '').trim().split(/\r\n|\r|\n/)[0] || '';
    if (!line) return { text: '', issues: [{ level: 'error', line: 0, msg: 'Paste the header row from an iFIX Database Manager export first.' }] };
    const d = detectDelim(line);
    const cols = splitCsv(line, d).map((x) => x.trim());
    const kinds = cols.map(classifyCol);
    const issues = [];
    if (!kinds.includes('tag')) issues.push({ level: 'error', line: 0, msg: 'Could not find a tag-name column (Tag / TagName / Name) in the header.' });
    ['addr', 'driver'].forEach((k) => { if (!kinds.includes(k)) issues.push({ level: 'warn', line: 0, msg: `No ${k === 'addr' ? 'address' : 'driver'} column recognised — it will not be filled.` }); });
    const typeName = { disc: 'DI', int: 'AI', real: 'AI' };
    const out = [cols.map((c) => quote(c, d)).join(d)];
    rows.forEach((r) => {
      out.push(kinds.map((k) => {
        switch (k) {
          case 'tag': return quote(r.tag, d);
          case 'desc': return quote(r.comment, d);
          case 'addr': return quote(r.addr, d);
          case 'driver': return quote(o.driver || '', d);
          case 'eu': return quote(r.eu || o.eu || '', d);
          case 'min': return r.type === 'disc' ? '' : (r.min === '' ? o.min : r.min);
          case 'max': return r.type === 'disc' ? '' : (r.max === '' ? o.max : r.max);
          case 'type': return typeName[r.type];
          default: return '';
        }
      }).join(d));
    });
    return { text: out.join('\r\n') + '\r\n', issues };
  }

  PL.taghelper = { parseLines, buildDbLoad, validateDbLoad, ifixRefs, fillByHeader, splitCsv, detectDelim, typeOf, COLS };
})(typeof window !== 'undefined' ? window : globalThis);
