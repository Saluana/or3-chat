import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { resolveQualificationProvider } from '../test/workspace-cloud-providers';

// Qualification must not substitute a sibling for installed bytes, accept a
// linked checkout or a mismatched pin, or label development overlays installed.
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture() {
    const root = await mkdtemp(join(tmpdir(), 'or3-provider-qualification-')); roots.push(root);
    const app = join(root, 'app'); const installed = join(app, 'node_modules/or3-provider-sqlite');
    const sibling = join(root, 'or3-provider-sqlite');
    await mkdir(installed, { recursive: true }); await mkdir(sibling);
    await writeFile(join(app, 'package.json'), JSON.stringify({ dependencies: { 'or3-provider-sqlite': '0.0.14' } }));
    await writeFile(join(installed, 'package.json'), JSON.stringify({ name: 'or3-provider-sqlite', version: '0.0.14' }));
    await writeFile(join(installed, 'contract.json'), JSON.stringify({ ownership: false }));
    await writeFile(join(sibling, 'package.json'), JSON.stringify({ name: 'or3-provider-sqlite', version: '0.0.13' }));
    await writeFile(join(sibling, 'contract.json'), JSON.stringify({ ownership: true }));
    return { app, installed, sibling };
}
describe('installed cloud qualification', () => {
    it('uses the pinned installed bytes even when a development source environment is set', async () => {
        const { app, installed, sibling } = await fixture();
        const result = await resolveQualificationProvider(app, 'or3-provider-sqlite', false, { OR3_PROJECT_SQLITE_SOURCE: sibling });
        expect(result).toMatchObject({ path: installed, version: '0.0.14', mode: 'installed' });
        expect(JSON.parse(await readFile(join(result.path, 'contract.json'), 'utf8'))).toEqual({ ownership: false });
    });
    it('labels explicitly selected development bytes separately', async () => {
        const { app, sibling } = await fixture();
        const result = await resolveQualificationProvider(app, 'or3-provider-sqlite', true, { OR3_PROJECT_SQLITE_SOURCE: sibling });
        expect(result).toMatchObject({ path: sibling, version: '0.0.13', mode: 'development-source' });
        expect(JSON.parse(await readFile(join(result.path, 'contract.json'), 'utf8'))).toEqual({ ownership: true });
    });
    it.each(['linked-source', 'wrong-version', 'wrong-name'] as const)('rejects false installed qualification (%s)', async kind => {
        const { app, installed, sibling } = await fixture();
        if (kind === 'linked-source') { await rm(installed, { recursive: true }); await symlink(sibling, installed); }
        else await writeFile(join(installed, 'package.json'), JSON.stringify({ name: kind === 'wrong-name' ? 'wrong-provider' : 'or3-provider-sqlite', version: kind === 'wrong-version' ? '0.0.13' : '0.0.14' }));
        await expect(resolveQualificationProvider(app, 'or3-provider-sqlite', false, {})).rejects.toThrow(/installed|pin|package/i);
    });
});
