import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkWritableDir,
    generatedFileContainsProvider,
    providerPackageInstalled,
} from '../../scripts/cli/or3-cloud-doctor';

describe('or3-cloud doctor helpers', () => {
    let cwd: string;

    beforeEach(async () => {
        cwd = await mkdtemp(join(tmpdir(), 'or3-doctor-'));
    });

    afterEach(async () => {
        await rm(cwd, { recursive: true, force: true });
    });

    it('treats local provider ids as always installed', () => {
        expect(providerPackageInstalled('memory', cwd)).toBe(true);
        expect(providerPackageInstalled('custom', cwd)).toBe(true);
    });

    it('detects installed provider packages under node_modules', async () => {
        await mkdir(join(cwd, 'node_modules', 'or3-provider-basic-auth'), {
            recursive: true,
        });
        expect(providerPackageInstalled('basic-auth', cwd)).toBe(true);
        expect(providerPackageInstalled('sqlite', cwd)).toBe(false);
    });

    it('checks generated providers file contents', async () => {
        await writeFile(
            join(cwd, 'or3.providers.generated.ts'),
            'export const or3ProviderModules = ["or3-provider-basic-auth/nuxt"];\n',
            'utf8'
        );
        expect(generatedFileContainsProvider('basic-auth', cwd)).toBe(true);
        expect(generatedFileContainsProvider('sqlite', cwd)).toBe(false);
    });

    it('checks parent writability for missing file paths', async () => {
        const dataDir = join(cwd, '.data');
        await mkdir(dataDir, { recursive: true });
        expect(checkWritableDir(join(dataDir, 'or3-sync.sqlite'))).toBe(true);
        expect(checkWritableDir(join(cwd, 'missing-parent', 'file.sqlite'))).toBe(
            false
        );
    });
});
