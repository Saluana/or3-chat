/**
 * Host-owned portable sandbox frame document.
 *
 * Inert markup served with the containment CSP; the relay script is a separate
 * same-origin asset because inline script is not allowed. Sandboxed without
 * `allow-same-origin`, so the frame (and the worker it creates) has an opaque
 * origin and cannot reach host IndexedDB, cookies or web storage.
 */
import { defineEventHandler, setHeader } from 'h3';
import { PORTABLE_FRAME_CSP } from '~~/shared/plugins/isolation/containment-policy';
import { PORTABLE_FRAME_DOCUMENT } from '~~/shared/plugins/isolation/portable-frame-document';

export default defineEventHandler((event) => {
    setHeader(event, 'content-type', 'text/html; charset=utf-8');
    setHeader(event, 'content-security-policy', PORTABLE_FRAME_CSP);
    setHeader(event, 'x-content-type-options', 'nosniff');
    setHeader(event, 'referrer-policy', 'no-referrer');
    setHeader(event, 'cache-control', 'no-store');
    return PORTABLE_FRAME_DOCUMENT;
});
