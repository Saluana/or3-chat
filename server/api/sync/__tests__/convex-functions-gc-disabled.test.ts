import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

function installedConvexTemplates(): Record<string, string> {
    const providerEntry = fileURLToPath(
        import.meta.resolve('or3-provider-convex/nuxt')
    );
    const packPath = resolve(
        dirname(providerEntry),
        '../templates/convex.pack.json.gz'
    );
    return (
        JSON.parse(gunzipSync(readFileSync(packPath)).toString('utf8')) as {
            files: Record<string, string>;
        }
    ).files;
}

describe('installed Convex sync history GC contract', () => {
    it('ships bounded direct collectors and inert orchestration entry points', () => {
        const files = installedConvexTemplates();
        const sync = files['sync.ts'] ?? '';
        const policy = files['syncHistoryGcPolicy.ts'] ?? '';

        expect(sync).toContain('export const gcTombstones = internalMutation');
        expect(sync).toContain('export const gcChangeLog = internalMutation');
        expect(sync).toContain(".order('asc').take(batchSize + 1)");
        expect(sync).toContain('export const runWorkspaceGc = internalMutation');
        expect(sync).toContain('export const runScheduledGc = internalMutation');
        expect(sync).toContain('disabled: true');
        expect(policy).toContain('enabled: true');
        expect(policy).toContain('snapshotBootstrapVerified: true');
    });
});
