// Signals only that the visible page changed. No page text, form values or DOM is sent.
(() => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = 0, disabled = false;
  function notify() {
    clearTimeout(timer); timer = undefined;
    if (disabled || document.visibilityState !== 'visible') return;
    lastSent = Date.now();
    try { chrome.runtime.sendMessage({ type: 'mosaic:page-activity' }).catch(() => { disabled = !chrome.runtime?.id; }); }
    catch { disabled = true; }
  }
  function activity() {
    if (disabled || document.visibilityState !== 'visible' || timer) return;
    timer = setTimeout(notify, Math.max(600, 3000 - (Date.now() - lastSent)));
  }
  document.addEventListener('scroll', activity, { passive: true, capture: true });
  document.addEventListener('click', activity, { passive: true });
  document.addEventListener('visibilitychange', activity);
  window.addEventListener('pageshow', activity);
  window.addEventListener('popstate', activity);
  window.addEventListener('hashchange', activity);
  activity();
})();
