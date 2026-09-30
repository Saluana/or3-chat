import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SitePluginPolicyStore } from '../site-policy';
import { approvedCatalogPage, isSiteReleaseStillApproved } from '../site-policy-service';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function store() {
    const root = await mkdtemp(join(tmpdir(), 'or3-site-policy-'));
    roots.push(root);
    return { root, policy: new SitePluginPolicyStore(root) };
}

const release = {
    releaseId: 'rel_test', version: '1.0.0', packageTreeSha256: `sha256-${'a'.repeat(64)}`,
    authoritySha256: `sha256-${'b'.repeat(64)}`,
    display: { name: 'Test plugin', summary: 'A test', publisherName: 'Test publisher', category: 'automation', tags: ['automation'] },
};

describe('site policy persistence', () => {
    it('keeps hidden approval hidden across a new store and rejects a stale revision', async () => {
        const { root, policy } = await store();
        const approved = await policy.save('acme.test', 0, { catalogVisible: true, approvedRelease: release, futureDefault: null }, 'admin-a');
        const hidden = await policy.save('acme.test', approved.revision, { catalogVisible: false, approvedRelease: release, futureDefault: null }, 'admin-b');
        expect(hidden.revision).toBe(2);
        expect((await new SitePluginPolicyStore(root).read('acme.test'))?.catalogVisible).toBe(false);
        await expect(policy.save('acme.test', approved.revision, { catalogVisible: true, approvedRelease: release, futureDefault: null }, 'admin-a')).rejects.toMatchObject({ code: 'policy-conflict' });
        expect(await policy.seedIfAbsent('acme.test', release)).toBe(false);
        expect((await policy.read('acme.test'))?.catalogVisible).toBe(false);
    });

    it('fails closed for corrupt policy files', async () => {
        const { root, policy } = await store();
        await mkdir(join(root, '.plugin-admin'));
        await writeFile(join(root, '.plugin-admin', 'acme.test.json'), '{broken');
        await expect(policy.read('acme.test')).rejects.toMatchObject({ code: 'policy-invalid' });
    });

    it('filters approved entries before counting and paginating', async () => {
        const { policy } = await store();
        await policy.save('acme.one', 0, { catalogVisible: true, approvedRelease: { ...release, display: { ...release.display, name: 'Visible One' } }, futureDefault: null }, 'admin');
        await policy.save('acme.two', 0, { catalogVisible: false, approvedRelease: { ...release, display: { ...release.display, name: 'Hidden Two' } }, futureDefault: null }, 'admin');
        await policy.save('acme.three', 0, { catalogVisible: true, approvedRelease: { ...release, display: { ...release.display, name: 'Visible Three' } }, futureDefault: null }, 'admin');
        expect((await approvedCatalogPage(policy, new URLSearchParams('page=1&pageSize=1'))).total).toBe(2);
        expect((await approvedCatalogPage(policy, new URLSearchParams('page=2&pageSize=1'))).items).toHaveLength(1);
        expect((await approvedCatalogPage(policy, new URLSearchParams('search=Hidden'))).total).toBe(0);
    });

    it('binds approval to the exact release and rejects it after hide', async () => {
        const { policy } = await store();
        const approved = await policy.save('acme.test', 0, { catalogVisible: true, approvedRelease: release, futureDefault: null }, 'admin');
        expect(await isSiteReleaseStillApproved('acme.test', release, policy)).toBe(true);
        expect(await isSiteReleaseStillApproved('acme.test', { ...release, version: '2.0.0' }, policy)).toBe(false);
        await policy.save('acme.test', approved.revision, { catalogVisible: false, approvedRelease: release, futureDefault: null }, 'admin');
        expect(await isSiteReleaseStillApproved('acme.test', release, policy)).toBe(false);
    });
});
