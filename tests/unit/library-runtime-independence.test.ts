import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A Library link is acquisition authority, never execution authority (LK08).
 *
 * A revoked, expired or unreachable link must not stop already acquired plugins
 * from running, and it must not be able to (accidentally) become a runtime gate
 * later. This walks the runtime and installation code and fails if any of it
 * depends on the library link service or client state.
 */
// Vitest runs from the repository root in every lane.
const REPOSITORY_ROOT = process.cwd();

const RUNTIME_DIRECTORIES = [
    'app/composables/plugins',
    'app/plugins',
    'server/admin/plugins',
    'server/utils/plugins',
    'server/utils/plugins/connections',
];

const LIBRARY_DEPENDENCY =
    /from\s+['"][^'"]*(?:\/library\/(?:link-service|link-store|link-crypto|transport|route-support|config)|composables\/library\/useLibraryLink)['"]/;

function sourceFiles(directory: string): string[] {
    const absolute = join(REPOSITORY_ROOT, directory);
    const files: string[] = [];
    for (const entry of readdirSync(absolute)) {
        const path = join(absolute, entry);
        if (statSync(path).isDirectory()) {
            if (entry === '__tests__') continue;
            for (const nested of readdirSync(path)) {
                const nestedPath = join(path, nested);
                if (statSync(nestedPath).isFile() && nestedPath.endsWith('.ts')) files.push(nestedPath);
            }
            continue;
        }
        if (entry.endsWith('.ts')) files.push(path);
    }
    return files;
}

describe('plugin runtime independence from the Library link', () => {
    it('no runtime, gate or installation module imports the link service or its client', () => {
        const offenders: string[] = [];
        for (const directory of RUNTIME_DIRECTORIES) {
            for (const file of sourceFiles(directory)) {
                if (LIBRARY_DEPENDENCY.test(readFileSync(file, 'utf8'))) {
                    offenders.push(file.slice(REPOSITORY_ROOT.length));
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
