/* @vitest-environment node */
import { describe, it, expect, afterEach } from 'vitest';
import { zipSync } from 'fflate';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { installExtensionFromZip } from '../install';
import { EXTENSIONS_BASE_DIR } from '../paths';

function makeZip(entries: Record<string, string>): Buffer {
    const data: Record<string, Uint8Array> = {};
    for (const [key, value] of Object.entries(entries)) {
        data[key] = Buffer.from(value, 'utf8');
    }
    return Buffer.from(zipSync(data));
}

async function cleanup(id: string) {
    await fs.rm(join(EXTENSIONS_BASE_DIR, 'plugins', id), { recursive: true, force: true });
    await fs.rm(join(EXTENSIONS_BASE_DIR, '.tmp'), { recursive: true, force: true });
}

describe('installExtensionFromZip', () => {
    afterEach(async () => {
        await cleanup('test-plugin');
    });

    it('rejects missing manifest', async () => {
        const zip = makeZip({ 'index.js': 'console.log("hi")' });
        await expect(installExtensionFromZip(zip, false)).rejects.toThrow(
            'Missing or3.manifest.json'
        );
    });

    it('rejects invalid manifest', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({ id: 'x' }),
            'index.js': 'console.log("hi")',
        });
        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
    });

    it('rejects unsafe manifest ids', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: '../evil',
                name: 'Bad',
                version: '0.0.1',
                capabilities: [],
            }),
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid manifest');
    });

    it('blocks zip slip paths', async () => {
        const zip = makeZip({
            'or3.manifest.json': JSON.stringify({
                kind: 'plugin',
                id: 'test-plugin',
                name: 'Test',
                version: '0.0.1',
                capabilities: [],
            }),
            '../evil.txt': 'nope',
        });

        await expect(installExtensionFromZip(zip, false)).rejects.toThrow('Invalid archive path');
    });
});
