'use strict';
// Serial framing + Web Serial session (against a mock port).  Run: node tests/serial.test.js
const assert = require('assert');
const path = require('path');
require(path.join('..', 'js', 'validator.js'));
require(path.join('..', 'js', 'serial.js'));
const S = globalThis.PL.serial, MB = globalThis.PL.modbus;

let n = 0;
const queue = [];
const t = (name, fn) => queue.push([name, fn]);
const near = (a, b, e) => assert.ok(Math.abs(a - b) <= e, `${a} !≈ ${b}`);

t('silence gap: 3.5 chars below 19200 baud, 1.75 ms above; auto never below minMs', () => {
  near(S.silenceMs(9600, 'even', 1, 0), (3.5 * 11 * 1000) / 9600, 1e-9);    // 4.0104 ms (11-bit char)
  near(S.silenceMs(9600, 'none', 1, 0), (3.5 * 10 * 1000) / 9600, 1e-9);    // 3.6458 ms
  near(S.silenceMs(9600, 'none', 2, 0), (3.5 * 11 * 1000) / 9600, 1e-9);    // 2 stop bits = 11 bits
  near(S.silenceMs(19200, 'even', 1, 0), (3.5 * 11 * 1000) / 19200, 1e-9);
  assert.strictEqual(S.silenceMs(38400, 'none', 1, 0), 1.75);
  assert.strictEqual(S.silenceMs(115200, 'even', 1, 0), 1.75);
  assert.strictEqual(S.silenceMs(115200, 'even', 1), 8);                    // default USB-latency floor
  assert.strictEqual(S.bitsPerChar('none', 1), 10); assert.strictEqual(S.bitsPerChar('odd', 2), 12);
});
t('Framer splits a stream on idle gaps and keeps split chunks together', () => {
  const frames = [];
  const f = new S.Framer(10, (b, start) => frames.push({ b, start }));
  f.push([1, 3, 0, 0], 0); f.push([0, 10], 2); f.push([0xc5, 0xcd], 4);     // one frame in three chunks
  f.push([1, 3, 4], 30);                                                       // 26 ms later → new frame (flushes the first)
  assert.strictEqual(frames.length, 1); assert.deepStrictEqual(frames[0].b, [1, 3, 0, 0, 0, 10, 0xc5, 0xcd]); assert.strictEqual(frames[0].start, 0);
  f.tick(35); assert.strictEqual(frames.length, 1);                            // not idle long enough yet
  f.tick(45); assert.strictEqual(frames.length, 2); assert.deepStrictEqual(frames[1].b, [1, 3, 4]);
  f.tick(100); assert.strictEqual(frames.length, 2);                           // nothing buffered → no empty frame
});
t('Framer flushes at max length and on demand', () => {
  const frames = [];
  const f = new S.Framer(10, (b) => frames.push(b), 8);
  f.push(Array.from({ length: 20 }, (_, i) => i), 0);
  assert.deepStrictEqual(frames.map((b) => b.length), [8, 8]); f.flush(); assert.deepStrictEqual(frames.map((b) => b.length), [8, 8, 4]);
});
t('Framed bytes feed the CRC check (valid and corrupted frame)', () => {
  const body = [1, 3, 4, 0, 10, 0, 11]; const c = MB.crc16(body); const good = body.concat([c & 0xff, c >> 8]);
  const out = [];
  const f = new S.Framer(5, (b) => { const m = b.length; out.push(MB.crc16(b, 0, m - 2) === (b[m - 2] | (b[m - 1] << 8))); });
  f.push(good, 0); f.push(good.slice(0, 8).concat([0x00]), 20); f.tick(40);
  assert.deepStrictEqual(out, [true, false]);
});
t('support(): reports unsupported when navigator.serial is missing', () => {
  const s = S.support();
  assert.strictEqual(s.ok, false); assert.ok(/Web Serial/.test(s.reason));
});

// ---- Session against a mock port
function mockPort(chunks, record) {
  let i = 0, hang = null;
  const port = {
    async open(cfg) { record.open = cfg; },
    async close() { record.closed = true; port.readable = null; },
    readable: {
      getReader() {
        return {
          async read() {
            await new Promise((r) => setTimeout(r, 2));
            if (i < chunks.length) return { value: Uint8Array.from(chunks[i++]), done: false };
            return new Promise((res) => { hang = res; });
          },
          async cancel() { if (hang) hang({ done: true }); },
          releaseLock() {},
        };
      },
    },
    writable: { getWriter() { return { async write(b) { record.written = Array.from(b); }, releaseLock() {} }; } },
  };
  return port;
}
t('Session: opens with 8 data bits and chosen settings, streams bytes, writes, disconnects cleanly', async () => {
  const rec = {}; const got = []; let closed = false;
  const port = mockPort([[1, 3, 0], [0, 0, 10, 0xc5, 0xcd]], rec);
  Object.defineProperty(globalThis.navigator, 'serial', { configurable: true, value: { requestPort: async () => port } });
  assert.strictEqual(S.support().ok, true);
  const s = new S.Session({ onBytes: (v) => got.push(...v), onError() {}, onClose: () => { closed = true; } });
  await s.connect({ baudRate: 19200, parity: 'even', stopBits: 1 });
  assert.deepStrictEqual(rec.open, { baudRate: 19200, dataBits: 8, stopBits: 1, parity: 'even', flowControl: 'none', bufferSize: 8192 });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepStrictEqual(got, [1, 3, 0, 0, 0, 10, 0xc5, 0xcd]); assert.strictEqual(s.rx, 8);
  await s.write([1, 2, 3]); assert.deepStrictEqual(rec.written, [1, 2, 3]); assert.strictEqual(s.tx, 3);
  await s.disconnect();
  assert.ok(rec.closed); assert.ok(closed); assert.strictEqual(s.connected, false);
  await assert.rejects(() => s.write([1]));
  delete globalThis.navigator.serial;
});

(async () => {
  for (const [name, fn] of queue) { await fn(); n++; console.log('  ✔', name); }
  console.log(`\n${n} serial test groups passed`);
})().catch((e) => { console.error(e); process.exit(1); });
