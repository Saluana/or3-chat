/** Host-owned relay. Update the hash and rerun containment qualification after changing it. */
export const CONTAINED_VIEW_RELAY_SOURCE = String.raw`(function () {
'use strict';

function or3WireGuard(value, limits) {
  var maxBytes = limits.bytes, maxDepth = limits.depth, maxNodes = limits.nodes;
  var bytes = 0, nodes = 0, seen = [];
  function over() { return { ok: false, code: 'oversized', message: 'RPC message exceeds ' + maxBytes + ' bytes' }; }
  function walk(node, depth, inArray) {
    nodes += 1;
    if (nodes > maxNodes) return { ok: false, code: 'too-many-nodes', message: 'RPC message exceeds ' + maxNodes + ' values' };
    if (depth > maxDepth) return { ok: false, code: 'too-deep', message: 'RPC message nests deeper than ' + maxDepth + ' levels' };
    if (node === null) { bytes += 4; return bytes > maxBytes ? over() : null; }
    var type = typeof node;
    if (type === 'boolean') { bytes += node ? 4 : 5; return bytes > maxBytes ? over() : null; }
    if (type === 'number') {
      if (!isFinite(node)) return { ok: false, code: 'invalid-envelope', message: 'RPC wire values must use finite numbers' };
      bytes += String(node).length;
      return bytes > maxBytes ? over() : null;
    }
    if (type === 'string') { bytes += 2 + node.length * 3; return bytes > maxBytes ? over() : null; }
    if (type === 'undefined') { if (inArray) bytes += 4; return bytes > maxBytes ? over() : null; }
    if (type === 'function' || type === 'symbol' || type === 'bigint') {
      return { ok: false, code: 'invalid-envelope', message: 'RPC wire values cannot contain ' + type };
    }
    if (seen.indexOf(node) !== -1) {
      return { ok: false, code: 'invalid-envelope', message: 'RPC wire values cannot contain circular references' };
    }
    seen.push(node);
    try {
      if (Object.prototype.toString.call(node) === '[object Array]') {
        bytes += 2 + (node.length > 0 ? node.length - 1 : 0);
        if (bytes > maxBytes) return over();
        for (var i = 0; i < node.length; i += 1) {
          var arrayFailure = walk(node[i], depth + 1, true);
          if (arrayFailure) return arrayFailure;
        }
        return null;
      }
      var prototype = Object.getPrototypeOf(node);
      if (prototype !== Object.prototype && prototype !== null) {
        return { ok: false, code: 'invalid-envelope', message: 'RPC wire values must be plain objects' };
      }
      bytes += 2;
      if (bytes > maxBytes) return over();
      var keys = Object.keys(node);
      for (var index = 0; index < keys.length; index += 1) {
        bytes += 2 + keys[index].length * 3 + 1;
        if (bytes > maxBytes) return over();
        var failure = walk(node[keys[index]], depth + 1, false);
        if (failure) return failure;
      }
      return null;
    } finally {
      seen.pop();
    }
  }
  var failure = walk(value, 1, false);
  if (failure) return failure;
  return { ok: true, bytes: bytes, nodes: nodes };
}

const Parent = parent;
const createBlob = Blob;
const createUrl = URL.createObjectURL.bind(URL);
const revokeUrl = URL.revokeObjectURL.bind(URL);
const activation = navigator.userActivation;
const activationGetter = activation && Object.getOwnPropertyDescriptor(Object.getPrototypeOf(activation), 'isActive')?.get;
const isActivated = activationGetter && Function.prototype.call.bind(activationGetter, activation);
const Resize = ResizeObserver;
const Controller = AbortController;
const preventNavigation = Function.prototype.call.bind(Event.prototype.preventDefault);
const safeTimeout = setTimeout.bind(window);
const safeClearTimeout = clearTimeout.bind(window);
const root = document.getElementById('card');
let connected = false;
window.addEventListener('message', function connect(event) {
    if (connected || event.source !== Parent || event.data?.type !== 'or3-card:connect' || event.data.protocol !== 1 || event.ports.length !== 1) return;
    connected = true; window.removeEventListener('message', connect);
    const port = event.ports[0];
    const post = port.postMessage.bind(port);
    const controller = new Controller();
    const abort = controller.abort.bind(controller);
    const listeners = new Set(); const requests = new Map();
    let snapshot; let mounted = false; let closed = false; let cleanup; let resize; let sequence = 0; let urls = [];
    function fail(code) { if (!closed) post({ type: 'error', code, message: code }); }
    function teardown() { if (closed) return; closed = true; abort(); try { cleanup?.(); } catch {} resize?.disconnect(); for (const url of urls) revokeUrl(url); for (const request of requests.values()) { safeClearTimeout(request.timer); request.resolve({ ok: false, error: { code: 'aborted', message: 'Card unmounted', retryable: false } }); } requests.clear(); listeners.clear(); port.close(); }
    window.addEventListener('pagehide', teardown, { once: true });
    root.addEventListener('or3:card-error', () => fail('mount-error'));
    window.addEventListener('error', () => fail('mount-error'));
    window.addEventListener('unhandledrejection', () => fail('mount-error'));
    if (!window.navigation || !activationGetter) { fail('runtime-unsupported'); return; }
    const cancelNavigation = event => { if (event.cancelable) preventNavigation(event); fail('frame-navigated'); };
    window.navigation.addEventListener('navigate', cancelNavigation);
    for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'Worker', 'SharedWorker']) {
        try { Object.defineProperty(window, name, { value: undefined, configurable: false, writable: false }); } catch { fail('runtime-unsupported'); return; }
    }
    function validSnapshot(value) {
        if (!or3WireGuard(value, { bytes: 160 * 1024, depth: 32, nodes: 20000 }).ok) return false;
        return value && Object.keys(value).sort().join(',') === 'args,callId,error,messageId,result,runtime,state,status,theme,tool' && value.runtime === 'frame' && ['running','complete','error'].includes(value.status) && typeof value.tool === 'string' && typeof value.callId === 'string' && typeof value.messageId === 'string' && value.theme && ['light','dark'].includes(value.theme.mode) && value.theme.tokens && typeof value.theme.tokens === 'object' && !Array.isArray(value.theme.tokens) && Object.entries(value.theme.tokens).every(([key,token]) => /^--[a-zA-Z0-9-]+$/.test(key) && typeof token === 'string' && token.length <= 2048);
    }
    function theme() { for (const [key,value] of Object.entries(snapshot.theme.tokens)) if (key.startsWith('--') && typeof value === 'string') document.documentElement.style.setProperty(key,value); document.documentElement.style.colorScheme = snapshot.theme.mode; }
    function action(name, payload) {
        if (closed) return Promise.resolve({ ok: false, error: { code: 'stale-context', message: 'Card unmounted', retryable: false } });
        const id = String(++sequence);
        const message = { type: 'action', id, name, payload, activated: isActivated() === true };
        if (!or3WireGuard(message, { bytes: 64 * 1024, depth: 32, nodes: 20000 }).ok) return Promise.resolve({ ok: false, error: { code: 'invalid-input', message: 'Invalid card action', retryable: false } });
        return new Promise(resolve => { const timer = safeTimeout(() => { requests.delete(id); resolve({ ok: false, error: { code: 'timeout', message: 'Card action timed out', retryable: true } }); }, 30000); requests.set(id,{ resolve,timer,name,payload }); post(message); });
    }
    const card = Object.freeze({
        get tool() { return snapshot.tool; }, get callId() { return snapshot.callId; }, get messageId() { return snapshot.messageId; }, runtime: 'frame',
        get status() { return snapshot.status; }, get args() { return snapshot.args; }, get result() { return snapshot.result; }, get error() { return snapshot.error; }, get state() { return snapshot.state; }, get theme() { return snapshot.theme; }, signal: controller.signal,
        setState: value => action('setState', value), send: text => action('send', text), openLink: url => action('openLink', url),
        onUpdate(listener) { listeners.add(listener); return () => listeners.delete(listener); }
    });
    function notify() { queueMicrotask(() => { if (closed) return; for (const listener of listeners) { try { listener(card); } catch { fail('mount-error'); } } }); }
    port.onmessage = async event => {
        const message = event.data;
        try {
            if (closed || !message || typeof message !== 'object') return;
            if (message.type === 'teardown') { teardown(); return; }
            if (message.type === 'boot') {
                if (mounted || snapshot || !(message.module instanceof ArrayBuffer) || message.module.byteLength + (message.stylesheet?.length ?? 0) > 1536 * 1024 || !validSnapshot(message.snapshot)) { fail('protocol-violation'); return; }
                snapshot = message.snapshot; theme();
                if (message.stylesheet) { const style = document.createElement('style'); style.textContent = message.stylesheet; document.head.append(style); }
                const url = createUrl(new createBlob([message.module], { type: 'text/javascript' })); urls.push(url);
                const module = await import(url);
                if (closed) return;
                if (typeof module.default?.mount !== 'function') { fail('mount-error'); return; }
                cleanup = module.default.mount(root, card); mounted = true; post({ type: 'mounted' });
                let last = 0; let timer;
                const report = () => { if (closed) return; const now = Date.now(); if (now - last < 34) { safeClearTimeout(timer); timer = safeTimeout(report,34); return; } last = now; post({ type: 'resize', height: Math.min(720, Math.max(48, Math.ceil(root.getBoundingClientRect().height))) }); };
                resize = new Resize(report); resize.observe(root); report();
                return;
            }
            if (message.type === 'update') { if (!validSnapshot(message.snapshot)) { fail('protocol-violation'); return; } snapshot = message.snapshot; theme(); notify(); return; }
            if (message.type === 'action-result' && or3WireGuard(message, { bytes: 64 * 1024, depth: 32, nodes: 20000 }).ok) {
                const request = requests.get(message.id); if (!request) return; requests.delete(message.id); safeClearTimeout(request.timer);
                if (message.result?.ok && request.name === 'setState') { snapshot.state = request.payload; notify(); }
                request.resolve(message.result);
            }
        } catch { fail('mount-error'); }
    };
    port.start(); post({ type: 'ready' });
});
})();`;
export const CONTAINED_VIEW_SCRIPT_HASH =
    'sha256-U1M0hSFxyPjdtKpX414GNv7fVjGiBmROZNN+gH0X6CM=';
export const CONTAINED_VIEW_DOCUMENT =
    '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;background:transparent;overflow-x:hidden;font-family:var(--font-sans,sans-serif);color:var(--md-on-surface)}#card{min-width:0;overflow-wrap:anywhere}img,iframe{max-width:100%}</style></head><body><div id="card"></div>' +
    '<script>' +
    CONTAINED_VIEW_RELAY_SOURCE +
    '</script></body></html>';
