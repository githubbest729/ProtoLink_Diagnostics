/* ProtoLink Diagnostics — js/editor.js
 * Input handling for the hex editor: forgiving hex parsing, formatting, clipboard.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});
  const hex2 = (n) => (n & 0xff).toString(16).toUpperCase().padStart(2, '0');

  function pairsToBytes(str) {
    const out = [];
    for (let i = 0; i < str.length; i += 2) out.push(parseInt(str.substr(i, 2), 16));
    return out;
  }

  /**
   * Parse free-form hex text. Accepts "01 03 00", "0x01,0x03", "010300", "01:03:00",
   * and Modbus ASCII frames (":010300000001FB", with or without CR/LF).
   * @returns {{bytes:number[], ascii:boolean, warnings:string[], error:string|null}}
   */
  function parseInput(text) {
    const res = { bytes: [], ascii: false, warnings: [], error: null };
    if (!text || !text.trim()) { res.error = 'Nothing to parse.'; return res; }
    let s = text.trim();

    // Modbus ASCII frame typed as text
    if (s[0] === ':') {
      res.ascii = true;
      s = s.slice(1).replace(/\\r|\\n/gi, '').replace(/[\s\r\n]+/g, '');
      if (!/^[0-9a-f]*$/i.test(s)) {
        res.error = 'ASCII frame contains non-hex characters.';
        return res;
      }
      if (s.length % 2) { res.error = 'ASCII frame has an odd number of hex digits.'; return res; }
      res.bytes = pairsToBytes(s);
      return res;
    }

    let t = s.replace(/0x/gi, ' ').replace(/:/g, ' ');
    if (/[\s,;]/.test(t.trim())) {
      let acc = '';
      for (const tok of t.trim().split(/[\s,;]+/).filter(Boolean)) {
        const clean = tok.replace(/[-_.]/g, '');
        const bad = clean.match(/[^0-9a-f]/i);
        if (bad) { res.error = `Invalid hex character "${bad[0]}" in "${tok}".`; return res; }
        if (clean.length % 2) {
          acc += '0' + clean;
          res.warnings.push(`"${tok}" has an odd number of digits — read as "0${clean}".`);
        } else acc += clean;
      }
      t = acc;
    } else {
      t = t.trim().replace(/[-_.]/g, '');
      const bad = t.match(/[^0-9a-f]/i);
      if (bad) { res.error = `Invalid hex character "${bad[0]}".`; return res; }
      if (t.length % 2) {
        res.error = `Odd number of hex digits (${t.length}) — a nibble is missing.`;
        return res;
      }
    }
    res.bytes = pairsToBytes(t);

    // A capture of the ASCII *characters* of a Modbus ASCII frame: 3A 30 31 ...
    if (res.bytes[0] === 0x3a && res.bytes.length > 3) {
      const rest = res.bytes.slice(1).filter((b) => b !== 0x0d && b !== 0x0a);
      const chars = rest.map((b) => String.fromCharCode(b)).join('');
      if (/^[0-9A-Fa-f]+$/.test(chars) && chars.length % 2 === 0) {
        res.ascii = true;
        res.bytes = pairsToBytes(chars);
        res.warnings.push('Input looked like the raw ASCII characters of a Modbus ASCII frame — decoded.');
      }
    }
    return res;
  }

  function formatHex(bytes, sep) {
    return bytes.map(hex2).join(sep === undefined ? ' ' : sep);
  }

  async function copy(text) {
    try {
      if (g.navigator && navigator.clipboard && g.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through */ }
    try {
      const ta = g.document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.className = 'sr-only';
      g.document.body.appendChild(ta);
      ta.select();
      const ok = g.document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (e) {
      return false;
    }
  }

  PL.editor = { parseInput, formatHex, copy, hex2 };
})(typeof window !== 'undefined' ? window : globalThis);
