/**
 * Host-owned containment probe: module source.
 *
 * Returned as text and handed to the production sandbox frame exactly as a real
 * plugin module would be, so the reported results describe the shipped sandbox
 * (opaque origin + containment CSP) rather than a test-only one.
 *
 * The same module runs in two places:
 * - inside the shipped sandbox, where every ambient channel must be denied;
 * - inside an uncontained control worker on the host origin, where the same
 *   channels must work.
 *
 * That pair is what makes a "blocked" result evidence of containment rather than
 * evidence of a typo, a dead DNS name or a probe that never executed. The harness
 * supplies reachable targets explicitly because `location.origin` is `null` in an
 * opaque-origin worker.
 *
 * Inert: the module only measures which ambient capabilities exist and reports
 * them; it touches no host data. Disabled unless
 * `OR3_CONTAINMENT_PROBE_ENABLED=true`.
 */
import { createError, defineEventHandler, setHeader } from 'h3';
import { useRuntimeConfig } from '#imports';
import { PORTABLE_FRAME_CSP } from '~~/shared/plugins/isolation/containment-policy';

export const PROBE_MODULE_SOURCE = `
// Host-owned containment probe. Runs inside the sandbox worker (opaque origin).
const results = [];
const record = (channel, outcome, note) =>
  results.push({ channel, outcome, note: String(note).slice(0, 200) });
const blocked = (channel, note) => record(channel, 'blocked', note);
const reachable = (channel, note) => record(channel, 'reachable', note);
const inconclusive = (channel, note) => record(channel, 'inconclusive', note);

const attempt = async (channel, run) => {
  try {
    const value = await run();
    reachable(channel, typeof value === 'string' ? value : 'reachable');
  } catch (error) {
    blocked(channel, (error && error.message) || String(error));
  }
};

const probeIndexedDb = () => new Promise((resolve, reject) => {
  if (typeof self.indexedDB === 'undefined') { reject(new Error('indexedDB is undefined')); return; }
  let request;
  try { request = self.indexedDB.open('or3-containment-probe'); } catch (error) { reject(error); return; }
  request.onsuccess = () => resolve('opened');
  request.onerror = () => reject(request.error || new Error('open failed'));
  request.onblocked = () => reject(new Error('blocked'));
  setTimeout(() => reject(new Error('timed out')), 800);
});

// The nested worker reports every result before the parent decides anything.
const nestedSource = [
  "self.onmessage = function () {",
  "  var out = { settled: 0, expected: 2 };",
  "  function done() { out.settled += 1; if (out.settled >= out.expected) { try { self.postMessage(out); } catch (e) {} } }",
  "  try {",
  "    var request = self.indexedDB.open('or3-nested-probe');",
  "    request.onsuccess = function () { out.indexedDbOpen = 'opened'; done(); };",
  "    request.onerror = function () { out.indexedDbOpen = 'denied'; done(); };",
  "    setTimeout(function () { out.indexedDbOpen = out.indexedDbOpen || 'timeout'; done(); }, 600);",
  "  } catch (error) { out.indexedDbOpen = 'denied:' + error.name; done(); }",
  "  self.fetch(globalThis.__or3NestedTarget).then(",
  "    function (response) { out.fetch = 'status ' + response.status; done(); },",
  "    function (error) { out.fetch = 'denied:' + (error && error.name); done(); }",
  "  );",
  "};"
].join('\\n');

const probe = async () => {
  const targets = globalThis.__or3ProbeTargets || {};
  const hostOrigin = typeof targets.hostOrigin === 'string' ? targets.hostOrigin : null;
  const httpTarget = typeof targets.http === 'string' ? targets.http : null;
  const scriptTarget = typeof targets.script === 'string' ? targets.script : null;
  const socketTarget = typeof targets.socket === 'string' ? targets.socket : null;

  // Structural facts: these are absent in every dedicated worker, contained or
  // not, so they are recorded but never used as containment evidence.
  record('struct.document', typeof self.document === 'undefined' ? 'blocked' : 'reachable', 'self.document');
  record('struct.frameElement', typeof self.frameElement === 'undefined' ? 'blocked' : 'reachable', 'self.frameElement');
  record('struct.cookie', typeof self.cookie === 'undefined' ? 'blocked' : 'reachable', 'self.cookie');
  record('struct.localStorage', typeof self.localStorage === 'undefined' ? 'blocked' : 'reachable', 'self.localStorage');
  record('struct.sessionStorage', typeof self.sessionStorage === 'undefined' ? 'blocked' : 'reachable', 'self.sessionStorage');

  if (!httpTarget || !scriptTarget || !hostOrigin) {
    // Without reachable targets nothing can be claimed: record why instead of
    // reporting a denial that a missing target would also produce.
    inconclusive('targets', 'the harness did not supply reachable probe targets');
    return results;
  }

  await attempt('storage.indexedDB', probeIndexedDb);

  await attempt('network.fetch', async () => {
    if (typeof self.fetch !== 'function') throw new Error('fetch is undefined');
    const response = await self.fetch(httpTarget, { mode: 'cors' });
    return 'status ' + response.status;
  });

  await attempt('network.fetch-same-origin', async () => {
    if (typeof self.fetch !== 'function') throw new Error('fetch is undefined');
    // The host origin is passed in explicitly: an opaque-origin worker reports
    // location.origin as 'null', which would make this probe meaningless.
    const response = await self.fetch(hostOrigin + '/or3-containment/target', { mode: 'cors' });
    return 'status ' + response.status;
  });

  await attempt('network.xmlHttpRequest', () => new Promise((resolve, reject) => {
    if (typeof self.XMLHttpRequest === 'undefined') { reject(new Error('XMLHttpRequest is undefined')); return; }
    try {
      const xhr = new self.XMLHttpRequest();
      xhr.open('GET', httpTarget);
      xhr.onload = () => resolve('status ' + xhr.status);
      xhr.onerror = () => reject(new Error('xhr error'));
      xhr.send();
    } catch (error) { reject(error); }
  }));

  if (!socketTarget) {
    // Running this probe would open a socket the harness asked us not to open
    // (some engines assert when such a worker is torn down). Absence is recorded
    // as unanswered rather than as a denial.
    inconclusive('network.webSocket', 'the harness did not supply a socket target for this run');
  } else {
  await attempt('network.webSocket', () => new Promise((resolve, reject) => {
    if (typeof self.WebSocket === 'undefined') { reject(new Error('WebSocket is undefined')); return; }
    let socket;
    const settled = { done: false };
    const finish = (fn) => { if (settled.done) return; settled.done = true; fn(); };
    try { socket = new self.WebSocket(socketTarget); } catch (error) { reject(error); return; }
    // Resolve only after the socket is fully closed: terminating a worker with an
    // in-flight WebSocket teardown makes some engines assert.
    socket.onopen = () => {
      finish(() => resolve('open'));
      try { socket.close(); } catch (e) { void e; }
    };
    socket.onclose = () => finish(() => resolve('open'));
    socket.onerror = () => finish(() => reject(new Error('socket error')));
    setTimeout(() => finish(() => reject(new Error('timed out'))), 900);
  }));
  }

  await attempt('imports.importScripts', () => {
    if (typeof self.importScripts !== 'function') throw new Error('importScripts is undefined');
    // The target is an inert, separately served script: loading the probe module
    // again would double-declare its own top-level bindings.
    self.importScripts(scriptTarget);
    return 'imported';
  });

  await attempt('imports.dynamicRemote', async () => {
    // Genuine dynamic import of a reachable script URL.
    const namespace = await import(scriptTarget);
    return 'imported:' + Object.keys(namespace).length;
  });

  // A nested worker inherits the opaque origin and the CSP. Every result is
  // required before the parent decides: a silent nested worker is inconclusive.
  try {
    if (typeof self.Worker === 'undefined') throw new Error('Worker constructor is undefined');
    globalThis.__or3NestedTarget = httpTarget;
    const url = URL.createObjectURL(new Blob([nestedSource], { type: 'text/javascript' }));
    const nested = new self.Worker(url);
    const report = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 2500);
      nested.onmessage = (event) => {
        clearTimeout(timer);
        resolve(event && event.data ? event.data : {});
      };
      nested.onerror = (event) => {
        clearTimeout(timer);
        resolve({ nestedError: String((event && event.message) || 'nested worker error') });
      };
      nested.postMessage(1);
    });
    try { nested.terminate(); } catch (e) {}
    if (!report) {
      inconclusive('workers.nested', 'the nested worker reported nothing');
    } else if (typeof report.indexedDbOpen !== 'string' || typeof report.fetch !== 'string') {
      inconclusive('workers.nested', 'the nested worker did not report every result: ' + JSON.stringify(report));
    } else if (report.indexedDbOpen === 'opened' || report.fetch.indexOf('status') === 0) {
      reachable('workers.nested', JSON.stringify(report));
    } else {
      blocked('workers.nested', JSON.stringify(report));
    }
  } catch (error) {
    blocked('workers.nested', (error && error.message) || error);
  }

  return results;
};

self.addEventListener('message', (event) => {
  const data = event && event.data ? event.data : null;
  if (!data || data.or3Probe !== true) return;
  globalThis.__or3ProbeTargets = data.targets || {};
  probe().then(
    (capabilities) => self.postMessage({ or3ContainmentProbe: { capabilities } }),
    (error) => self.postMessage({ or3ContainmentProbe: { error: String(error) } })
  );
});

// Announce readiness so the harness never races the listener registration.
self.postMessage({ or3ContainmentProbe: { ready: true } });
`;

export default defineEventHandler((event) => {
    const config = useRuntimeConfig();
    const enabled = Boolean(
        (config.admin as { containmentProbeEnabled?: boolean } | undefined)
            ?.containmentProbeEnabled
    );
    if (!enabled) {
        throw createError({ statusCode: 404, statusMessage: 'Not Found' });
    }

    setHeader(event, 'content-type', 'text/javascript; charset=utf-8');
    setHeader(event, 'content-security-policy', PORTABLE_FRAME_CSP);
    setHeader(event, 'x-content-type-options', 'nosniff');
    setHeader(event, 'cache-control', 'no-store');
    return PROBE_MODULE_SOURCE;
});
