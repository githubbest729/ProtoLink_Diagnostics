/* ProtoLink Diagnostics — sw-register.js
 * Registers service-worker.js and reports state to the UI via a "pl:sw" window event.
 */
(function (g) {
  'use strict';
  const PL = (g.PL = g.PL || {});
  const emit = (state, detail) => g.dispatchEvent(new CustomEvent('pl:sw', { detail: Object.assign({ state }, detail || {}) }));
  let waiting = null;
  let wantReload = false;

  PL.sw = {
    applyUpdate() {
      if (waiting) { wantReload = true; waiting.postMessage({ type: 'SKIP_WAITING' }); }
    },
  };

  if (!('serviceWorker' in navigator)) { emit('unsupported'); return; }

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (wantReload) g.location.reload();
  });

  g.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js', { scope: './' })
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) { waiting = reg.waiting; emit('update'); }
        reg.addEventListener('updatefound', () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener('statechange', () => {
            if (nw.state === 'installed' && navigator.serviceWorker.controller) { waiting = nw; emit('update'); }
          });
        });
        return navigator.serviceWorker.ready.then(() => emit('ready'));
      })
      .catch((e) => emit('error', { message: String(e && e.message ? e.message : e) }));
  });
})(window);
