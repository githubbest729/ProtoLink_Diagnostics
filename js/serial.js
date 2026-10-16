/* ProtoLink Diagnostics — js/serial.js
 * Live serial sniffer: Web Serial API wrapper + idle-gap frame splitter.
 * Web Serial works only in Chromium-based browsers (Chrome, Edge, Opera) on a secure context
 * (https:// or localhost). Not available in Firefox or any iOS browser.
 * No data leaves the device.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});

  /** Is Web Serial usable? Returns {ok, reason}. */
  function support() {
    const nav = g.navigator;
    if (!nav || !nav.serial) {
      return { ok: false, reason: 'This browser does not support the Web Serial API (Firefox, Safari and all iOS browsers do not). Use Chrome, Edge or Opera on a laptop/Android with a USB-to-RS485 adapter — or paste frames manually into the analyzer.' };
    }
    if (g.isSecureContext === false) {
      return { ok: false, reason: 'Web Serial requires a secure context. Open the app over https:// (GitHub Pages) or http://localhost.' };
    }
    return { ok: true, reason: '' };
  }

  /** Bits on the wire per character (start + data + parity + stop). */
  function bitsPerChar(parity, stopBits) {
    return 1 + 8 + (parity === 'none' ? 0 : 1) + (stopBits === 2 ? 2 : 1);
  }

  /**
   * Modbus RTU inter-frame silence. Spec: 3.5 character times, fixed 1.75 ms above 19200 baud.
   * Browser/USB timing is coarse (adapter latency timers are typically 1–16 ms), so the AUTO gap is
   * never below minMs. Override it manually if frames are merged or split.
   */
  function silenceMs(baud, parity, stopBits, minMs) {
    const spec = baud > 19200 ? 1.75 : (3.5 * bitsPerChar(parity, stopBits) * 1000) / baud;
    return Math.max(spec, minMs === undefined ? 8 : minMs);
  }

  /** Splits a byte stream into frames separated by idle gaps. Time is injected, so it is testable. */
  class Framer {
    constructor(gapMs, onFrame, maxLen) {
      this.gapMs = gapMs;
      this.onFrame = onFrame;
      this.maxLen = maxLen || 260; // RTU max is 256; allow slack
      this.buf = [];
      this.start = 0;
      this.last = 0;
    }
    push(bytes, now) {
      if (this.buf.length && now - this.last > this.gapMs) this.flush();
      if (!this.buf.length) this.start = now;
      for (let i = 0; i < bytes.length; i++) {
        this.buf.push(bytes[i]);
        if (this.buf.length >= this.maxLen) { this.last = now; this.flush(); this.start = now; }
      }
      this.last = now;
    }
    tick(now) { if (this.buf.length && now - this.last > this.gapMs) this.flush(); }
    flush() {
      if (!this.buf.length) return;
      const b = this.buf; this.buf = [];
      this.onFrame(b, this.start);
    }
  }

  /**
   * Port session. Usage:
   *   const s = new Session({ onBytes, onError, onClose });
   *   await s.connect({ baudRate, parity, stopBits });
   *   await s.write(bytes); await s.disconnect();
   */
  class Session {
    constructor(h) { this.h = h || {}; this.port = null; this.keep = false; this.reader = null; this.loop = null; this.rx = 0; this.tx = 0; }
    get connected() { return !!this.port; }
    async connect(cfg) {
      const sup = support();
      if (!sup.ok) throw new Error(sup.reason);
      const port = await g.navigator.serial.requestPort(); // must be called from a user gesture
      await port.open({ baudRate: cfg.baudRate, dataBits: 8, stopBits: cfg.stopBits, parity: cfg.parity, flowControl: 'none', bufferSize: 8192 });
      this.port = port; this.keep = true; this.rx = 0; this.tx = 0;
      this.loop = this._read();
      return port;
    }
    async _read() {
      while (this.port && this.port.readable && this.keep) {
        this.reader = this.port.readable.getReader();
        try {
          for (;;) {
            const r = await this.reader.read();
            if (r.done) break;
            if (r.value && r.value.length) { this.rx += r.value.length; this.h.onBytes && this.h.onBytes(r.value, g.performance.now()); }
          }
        } catch (e) {
          // Framing / parity / overrun errors are recoverable: report and re-acquire the reader.
          this.h.onError && this.h.onError(e);
          if (e && e.name === 'NetworkError') this.keep = false; // device unplugged
        } finally {
          try { this.reader.releaseLock(); } catch (e) { /* ignore */ }
          this.reader = null;
        }
      }
      if (this.keep) { this.keep = false; }
      await this._closePort();
      this.h.onClose && this.h.onClose();
    }
    async _closePort() {
      const p = this.port; this.port = null;
      if (p) { try { await p.close(); } catch (e) { /* already closed */ } }
    }
    async write(bytes) {
      if (!this.port || !this.port.writable) throw new Error('Port not connected.');
      const w = this.port.writable.getWriter();
      try { await w.write(new Uint8Array(bytes)); this.tx += bytes.length; } finally { w.releaseLock(); }
    }
    async disconnect() {
      this.keep = false;
      if (this.reader) { try { await this.reader.cancel(); } catch (e) { /* ignore */ } }
      if (this.loop) { try { await this.loop; } catch (e) { /* ignore */ } }
    }
  }

  PL.serial = { support, bitsPerChar, silenceMs, Framer, Session };
})(typeof window !== 'undefined' ? window : globalThis);
