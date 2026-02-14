import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const APP_ROOT = join(ROOT, 'app');

const ALLOWED_PENDING_OPS_MATCHES = new Set([
    'app/core/sync/hook-bridge.ts',
]);

function collectSourceFiles(dir: string): string[] {
    const entries = readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__') continue;
            files.push(...collectSourceFiles(full));
            continue;
        }
        if (!entry.isFile()) continue;
        if (full.endsWith('.ts') || full.endsWith('.vue')) {
            files.push(full);
        }
    }
    return files;
}

describe('sync tx scope usage', () => {
    it('uses shared tx-scope helper instead of manual pending_ops checks', () => {
        const offenders: string[] = [];
        const files = collectSourceFiles(APP_ROOT);
        for (const file of files) {
            const rel = relative(ROOT, file).replaceAll('\\', '/');
            const content = readFileSync(file, 'utf8');
            const hasManualPendingOpsCheck =
                content.includes("includes('pending_ops')") ||
                content.includes('includes("pending_ops")') ||
                content.includes("txTables.push('pending_ops')") ||
                content.includes('txTables.push("pending_ops")');

            if (
                hasManualPendingOpsCheck &&
                !ALLOWED_PENDING_OPS_MATCHES.has(rel)
            ) {
                offenders.push(rel);
            }
        }

        expect(offenders).toEqual([]);
    });
});
