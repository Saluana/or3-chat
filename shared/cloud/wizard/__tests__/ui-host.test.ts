import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createWizardUiHost } from '../ui-host';

describe('isolated wizard UI host', () => {
    it('keeps target configuration and generated files away from the running UI', async () => {
        const source = await mkdtemp(resolve(tmpdir(), 'or3-wizard-source-'));
        let host: string | undefined;
        try {
            await mkdir(resolve(source, 'app/pages'), { recursive: true });
            await mkdir(resolve(source, 'node_modules/example-dependency'), { recursive: true });
            await mkdir(resolve(source, 'node_modules/.cache/vite'), { recursive: true });
            await mkdir(resolve(source, '.nuxt'), { recursive: true });
            await writeFile(resolve(source, 'package.json'), '{}');
            await writeFile(resolve(source, 'node_modules/example-dependency/index.js'), 'installed dependency');
            await writeFile(resolve(source, 'node_modules/.cache/vite/metadata.json'), 'target cache');
            await writeFile(resolve(source, 'app/pages/wizard.vue'), 'original wizard');
            await writeFile(resolve(source, '.env'), 'PRIVATE_PASSWORD=secret');
            await writeFile(resolve(source, '.or3-initial-credentials'), 'private login');
            await writeFile(resolve(source, 'or3.providers.generated.json'), '{"modules":["target-provider"]}');
            await writeFile(resolve(source, '.nuxt/nuxt.config.mjs'), 'target generated files');
            host = await createWizardUiHost(source);
            expect(host).not.toBe(source);
            expect(await readFile(resolve(host, 'node_modules/example-dependency/index.js'), 'utf8')).toBe('installed dependency');
            await mkdir(resolve(host, 'node_modules/.cache/vite'), { recursive: true });
            await writeFile(resolve(host, 'node_modules/.cache/vite/metadata.json'), 'wizard cache');
            expect(await readFile(resolve(source, 'node_modules/.cache/vite/metadata.json'), 'utf8')).toBe('target cache');
            for (const file of ['.env', '.or3-initial-credentials', 'or3.providers.generated.json', '.nuxt/nuxt.config.mjs']) {
                await expect(readFile(resolve(host, file), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
            }
            await writeFile(resolve(source, 'app/pages/wizard.vue'), 'changed by target setup');
            expect(await readFile(resolve(host, 'app/pages/wizard.vue'), 'utf8')).toBe('original wizard');
        } finally {
            if (host) await rm(host, { recursive: true, force: true });
            await rm(source, { recursive: true, force: true });
        }
    });
});
