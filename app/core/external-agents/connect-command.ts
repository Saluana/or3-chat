/**
 * Produces a copyable command for the current OR3 origin. Self-hosted users
 * should never have to discover or export their cloud URL by hand.
 */
export function buildConnectCommand(publicUrl: unknown): string | undefined {
    if (typeof publicUrl !== 'string' || !publicUrl.trim()) {
        return undefined;
    }

    try {
        const url = new URL(publicUrl.trim());
        if (
            !['http:', 'https:'].includes(url.protocol) ||
            url.username ||
            url.password ||
            url.pathname !== '/' ||
            url.search ||
            url.hash
        ) {
            return undefined;
        }
        return `npx @or3/connect --cloud-url ${url.origin}`;
    } catch {
        return undefined;
    }
}
