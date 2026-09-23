// Included only in the isolated release, never over the old application's worker.
if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./pwa-sw.js').catch(error => {
    console.warn('Installation support unavailable', error);
  });
}
