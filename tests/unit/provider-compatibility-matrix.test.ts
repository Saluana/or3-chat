import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    PROVIDER_PACKAGE_CONTRACTS,
    SUPPORTED_PROVIDER_STACKS,
    providerModuleIdsForStack,
} from '~~/shared/cloud/provider-compatibility';
import {
    AUTH_PROVIDER_ID_LIST,
    STORAGE_PROVIDER_ID_LIST,
    SYNC_PROVIDER_ID_LIST,
} from '~~/shared/cloud/provider-ids';

const root = resolve(import.meta.dirname, '../..');
const rootManifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
};
const dependencySpecs = {
    ...rootManifest.dependencies,
    ...rootManifest.devDependencies,
};

function readProviderManifest(packageName: string) {
    const path = resolve(root, 'node_modules', packageName, 'package.json');
    expect(existsSync(path), `${packageName} must be installed`).toBe(true);
    return {
        path,
        manifest: JSON.parse(readFileSync(path, 'utf8')) as {
            name?: string;
            exports?: Record<string, string | { import?: string }>;
        },
    };
}

describe('installed provider package contract', () => {
    it.each(Object.values(PROVIDER_PACKAGE_CONTRACTS))(
        '$packageName loads its exported Nuxt module implementation',
        async ({ packageName }) => {
            const spec = dependencySpecs[packageName];
            expect(spec).toBeTruthy();
            const { path, manifest } = readProviderManifest(packageName);
            expect(manifest.name).toBe(packageName);
            const nuxtExport = manifest.exports?.['./nuxt'];
            const target = typeof nuxtExport === 'string'
                ? nuxtExport
                : nuxtExport?.import;
            expect(target).toBeTruthy();
            expect(existsSync(resolve(path, '..', target!))).toBe(true);

            const moduleId = `${packageName}/nuxt`;
            const implementation = await import(/* @vite-ignore */ moduleId);
            expect(implementation.default).toBeTypeOf('function');
        },
    );
});

describe('provider stack contract parity', () => {
    it('keeps canonical provider ID lists aligned with shipped contracts', () => {
        for (const [id, contract] of Object.entries(PROVIDER_PACKAGE_CONTRACTS)) {
            if (contract.roles.includes('auth')) {
                expect(AUTH_PROVIDER_ID_LIST).toContain(id);
            }
            if (contract.roles.includes('sync')) {
                expect(SYNC_PROVIDER_ID_LIST).toContain(id);
            }
            if (contract.roles.includes('storage')) {
                expect(STORAGE_PROVIDER_ID_LIST).toContain(id);
            }
        }
    });

    it.each(SUPPORTED_PROVIDER_STACKS)(
        '$id resolves every selected role to an installed, role-compatible module',
        (stack) => {
            const selections = [
                ['auth', stack.auth],
                ['sync', stack.sync],
                ['storage', stack.storage],
            ] as const;
            for (const [role, id] of selections) {
                if (!id) continue;
                const contract = PROVIDER_PACKAGE_CONTRACTS[id];
                expect(contract, `${stack.id} has unknown ${role} provider ${id}`).toBeDefined();
                expect(contract!.roles).toContain(role);
                readProviderManifest(contract!.packageName);
            }

            const modules = providerModuleIdsForStack(stack);
            expect(new Set(modules).size).toBe(modules.length);
            for (const moduleId of modules) {
                expect(moduleId).toMatch(/^or3-provider-[a-z0-9-]+\/nuxt$/);
            }
        },
    );
});
