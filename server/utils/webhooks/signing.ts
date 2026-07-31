import { createHmac } from 'node:crypto';

export function signPayload(
    body: string,
    secret: string,
    timestamp: number
): string {
    const digest = createHmac('sha256', secret)
        .update(`${timestamp}.${body}`)
        .digest('hex');

    return `sha256=${digest}`;
}

export function buildDeliveryHeaders(
    eventType: string,
    eventId: string,
    signature: string,
    timestamp: number
): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        'X-OR3-Event': eventType,
        'X-OR3-Signature': signature,
        'X-OR3-Event-ID': eventId,
        'X-OR3-Timestamp': String(timestamp),
        'User-Agent': 'OR3-Webhooks/1.0',
    };
}
