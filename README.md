# ProtoLink Diagnostics

Offline-capable PWA for SCADA field engineers: **Modbus frame analyzer**, **OPC DA/UA troubleshooter** (Wonderware-focused) and **log snippet parser**. Vanilla HTML/CSS/JS, no build step, 100 % client-side, hostable on GitHub Pages.

## Features

| Tab | What it does |
|---|---|
| **Modbus** | **Live Serial Sniffer** (Web Serial, see below) plus: paste RTU / TCP / ASCII hex. Auto-detects mode, validates **CRC-16 / LRC / MBAP length**, colour-codes every byte (slave, function, address, quantity, data, CRC), decodes FC 01–06, 07, 08, 11, 15, 16, 17, 22, 23 and exception responses, shows register tables with U16/I16/binary and **32-bit int/float in all four byte orders**. Includes a **frame builder** (generates RTU/TCP/ASCII requests with checksum). |
| **OPC** | Searchable knowledge base (DCOM, DCOM hardening KB5004442, RPC errors, quality codes, OPC DA error codes, Modbus DAServer timeouts, SuiteLink/InTouch, OPC UA certificates/sessions/NodeIds) with Wonderware/AVEVA notes, an **OPC quality-byte decoder**, an **OPC UA status-code lookup**, and a persistent **DCOM checklist**. **v1.1:** 13 **GE iFIX** articles (node name / SCU / FIX.INI, TCP/IP networking, SAC start-up, driver comm errors, redundant SCADA sync drops, data links, OPC client, licence, alarms, DB import, scan load, start-up failures, time sync) and a **Tag Helper** that builds / validates Wonderware **DBLoad CSV** and generates iFIX tag references / import rows. |
| **Logs** | Paste text or open a `.log/.txt` file (never uploaded). Regex highlighting of errors, timeouts, connection drops, warnings, HRESULT/OPC codes, Modbus exceptions, quality values, IPs, timestamps and Wonderware component names. Line filters with counts, custom regex, and a *Findings* table that explains known codes and links to the guide. |
| **Tools** | Modicon ⇄ protocol offset, **PLC endianness & word swapper (32/64-bit)**, **4–20 mA loop calculator + Ohm's-law drop**, **IPv4 subnet/CIDR planner**, CRC-16/LRC calculator, linear scaling (e.g. Siemens 0–27648). |
| **Saved** | Save frames and field notes to IndexedDB on the device; export to JSON. |

## What's new in v1.1.0

### 1. Live Serial Sniffer (Modbus tab)
Connects a USB-to-RS-485 / RS-232 adapter through the browser's native **Web Serial API** — no drivers, no server, no dependencies.
- Settings: baud 9600 / 19200 / 38400 / 115200, parity None / Even / Odd, data bits 8, stop bits 1 / 2, optional manual frame gap.
- Incoming bytes are split into frames on the Modbus **idle gap** (3.5 character times, 1.75 ms above 19200 baud; the *auto* gap never goes below 8 ms because USB adapters add latency — override it if frames merge or split).
- Every frame is listed with timestamp, length and **CRC OK / BAD**; **Analyze** loads it into the analyzer, or tick *Auto-analyze newest frame* for a live view. Optional raw hex stream, pause, clear, copy.
- Optional **Transmit** box (hex + auto CRC) if you are the master on the bus.
- **Browser support:** Chrome, Edge, Opera (desktop and Android) over `https://` or `localhost`. **Firefox and iOS (all browsers) do not support Web Serial** — the app shows a warning banner and everything else keeps working.
- Sniffing is passive: wire the adapter in parallel (A/B) with the bus and share ground. Never transmit while sniffing a live network you do not master.

### 2. PLC Endianness & Word Swapper (Tools tab)
32-bit and 64-bit. Enter registers (dec/`0x`) or raw bytes **as received** and see Float, Int and UInt for all four layouts at once:

| Layout | Name | Typical |
|---|---|---|
| ABCD | Big-Endian | Siemens S7 / TIA Portal |
| DCBA | Little-Endian | Rockwell / Allen-Bradley Logix |
| BADC | Mid-Big (byte swap) | bytes swapped inside each word |
| CDAB | Mid-Little (word swap) | words in reverse order |

Also: **convert layout** (from → to) and **encode a value** into the registers to write for each layout. 64-bit integers use BigInt (exact). Vendor labels are conventions; the real order depends on the gateway/driver — use the row that yields a plausible value.

### 3. 4–20 mA Loop & Loop-Drop Calculator (Tools tab)
Slider/inputs map 4–20 mA (or 0–20 mA) to any process range (0–100 bar, −50…150 °C, presets included) in both directions, show % span, a plain-language status (under/over-range, NAMUR-style fault levels) and the Siemens raw count. The Ohm's-law section gives the voltage across a resistor (250 Ω HART quick-select: 4 mA = 1.0 V, 20 mA = 5.0 V), a reference table, and works in reverse (measured volts → mA).

### 4. Offline IPv4 Subnet & CIDR Planner (Tools tab)
Enter `192.168.1.50/24` (or address + mask): mask, wildcard, network ID, broadcast, usable range, usable host count, address type (RFC 1918, APIPA…), /31 and /32 handled correctly. Includes "is this IP in the subnet?" and "split into /N".

### 5. GE iFIX articles & Tag Helper (OPC tab)
- Filter chip **iFIX** + 13 searchable articles. They are field checklists — menu names, file locations and ports differ between iFIX/Proficy versions, so verify in the product documentation.
- **Tag Helper**: one tag per line (`TagName, Address, [D/I/R], [comment], [EU], [min], [max]`).
  - *Wonderware DBLoad CSV* — `:IODisc / :IOInt / :IOReal` sections with defaults, duplicate/length/range checks.
  - *Validate pasted DBLoad CSV* — section headers, column counts, duplicates, empty Access/Item names.
  - *iFIX tag references* — `NODE.TAG.F_CV` (any fields).
  - *iFIX import rows* — fills the columns of a header row you paste from an iFIX Database Manager export.
  - **DBLoad column sets vary by InTouch version.** If DBLoad rejects the defaults, export one tag per type with DBDump and paste that header into **Custom header**; the helper then fills exactly those columns by name. Always test with a few tags first.

## Deploy to GitHub Pages

1. Create a new GitHub repository (e.g. `protolink-diagnostics`) and upload **the contents of this folder** (the zip's files, with `index.html` at the repository root).
2. **Settings → Pages → Build and deployment → Source: GitHub Actions.** The included workflow (`.github/workflows/deploy.yml`) runs the tests, stamps the cache version and deploys on every push to `main`.
   *(Alternative: Source = "Deploy from a branch", `main` / `/ (root)`. The `.nojekyll` file is included so dot-folders are served.)*
3. Open `https://<user>.github.io/<repo>/` **once while online** — the service worker caches everything. After that the app works with no connection. On Android/Chrome use *Install app*; on iOS Safari use *Share → Add to Home Screen*.

Everything uses relative paths, so it works from a repo sub-path or a custom domain.

### Before you publish — placeholders to edit
- `sitemap.xml`, `robots.txt`: replace `YOUR-USER.github.io/protolink-diagnostics` with your real URL.
- `security.txt`: replace the contact address (GitHub Pages serves `/.well-known/security.txt`; copy it there if you want it discoverable).
- `humans.txt`, `LICENSE`: add your name/company if you wish.
- `.well-known/assetlinks.json` / `apple-app-site-association` are empty stubs (only needed if you later wrap the PWA as a Play Store TWA / iOS app).

## Shipping updates
1. Change files, bump `VERSION` in `service-worker.js` (currently `1.1.0`; new files must also be added to `PRECACHE`) (the workflow also appends the commit SHA to the cache name).
2. Users who already installed the app see a **"Reload to update"** banner when online.

## Local development / tests
```bash
npm start        # http://localhost:8080 (service workers work on localhost)
npm test         # Modbus parser/CRC/LRC, endianness, 4–20 mA/Ohm, subnet, serial framing + mock Web Serial, DBLoad/iFIX helper, precache list (Node ≥ 18, no dependencies)
```
Open `index.html` through a web server, not `file://`, or the service worker will not register.

## Notes & limits
- Web Serial needs a Chromium browser; testing against real hardware was not possible in the build environment — the serial session logic is tested against a mock port, so field-test with your adapter and report quirks (e.g. adapter latency settings).
- Frame direction (request vs response) is inferred from the PDU shape; FC 05/06 requests and echoed responses are identical, and a 4-byte FC01/02 payload starting `03` is ambiguous — use the **Direction** selector to force it.
- The OPC guide is a field checklist, not vendor documentation. Menu names, default ports and item syntax differ between Windows and AVEVA/Wonderware versions; verify against the manual for the version on site. Wonderware items are written conservatively for that reason.
- Icons: the layout lists `*.png.svg` files; real PNG renders (`icon-192.png`, `icon-512.png`, maskable, `apple-touch-icon.png`) are included too because iOS and some Android installers require raster icons.

## License
MIT — see `LICENSE`.
