/**
 * Structured background execution logging with recursive secret redaction.
 */

type BackgroundLogLevel = 'info' | 'warn' | 'error';

const SECRET_KEY_PATTERN =
    /(token|secret|password|authorization|cookie|api[_-]?key|refresh|jwt)/i;
const JWT_LIKE_PATTERN =
    /\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/\-=]{8,}\b/gi;
const OPENROUTER_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{12,}\b/g;

function redactString(value: string): string {
    return value
        .replace(BEARER_PATTERN, 'Bearer <redacted>')
        .replace(JWT_LIKE_PATTERN, '<redacted-jwt>')
        .replace(OPENROUTER_KEY_PATTERN, '<redacted-key>');
}

function redactValue(key: string, value: unknown): unknown {
    if (SECRET_KEY_PATTERN.test(key)) {
        return '<redacted>';
    }

    if (typeof value === 'string') {
        return redactString(value);
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(key, item));
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    const record = value as Record<string, unknown>;
    const redacted: Record<string, unknown> = {};
    for (const [entryKey, entryValue] of Object.entries(record)) {
        redacted[entryKey] = redactValue(entryKey, entryValue);
    }
    return redacted;
}

export function redactForBackgroundLog<T>(value: T): T {
    return redactValue('', value) as T;
}

export function logBackgroundEvent(
    level: BackgroundLogLevel,
    event: string,
    details: Record<string, unknown> = {}
): void {
    const entry = {
        level,
        event,
        timestamp: new Date().toISOString(),
        ...redactForBackgroundLog(details),
    };
    let serialized = '';
    try {
        serialized = JSON.stringify(entry);
    } catch {
        serialized = JSON.stringify({
            level,
            event,
            timestamp: entry.timestamp,
            message: 'failed_to_serialize_log_entry',
        });
    }

    if (level === 'error') {
        console.error(serialized);
        return;
    }
    if (level === 'warn') {
        console.warn(serialized);
        return;
    }
    console.info(serialized);
}
