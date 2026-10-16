'use strict';
// Verifies every file in service-worker.js PRECACHE exists, and that index.html's local assets are precached.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const sw = fs.readFileSync(path.join(root, 'service-worker.js'), 'utf8');
const list = [...sw.match(/const PRECACHE = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
let bad = 0;
list.forEach((f) => {
  if (f === './') return;
  if (!fs.existsSync(path.join(root, f))) { console.error('  ✖ missing precache file:', f); bad++; }
});
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
[...html.matchAll(/(?:src|href)="([^"#:]+?\.(?:js|css|svg|png|webmanifest))"/g)].forEach((m) => {
  if (!list.includes(m[1])) { console.error('  ✖ asset used by index.html but not precached:', m[1]); bad++; }
});
const man = JSON.parse(fs.readFileSync(path.join(root, 'manifest.webmanifest'), 'utf8'));
man.icons.forEach((i) => { if (!list.includes(i.src)) { console.error('  ✖ manifest icon not precached:', i.src); bad++; } });
if (bad) process.exit(1);
console.log(`  ✔ precache list OK (${list.length} entries, all exist and cover index.html + manifest)`);
