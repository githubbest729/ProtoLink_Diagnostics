# ProtoLink Diagnostics — Architecture

## Principles
- **Static, client-side only.** No backend, no network calls at runtime (CSP `connect-src 'self'`).
- **No build step.** Classic `<script>` files share a single global namespace `window.PL`; modules are IIFEs so the same files also load in Node for tests.
- **Offline first.** A hand-written service worker precaches every file; the app shell loads cache-first.

## File map
| File | Responsibility |
|---|---|
| `index.html` | Single-page shell: five tab panels (Modbus, OPC, Logs, Tools, Saved), CSP meta, manifest/icon links. |
| `style.css` | Industrial dark theme, CSS variables, bottom tab bar (mobile) → top tab bar (≥ 820 px), 44 px touch targets, print rules. System fonts only. |
| `app.js` | UI controller: tab routing (hash), rendering, event wiring, log highlighter, OPC search, history UI. The only file that touches the DOM (besides `sw-register.js`). |
| `js/editor.js` | `PL.editor` — tolerant hex input parsing (`0x`, separators, odd nibbles, Modbus ASCII incl. raw `3A …` captures), formatting, clipboard. |
| `js/validator.js` | `PL.modbus` — CRC-16, LRC, `copyValues` (per-segment clipboard values), frame analyzer (RTU/TCP/ASCII), PDU decoders, exception table, frame builder. Pure functions. |
| `js/tag-converter.js` | `PL.convert` — Modicon ⇄ offset, 32/64-bit endianness decode/encode/convert (ABCD, DCBA, BADC, CDAB; BigInt for 64-bit), linear scaling, number parsing. |
| `js/templates.js` | `PL.templates` — sample frames, OPC knowledge base, OPC UA status table, HRESULT annotations, DCOM checklist, log regex rules, sample log. **Edit this file to extend the guide.** |
| `js/serial.js` | `PL.serial` — Web Serial support check, idle-gap `Framer` (time injected for tests), `Session` (open/read loop/write/close). |
| `js/instrument.js` | `PL.instrument` — 4–20 mA ⇄ EU scaling, loop status thresholds, Ohm's-law helpers, Siemens raw counts. |
| `js/subnet.js` | `PL.subnet` — IPv4 parse/mask/prefix, network/broadcast/host range, membership, split. |
| `js/tag-helper.js` | `PL.taghelper` — DBLoad CSV build/validate, iFIX references, header-mapped import rows. |
| `js/export.js` | `PL.exporter` — `toCsv` / `toTxt` / `merge` for the Saved tab: BOM + CRLF, RFC-4180 quoting, `'` prefix against formula injection, chronological merge of frames, notes and logs. |
| `js/db.js` | `PL.db` — IndexedDB wrapper (`frames`, `notes`) with localStorage → memory fallback. |
| `service-worker.js` | Precache + cache-first/stale-while-revalidate, navigation fallback to `offline.html`, update via `SKIP_WAITING` message. |
| `sw-register.js` | Registers the SW, emits `pl:sw` events (`ready`, `update`, `error`) the UI shows as pills/banner. |
| `manifest.webmanifest` | Install metadata, PNG + SVG icons (incl. maskable), shortcuts. |
| `offline.html`, `404.html`, `privacy.html` | Fallback pages (404 is self-contained because GitHub Pages serves it at arbitrary paths). |
| `tests/` | Node tests: `validator` (CRC/LRC, parser, builder), `converters` (endianness, scaling, Ohm, subnet), `serial` (framer + mock Web Serial), `taghelper` (DBLoad/iFIX), `uidata` (copy-value extraction, CSV/TXT export, log presets), `precache` (SW list consistency). |

## Data flow (Modbus)
```
textarea → editor.parseInput() → bytes[] (+ascii flag)
        → modbus.analyze(bytes, {mode, dir})
              ├─ framing: MBAP / CRC-16 / LRC check  → issues[], checksum
              ├─ decodePdu(fc, data, dir)            → fields[], registers[], bits[]
              └─ segments[] (label, offset, length, class, text)
        → app.renderAnalysis(): verdict, byte map, diagnosis, field table, register tables
```
`segments[].cls` drives colour: `hdr addr fc reg qty data crc exc err`. Each segment is also labelled in text so meaning never relies on colour alone.

## Service worker strategy
- **Install:** `cache.addAll` of the `PRECACHE` list with `cache: 'reload'` (bypasses the HTTP cache).
- **Navigation:** cached page → else `index.html` for directory URLs → else network → else `offline.html`.
- **Assets:** cached copy returned immediately, refreshed in the background (same-origin, `ok` responses only).
- **Updates:** a new SW waits; the page shows *Reload to update* and sends `SKIP_WAITING`; `controllerchange` reloads once.
- **Versioning:** `VERSION` constant + `__BUILD__` placeholder stamped with the commit SHA by the Pages workflow.
- `tests/precache.test.js` fails CI if the list references a missing file or omits an asset used by `index.html`/manifest — a missing file would otherwise make the whole install fail.

## Serial sniffer data flow
```
USB-RS485 adapter → navigator.serial (user-gesture requestPort) → Session read loop
   → Framer.push(bytes, t)  [idle gap → frame]  → CRC-16 check → frame table
   → (auto) editor input → modbus.analyze() → same renderer as pasted frames
```
Recoverable read errors (framing, parity, overrun) re-acquire the reader; a `NetworkError` (unplug) closes the session. The page never needs a network.

## Security & privacy
- CSP via `<meta>` (and headers for Netlify/Vercel): scripts/styles only from self, no inline script/style, no `eval`.
- All dynamic content is inserted with `textContent`/`createElement`; the log viewer uses `innerHTML` only after escaping every fragment.
- Saved data stays in IndexedDB/localStorage on the device; export is an explicit JSON download.

## Extending
- **New OPC article:** append an object to `PL.templates.opcKb` (`id, title, proto, cats[], codes[], tags[], symptom, causes[], steps[], ww[]`).
- **New log rule:** add `{id, label, cls, prio, pattern, flags}` to `PL.templates.logRules` (lower `prio` wins on overlap) and a colour class in `style.css`.
- **New function-code decoder:** add a `case` in `decodePdu()` and a test in `tests/validator.test.js`.
- **New asset file:** add it to `PRECACHE` in `service-worker.js`, bump `VERSION`.

## UI layout notes (v1.2)
- **Sticky offsets are computed, not hard-coded:** `updateStickyOffsets()` in `app.js` writes `--topbar-h` and `--dock-top` and sets `scroll-padding-top/bottom` so auto-scrolled elements are never hidden behind the top bar, the serial dock or the mobile bottom tab bar. It re-runs on resize, hash change and when the top bar / dock change size (ResizeObserver).
- **Serial dock** (`#ser-dock`) is always in the DOM of the Modbus tab; the sniffer card (`#ser-card`) holds the table and transmit box and opens itself on connect.
- **Accordions** are native `<details>` (no JS needed to toggle); state persists in `localStorage` key `pl.tools`, failures are swallowed.
- **CSP stays strict** (`style-src 'self'`): all dynamic styling uses CSSOM `style.setProperty`, never inline `style=""`.
