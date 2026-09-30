/**
 * Real connection transport.
 *
 * Manual redirects, a combined cancellation+deadline signal, and a bounded
 * response read. The dispatcher has already validated the destination, method,
 * path and headers; this module only performs the request it is handed.
 *
 * The deadline stays active until the body has been read, so a provider that
 * accepts the request and then stalls cannot outlive its budget.
 */

import {
    combineWithDeadline,
    readBoundedBody,
} from './bounded-body';
import type {
    ConnectionTransport,
    ConnectionTransportRequest,
    ConnectionTransportResponse,
} from './dispatch';

export function createFetchConnectionTransport(
    fetchImpl: typeof fetch = fetch
): ConnectionTransport {
    return async (request: ConnectionTransportRequest): Promise<ConnectionTransportResponse> => {
        const deadline = combineWithDeadline({
            ...(request.signal === undefined ? {} : { signal: request.signal }),
            timeoutMs: request.timeoutMs,
        });
        try {
            const response = await fetchImpl(request.url, {
                method: request.method,
                headers: request.headers,
                redirect: 'manual',
                signal: deadline.signal,
                ...(request.body === undefined ? {} : { body: request.body }),
            });
            const headers: Record<string, string> = {};
            response.headers.forEach((value, key) => {
                headers[key.toLowerCase()] = value;
            });
            if (response.status >= 300 && response.status < 400) {
                // A redirect is never followed: read nothing, cancel the body.
                try {
                    await response.body?.cancel();
                } catch {
                    // Nothing to release.
                }
                return { status: response.status, headers, body: '' };
            }

            const bounded = await readBoundedBody(response, {
                maxBytes: request.maxResponseBytes,
            });
            if (!bounded.ok) {
                if (deadline.timedOut()) {
                    throw new Error('Provider call timed out while reading the response');
                }
                throw Object.assign(new Error(bounded.message), {
                    code: bounded.code,
                });
            }
            return {
                status: response.status,
                headers,
                body: bounded.text,
            };
        } catch (error) {
            if (deadline.timedOut()) {
                throw new Error('Provider call exceeded its deadline');
            }
            throw error;
        } finally {
            deadline.dispose();
        }
    };
}
