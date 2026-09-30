import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    checkWritableDir,
    providerPackageInstalled,
} from '../../scripts/cli/or3-cloud-doctor';
import { readProviderMetadata } from '../../shared/cloud/provider-metadata';
import { renderProviderModulesFile } from '../../shared/cloud/wizard/apply';

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
        await writeFile(
            join(cwd, 'node_modules/or3-provider-basic-auth/package.json'),
            JSON.stringify({
                name: 'or3-provider-basic-auth',
                exports: { './nuxt': { import: './module.mjs' } },
            }),
        );
        expect(providerPackageInstalled('basic-auth', cwd)).toBe(false);
        await writeFile(
            join(cwd, 'node_modules/or3-provider-basic-auth/module.mjs'),
            'export default () => {};',
        );
        expect(providerPackageInstalled('basic-auth', cwd)).toBe(true);
        expect(providerPackageInstalled('sqlite', cwd)).toBe(false);
    });

    it('round trips wizard JSON and preserves explicit legacy migration', async () => {
        expect(readProviderMetadata(cwd).modules).toEqual([]);
        const legacy = join(cwd, 'or3.providers.generated.ts');
        await writeFile(
            legacy,
            'throw new Error("legacy must never execute");',
        );
        expect(() => readProviderMetadata(cwd)).toThrow(/migrat/i);
        await writeFile(
            join(cwd, 'or3.providers.generated.json'),
            renderProviderModulesFile([
                '@vendor/provider/nuxt',
                '@vendor/provider/nuxt',
            ]),
        );
        expect(readProviderMetadata(cwd)).toEqual({
            modules: ['@vendor/provider/nuxt'],
            warnings: [expect.stringMatching(/ignored/)],
        });
        for (const contents of [
            '{broken',
            '{"schemaVersion":2,"modules":[]}',
            '{"schemaVersion":1,"modules":[12]}',
        ]) {
            await writeFile(
                join(cwd, 'or3.providers.generated.json'),
                contents,
            );
            expect(() => readProviderMetadata(cwd)).toThrow(
                /provider metadata/i,
            );
        }
    });

    it('checks parent writability for missing file paths', async () => {
        const dataDir = join(cwd, '.data');
        await mkdir(dataDir, { recursive: true });
        expect(checkWritableDir(join(dataDir, 'or3-sync.sqlite'))).toBe(true);
        expect(
            checkWritableDir(join(cwd, 'missing-parent', 'file.sqlite')),
        ).toBe(false);
    });
});
