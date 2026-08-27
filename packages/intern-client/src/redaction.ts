const REDACTED = '[REDACTED]';

function secretKey(key: string): boolean {
    return (
        /^(?:authorization|proxy-authorization|cookie|set-cookie|password|passphrase|secret|api[_-]?key)$/i.test(
            key
        ) ||
        /(?:^|[_-])(?:password|passphrase|secret|token|api[_-]?key)$/i.test(
            key
        ) ||
        /(?:Password|Passphrase|Secret|Token|ApiKey)$/.test(key)
    );
}

function replaceLiteral(value: string, secret: string): string {
    if (!secret) return value;
    return value.split(secret).join(REDACTED);
}

function redactString(
    input: string,
    explicitSecrets: readonly string[]
): string {
    let value = input
        .replace(/\bBearer\s+[^\s"',;]+/gi, `Bearer ${REDACTED}`)
        .replace(
            /(["']?(?:authorization|api[_-]?key|[a-z0-9_-]*(?:password|passphrase|secret|token))["']?\s*[:=]\s*["']?)([^"',}\s&]+)/gi,
            `$1${REDACTED}`
        );

    value = value.replace(
        /([?&])([^=&#]+)=([^&#]*)/g,
        (match, prefix: string, rawKey: string) => {
            let key = rawKey;
            try {
                key = decodeURIComponent(rawKey);
            } catch {
                // Keep the raw key when malformed URL encoding is encountered.
            }
            return secretKey(key)
                ? `${prefix}${rawKey}=${REDACTED}`
                : match;
        }
    );

    for (const secret of explicitSecrets) {
        value = replaceLiteral(value, secret);
    }
    return value;
}

function redactValue(
    value: unknown,
    explicitSecrets: readonly string[],
    seen: WeakSet<object>
): unknown {
    if (typeof value === 'string') {
        return redactString(value, explicitSecrets);
    }
    if (
        value === null ||
        value === undefined ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        typeof value === 'bigint'
    ) {
        return value;
    }
    if (value instanceof Error) {
        return {
            name: value.name,
            message: redactString(value.message, explicitSecrets),
        };
    }
    if (Array.isArray(value)) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        return value.map((item) => redactValue(item, explicitSecrets, seen));
    }
    if (typeof value === 'object') {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
        const output: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            output[key] = secretKey(key)
                ? REDACTED
                : redactValue(item, explicitSecrets, seen);
        }
        return output;
    }
    return redactString(String(value), explicitSecrets);
}

export function redactInternSecrets(
    value: unknown,
    explicitSecrets: readonly string[] = []
): unknown {
    return redactValue(
        value,
        explicitSecrets.filter(Boolean),
        new WeakSet()
    );
}

export function safeInternStringify(
    value: unknown,
    explicitSecrets: readonly string[] = []
): string {
    try {
        return JSON.stringify(redactInternSecrets(value, explicitSecrets));
    } catch {
        return '"[Unserializable]"';
    }
}
