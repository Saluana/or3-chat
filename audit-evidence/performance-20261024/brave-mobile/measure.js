async page => {
  const browser = page.context().browser();
  const cdp = await page.context().newCDPSession(page);
  const conditions = {
    offline: false,
    latency: 562.5,
    downloadThroughput: 180000,
    uploadThroughput: 84375,
    connectionType: 'cellular4g'
  };
  const errors = [];
  const onError = error => errors.push(error.message);
  const onConsole = message => {
    if (/hydration/i.test(message.text())) errors.push(message.text());
  };
  page.on('pageerror', onError);
  page.on('console', onConsole);
  if (!(await page.evaluate(() => Boolean(window.__braveMobileAudit)))) await page.addInitScript(() => {
    const proof = { paints: [], lcp: [], shifts: [], longTasks: [], readyAt: null };
    window.__braveMobileAudit = proof;
    new PerformanceObserver(list => {
      proof.paints.push(...list.getEntries().map(entry => ({ name: entry.name, startTime: entry.startTime })));
    }).observe({ type: 'paint', buffered: true });
    new PerformanceObserver(list => {
      proof.lcp.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, size: entry.size, tag: entry.element?.tagName, className: entry.element?.className, url: entry.url })));
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(list => {
      proof.shifts.push(...list.getEntries().filter(entry => !entry.hadRecentInput).map(entry => ({ value: entry.value, startTime: entry.startTime })));
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(list => {
      proof.longTasks.push(...list.getEntries().map(entry => ({ startTime: entry.startTime, duration: entry.duration })));
    }).observe({ type: 'longtask', buffered: true });
    const check = () => {
      if (window.__OR3_APP_INIT_FIRED__ === true && document.querySelector('[aria-label="Message input"][contenteditable="true"]')) {
        proof.readyAt = performance.now();
      } else requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  });
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  await cdp.send('Network.emulateNetworkConditions', conditions);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const version = await cdp.send('Browser.getVersion');
  let tracing = false;
  try {
    await browser.startTracing(page, {
      path: '/private/tmp/or3-brave-mobile-playwright-latest.trace.json',
      screenshots: true,
      categories: ['devtools.timeline', 'loading', 'blink.user_timing', 'disabled-by-default-devtools.timeline', 'disabled-by-default-devtools.timeline.frame']
    });
    tracing = true;
    const startedAt = new Date().toISOString();
    await page.goto('http://127.0.0.1:3152/chat', { waitUntil: 'load', timeout: 60000 });
    await page.waitForFunction(() => {
      const resources = performance.getEntriesByType('resource');
      const background = resources.some(entry => entry.name.endsWith('/blank-chat-background.webp') && entry.responseEnd > 0);
      const hero = resources.some(entry => entry.name.endsWith('/bird-on-cloud.webp') && entry.responseEnd > 0);
      return window.__braveMobileAudit?.readyAt !== null && background && hero;
    }, { timeout: 60000 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const result = await page.evaluate(() => {
      const proof = window.__braveMobileAudit;
      const navigation = performance.getEntriesByType('navigation')[0].toJSON();
      const resources = performance.getEntriesByType('resource').filter(entry => entry.name.startsWith(location.origin)).map(entry => ({ path: new URL(entry.name).pathname, startMs: entry.startTime, endMs: entry.responseEnd, durationMs: entry.duration, transferSize: entry.transferSize, encodedBodySize: entry.encodedBodySize, decodedBodySize: entry.decodedBodySize, initiatorType: entry.initiatorType }));
      const rect = selector => {
        const element = document.querySelector(selector);
        return element ? element.getBoundingClientRect().toJSON() : null;
      };
      return {
        viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, touch: navigator.maxTouchPoints },
        userAgent: navigator.userAgent,
        theme: document.documentElement.dataset.theme,
        dark: document.documentElement.classList.contains('dark'),
        proof,
        navigation,
        resources,
        requestCount: resources.length + 1,
        transferredBytes: navigation.transferSize + resources.reduce((sum, entry) => sum + entry.transferSize, 0),
        geometry: { composer: rect('.chat-input-main'), input: rect('[aria-label="Message input"]'), navigation: rect('#main-content [aria-label="Open sidebar"]'), settings: rect('.chat-input-main [aria-label="Settings"]') }
      };
    });
    await page.screenshot({ path: 'output/playwright/brave-mobile/latest.png', animations: 'disabled', scale: 'css' });
    return { startedAt, browser: version, profile: { cpuSlowdown: 4, network: conditions, cacheDisabled: true, bypassServiceWorker: true, contextServiceWorkers: 'block', isolatedProfile: true, headless: true }, ...result, errors };
  } finally {
    if (tracing) await browser.stopTracing();
    page.off('pageerror', onError);
    page.off('console', onConsole);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.detach();
  }
}
