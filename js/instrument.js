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
    if (!(mA >= 0)) return { level: 'bad', label: 'Invalid', text: 'Invalid current.' };
    if (mode === '4-20') {
      if (mA < 3.6) return { level: 'bad', label: 'Fault', text: 'Below 3.6 mA — typically a fault/failure signal (broken wire, transmitter failure, or loop supply lost).' };
      if (mA < 3.8) return { level: 'warn', label: 'Under-range', text: 'Under-range (3.6–3.8 mA): below 0 % but not yet a failure level.' };
      if (mA <= 20.5) return { level: 'good', label: 'Normal', text: mA < 4 ? 'Slightly below 4 mA (within under-range tolerance).' : 'Within the normal measuring range.' };
      if (mA < 21) return { level: 'warn', label: 'Over-range', text: 'Over-range (20.5–21 mA).' };
      return { level: 'bad', label: 'Fault', text: 'Above 21 mA — typically a fault/saturation signal.' };
    }
    if (mA > 20.5) return { level: 'warn', label: 'Over-range', text: 'Above 20.5 mA — over-range.' };
    return { level: 'good', label: 'Normal', text: 'Within range.' };
  }

  /** Gauge fill + colour for the loop bar: 0 % at the low end of the span (4 mA), 100 % at 20 mA.
   *  green = inside the nominal span, yellow = outside it (under/over-range), red = fault level (see loopStatus). */
  function gaugeState(mA, mode) {
    if (!(mA >= 0) || !Number.isFinite(mA)) return { pct: 0, level: 'none' };
    const s = span(mode), raw = pctOfSpan(mA, mode), st = loopStatus(mA, mode);
    const pct = Math.max(0, Math.min(100, raw));
    if (st.level === 'bad') return { pct, level: 'bad' };
    return { pct, level: mA < s.lo || mA > s.hi ? 'warn' : st.level === 'warn' ? 'warn' : 'good' };
  }

  /** Plain-English next step for a fault reading (null when there is nothing to suggest). */
  function faultHint(mA, mode) {
    if (!(mA >= 0) || loopStatus(mA, mode).label !== 'Fault') return null;
    if (mA < 3.6) return 'Hint: A reading this low usually means a broken wire, blown fuse, or lost 24V DC power supply to the instrument.';
    return 'Hint: A reading this high usually means the transmitter has failed high or the loop wiring is shorted. Check the transmitter display/diagnostics and the field wiring.';
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

  PL.instrument = { span, loopToEU, euToLoop, pctOfSpan, loopStatus, gaugeState, faultHint, siemensRaw, voltage, current, dropTable };
})(typeof window !== 'undefined' ? window : globalThis);
