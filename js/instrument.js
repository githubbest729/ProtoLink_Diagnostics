/* ProtoLink Diagnostics — js/instrument.js
 * 4–20 mA loop scaling and Ohm's-law helpers. Pure functions.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});

  /** mode: '4-20' | '0-20' */
  const span = (mode) => (mode === '0-20' ? { lo: 0, hi: 20 } : { lo: 4, hi: 20 });

  /** Loop current → engineering units. o = {mode, euLo, euHi}. */
  function loopToEU(mA, o) {
    const s = span(o.mode);
    return o.euLo + ((mA - s.lo) / (s.hi - s.lo)) * (o.euHi - o.euLo);
  }
  /** Engineering units → loop current. */
  function euToLoop(eu, o) {
    if (o.euHi === o.euLo) return NaN;
    const s = span(o.mode);
    return s.lo + ((eu - o.euLo) / (o.euHi - o.euLo)) * (s.hi - s.lo);
  }
  const pctOfSpan = (mA, mode) => { const s = span(mode); return ((mA - s.lo) / (s.hi - s.lo)) * 100; };

  /** Plain-language status of a loop current. Thresholds follow common NAMUR NE43 practice (verify per device). */
  function loopStatus(mA, mode) {
    if (!(mA >= 0)) return { level: 'bad', text: 'Invalid current.' };
    if (mode === '4-20') {
      if (mA < 3.6) return { level: 'bad', text: 'Below 3.6 mA — typically a fault/failure signal (broken wire, transmitter failure, or loop supply lost).' };
      if (mA < 3.8) return { level: 'warn', text: 'Under-range (3.6–3.8 mA): below 0 % but not yet a failure level.' };
      if (mA <= 20.5) return { level: 'good', text: mA < 4 ? 'Slightly below 4 mA (within under-range tolerance).' : 'Within the normal measuring range.' };
      if (mA < 21) return { level: 'warn', text: 'Over-range (20.5–21 mA).' };
      return { level: 'bad', text: 'Above 21 mA — typically a fault/saturation signal.' };
    }
    if (mA > 20.5) return { level: 'warn', text: 'Above 20.5 mA — over-range.' };
    return { level: 'good', text: 'Within range.' };
  }

  /** What a Siemens analog input module reports (0…27648 = nominal range). type: '4-20' or '0-20' module setting. */
  function siemensRaw(mA, moduleType) {
    const s = span(moduleType);
    return Math.round(((mA - s.lo) / (s.hi - s.lo)) * 27648);
  }

  /** Ohm's law. mA → volts across R ohms. */
  const voltage = (mA, ohms) => (mA / 1000) * ohms;
  /** Volts across R ohms → mA. */
  const current = (volts, ohms) => (ohms === 0 ? NaN : (volts / ohms) * 1000);

  /** Rows for a quick multimeter reference table. */
  function dropTable(ohms, mode) {
    const pts = mode === '0-20' ? [0, 5, 10, 15, 20] : [4, 8, 12, 16, 20];
    return pts.map((mA) => ({ mA, pct: pctOfSpan(mA, mode), volts: voltage(mA, ohms) }));
  }

  PL.instrument = { span, loopToEU, euToLoop, pctOfSpan, loopStatus, siemensRaw, voltage, current, dropTable };
})(typeof window !== 'undefined' ? window : globalThis);
