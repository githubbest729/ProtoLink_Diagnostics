/* ProtoLink Diagnostics — js/db.js
 * Tiny promise wrapper over IndexedDB (stores: frames, notes).
 * Falls back to localStorage, then to memory, if IndexedDB is unavailable (private mode, etc.).
 * Everything stays on the device; nothing is ever transmitted.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});
  const DB_NAME = 'protolink', DB_VER = 1, STORES = ['frames', 'notes'];
  let dbp = null;
  let backend = 'idb';
  const mem = { frames: [], notes: [] };
  let memId = 1;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!g.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const rq = g.indexedDB.open(DB_NAME, DB_VER);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        STORES.forEach((s) => { if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id', autoIncrement: true }); });
      };
      rq.onsuccess = () => resolve(rq.result);
      rq.onerror = () => reject(rq.error || new Error('IndexedDB open failed'));
      rq.onblocked = () => reject(new Error('IndexedDB blocked'));
    }).catch((e) => { backend = 'fallback'; return null; });
    return dbp;
  }

  // ----- fallback (localStorage → memory) -----
  const lsKey = (s) => 'protolink:' + s;
  function lsRead(s) {
    try { return JSON.parse(g.localStorage.getItem(lsKey(s)) || '[]'); } catch (e) { return mem[s].slice(); }
  }
  function lsWrite(s, arr) {
    mem[s] = arr.slice();
    try { g.localStorage.setItem(lsKey(s), JSON.stringify(arr)); } catch (e) { /* memory only */ }
  }

  function idb(db, store, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const req = fn(t.objectStore(store));
      t.oncomplete = () => resolve(req ? req.result : undefined);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Transaction aborted'));
    });
  }

  async function add(store, obj) {
    const rec = Object.assign({}, obj, { ts: obj.ts || Date.now() }); // callers may supply the original capture time
    const db = await open();
    if (db) return idb(db, store, 'readwrite', (s) => s.add(rec));
    const arr = lsRead(store);
    rec.id = (arr.reduce((m, r) => Math.max(m, r.id || 0), 0) || memId) + 1;
    memId = rec.id;
    arr.push(rec);
    lsWrite(store, arr);
    return rec.id;
  }

  async function list(store) {
    const db = await open();
    let rows;
    if (db) rows = await idb(db, store, 'readonly', (s) => s.getAll());
    else rows = lsRead(store);
    return rows.sort((a, b) => b.ts - a.ts);
  }

  async function remove(store, id) {
    const db = await open();
    if (db) return idb(db, store, 'readwrite', (s) => s.delete(id));
    lsWrite(store, lsRead(store).filter((r) => r.id !== id));
  }

  async function clear(store) {
    const db = await open();
    if (db) return idb(db, store, 'readwrite', (s) => s.clear());
    lsWrite(store, []);
  }

  PL.db = { open, add, list, remove, clear, get backend() { return backend; } };
})(typeof window !== 'undefined' ? window : globalThis);
