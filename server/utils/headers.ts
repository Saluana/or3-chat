/**
 * HTTP header utilities for security and cache control.
 */
import { setHeader, type H3Event } from 'h3';

/**
 * Set no-cache headers to prevent intermediary caching of sensitive responses.
 * Use this for sync push/pull, storage presign/upload/download, and auth session endpoints.
 * 
 * @param event - H3Event
 */
export function setNoCacheHeaders(event: H3Event): void {
    setHeader(event, 'Cache-Control', 'no-store, no-cache, must-revalidate');
    setHeader(event, 'Pragma', 'no-cache');
}
