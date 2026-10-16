/* ProtoLink Diagnostics — js/export.js
 * Build CSV / TXT exports of saved frames, field notes and saved log snippets for SAT reports and
 * Excel commissioning sheets. Pure functions (no DOM).
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});
  const pad = (n, w) => String(n).padStart(w || 2, '0');

  /** Local time "YYYY-MM-DD HH:MM:SS.mmm". */
  function localStamp(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
  }

  /** One CSV cell. Quotes when needed and neutralises spreadsheet formula injection (= + - @ at the start). */
  function cell(v) {
    let s = v === undefined || v === null ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /** Merge frames and notes into one chronological list. */
  function merge(frames, notes) {
    const rows = [];
    (frames || []).forEach((f) => rows.push({ type: 'frame', ts: f.ts, mode: f.mode || '', hex: f.hex || '', summary: f.summary || '', text: '' }));
    (notes || []).forEach((n) => rows.push({ type: n.kind === 'log' ? 'log' : 'note', ts: n.ts, mode: '', hex: '', summary: '', text: n.text || '' }));
    return rows.sort((a, b) => a.ts - b.ts);
  }

  const CSV_HEADER = ['type', 'timestamp_local', 'timestamp_iso', 'mode', 'hex', 'summary', 'text'];

  /** CSV with UTF-8 BOM (so Excel reads accents/symbols correctly) and CRLF line ends. */
  function toCsv(frames, notes) {
    const lines = [CSV_HEADER.join(',')];
    merge(frames, notes).forEach((r) => {
      lines.push([r.type, localStamp(r.ts), new Date(r.ts).toISOString(), r.mode, r.hex, r.summary, r.text].map(cell).join(','));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /** Human-readable text for pasting into a report. */
  function toTxt(frames, notes, title) {
    const out = [title || 'ProtoLink Diagnostics export', 'Exported: ' + localStamp(Date.now()), ''];
    const rows = merge(frames, notes);
    if (!rows.length) out.push('(nothing saved)');
    rows.forEach((r) => {
      if (r.type === 'frame') {
        out.push(`[${localStamp(r.ts)}] FRAME${r.mode ? ' (' + String(r.mode).toUpperCase() + ')' : ''}`, '  ' + r.hex);
        if (r.summary) out.push('  ' + r.summary);
      } else {
        out.push(`[${localStamp(r.ts)}] ${r.type.toUpperCase()}`);
        String(r.text).split(/\r?\n/).forEach((l) => out.push('  ' + l));
      }
      out.push('');
    });
    return out.join('\r\n');
  }

  PL.exporter = { toCsv, toTxt, cell, merge, localStamp, CSV_HEADER };
})(typeof window !== 'undefined' ? window : globalThis);
