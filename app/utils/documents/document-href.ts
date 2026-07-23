/**
 * Shared link policy for the document editor and Document AI inserts.
 * Positive allowlist — blocks javascript:/data:/file:/blob:/ftp: etc.
 */
export function isAllowedDocumentHref(href: string): boolean {
    const trimmed = href.trim();
    if (!trimmed) return false;

    // In-document / site-relative targets without a scheme.
    if (
        trimmed.startsWith('#')
        || trimmed.startsWith('/')
        || trimmed.startsWith('./')
        || trimmed.startsWith('../')
        || trimmed.startsWith('?')
    ) {
        return true;
    }

    if (/^mailto:[^\s]+$/iu.test(trimmed)) return true;

    // Any other explicit scheme must be http(s).
    if (/^[a-z][a-z0-9+.-]*:/iu.test(trimmed)) {
        try {
            const url = new URL(trimmed);
            return url.protocol === 'http:' || url.protocol === 'https:';
        } catch {
            return false;
        }
    }

    // Scheme-less path (e.g. "docs/guide") — treat as relative.
    return !/\s/u.test(trimmed);
}
