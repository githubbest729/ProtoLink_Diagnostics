# ProtoLink Diagnostics

Offline-capable PWA for SCADA field engineers: **Modbus frame analyzer**, **OPC DA/UA troubleshooter** (Wonderware-focused) and **log snippet parser**. Vanilla HTML/CSS/JS, no build step, 100 % client-side, hostable on GitHub Pages.

## Features

| Tab | What it does |
|---|---|
| **Modbus** | Paste RTU / TCP / ASCII hex. Auto-detects mode, validates **CRC-16 / LRC / MBAP length**, colour-codes every byte (slave, function, address, quantity, data, CRC), decodes FC 01–06, 07, 08, 11, 15, 16, 17, 22, 23 and exception responses, shows register tables with U16/I16/binary and **32-bit int/float in all four byte orders**. Includes a **frame builder** (generates RTU/TCP/ASCII requests with checksum). |
| **OPC** | Searchable knowledge base (DCOM, DCOM hardening KB5004442, RPC errors, quality codes, OPC DA error codes, Modbus DAServer timeouts, SuiteLink/InTouch, OPC UA certificates/sessions/NodeIds) with Wonderware/AVEVA notes, an **OPC quality-byte decoder**, an **OPC UA status-code lookup**, and a persistent **DCOM checklist**. |
| **Logs** | Paste text or open a `.log/.txt` file (never uploaded). Regex highlighting of errors, timeouts, connection drops, warnings, HRESULT/OPC codes, Modbus exceptions, quality values, IPs, timestamps and Wonderware component names. Line filters with counts, custom regex, and a *Findings* table that explains known codes and links to the guide. |
| **Tools** | Modicon ⇄ protocol offset, 32-bit register decode/encode, CRC-16/LRC calculator, linear scaling (e.g. Siemens 0–27648). |
| **Saved** | Save frames and field notes to IndexedDB on the device; export to JSON. |

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
1. Change files, bump `VERSION` in `service-worker.js` (the workflow also appends the commit SHA to the cache name).
2. Users who already installed the app see a **"Reload to update"** banner when online.

## Local development / tests
```bash
npm start        # http://localhost:8080 (service workers work on localhost)
npm test         # CRC/LRC vectors, parser tests, precache-list check (Node ≥ 18, no dependencies)
```
Open `index.html` through a web server, not `file://`, or the service worker will not register.

## Notes & limits
- Frame direction (request vs response) is inferred from the PDU shape; FC 05/06 requests and echoed responses are identical, and a 4-byte FC01/02 payload starting `03` is ambiguous — use the **Direction** selector to force it.
- The OPC guide is a field checklist, not vendor documentation. Menu names, default ports and item syntax differ between Windows and AVEVA/Wonderware versions; verify against the manual for the version on site. Wonderware items are written conservatively for that reason.
- Icons: the layout lists `*.png.svg` files; real PNG renders (`icon-192.png`, `icon-512.png`, maskable, `apple-touch-icon.png`) are included too because iOS and some Android installers require raster icons.

## License
MIT — see `LICENSE`.
