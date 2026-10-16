/* OPTIONAL. The app ships with a hand-written service-worker.js and does NOT need Workbox.
 * Use this only if you prefer generated precaching:  npm run workbox
 * (it writes sw-workbox.js; point sw-register.js at it to use it). */
module.exports = {
  globDirectory: '.',
  globPatterns: ['**/*.{html,css,js,svg,png,webmanifest}'],
  globIgnores: ['node_modules/**', 'tests/**', 'docs/**', 'service-worker.js', 'sw-workbox.js', 'workbox-*.js'],
  swDest: 'sw-workbox.js',
  navigateFallback: 'index.html',
  cleanupOutdatedCaches: true,
  clientsClaim: true,
  skipWaiting: false,
};
