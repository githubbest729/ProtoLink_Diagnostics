/* ProtoLink Diagnostics — app.js
 * UI wiring. All logic is client-side; no network requests are made.
 */
(function () {
  'use strict';
  const PL = window.PL;
  const MB = PL.modbus, CV = PL.convert, ED = PL.editor, TP = PL.templates;

  // ------------------------------------------------------------------ helpers
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const hex2 = ED.hex2;
  const hex4 = (n) => (n & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function el(tag, props) {
    const e = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v === false || v == null) return;
        if (k === 'class') e.className = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    for (let i = 2; i < arguments.length; i++) {
      [].concat(arguments[i]).forEach((kid) => { if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(String(kid))); });
    }
    return e;
  }
  const debounce = (fn, ms) => { let t; return function () { clearTimeout(t); t = setTimeout(fn.bind(null, ...arguments), ms); }; };
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } };

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
  }
  const copyBtn = (text, label) => el('button', { class: 'btn small', type: 'button', onclick: async () => { toast((await ED.copy(text)) ? 'Copied' : 'Copy failed — select and copy manually'); } }, label || 'Copy');

  // One-click copy icon: copies a clean plain value (no labels/units) so it can be pasted straight into a tag dialog.
  const SHORT = { offset: 'off', Modicon: '4x', unsigned: 'u16', signed: 'i16', hex: 'hex', value: '' };
  function cpy(value, label, short) {
    const icon = el('span', { 'aria-hidden': 'true', text: '⧉' });
    const b = el('button', { class: 'cpy', type: 'button', 'aria-label': 'Copy ' + label, title: 'Copy ' + label + ': ' + value }, icon, short ? el('span', { class: 't', text: short }) : null);
    b.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await ED.copy(String(value));
      toast(ok ? 'Copied ' + value : 'Copy failed — select and copy manually');
      if (ok) { b.classList.add('done'); icon.textContent = '✓'; setTimeout(() => { b.classList.remove('done'); icon.textContent = '⧉'; }, 1200); }
    });
    return b;
  }
  /** Table cell with a value and a copy icon. */
  const mcell = (text, value, label, short) => el('td', { class: 'm' }, el('span', { text: String(text) }), cpy(value === undefined ? text : value, label || 'value', short));

  // ------------------------------------------------------------------ tabs
  const TABS = ['modbus', 'opc', 'logs', 'tools', 'history'];
  function showTab(id, updateHash) {
    if (!TABS.includes(id)) id = 'modbus';
    TABS.forEach((t) => {
      const on = t === id;
      $('#tab-' + t).hidden = !on;
      $('#t-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      $('#t-' + t).tabIndex = on ? 0 : -1;
    });
    if (updateHash) history.replaceState(null, '', '#' + id);
    if (id === 'history') renderHistory();
    window.scrollTo(0, 0);
  }
  $$('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab, true)));
  $('.tabs').addEventListener('keydown', (e) => {
    const i = TABS.findIndex((t) => $('#t-' + t).getAttribute('aria-selected') === 'true');
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length; else if (e.key === 'ArrowLeft') n = (i + TABS.length - 1) % TABS.length;
    if (n !== null) { showTab(TABS[n], true); $('#t-' + TABS[n]).focus(); e.preventDefault(); }
  });
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1), false));

  // ------------------------------------------------------------------ status pills / install / update
  function netPill() {
    const p = $('#pill-net'), on = navigator.onLine;
    p.textContent = on ? 'online' : 'offline'; p.className = 'pill ' + (on ? 'on' : 'off');
  }
  window.addEventListener('online', netPill); window.addEventListener('offline', netPill); netPill();

  const swPill = $('#pill-sw');
  swPill.textContent = 'cache…';
  window.addEventListener('pl:sw', (e) => {
    const s = e.detail.state;
    if (s === 'ready') { swPill.textContent = 'offline ready'; swPill.className = 'pill on'; }
    else if (s === 'update') { $('#update-banner').hidden = false; swPill.textContent = 'update'; swPill.className = 'pill off'; }
    else if (s === 'unsupported') { swPill.textContent = 'no sw'; swPill.className = 'pill bad'; }
    else if (s === 'error') { swPill.textContent = 'sw error'; swPill.className = 'pill bad'; swPill.title = e.detail.message || ''; }
  });
  $('#btn-update').addEventListener('click', () => PL.sw && PL.sw.applyUpdate());
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; $('#btn-install').hidden = false; });
  $('#btn-install').addEventListener('click', async () => {
    if (!deferredInstall) return;
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) { /* ignore */ }
    deferredInstall = null; $('#btn-install').hidden = true;
  });
  window.addEventListener('appinstalled', () => { $('#btn-install').hidden = true; toast('Installed'); });

  // ------------------------------------------------------------------ Modbus analyzer
  const mb = { last: null };
  TP.frames.forEach((f, i) => $('#mb-sample').append(el('option', { value: String(i), text: f.label })));

  function renderAnalysis(res, rawHex) {
    const out = $('#mb-out');
    out.replaceChildren();
    const hasErr = res.issues.some((i) => i.level === 'error');
    const hasWarn = res.issues.some((i) => i.level === 'warn');
    out.append(el('div', { class: 'verdict ' + (hasErr ? 'bad' : hasWarn ? 'warn' : 'good'), role: 'status' },
      el('strong', { text: hasErr ? '✖ Problems found' : hasWarn ? '⚠ Parsed with warnings' : '✔ Frame valid' }),
      el('span', { text: res.summary })));

    const card = el('div', { class: 'card' });
    card.append(el('h2', { text: 'Byte map · ' + res.mode.toUpperCase() + ' · ' + res.bytes.length + ' bytes' }));
    const map = el('div', { class: 'bytemap', role: 'group', 'aria-label': 'Byte map' });
    res.segments.slice().sort((a, b) => a.off - b.off).forEach((s) => {
      map.append(el('div', { class: 'seg cls-' + s.cls, title: s.label + ': ' + s.text },
        el('div', { class: 'seg-label', text: s.label }),
        el('div', { class: 'seg-bytes' }, res.bytes.slice(s.off, s.off + s.len).map((b) => el('span', { class: 'byte', text: hex2(b) })))));
    });
    card.append(map);
    if (res.checksum) {
      const dl = el('dl', { class: 'kv' });
      dl.append(el('dt', { text: 'Checksum' }), el('dd', { class: res.checksum.ok ? 'ok' : 'err', text: res.checksum.type === 'none' ? 'n/a (TCP)' : res.checksum.type + (res.checksum.ok ? ' ✔ valid' : ' ✖ INVALID') }));
      if (res.checksum.type !== 'none') dl.append(el('dt', { text: 'In frame' }), el('dd', { text: res.checksum.actual }), el('dt', { text: 'Calculated' }), el('dd', { text: res.checksum.expected }));
      card.append(dl);
    }
    card.append(el('div', { class: 'row' },
      copyBtn(ED.formatHex(res.bytes), 'Copy hex'),
      el('button', { class: 'btn small', type: 'button', onclick: saveFrame }, 'Save to history')));
    out.append(card);

    if (res.issues.length) {
      const ic = el('div', { class: 'card' }, el('h2', { text: 'Diagnosis' }));
      const ul = el('ul', { class: 'issues' });
      res.issues.forEach((i) => ul.append(el('li', { class: i.level }, el('b', { text: { error: 'Error · ', warn: 'Warning · ', info: 'Note · ', ok: 'OK · ' }[i.level] }), i.msg)));
      ic.append(ul); out.append(ic);
    }

    const fc = el('div', { class: 'card' }, el('h2', { text: 'Field breakdown' }));
    const tb = el('tbody');
    res.segments.slice().sort((a, b) => a.off - b.off).forEach((s) => {
      tb.append(el('tr', { class: s.cls === 'err' ? 'rowerr' : null },
        el('td', { class: 'm', text: String(s.off) }),
        el('td', { class: 'm', text: res.bytes.slice(s.off, s.off + s.len).map(hex2).join(' ') }),
        el('td', { text: s.label }),
        el('td', null, el('span', { text: s.text }), (s.copy || []).map((c) => cpy(c[1], s.label + ' ' + c[0], s.copy.length > 1 ? SHORT[c[0]] : '')))));
    });
    fc.append(el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' },
      el('thead', null, el('tr', null, ['Off', 'Bytes', 'Field', 'Decoded'].map((h) => el('th', { text: h })))), tb)));
    out.append(fc);

    const regs = res.pdu && res.pdu.registers;
    if (regs && regs.length) {
      const rc = el('div', { class: 'card' }, el('h2', { text: 'Register values' }));
      const rb = el('tbody');
      regs.slice(0, 125).forEach((v, i) => rb.append(el('tr', null,
        el('td', { class: 'm', text: '+' + i }), mcell('0x' + hex4(v), '0x' + hex4(v), 'register ' + i + ' hex'),
        mcell(v, String(v), 'register ' + i + ' unsigned'), mcell(v & 0x8000 ? v - 65536 : v, String(v & 0x8000 ? v - 65536 : v), 'register ' + i + ' signed'),
        el('td', { class: 'm', text: v.toString(2).padStart(16, '0').replace(/(.{4})/g, '$1 ').trim() }))));
      rc.append(el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' },
        el('thead', null, el('tr', null, ['Reg', 'Hex', 'U16', 'I16', 'Binary'].map((h) => el('th', { text: h })))), rb)));
      if (regs.length >= 2) {
        rc.append(el('h2', { text: '32-bit interpretation of consecutive pairs', class: 'sub' }));
        const pb = el('tbody');
        for (let i = 0; i + 1 < regs.length && i < 16; i += 2) {
          const d = CV.decode32(regs[i], regs[i + 1]);
          Object.keys(d).forEach((k, j) => pb.append(el('tr', null,
            el('td', { class: 'm', text: j === 0 ? `+${i}, +${i + 1}` : '' }), el('td', { class: 'm', text: k }),
            mcell(d[k].u32, String(d[k].u32), k + ' U32'), mcell(d[k].i32, String(d[k].i32), k + ' I32'), mcell(d[k].f32, d[k].f32, k + ' Float32'))));
        }
        rc.append(el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' },
          el('thead', null, el('tr', null, ['Regs', 'Order', 'U32', 'I32', 'Float32'].map((h) => el('th', { text: h })))), pb)));
        rc.append(el('p', { class: 'hint', text: 'Pick the byte order that gives a plausible engineering value.' }));
      }
      out.append(rc);
    }
    mb.last = { hex: ED.formatHex(res.bytes), mode: res.mode, summary: res.summary, raw: rawHex };
  }

  function runAnalysis() {
    const txt = $('#mb-input').value;
    const msg = $('#mb-parse-msg');
    $('#mb-out').replaceChildren();
    msg.textContent = ''; msg.className = 'hint';
    mb.last = null;
    if (!txt.trim()) return;
    const p = ED.parseInput(txt);
    if (p.error) { msg.textContent = '✖ ' + p.error; msg.className = 'hint err'; return; }
    if (p.warnings.length) msg.textContent = p.warnings.join(' ');
    const res = MB.analyze(p.bytes, { mode: p.ascii ? 'ascii' : $('#mb-mode').value, dir: $('#mb-dir').value, ascii: p.ascii });
    renderAnalysis(res, txt.trim());
  }
  const runAnalysisSoon = debounce(runAnalysis, 200);
  $('#mb-input').addEventListener('input', runAnalysisSoon);
  $('#mb-analyze').addEventListener('click', runAnalysis);
  $('#mb-mode').addEventListener('change', runAnalysis);
  $('#mb-dir').addEventListener('change', runAnalysis);
  $('#mb-clear').addEventListener('click', () => { $('#mb-input').value = ''; runAnalysis(); $('#mb-input').focus(); });
  $('#mb-paste').addEventListener('click', async () => {
    try { $('#mb-input').value = await navigator.clipboard.readText(); runAnalysis(); } catch (e) { toast('Clipboard blocked — paste manually (long-press)'); }
  });
  $('#mb-sample').addEventListener('change', (e) => {
    if (e.target.value === '') return;
    $('#mb-input').value = TP.frames[Number(e.target.value)].hex;
    $('#mb-mode').value = 'auto'; $('#mb-dir').value = 'auto';
    runAnalysis(); e.target.value = '';
  });
  function saveFrame() {
    if (!mb.last) return;
    PL.db.add('frames', { hex: mb.last.hex, mode: mb.last.mode, summary: mb.last.summary }).then(() => toast('Saved')).catch(() => toast('Storage unavailable'));
  }

  // Frame builder
  const BD_LABELS = { 1: 'Quantity (1–2000)', 2: 'Quantity (1–2000)', 3: 'Quantity (1–125)', 4: 'Quantity (1–125)', 5: 'State (1 = ON, 0 = OFF)', 6: 'Value (dec or 0x…)', 15: 'Coil bits (e.g. 1011001)', 16: 'Values, comma separated (dec or 0x…)' };
  function bdSync() {
    const fc = Number($('#bd-fc').value);
    $('#bd-data-label').textContent = BD_LABELS[fc];
    $('#bd-txid-wrap').hidden = $('#bd-mode').value !== 'tcp';
  }
  $('#bd-fc').addEventListener('change', bdSync); $('#bd-mode').addEventListener('change', bdSync); bdSync();
  $('#bd-build').addEventListener('click', () => {
    const res = $('#bd-result'); res.replaceChildren();
    try {
      const fc = Number($('#bd-fc').value);
      const n = (id, name) => { const v = CV.num($(id).value); if (Number.isNaN(v)) throw new Error(name + ' is not a number.'); return v; };
      const o = { mode: $('#bd-mode').value, fc, slave: n('#bd-slave', 'Slave ID'), addr: n('#bd-addr', 'Address'), txid: n('#bd-txid', 'Transaction ID') };
      const data = $('#bd-data').value.trim();
      if (fc <= 4) o.qty = n('#bd-data', 'Quantity');
      else if (fc === 5) o.on = /^(1|on|true|ff00|0xff00)$/i.test(data);
      else if (fc === 6) o.value = n('#bd-data', 'Value');
      else if (fc === 15) { const bits = data.replace(/[\s,]/g, ''); if (!/^[01]+$/.test(bits)) throw new Error('Coil bits must be 0/1 only.'); o.bits = bits.split('').map(Number); }
      else if (fc === 16) { o.values = data.split(/[\s,;]+/).filter(Boolean).map((x) => { const v = CV.num(x); if (Number.isNaN(v)) throw new Error('"' + x + '" is not a number.'); return v; }); }
      const f = MB.buildFrame(o);
      const shown = f.text ? f.text.replace('\r\n', '') : f.hex;
      res.append(el('div', { class: 'out', text: shown }),
        el('div', { class: 'row' }, copyBtn(shown, 'Copy'), el('button', { class: 'btn small primary', type: 'button', onclick: () => { $('#mb-input').value = shown; $('#mb-mode').value = 'auto'; runAnalysis(); window.scrollTo(0, 0); } }, 'Analyze this')));
      if (f.text) res.append(el('p', { class: 'hint', text: 'ASCII frame: send as characters, terminated by CR LF.' }));
    } catch (err) { res.append(el('p', { class: 'err', text: '✖ ' + err.message })); }
  });

  // ------------------------------------------------------------------ OPC knowledge base
  const OPC_FILTERS = ['All', 'DCOM', 'Quality', 'Timeout', 'Network', 'Modbus', 'OPC-DA', 'UA', 'Wonderware', 'iFIX', 'Config'];
  const opc = { filter: 'All' };
  OPC_FILTERS.forEach((f) => $('#opc-chips').append(el('button', { class: 'fchip', type: 'button', 'aria-pressed': f === 'All' ? 'true' : 'false', 'data-f': f, text: f === 'UA' ? 'OPC UA' : f === 'OPC-DA' ? 'OPC DA' : f })));
  $('#opc-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.fchip'); if (!b) return;
    opc.filter = b.dataset.f;
    $$('#opc-chips .fchip').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderOpc();
  });
  const kbText = (k) => [k.title, k.symptom, k.proto, k.codes.join(' '), k.tags.join(' '), k.cats.join(' '), k.causes.join(' '), k.steps.join(' '), k.ww.join(' ')].join(' ').toLowerCase();
  const kbIndex = TP.opcKb.map((k) => ({ k, text: kbText(k) }));

  function syncOpcToggle() {
    const ds = $$('#opc-list details.kb'), b = $('#opc-toggle');
    const all = ds.length > 0 && ds.every((d) => d.open);
    b.textContent = all ? 'Collapse all' : 'Expand all';
    b.setAttribute('aria-label', all ? 'Collapse all articles' : 'Expand all articles');
    b.disabled = ds.length === 0;
  }
  $('#opc-toggle').addEventListener('click', () => {
    const ds = $$('#opc-list details.kb'), open = !ds.every((d) => d.open);
    ds.forEach((d) => { d.open = open; });
    syncOpcToggle();
  });
  $('#opc-list').addEventListener('toggle', syncOpcToggle, true);

  function renderOpc(openId) {
    const q = $('#opc-search').value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const list = $('#opc-list');
    list.replaceChildren();
    const hits = kbIndex.filter(({ k, text }) => {
      if (opc.filter === 'Wonderware' ? !(k.ww.length || k.cats.includes('Wonderware')) : opc.filter !== 'All' && !k.cats.includes(opc.filter)) return false;
      return terms.every((t) => text.includes(t));
    }).map((x) => x.k);
    $('#opc-count').textContent = hits.length + ' of ' + TP.opcKb.length + ' articles';
    const note = $('#opc-note');
    note.hidden = opc.filter !== 'iFIX';
    note.textContent = 'iFIX steps are field checklists: menu names, file locations and network ports differ between iFIX / Proficy versions — confirm in the product documentation for the version on site.';
    if (!hits.length) list.append(el('div', { class: 'card' }, el('p', { text: 'No matches. Try a shorter term, an error code such as 0x80070005, or clear the filter.' })));
    hits.forEach((k) => {
      const d = el('details', { class: 'kb', id: 'kb-' + k.id, open: openId === k.id || (terms.length > 0 && hits.length <= 2) });
      d.append(el('summary', null, el('b', { text: k.title }), el('span', { class: 'tag', text: { Both: 'DA+UA', DA: 'OPC DA', UA: 'OPC UA', iFIX: 'GE iFIX' }[k.proto] || k.proto }), k.ww.length ? el('span', { class: 'tag ww', text: 'Wonderware' }) : null));
      const body = el('div', { class: 'kbbody' });
      if (k.codes.length) body.append(el('div', { class: 'chips' }, k.codes.map((c) => el('span', { class: 'tag code', text: c }))));
      body.append(el('h3', { text: 'Symptom' }), el('p', { text: k.symptom }));
      if (k.causes.length) body.append(el('h3', { text: 'Likely causes' }), el('ul', null, k.causes.map((c) => el('li', { text: c }))));
      body.append(el('h3', { text: 'Mitigation steps' }), el('ol', null, k.steps.map((c) => el('li', { text: c }))));
      if (k.ww.length) body.append(el('div', { class: 'wwbox' }, el('h3', { text: 'Wonderware / AVEVA notes' }), el('ul', null, k.ww.map((c) => el('li', { text: c })))));
      d.append(body); list.append(d);
    });
    syncOpcToggle();
    if (openId) { const t = $('#kb-' + openId); if (t) t.scrollIntoView({ block: 'start' }); }
  }
  $('#opc-search').addEventListener('input', debounce(() => renderOpc(), 120));
  function gotoKb(id, term) {
    opc.filter = 'All'; $$('#opc-chips .fchip').forEach((x) => x.setAttribute('aria-pressed', x.dataset.f === 'All' ? 'true' : 'false'));
    $('#opc-search').value = term || '';
    showTab('opc', true); renderOpc(id);
  }

  // Quality decoder
  const Q_BAD = { 0: 'Non-specific', 1: 'Configuration error', 2: 'Not connected', 3: 'Device failure', 4: 'Sensor failure', 5: 'Last known value', 6: 'Communication failure', 7: 'Out of service', 8: 'Waiting for initial data' };
  const Q_UNC = { 0: 'Non-specific', 1: 'Last usable value', 4: 'Sensor not accurate', 5: 'Engineering units exceeded', 6: 'Sub-normal' };
  const Q_GOOD = { 0: 'Non-specific', 6: 'Local override' };
  const Q_LIM = ['Not limited', 'Low limited', 'High limited', 'Constant'];
  function decodeQuality(v) {
    const q = (v >> 6) & 3, sub = (v >> 2) & 15, lim = v & 3;
    const major = q === 0 ? 'Bad' : q === 1 ? 'Uncertain' : q === 3 ? 'Good' : 'Invalid';
    const names = q === 0 ? Q_BAD : q === 1 ? Q_UNC : q === 3 ? Q_GOOD : {};
    return { major, sub: names[sub] || 'Vendor-specific / reserved (' + sub + ')', limit: Q_LIM[lim] };
  }
  function runQuality() {
    const out = $('#q-out'); out.replaceChildren();
    const s = $('#q-input').value.trim(); if (!s) return;
    const v = CV.num(s);
    if (Number.isNaN(v) || v < 0 || v > 255 || !Number.isInteger(v)) { out.append(el('p', { class: 'err', text: 'Enter a whole number 0–255 (e.g. 192 or 0xC0).' })); return; }
    const d = decodeQuality(v);
    out.append(el('p', null, el('span', { class: 'qbadge ' + (d.major === 'Invalid' ? 'Bad' : d.major), text: d.major.toUpperCase() }), ' ', el('b', { text: d.sub })),
      el('dl', { class: 'kv' }, el('dt', { text: 'Value' }), el('dd', { text: `${v} = 0x${hex2(v)} = ${v.toString(2).padStart(8, '0')}b (QQ SSSS LL)` }), el('dt', { text: 'Limit' }), el('dd', { text: d.limit })),
      el('p', { class: 'hint', text: 'OPC DA quality byte. InTouch shows the same 0–255 value (192 = Good). System Platform attributes also expose their own Quality/QualityDetail — see your version’s help.' }));
    const kbMap = { 24: 'q-bad-comm', 4: 'q-bad-config', 8: 'q-not-connected', 32: 'q-waiting-initial', 12: 'q-device-failure', 16: 'q-device-failure', 20: 'q-device-failure', 68: 'q-uncertain', 80: 'q-uncertain', 84: 'q-uncertain', 88: 'q-uncertain' };
    if (kbMap[v]) out.append(el('button', { class: 'btn small', type: 'button', onclick: () => gotoKb(kbMap[v], '') }, 'Open troubleshooting guide'));
  }
  $('#q-input').addEventListener('input', debounce(runQuality, 120));

  // UA status lookup
  function renderUa() {
    const q = $('#ua-search').value.trim().toLowerCase();
    const b = $('#ua-body'); b.replaceChildren();
    TP.uaStatus.filter((r) => !q || r.join(' ').toLowerCase().includes(q)).forEach((r) => b.append(el('tr', null, el('td', { class: 'm', text: r[0] }), el('td', { class: 'm', text: r[1] }), el('td', { text: r[2] }))));
    if (!b.children.length) b.append(el('tr', null, el('td', { colspan: '3', text: 'No match.' })));
  }
  $('#ua-search').addEventListener('input', debounce(renderUa, 100)); renderUa();

  // DCOM checklist
  (function () {
    const saved = lsGet('pl.dcom', {});
    const ul = $('#dcom-list');
    TP.dcomChecklist.forEach((t, i) => {
      const cb = el('input', { type: 'checkbox', checked: !!saved[i] });
      cb.addEventListener('change', () => { saved[i] = cb.checked; lsSet('pl.dcom', saved); });
      ul.append(el('li', null, el('label', null, cb, el('span', { text: t }))));
    });
  })();

  // ------------------------------------------------------------------ Log parser
  const lg = { filter: 'all', rules: null, lines: [], rendered: null };
  function compileRules(custom) {
    const rules = TP.logRules.map((r) => ({ id: r.id, label: r.label, cls: r.cls, prio: r.prio, re: new RegExp(r.pattern, r.flags) }));
    if (custom) rules.push({ id: 'custom', label: 'Custom match', cls: 'l-custom', prio: -1, re: new RegExp(custom, 'gi') });
    return rules;
  }
  function highlight(line, rules) {
    const found = [];
    for (const r of rules) {
      r.re.lastIndex = 0;
      let m, guard = 0;
      while ((m = r.re.exec(line)) !== null && guard++ < 100) {
        if (m[0].length === 0) { r.re.lastIndex++; continue; }
        found.push({ s: m.index, e: m.index + m[0].length, r, t: m[0] });
      }
    }
    found.sort((a, b) => a.r.prio - b.r.prio || a.s - b.s);
    const acc = [];
    found.forEach((f) => { if (!acc.some((a) => f.s < a.e && f.e > a.s)) acc.push(f); });
    acc.sort((a, b) => a.s - b.s);
    let html = '', pos = 0;
    acc.forEach((a) => { html += esc(line.slice(pos, a.s)) + '<mark class="' + a.r.cls + '" title="' + esc(a.r.label) + '">' + esc(line.slice(a.s, a.e)) + '</mark>'; pos = a.e; });
    html += esc(line.slice(pos));
    return { html, acc };
  }
  const SEV = { error: 3, timeout: 2, drop: 2, warn: 1 };

  function runLog() {
    const text = $('#log-input').value;
    const msg = $('#log-msg'); msg.textContent = ''; msg.className = 'hint';
    if (!text.trim()) { $('#log-result').hidden = true; $('#log-findings-card').hidden = true; return; }
    const custom = $('#log-custom').value.trim();
    try { lg.rules = compileRules(custom); } catch (e) { msg.textContent = '✖ Invalid custom regex: ' + e.message; msg.className = 'hint err'; lg.rules = compileRules(''); }
    let lines = text.split(/\r\n|\r|\n/);
    const MAX = 50000;
    if (lines.length > MAX) { msg.textContent = `Large log: only the first ${MAX} of ${lines.length} lines were analysed.`; lines = lines.slice(0, MAX); }
    const counts = { all: lines.length };
    const findings = new Map();
    lg.lines = lines.map((line, i) => {
      const h = highlight(line, lg.rules);
      const cats = new Set(h.acc.map((a) => a.r.id));
      let sev = 0; cats.forEach((c) => { if (SEV[c] > sev) sev = SEV[c]; });
      cats.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
      h.acc.forEach((a) => {
        let key = null, meaning = '', kb = null;
        if (a.r.id === 'code') { const info = TP.hresults[a.t.toLowerCase()]; key = a.t.toUpperCase().replace('0X', '0x'); meaning = info ? info[0] + ' — ' + info[1] : 'Unknown code (not in the built-in table)'; kb = info ? info[2] : null; }
        else if (a.r.id === 'mbexc') { const m = a.t.match(/(0x)?([0-9a-f]{1,2})\s*$/i); const n = m ? parseInt(m[2], m[1] ? 16 : (/[a-f]/i.test(m[2]) ? 16 : 10)) : NaN; const e = MB.EXC[n]; key = 'Modbus exception ' + (Number.isNaN(n) ? '?' : n); meaning = e ? e[0] + ' — ' + e[1] : 'Unknown exception code'; kb = n === 2 ? 'modbus-address' : (n === 10 || n === 11) ? 'modbus-no-response' : null; }
        else if (a.r.id === 'quality') { const m = a.t.match(/(0x[0-9a-f]{1,2}|\d{1,3})\s*$/i); const v = m ? CV.num(m[1]) : NaN; if (!Number.isNaN(v) && v <= 255) { const d = decodeQuality(v); key = 'Quality ' + v; meaning = d.major + ' — ' + d.sub; kb = { 24: 'q-bad-comm', 4: 'q-bad-config', 8: 'q-not-connected', 32: 'q-waiting-initial' }[v] || null; } }
        else if (a.r.id === 'timeout') { key = 'Timeout'; meaning = 'A request/reply timed out.'; kb = 'da-timeouts'; }
        else if (a.r.id === 'drop') { key = 'Connection drop / comm failure'; meaning = 'Link or session lost.'; kb = 'q-bad-comm'; }
        if (key) { const f = findings.get(key) || { key, n: 0, meaning, kb }; f.n++; findings.set(key, f); }
      });
      return { no: i + 1, html: h.html, cats, sev, raw: line };
    });
    lg.counts = counts;
    renderLogChips(!!custom);
    renderLogLines();
    renderFindings(Array.from(findings.values()).sort((a, b) => b.n - a.n));
    $('#log-result').hidden = false;
  }
  function renderLogChips(hasCustom) {
    const c = $('#log-chips'); c.replaceChildren();
    const defs = [{ id: 'all', label: 'All lines' }].concat(TP.logCats, hasCustom ? [{ id: 'custom', label: 'Custom' }] : []);
    if (!defs.some((d) => d.id === lg.filter)) lg.filter = 'all';
    defs.forEach((d) => c.append(el('button', { class: 'fchip', type: 'button', 'data-f': d.id, 'aria-pressed': d.id === lg.filter ? 'true' : 'false' }, d.label, el('span', { class: 'n', text: String(lg.counts[d.id] || 0) }))));
    const n = lg.counts;
    $('#log-summary').textContent = `${n.all} lines · ${n.error || 0} error · ${n.timeout || 0} timeout · ${n.drop || 0} drop · ${n.warn || 0} warning lines`;
  }
  function renderLogLines() {
    const only = $('#log-only').checked, nums = $('#log-nums').checked;
    const f = lg.filter, CAP = 3000;
    const rows = []; let total = 0;
    for (const l of lg.lines) {
      if (f !== 'all') { if (!l.cats.has(f)) continue; }
      else if (only && !(l.sev || ['code', 'mbexc', 'quality', 'custom'].some((c) => l.cats.has(c)))) continue;
      total++;
      if (rows.length < CAP) rows.push(`<div class="ln s${l.sev}${nums ? '' : ' nonum'}"><span class="no">${l.no}</span><span class="tx">${l.html || ' '}</span></div>`);
    }
    $('#log-out').innerHTML = rows.join('') + (total > CAP ? `<div class="ln"><span class="tx">… ${total - CAP} more lines not shown — narrow the filter.</span></div>` : '') || '<div class="ln"><span class="tx">No lines match this filter.</span></div>';
  }
  function renderFindings(list) {
    const card = $('#log-findings-card'), b = $('#log-findings'); b.replaceChildren();
    card.hidden = list.length === 0;
    list.forEach((f) => b.append(el('tr', null, el('td', { class: 'm', text: f.key }), el('td', { class: 'm', text: String(f.n) }), el('td', { text: f.meaning }),
      el('td', null, f.kb ? el('button', { class: 'btn small', type: 'button', onclick: () => gotoKb(f.kb, '') }, 'Guide') : null))));
  }
  $('#log-chips').addEventListener('click', (e) => {
    const b = e.target.closest('.fchip'); if (!b) return;
    lg.filter = b.dataset.f;
    $$('#log-chips .fchip').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    renderLogLines();
  });
  $('#log-analyze').addEventListener('click', runLog);
  $('#log-input').addEventListener('input', debounce(runLog, 400));
  $('#log-custom').addEventListener('input', debounce(runLog, 400));
  $('#log-only').addEventListener('change', () => lg.lines.length && renderLogLines());
  $('#log-nums').addEventListener('change', () => lg.lines.length && renderLogLines());
  TP.logPresets.forEach((p) => $('#log-preset').append(el('option', { value: p.id, text: p.label })));
  $('#log-preset').addEventListener('change', (e) => {
    const p = TP.logPresets.find((x) => x.id === e.target.value); if (!p) return;
    $('#log-input').value = p.text; runLog(); e.target.value = '';
    toast('Loaded sample: ' + p.label);
  });
  $('#log-save').addEventListener('click', () => {
    const v = $('#log-input').value.trim(); if (!v) { toast('Nothing to save'); return; }
    PL.db.add('notes', { text: v.slice(0, 50000), kind: 'log' }).then(() => toast('Log saved to the Saved tab')).catch(() => toast('Storage unavailable'));
  });
  $('#log-clear').addEventListener('click', () => { $('#log-input').value = ''; runLog(); $('#log-input').focus(); });
  $('#log-file').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    if (f.size > 25 * 1024 * 1024) { toast('File too large (25 MB max)'); return; }
    const rd = new FileReader();
    rd.onload = () => { $('#log-input').value = String(rd.result); runLog(); toast('Loaded ' + f.name); };
    rd.onerror = () => toast('Could not read file');
    rd.readAsText(f); e.target.value = '';
  });

  // ------------------------------------------------------------------ Tools
  function kvOut(target, rows, err) {
    const t = $(target); t.replaceChildren();
    if (err) { t.append(el('p', { class: 'err', text: '✖ ' + err })); return; }
    const dl = el('dl', { class: 'kv' });
    rows.forEach((r) => dl.append(el('dt', { text: r[0] }), el('dd', null, el('span', { text: r[1] }), cpy(r[2] === undefined ? r[1] : r[2], r[0]))));
    t.append(dl);
  }
  $('#ad-input').addEventListener('input', debounce(() => {
    const s = $('#ad-input').value.trim(); if (!s) { $('#ad-out').replaceChildren(); return; }
    const r = CV.parseModicon(s);
    if (r.error) return kvOut('#ad-out', [], r.error);
    kvOut('#ad-out', [['Table', r.name], ['Protocol offset (dec)', String(r.offset)], ['Protocol offset (hex)', r.hex], ['Read FC', r.read], ['Write FC', r.write], ['Other format', (CV.toModicon(r.table, r.offset, r.digits === 5 ? 6 : 5).text || 'n/a')]]);
  }, 120));
  const ad2 = debounce(() => {
    const s = $('#ad2-offset').value.trim(); if (!s) { $('#ad2-out').replaceChildren(); return; }
    const off = CV.num(s);
    const r = CV.toModicon(Number($('#ad2-table').value), off, Number($('#ad2-digits').value));
    if (r.error) return kvOut('#ad2-out', [], r.error);
    kvOut('#ad2-out', [['Modicon', r.text], ['Offset (dec)', String(off)], ['Offset (hex)', '0x' + hex4(off)]]);
  }, 120);
  ['#ad2-offset', '#ad2-table', '#ad2-digits'].forEach((id) => { $(id).addEventListener('input', ad2); $(id).addEventListener('change', ad2); });

  $('#ck-input').addEventListener('input', debounce(() => {
    const s = $('#ck-input').value; if (!s.trim()) { $('#ck-out').replaceChildren(); return; }
    const p = ED.parseInput(s);
    if (p.error) return kvOut('#ck-out', [], p.error);
    const c = MB.crc16(p.bytes), l = MB.lrc(p.bytes);
    kvOut('#ck-out', [['Bytes', String(p.bytes.length)], ['CRC-16', `0x${hex4(c)}  → on wire: ${hex2(c & 0xff)} ${hex2(c >> 8)} (low first)`, '0x' + hex4(c)], ['CRC bytes (lo hi)', hex2(c & 0xff) + ' ' + hex2(c >> 8)], ['RTU frame', ED.formatHex(p.bytes.concat([c & 0xff, c >> 8]))], ['LRC', `0x${hex2(l)}`], ['ASCII frame', ':' + ED.formatHex(p.bytes.concat([l]), '')]]);
  }, 120));

  function sc() {
    const v = ['#sc-raw', '#sc-rmin', '#sc-rmax', '#sc-emin', '#sc-emax'].map((id) => CV.num($(id).value));
    if (v.some(Number.isNaN)) return kvOut('#sc-out', [], 'All five fields must be numbers.');
    const r = CV.scale(v[0], v[1], v[2], v[3], v[4]);
    if (r.error) return kvOut('#sc-out', [], r.error);
    kvOut('#sc-out', [['Engineering value', String(Number(r.value.toFixed(6)))], ['% of span', r.pct.toFixed(2) + ' %']]);
  }
  ['#sc-raw', '#sc-rmin', '#sc-rmax', '#sc-emin', '#sc-emax'].forEach((id) => $(id).addEventListener('input', debounce(sc, 100)));
  $$('[data-preset]').forEach((b) => b.addEventListener('click', () => {
    const p = b.dataset.preset.split(',');
    ['#sc-rmin', '#sc-rmax', '#sc-emin', '#sc-emax'].forEach((id, i) => { $(id).value = p[i]; });
    sc();
  }));
  sc();

  // ------------------------------------------------------------------ Endianness & word swapper
  (function () {
    const EN = CV.ENDIAN;
    EN.forEach((e) => ['#en-from', '#en-to'].forEach((id) => $(id).append(el('option', { value: e.key, text: e.key + ' — ' + e.name }))));
    $('#en-to').value = 'CDAB';
    const rowsOf = (d, w) => EN.map((e) => el('tr', null,
      el('td', null, el('b', { text: d[e.key].label }), el('div', { class: 'muted', text: e.name + ' · ' + e.note })),
      mcell(d[e.key].canon, d[e.key].canon, e.key + ' bytes'), mcell(d[e.key].f, d[e.key].f, e.key + ' float'),
      mcell(d[e.key].i, d[e.key].i, e.key + ' signed integer'), mcell(d[e.key].u, d[e.key].u, e.key + ' unsigned integer')));
    function run() {
      const out = $('#en-out'), conv = $('#en-conv'), enc = $('#en-enc');
      out.replaceChildren(); conv.replaceChildren(); enc.replaceChildren();
      const w = Number($('#en-width').value), mode = $('#en-mode').value;
      $('#en-in').placeholder = mode === 'regs' ? (w === 32 ? '0x4048 0xF5C3' : '0x4009 0x1EB8 0x51EB 0x851F') : (w === 32 ? '40 48 F5 C3' : '40 09 1E B8 51 EB 85 1F');
      if ($('#en-in').value.trim()) {
        const r = CV.parseRaw($('#en-in').value, mode, w);
        if (r.error) out.append(el('p', { class: 'err', text: '✖ ' + r.error }));
        else {
          const d = CV.decodeAll(r.bytes);
          out.append(el('p', { class: 'hint', text: 'Received bytes: ' + ED.formatHex(r.bytes) + '  ·  pick the row with a plausible value.' }),
            el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' },
              el('thead', null, el('tr', null, ['Layout', 'Value bytes (big-endian)', 'Float' + w, 'Int' + w, 'UInt' + w].map((h) => el('th', { text: h })))),
              el('tbody', null, rowsOf(d, w)))));
          const from = $('#en-from').value, to = $('#en-to').value;
          const cb = CV.convertOrder(r.bytes, from, to);
          conv.append(el('dl', { class: 'kv' },
            el('dt', { text: 'Bytes' }), el('dd', { text: ED.formatHex(cb) }),
            el('dt', { text: 'Registers' }), el('dd', { text: CV.wordsText(cb) })),
          copyBtn(ED.formatHex(cb), 'Copy bytes'), ' ', copyBtn(CV.wordsText(cb), 'Copy registers'));
        }
      }
      const v = $('#en-val').value.trim();
      if (v) {
        const e = CV.encodeValue(v, $('#en-type').value, w);
        if (e.error) enc.append(el('p', { class: 'err', text: '✖ ' + e.error }));
        else enc.append(el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' },
          el('thead', null, el('tr', null, ['Layout', 'Bytes to send', 'Registers'].map((h) => el('th', { text: h })))),
          el('tbody', null, EN.map((o) => el('tr', null, el('td', null, el('b', { text: e[o.key].label }), el('div', { class: 'muted', text: o.name + ' · ' + o.note })), mcell(e[o.key].hex, e[o.key].hex, o.key + ' bytes'), mcell(e[o.key].words, e[o.key].words, o.key + ' registers')))))));
      }
    }
    const runSoon = debounce(run, 120);
    ['#en-in', '#en-val'].forEach((id) => $(id).addEventListener('input', runSoon));
    ['#en-width', '#en-mode', '#en-from', '#en-to', '#en-type'].forEach((id) => $(id).addEventListener('change', run));
    run();
  })();

  // ------------------------------------------------------------------ 4–20 mA loop + Ohm's law
  (function () {
    const LP = PL.instrument;
    const rnd = (v, d) => String(Number(Number(v).toFixed(d)));
    const opts = () => ({ mode: $('#lp-mode').value, euLo: CV.num($('#lp-eulo').value), euHi: CV.num($('#lp-euhi').value) });
    function lp(src) {
      const o = opts(), out = $('#lp-out');
      $('#lp-unit-lbl').textContent = $('#lp-unit').value || 'EU';
      out.replaceChildren();
      if (Number.isNaN(o.euLo) || Number.isNaN(o.euHi) || o.euLo === o.euHi) { out.append(el('p', { class: 'err', text: '✖ Enter two different numbers for the process range.' })); return; }
      let mA;
      if (src === 'eu') mA = LP.euToLoop(CV.num($('#lp-eu').value), o);
      else if (src === 'slider') mA = Number($('#lp-slider').value);
      else mA = CV.num($('#lp-ma').value);
      if (!Number.isFinite(mA) || mA < 0 || mA > 40) { out.append(el('p', { class: 'err', text: '✖ Enter a loop current of 0–40 mA (or a process value that maps into it).' })); return; }
      if (src !== 'ma') $('#lp-ma').value = rnd(mA, 3);
      if (src !== 'slider') $('#lp-slider').value = String(Math.min(24, mA));
      if (src !== 'eu') $('#lp-eu').value = rnd(LP.loopToEU(mA, o), 4);
      const st = LP.loopStatus(mA, o.mode), pct = LP.pctOfSpan(mA, o.mode);
      const rows = [['Span', rnd(pct, 2) + ' %'], ['Process value', rnd(LP.loopToEU(mA, o), 4) + ' ' + ($('#lp-unit').value || '')],
        ['S7 raw (module 4–20 mA)', String(LP.siemensRaw(mA, '4-20')) + '  (nominal 0…27648)'], ['S7 raw (module 0–20 mA)', String(LP.siemensRaw(mA, '0-20'))]];
      const dl = el('dl', { class: 'kv' }); rows.forEach((r) => dl.append(el('dt', { text: r[0] }), el('dd', { text: r[1] })));
      out.append(dl, el('div', { class: 'verdict ' + (st.level === 'good' ? 'good' : st.level === 'warn' ? 'warn' : 'bad') }, el('span', { text: st.text })));
      ohm('ma-sync');
    }
    function ohm(src) {
      const R = CV.num($('#oh-r').value), out = $('#oh-out');
      out.replaceChildren();
      if (!(R > 0)) { out.append(el('p', { class: 'err', text: '✖ Resistor value must be a positive number of ohms.' })); return; }
      let mA;
      if (src === 'v') { const V = CV.num($('#oh-v').value); if (Number.isNaN(V)) { out.append(el('p', { class: 'err', text: '✖ Voltage is not a number.' })); return; } mA = LP.current(V, R); $('#oh-ma').value = rnd(mA, 3); }
      else { mA = CV.num($('#oh-ma').value); if (Number.isNaN(mA)) { out.append(el('p', { class: 'err', text: '✖ Current is not a number.' })); return; } $('#oh-v').value = rnd(LP.voltage(mA, R), 4); }
      const mode = $('#lp-mode').value;
      out.append(el('p', null, el('b', { text: rnd(mA, 3) + ' mA' }), ' across ', el('b', { text: rnd(R, 2) + ' Ω' }), ' = ', el('b', { text: rnd(LP.voltage(mA, R), 4) + ' V' })),
        el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, ['mA', '% span', 'Volts'].map((h) => el('th', { text: h })))),
          el('tbody', null, LP.dropTable(R, mode).map((r) => el('tr', null, el('td', { class: 'm', text: rnd(r.mA, 2) }), el('td', { class: 'm', text: rnd(r.pct, 1) }), el('td', { class: 'm', text: rnd(r.volts, 4) })))))),
        el('p', { class: 'hint', text: 'Measure with the meter across the resistor (loop powered, transmitter connected). Compare with the PLC’s scaled value.' }));
    }
    const lpSoon = { ma: debounce(() => lp('ma'), 80), eu: debounce(() => lp('eu'), 80), cfg: debounce(() => lp('ma'), 80) };
    $('#lp-ma').addEventListener('input', lpSoon.ma);
    $('#lp-eu').addEventListener('input', lpSoon.eu);
    $('#lp-slider').addEventListener('input', () => lp('slider'));
    ['#lp-eulo', '#lp-euhi', '#lp-unit'].forEach((id) => $(id).addEventListener('input', lpSoon.cfg));
    $('#lp-mode').addEventListener('change', () => lp('ma'));
    $$('[data-lp]').forEach((b) => b.addEventListener('click', () => { const p = b.dataset.lp.split(','); $('#lp-eulo').value = p[0]; $('#lp-euhi').value = p[1]; $('#lp-unit').value = p[2]; lp('ma'); }));
    $$('[data-ohm]').forEach((b) => b.addEventListener('click', () => { $('#oh-r').value = b.dataset.ohm; ohm('ma'); }));
    $('#oh-ma').addEventListener('input', debounce(() => ohm('ma'), 80));
    $('#oh-r').addEventListener('input', debounce(() => ohm('ma'), 80));
    $('#oh-v').addEventListener('input', debounce(() => ohm('v'), 80));
    $('#oh-use').addEventListener('click', () => { $('#oh-ma').value = $('#lp-ma').value; ohm('ma'); });
    lp('ma');
  })();

  // ------------------------------------------------------------------ Subnet planner
  (function () {
    const SN = PL.subnet;
    function run() {
      const out = $('#sn-out'), extra = $('#sn-extra');
      out.replaceChildren(); extra.replaceChildren();
      const s = $('#sn-in').value.trim();
      if (!s) return;
      const p = SN.parse(s);
      if (p.error) { kvOut('#sn-out', [], p.error); return; }
      const c = SN.calc(p.ip, p.prefix);
      const rows = [['Address', SN.ipToStr(c.ip) + ' /' + c.prefix], ['Subnet mask', c.maskStr], ['Wildcard mask', c.wildcardStr], ['Network ID', c.networkStr],
        ['Broadcast', c.prefix >= 31 ? (c.prefix === 31 ? c.broadcastStr + ' (not used — /31)' : 'n/a (/32)') : c.broadcastStr],
        ['Usable range', c.firstStr + '  →  ' + c.lastStr], ['Usable hosts', c.usable.toLocaleString() + ' (of ' + c.total.toLocaleString() + ' addresses)'],
        ['Common gateway', c.prefix <= 30 ? c.firstStr + ' (convention: first usable — use what your network defines)' : 'n/a'], ['Mask (binary)', c.maskBin], ['Type', c.kind]];
      kvOut('#sn-out', rows);
      if (c.note) $('#sn-out').append(el('p', { class: 'hint', text: c.note }));
      const chk = $('#sn-chk').value.trim();
      if (chk) {
        const ip = SN.parseIPv4(chk);
        extra.append(ip === null ? el('p', { class: 'err', text: '✖ "' + chk + '" is not a valid IPv4 address.' })
          : el('p', { class: SN.contains(c, ip) ? 'ok' : 'err', text: (SN.contains(c, ip) ? '✔ ' : '✖ ') + chk + (SN.contains(c, ip) ? ' is inside ' : ' is NOT inside ') + c.networkStr + '/' + c.prefix + (SN.contains(c, ip) && (ip === c.network || ip === c.broadcast) && c.prefix < 31 ? ' (but it is the ' + (ip === c.network ? 'network' : 'broadcast') + ' address — not assignable)' : '') }));
      }
      const sp = $('#sn-split').value.trim();
      if (sp) {
        const r = SN.split(c, Number(sp), 64);
        if (r.error) extra.append(el('p', { class: 'err', text: '✖ ' + r.error }));
        else extra.append(el('p', { class: 'hint', text: r.count + ' subnets of /' + sp + (r.truncated ? ' (first 64 shown)' : '') }),
          el('div', { class: 'tablewrap' }, el('table', { class: 'tbl' }, el('thead', null, el('tr', null, ['Network', 'Usable range', 'Broadcast'].map((h) => el('th', { text: h })))),
            el('tbody', null, r.list.map((x) => el('tr', null, el('td', { class: 'm', text: x.networkStr + '/' + x.prefix }), el('td', { class: 'm', text: x.firstStr + ' – ' + x.lastStr }), el('td', { class: 'm', text: x.broadcastStr })))))));
      }
    }
    ['#sn-in', '#sn-chk', '#sn-split'].forEach((id) => $(id).addEventListener('input', debounce(run, 120)));
  })();

  // ------------------------------------------------------------------ Live serial sniffer (Web Serial)
  (function () {
    const S = PL.serial, MBX = PL.modbus;
    const sup = S.support();
    const warn = $('#ser-warn');
    const st = { sess: null, framer: null, timer: null, paused: false, frames: [], count: 0, bytes: 0, ok: 0, bad: 0, raw: [], gap: 0, cfg: '', pending: false };
    if (!sup.ok) { warn.textContent = '⚠ ' + sup.reason; warn.hidden = false; $('#ser-connect').disabled = true; $('#ser-led').className = 'led err'; $('#ser-dock').classList.add('err'); }
    const ctl = (connected) => {
      $('#ser-dock').classList.toggle('live', connected);
      $('#ser-connect').disabled = connected || !sup.ok;
      ['#ser-disconnect', '#ser-pause', '#ser-send'].forEach((id) => { $(id).disabled = !connected; });
      ['#ser-baud', '#ser-parity', '#ser-stop', '#ser-gap'].forEach((id) => { $(id).disabled = connected; });
    };
    const setStatus = (t) => { $('#ser-status').textContent = t; };
    const stamp = (ms) => { const d = new Date(ms); return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0'); };
    function status() {
      $('#ser-led').className = 'led ' + (st.sess ? (st.paused ? 'paused' : 'on') : 'off');
      $('#ser-dock').classList.toggle('paused', !!st.sess && st.paused);
      setStatus((st.sess ? 'Connected ' + st.cfg + (st.port || '') + ' · gap ' + st.gap.toFixed(1) + ' ms' + (st.paused ? ' · PAUSED' : '') : 'Not connected') + ' · ' + st.bytes + ' bytes · ' + st.count + ' frames (' + st.ok + ' CRC ok, ' + st.bad + ' bad)');
    }
    function render() {
      st.pending = false;
      const tb = $('#ser-body'); tb.replaceChildren();
      $('#ser-table').hidden = st.frames.length === 0;
      st.frames.slice(-100).reverse().forEach((f) => {
        const hex = ED.formatHex(f.bytes.slice(0, 48)) + (f.bytes.length > 48 ? ' …' : '');
        tb.append(el('tr', { class: f.crc === false ? 'badcrc' : null },
          el('td', { class: 'm', text: String(f.n) }), el('td', { class: 'm', text: stamp(f.t) }), el('td', { class: 'm', text: String(f.bytes.length) }),
          el('td', null, el('span', { class: 'badge ' + (f.crc === null ? 'na' : f.crc ? 'ok' : 'bad'), text: f.crc === null ? 'n/a' : f.crc ? 'OK' : 'BAD' })),
          el('td', { class: 'frame', text: hex }),
          el('td', null, el('button', { class: 'btn small', type: 'button', onclick: () => loadFrame(f, true) }, 'Analyze'), ' ', copyBtn(ED.formatHex(f.bytes), 'Copy'))));
      });
      status();
    }
    const later = () => { if (!st.pending) { st.pending = true; requestAnimationFrame(render); } };
    function loadFrame(f, scroll) {
      $('#mb-input').value = ED.formatHex(f.bytes);
      $('#mb-mode').value = 'rtu';
      runAnalysis();
      if (scroll) $('#mb-out').scrollIntoView({ block: 'start' });
    }
    function onFrame(bytes, start) {
      const n = bytes.length;
      const crc = n >= 4 ? MBX.crc16(bytes, 0, n - 2) === (bytes[n - 2] | (bytes[n - 1] << 8)) : null;
      if (crc === true) st.ok++; else if (crc === false) st.bad++;
      const f = { n: ++st.count, t: Date.now() - (performance.now() - start), bytes, crc };
      st.frames.push(f); if (st.frames.length > 300) st.frames.shift();
      if ($('#ser-auto').checked) loadFrame(f, false);
      later();
    }
    function onBytes(v, now) {
      if (st.paused) return;
      st.bytes += v.length;
      st.framer.push(Array.from(v), now);
      if ($('#ser-raw').checked) {
        st.raw.push(ED.formatHex(Array.from(v)));
        if (st.raw.length > 400) st.raw.splice(0, st.raw.length - 400);
        $('#ser-rawbox').textContent = st.raw.join(' ');
        $('#ser-rawbox').scrollTop = 1e9;
      }
      later();
    }
    $('#ser-raw').addEventListener('change', () => { $('#ser-rawbox').hidden = !$('#ser-raw').checked; });
    $('#ser-connect').addEventListener('click', async () => {
      const cfg = { baudRate: Number($('#ser-baud').value), parity: $('#ser-parity').value, stopBits: Number($('#ser-stop').value) };
      const gapIn = CV.num($('#ser-gap').value);
      st.gap = Number.isFinite(gapIn) && gapIn > 0 ? gapIn : S.silenceMs(cfg.baudRate, cfg.parity, cfg.stopBits);
      st.cfg = cfg.baudRate + ' 8' + cfg.parity[0].toUpperCase() + cfg.stopBits;
      st.framer = new S.Framer(st.gap, onFrame);
      st.sess = new S.Session({
        onBytes,
        onError: (e) => { toast('Serial: ' + (e && e.name ? e.name : 'error') + (e && e.message ? ' — ' + e.message : '')); },
        onClose: () => { clearInterval(st.timer); if (st.framer) st.framer.flush(); st.sess = null; ctl(false); status(); toast('Serial port closed'); },
      });
      try { await st.sess.connect(cfg); }
      catch (e) {
        st.sess = null;
        $('#ser-led').className = 'led ' + (e && e.name === 'NotFoundError' ? 'off' : 'err');
        setStatus(e && e.name === 'NotFoundError' ? 'No port selected.' : '✖ Could not open port: ' + (e && e.message ? e.message : e) + ' (is another program using it?)');
        return;
      }
      try { const inf = st.sess.port && st.sess.port.getInfo ? st.sess.port.getInfo() : null; st.port = inf && inf.usbVendorId !== undefined ? ' · USB ' + hex4(inf.usbVendorId) + ':' + hex4(inf.usbProductId || 0) : ''; } catch (e) { st.port = ''; }
      $('#ser-card').open = true;
      st.paused = false; $('#ser-pause').textContent = 'Pause';
      ctl(true); status();
      st.timer = setInterval(() => st.framer.tick(performance.now()), Math.max(2, Math.min(20, st.gap / 2)));
    });
    $('#ser-disconnect').addEventListener('click', () => { if (st.sess) st.sess.disconnect(); });
    $('#ser-pause').addEventListener('click', () => { st.paused = !st.paused; $('#ser-pause').textContent = st.paused ? 'Resume' : 'Pause'; status(); });
    $('#ser-clear').addEventListener('click', () => { st.frames = []; st.count = st.bytes = st.ok = st.bad = 0; st.raw = []; $('#ser-rawbox').textContent = ''; render(); });
    $('#ser-save').addEventListener('click', async () => {
      if (!st.frames.length) { toast('No captured frames to save'); return; }
      try {
        for (const f of st.frames) await PL.db.add('frames', { hex: ED.formatHex(f.bytes), mode: 'rtu', ts: Math.round(f.t), summary: 'Sniffed frame #' + f.n + ' · ' + f.bytes.length + ' bytes · CRC ' + (f.crc === null ? 'n/a' : f.crc ? 'OK' : 'BAD') });
        toast('Saved ' + st.frames.length + ' frame(s) to the Saved tab');
      } catch (e) { toast('Storage unavailable'); }
    });
    $('#ser-send').addEventListener('click', async () => {
      const p = ED.parseInput($('#ser-tx').value);
      if (p.error) { toast(p.error); return; }
      let b = p.bytes.slice();
      if ($('#ser-tx-crc').checked) { const c = MBX.crc16(b); b = b.concat([c & 0xff, c >> 8]); }
      try { await st.sess.write(b); toast('Sent ' + b.length + ' bytes: ' + ED.formatHex(b)); } catch (e) { toast('Send failed: ' + (e && e.message ? e.message : e)); }
    });
    status();
    window.PL.app = Object.assign(window.PL.app || {}, { serialState: st });
  })();

  // ------------------------------------------------------------------ Tag helper (Wonderware DBLoad / iFIX)
  (function () {
    const TH = PL.taghelper;
    let lastKind = 'dbload';
    function run() {
      const target = $('#tg-target').value, text = $('#tg-in').value, out = $('#tg-out'), ul = $('#tg-issues');
      ul.replaceChildren(); out.value = '';
      const addIssues = (list) => list.forEach((i) => ul.append(el('li', { class: i.level }, el('b', { text: { error: 'Error · ', warn: 'Warning · ', info: 'Note · ', ok: 'OK · ' }[i.level] }), (i.line ? 'Line ' + i.line + ': ' : '') + i.msg)));
      lastKind = target;
      if (!text.trim()) { return; }
      if (target === 'validate') {
        const v = TH.validateDbLoad(text);
        addIssues(v.issues);
        addIssues([{ level: v.issues.some((i) => i.level === 'error') ? 'info' : 'ok', line: 0, msg: v.stats.tags + ' tag row(s) in ' + v.stats.sections + ' section(s) checked.' }]);
        return;
      }
      const numOr = (id, d) => { const v = CV.num($(id).value); return Number.isNaN(v) ? d : v; };
      const o = { access: $('#tg-access').value.trim(), group: $('#tg-group').value.trim() || '$System', eu: $('#tg-eu').value.trim(), min: numOr('#tg-min', 0), max: numOr('#tg-max', 100), type: $('#tg-type').value, delim: $('#tg-delim').value, customHeader: $('#tg-hdr').value, node: $('#tg-node').value, driver: $('#tg-driver').value.trim(), fields: $('#tg-fields').value.split(/[\s,;]+/).filter(Boolean).map((x) => x.toUpperCase()) };
      const p = TH.parseLines(text, { type: o.type });
      addIssues(p.issues);
      if (!p.rows.length) return;
      let res;
      if (target === 'dbload') res = TH.buildDbLoad(p.rows, o);
      else if (target === 'ifix-ref') res = TH.ifixRefs(p.rows, o);
      else { res = TH.fillByHeader(p.rows, $('#tg-hdr').value, o); addIssues(TH.ifixRefs(p.rows, o).issues.filter((i) => i.line)); }
      addIssues(res.issues);
      out.value = res.text;
      const errs = res.issues.some((i) => i.level === 'error');
      if (res.text) addIssues([{ level: errs ? 'warn' : 'ok', line: 0, msg: p.rows.length + ' tag(s) processed' + (errs ? ' — fix the errors above before importing.' : '.') }]);
    }
    $('#tg-gen').addEventListener('click', run);
    $('#tg-target').addEventListener('change', run);
    $('#tg-in').addEventListener('input', debounce(run, 300));
    ['#tg-type', '#tg-access', '#tg-group', '#tg-eu', '#tg-min', '#tg-max', '#tg-delim', '#tg-node', '#tg-driver', '#tg-fields', '#tg-hdr'].forEach((id) => $(id).addEventListener('input', debounce(run, 300)));
    $('#tg-sample').addEventListener('click', () => { $('#tg-in').value = TP.tagSample; run(); });
    $('#tg-copy').addEventListener('click', async () => { if (!$('#tg-out').value) { toast('Nothing to copy'); return; } toast((await ED.copy($('#tg-out').value)) ? 'Copied' : 'Copy failed'); });
    $('#tg-dl').addEventListener('click', () => {
      const v = $('#tg-out').value; if (!v) { toast('Nothing to download'); return; }
      const name = lastKind === 'dbload' ? 'dbload.csv' : lastKind === 'ifix-ref' ? 'ifix-tags.txt' : 'ifix-import.csv';
      const url = URL.createObjectURL(new Blob([v], { type: 'text/csv' }));
      const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    });
  })();

  // ------------------------------------------------------------------ History / notes
  const fmtDate = (ts) => new Date(ts).toLocaleString();
  function renderHistory() {
    PL.db.list('frames').then((rows) => {
      const t = $('#hist-frames'); t.replaceChildren();
      if (!rows.length) { t.append(el('p', { class: 'muted', text: 'No saved frames yet. Analyze a frame and press “Save to history”.' })); return; }
      rows.forEach((r) => t.append(el('div', { class: 'card' },
        el('div', { class: 'muted', text: fmtDate(r.ts) + ' · ' + String(r.mode).toUpperCase() }),
        el('div', { class: 'out', text: r.hex }), el('p', { text: r.summary || '' }),
        el('div', { class: 'row' },
          el('button', { class: 'btn small primary', type: 'button', onclick: () => { $('#mb-input').value = r.hex; showTab('modbus', true); runAnalysis(); } }, 'Load'),
          copyBtn(r.hex, 'Copy'),
          el('button', { class: 'btn small danger', type: 'button', onclick: () => PL.db.remove('frames', r.id).then(renderHistory) }, 'Delete')))));
    }).catch(() => $('#hist-frames').replaceChildren(el('p', { class: 'err', text: 'Storage unavailable in this browser mode.' })));
    PL.db.list('notes').then((rows) => {
      const t = $('#hist-notes'); t.replaceChildren();
      rows.forEach((r) => t.append(el('div', { class: 'card' }, el('div', { class: 'muted', text: fmtDate(r.ts) + (r.kind === 'log' ? ' · LOG SNIPPET' : '') }), r.kind === 'log' ? el('pre', { class: 'logbox rawbox', text: r.text }) : el('p', { text: r.text }),
        el('button', { class: 'btn small danger', type: 'button', onclick: () => PL.db.remove('notes', r.id).then(renderHistory) }, 'Delete'))));
    }).catch(() => { /* already reported */ });
  }
  $('#note-save').addEventListener('click', () => {
    const v = $('#note-input').value.trim(); if (!v) return;
    PL.db.add('notes', { text: v }).then(() => { $('#note-input').value = ''; toast('Note saved'); renderHistory(); }).catch(() => toast('Storage unavailable'));
  });
  function downloadText(name, text, mime) {
    const url = URL.createObjectURL(new Blob([text], { type: mime }));
    const a = el('a', { href: url, download: name }); document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const stampName = () => { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); };
  async function exportText(kind) {
    try {
      const frames = await PL.db.list('frames'), notes = await PL.db.list('notes');
      if (!frames.length && !notes.length) { toast('Nothing saved yet'); return; }
      if (kind === 'csv') downloadText('protolink-saved-' + stampName() + '.csv', PL.exporter.toCsv(frames, notes), 'text/csv;charset=utf-8');
      else downloadText('protolink-saved-' + stampName() + '.txt', PL.exporter.toTxt(frames, notes, 'ProtoLink Diagnostics — saved frames, notes and logs'), 'text/plain;charset=utf-8');
      toast('Downloaded ' + (frames.length + notes.length) + ' item(s)');
    } catch (e) { toast('Export failed'); }
  }
  $('#hist-csv').addEventListener('click', () => exportText('csv'));
  $('#hist-txt').addEventListener('click', () => exportText('txt'));
  $('#hist-export').addEventListener('click', async () => {
    try {
      const data = { exported: new Date().toISOString(), app: 'ProtoLink Diagnostics', frames: await PL.db.list('frames'), notes: await PL.db.list('notes') };
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const a = el('a', { href: url, download: 'protolink-export.json' }); document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) { toast('Export failed'); }
  });
  $('#hist-clear').addEventListener('click', async () => {
    if (!window.confirm('Delete all saved frames and notes on this device?')) return;
    try { await PL.db.clear('frames'); await PL.db.clear('notes'); toast('Deleted'); renderHistory(); } catch (e) { toast('Failed'); }
  });

  // ------------------------------------------------------------------ Tools accordions (state remembered)
  (function () {
    const cards = $$('details.tool'), btn = $('#tools-toggle');
    const saved = lsGet('pl.tools', null);
    cards.forEach((d, i) => { d.open = saved ? !!saved[d.dataset.tool] : i === 0; });
    const sync = () => { const all = cards.every((d) => d.open); btn.textContent = all ? 'Collapse all' : 'Expand all'; };
    cards.forEach((d) => d.addEventListener('toggle', () => { const m = {}; cards.forEach((x) => { m[x.dataset.tool] = x.open; }); lsSet('pl.tools', m); sync(); }));
    btn.addEventListener('click', () => { const open = !cards.every((d) => d.open); cards.forEach((d) => { d.open = open; }); sync(); });
    sync();
  })();

  // ------------------------------------------------------------------ sticky offsets (serial dock sits under the sticky header/tabs)
  function updateStickyOffsets() {
    const tb = $('.topbar').offsetHeight, tabs = $('.tabs');
    const tabsSticky = getComputedStyle(tabs).position === 'sticky' ? tabs.offsetHeight : 0;
    document.documentElement.style.setProperty('--topbar-h', tb + 'px');
    document.documentElement.style.setProperty('--dock-top', (tb + tabsSticky + 6) + 'px');
    // keep auto-scrolled / anchored elements clear of the sticky bars (dock only matters on the Modbus tab)
    const dock = $('#ser-dock'), dockVisible = dock && dock.offsetParent !== null;
    const bottomTabs = tabsSticky ? 0 : tabs.offsetHeight;
    document.documentElement.style.scrollPaddingTop = (tb + tabsSticky + (dockVisible ? dock.offsetHeight + 12 : 8)) + 'px';
    document.documentElement.style.scrollPaddingBottom = (bottomTabs + 12) + 'px';
  }
  window.addEventListener('resize', debounce(updateStickyOffsets, 100));
  updateStickyOffsets();
  if (window.ResizeObserver) { const ro = new ResizeObserver(updateStickyOffsets); ro.observe($('.topbar')); if ($('#ser-dock')) ro.observe($('#ser-dock')); }
  window.addEventListener('hashchange', updateStickyOffsets);

  // ------------------------------------------------------------------ init
  renderOpc();
  showTab(location.hash.slice(1) || 'modbus', false);
  window.PL.app = Object.assign(window.PL.app || {}, { decodeQuality });
})();
