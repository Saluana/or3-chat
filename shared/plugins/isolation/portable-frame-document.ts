/**
 * @module shared/plugins/isolation/portable-frame-document
 *
 * Purpose:
 * The host-owned sandbox frame: its document, its relay script, the worker shim
 * and the bounded wire guard both hops share.
 *
 * Behavior:
 * - The frame document is inert markup that loads the relay script.
 * - The relay script creates exactly one worker from the host-owned shim blob,
 *   hands it the host-verified module source, and relays RPC both ways.
 * - The shim queues plugin-facing messages until the module has imported, so a
 *   fast host never loses the bootstrap message.
 * - The shim records the host session from the bootstrap message and stamps it
 *   onto every outbound request, overwriting anything the plugin supplied.
 * - Both the shim→frame and frame→host hops measure the message against the
 *   recorded wire bounds before forwarding it. The host boundary measures again
 *   with the authoritative UTF-8 implementation.
 * - Publisher code is never evaluated in the frame window.
 *
 * Constraints:
 * - No inline script other than the hash-authorised relay, no `eval`, no ambient
 *   access in the worker shim.
 *
 * Non-Goals:
 * - Deciding what to run (see `portable-bootstrap`).
 */

/**
 * Bounded wire guard shared by the worker shim and the frame relay.
 *
 * A compact, allocation-light pre-filter: it walks the value once, refusing
 * unsupported values, circular references, excessive nesting, node floods and
 * oversized messages. The host boundary still measures the same message with the
 * authoritative UTF-8 counter, so an undercount here cannot loosen the ceiling.
 */
export const PORTABLE_WIRE_GUARD_SOURCE = `
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
`;

/** Wire bounds mirrored from `rpc-envelope` (kept as literals for the sandbox). */
export const PORTABLE_WIRE_LIMITS = Object.freeze({
    bytes: 256 * 1024,
    depth: 32,
    nodes: 20_000,
});

/**
 * Install the nested-worker deny boundary before publisher code is imported.
 * If a browser exposes an unreplaceable constructor, the shim refuses to
 * import the publisher instead of claiming that the boundary is enforced.
 */
export const PORTABLE_NESTED_WORKER_HARDENING_SOURCE = `
function or3HardenNestedWorkers() {
  var roots = [];
  try { if (typeof globalThis !== 'undefined') roots.push(globalThis); } catch (error) { return false; }
  try { if (typeof self !== 'undefined' && roots.indexOf(self) === -1) roots.push(self); } catch (error) { return false; }
  var names = ['Worker', 'SharedWorker'];
  for (var rootIndex = 0; rootIndex < roots.length; rootIndex += 1) {
    var root = roots[rootIndex];
    for (var nameIndex = 0; nameIndex < names.length; nameIndex += 1) {
      var name = names[nameIndex];
      var target = root;
      var replaced = false;
      for (var depth = 0; target && depth < 16; depth += 1) {
        var descriptor;
        try { descriptor = Object.getOwnPropertyDescriptor(target, name); } catch (error) { return false; }
        if (descriptor) {
          if (descriptor.configurable === false) {
            if (Object.prototype.hasOwnProperty.call(descriptor, 'value') && descriptor.value === undefined) {
              replaced = true;
              break;
            }
            return false;
          }
          try {
            Object.defineProperty(target, name, {
              value: undefined,
              writable: false,
              configurable: false,
              enumerable: false,
            });
          } catch (error) { return false; }
          replaced = true;
          break;
        }
        try { target = Object.getPrototypeOf(target); } catch (error) { return false; }
      }
      if (!replaced) {
        try {
          Object.defineProperty(root, name, {
            value: undefined,
            writable: false,
            configurable: false,
            enumerable: false,
          });
        } catch (error) { return false; }
      }
      try {
        if (root[name] !== undefined) return false;
      } catch (error) { return false; }
    }
  }
  return true;
}
`;

/**
 * Host-owned worker shim. Runs inside the worker (and therefore inside the
 * frame's opaque origin) and holds no ambient capability of its own.
 */
export const PORTABLE_WORKER_SHIM = `
'use strict';
// Host-owned bootstrap. No ambient access of its own.
// Envelopes that arrive before the module is imported are queued and replayed,
// so a fast host never loses the bootstrap message.
const state = { started: false, ready: false, session: null };
const pending = [];
const limits = { bytes: ${PORTABLE_WIRE_LIMITS.bytes}, depth: ${PORTABLE_WIRE_LIMITS.depth}, nodes: ${PORTABLE_WIRE_LIMITS.nodes} };
const nativePostMessage = self.postMessage.bind(self);
${PORTABLE_WIRE_GUARD_SOURCE}
${PORTABLE_NESTED_WORKER_HARDENING_SOURCE}
function deliver(data) {
  try {
    self.dispatchEvent(new MessageEvent('message', { data: data }));
  } catch (error) {
    void error;
  }
}
// The host sends serialized JSON strings; plugin code may post objects. Only the
// host-owned parts (session capture and request stamping) need the parsed form,
// and the plugin still receives exactly what the host sent.
function normalizeIncoming(data) {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data);
  } catch (error) {
    return data;
  }
}
function rememberSession(envelope) {
  if (!envelope || typeof envelope !== 'object') return;
  if (envelope.kind !== 'event' || envelope.name !== 'runtime.bootstrap') return;
  var payload = envelope.payload;
  if (!payload || typeof payload !== 'object') return;
  var session = payload.session;
  if (!session || typeof session !== 'object') return;
  if (typeof session.sessionId !== 'string') return;
  if (typeof session.sourceId !== 'string') return;
  if (typeof session.generation !== 'number') return;
  // Host-issued identity, recorded before the plugin can see the message.
  state.session = { sessionId: session.sessionId, sourceId: session.sourceId, generation: session.generation };
}
// Every outbound message is size-checked and stamped with the host session.
// The plugin cannot opt out: this wrapper is installed before the module loads.
self.postMessage = function (message) {
  var envelope = message;
  if (
    state.session &&
    message &&
    typeof message === 'object' &&
    message.kind === 'request'
  ) {
    envelope = {};
    for (var key in message) {
      if (Object.prototype.hasOwnProperty.call(message, key)) envelope[key] = message[key];
    }
    envelope.sessionId = state.session.sessionId;
    envelope.sourceId = state.session.sourceId;
    envelope.generation = state.session.generation;
  }
  var guard = or3WireGuard(envelope, limits);
  if (!guard.ok) {
    nativePostMessage({
      v: 1,
      kind: 'event',
      id: 'wire-' + Date.now().toString(36),
      name: 'runtime.malformed',
      payload: { code: guard.code, message: guard.message }
    });
    if (envelope && typeof envelope === 'object' && typeof envelope.id === 'string') {
      deliver({ v: 1, kind: 'error', id: envelope.id, code: 'oversized', message: guard.message });
    }
    return;
  }
  nativePostMessage(envelope);
};
function start(source) {
  if (state.started) return;
  state.started = true;
  if (!source) {
    nativePostMessage({ or3Portable: 'worker-error', reason: 'missing-module-source' });
    return;
  }
  if (!or3HardenNestedWorkers()) {
    nativePostMessage({ or3Portable: 'worker-error', reason: 'nested-worker-constructors-unavailable' });
    return;
  }
  const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
  import(url)
    .then(function () {
      state.ready = true;
      nativePostMessage({ or3Portable: 'worker-ready' });
      while (pending.length > 0) deliver(pending.shift());
    })
    .catch(function (error) {
      nativePostMessage({
        or3Portable: 'worker-error',
        reason: 'module-import-failed: ' + String((error && error.message) || error),
      });
    });
}
self.addEventListener('message', function (event) {
  const data = event && event.data ? event.data : null;
  if (data && data.or3Portable === 'module-source') {
    start(typeof data.source === 'string' ? data.source : '');
    return;
  }
  rememberSession(normalizeIncoming(data));
  if (!state.ready) {
    pending.push(data);
    return;
  }
  // Once the module is imported the plugin listens on the worker global itself.
});
`;

/**
 * Relay script for the frame document. Same-origin, loaded by `<script src>`.
 * It reports itself, creates the worker, relays RPC and never runs publisher
 * code in this window.
 */
export const PORTABLE_FRAME_SCRIPT = `
(function () {
  'use strict';
  var worker = null;
  var started = false;
  var shimSource = ${JSON.stringify(PORTABLE_WORKER_SHIM)};
  var limits = { bytes: ${PORTABLE_WIRE_LIMITS.bytes}, depth: ${PORTABLE_WIRE_LIMITS.depth}, nodes: ${PORTABLE_WIRE_LIMITS.nodes} };
${PORTABLE_WIRE_GUARD_SOURCE}
  function toHost(kind, payload) {
    var message = { or3Portable: kind };
    if (payload) {
      for (var key in payload) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) message[key] = payload[key];
      }
    }
    try {
      parent.postMessage(message, '*');
    } catch (error) {
      void error;
    }
  }

  function startWorker(source) {
    if (started) return;
    started = true;
    try {
      var shimUrl = URL.createObjectURL(new Blob([shimSource], { type: 'text/javascript' }));
      worker = new Worker(shimUrl);
    } catch (error) {
      toHost('frame-error', {
        reason: 'worker-create-failed: ' + String((error && error.message) || error)
      });
      return;
    }
    worker.onmessage = function (event) {
      var data = event && event.data ? event.data : null;
      if (data && data.or3Portable === 'worker-ready') {
        toHost('worker-ready');
        return;
      }
      if (data && data.or3Portable === 'worker-error') {
        toHost('worker-error', { reason: String(data.reason || 'worker-error') });
        return;
      }
      // Cheap second check before the message crosses into the host realm.
      var guard = or3WireGuard(data, limits);
      if (!guard.ok) {
        toHost('worker-error', { reason: 'wire-violation: ' + guard.code + ': ' + guard.message });
        return;
      }
      toHost('rpc', { data: data });
    };
    worker.onerror = function (event) {
      toHost('worker-error', { reason: String((event && event.message) || 'worker error') });
    };
    worker.postMessage({ or3Portable: 'module-source', source: source });
  }

  window.addEventListener('message', function (event) {
    var data = event && event.data ? event.data : null;
    if (!data || typeof data.or3Portable !== 'string') return;
    if (event.source !== parent) return;
    switch (data.or3Portable) {
      case 'start':
        startWorker(typeof data.moduleSource === 'string' ? data.moduleSource : '');
        break;
      case 'rpc':
        if (worker) worker.postMessage(data.data);
        break;
      case 'terminate':
        if (worker) {
          worker.terminate();
          worker = null;
        }
        break;
      default:
        break;
    }
  });

  toHost('frame-ready');
})();
`;

/**
 * The inline relay script is authorised by a CSP hash rather than `'self'`: a
 * sandboxed document has an opaque origin, and WebKit (correctly) refuses an
 * external `'self'` script there. The hash authorises exactly this text and
 * nothing else, so `'unsafe-inline'` is still unnecessary.
 */
export const PORTABLE_FRAME_SCRIPT_HASH =
    'sha256-TFAXm7CuJbfHeGEFJrdqIQIEV5rq/NxsWJnzPrm795A=';

/** The frame document: inert markup plus the hash-authorised relay script. */
export const PORTABLE_FRAME_DOCUMENT = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>OR3 portable sandbox</title></head>
<body>
<script>${PORTABLE_FRAME_SCRIPT}</script>
</body>
</html>
`;
