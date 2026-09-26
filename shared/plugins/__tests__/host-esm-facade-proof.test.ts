import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileTemplate } from 'vue/compiler-sfc';
import { describe, expect, it, vi } from 'vitest';
import * as Sdk from '@or3/plugin-sdk';
import * as Vue from 'vue';
import { createApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import {
    applyHostEsmFacadeBehaviorProof,
    decideTrustedHostUi,
    hostEsmFacadeImportMapScript,
    HOST_ESM_FACADE_IMPORTS,
    importMapPrecedesModuleScripts,
} from '../host-esm-facade';
import {
    createProductionModuleV2Loader,
    publishTrustedHostUiEvidence,
} from '../host-esm-facade-runtime';
import { proveHostEsmFacadeBehavior } from '../host-esm-facade-proof';
import {
    inspectProductionHostEsmFacade,
} from '../../../scripts/plugin-runtime/check-host-esm-facade';
import { ModuleV2Loader } from '../module-v2-loader';
import type { PackageV2PluginDescriptor } from '../runtime-descriptor';

const repoRoot = resolve(import.meta.dirname, '../../..');
const vueFacadeUrl = pathToFileURL(resolve(repoRoot, 'public/_plugins/host-vue.mjs')).href;
const sdkFacadeUrl = pathToFileURL(resolve(repoRoot, 'public/_plugins/host-sdk.mjs')).href;

type HostAbiGlobal = typeof globalThis & {
    __or3HostAbi?: { vue: typeof Vue; sdk: typeof Sdk };
};

function installHostAbi(): void {
    (globalThis as HostAbiGlobal).__or3HostAbi = Object.freeze({
        vue: Vue,
        sdk: Sdk,
    });
}

function outputWithRealFacades(): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-host-esm-proof-'));
    const publicRoot = resolve(root, 'public/_plugins');
    mkdirSync(publicRoot, { recursive: true });
        writeFileSync(
        resolve(root, 'public/index.html'),
        `<script type="importmap">${hostEsmFacadeImportMapScript().innerHTML}</script><script type="module" src="/_nuxt/entry.js"></script>`
    );
    writeFileSync(
        resolve(publicRoot, 'host-vue.mjs'),
        readFileSync(resolve(repoRoot, 'public/_plugins/host-vue.mjs'), 'utf8')
    );
    writeFileSync(
        resolve(publicRoot, 'host-sdk.mjs'),
        readFileSync(resolve(repoRoot, 'public/_plugins/host-sdk.mjs'), 'utf8')
    );
    return root;
}

function descriptor(): PackageV2PluginDescriptor {
    const digest = `sha256-${'a'.repeat(64)}` as `sha256-${string}`;
    return {
        id: 'sample.plugin',
        name: 'Sample Plugin',
        effectiveGrants: [],
        version: '1.0.0',
        pluginApiVersion: '2.0.0',
        workspaceId: 'ws-1',
        policyRevision: 'policy-1',
        grantsRevision: 'grants-1',
        resolvedDependencyKeys: [],
        descriptorKey: `sha256-${'b'.repeat(64)}` as `sha256-${string}`,
        manifestVersion: 2,
        source: 'package',
        trust: 'trusted-host',
        artifact: {
            kind: 'package-v2',
            packageDigest: digest,
            clientEntry: 'client.mjs',
            serverRoutes: [],
        },
    };
}

describe('trusted-host Vue ABI proof', () => {
    it('emits an import map onto the host facade files', () => {
        const script = hostEsmFacadeImportMapScript();
        expect(script.type).toBe('importmap');
        expect(script.tagPriority).toBe('critical');
        expect(JSON.parse(script.innerHTML).imports).toEqual(HOST_ESM_FACADE_IMPORTS);
        const html = `<script type="importmap">${script.innerHTML}</script><script type="module" src="/app.js"></script>`;
        expect(importMapPrecedesModuleScripts(html)).toBe(true);
        expect(importMapPrecedesModuleScripts(`<script type="module" src="/app.js"></script>${html}`)).toBe(false);
        const vueSource = readFileSync(resolve(repoRoot, 'public/_plugins/host-vue.mjs'), 'utf8');
        const sdkSource = readFileSync(resolve(repoRoot, 'public/_plugins/host-sdk.mjs'), 'utf8');
        for (const name of Object.keys(Vue)) {
            if (name === 'default' || name === '__esModule' || !/^[A-Za-z_$][\w$]*$/.test(name)) continue;
            expect(vueSource).toContain(`    ${name},`);
        }
        expect(vueSource).toContain('or3-plugin-host-esm-facade:v1');
        expect(vueSource).not.toMatch(/\beval\s*\(|\bnew\s+Function\b/);
        expect(sdkSource).toContain('or3-plugin-sdk-host-singleton:v2');
        expect(sdkSource).not.toMatch(/\beval\s*\(|\bnew\s+Function\b/);
    });

    it('proves plugin vue and sdk imports are the host singletons and supports the kill gate', async () => {
        installHostAbi();
        const vueFacade = await import(/* @vite-ignore */ vueFacadeUrl);
        const sdkFacade = await import(/* @vite-ignore */ sdkFacadeUrl);
        const proof = await proveHostEsmFacadeBehavior({
            hostVue: Vue,
            hostSdk: Sdk,
            vueFacade,
            sdkFacade,
        });
        expect(proof).toEqual({
            vueSingletonIdentity: true,
            sdkSingletonIdentity: true,
            vueReactivity: true,
            vueComponentRendering: true,
        });

        const inspected = inspectProductionHostEsmFacade(outputWithRealFacades());
        const evidence = applyHostEsmFacadeBehaviorProof(inspected.evidence, proof);
        expect(decideTrustedHostUi(evidence)).toEqual({
            status: 'supported',
            loader: 'module-v2',
            blockCodes: [],
            postBuildAlternative: null,
        });
        expect(vueFacade.ref).toBe(Vue.ref);
        expect(vueFacade.openBlock).toBe(Vue.openBlock);
        expect(sdkFacade.defineOr3Plugin).toBe(Sdk.defineOr3Plugin);

        const compiled = compileTemplate({
            source: '<p id="or3-host-abi-proof">{{ label }}</p>',
            filename: 'AbiProof.vue',
            id: 'abi-proof',
        });
        expect(compiled.errors).toEqual([]);
        const modulePath = resolve(mkdtempSync(resolve(tmpdir(), 'or3-compiled-sfc-')), 'abi-proof.mjs');
        writeFileSync(
            modulePath,
            compiled.code.replace('from "vue"', `from ${JSON.stringify(vueFacadeUrl)}`)
        );
        const rendered = (await import(/* @vite-ignore */ pathToFileURL(modulePath).href)) as {
            render: (ctx: { label: string }) => unknown;
        };
        const html = await renderToString(
            createApp({
                render() {
                    return rendered.render({ label: 'host-vue-proof' });
                },
            })
        );
        expect(html).toContain('id="or3-host-abi-proof"');
        expect(html).toContain('host-vue-proof');

        const published = publishTrustedHostUiEvidence(evidence);
        const loader = createProductionModuleV2Loader({
            assetUrl: () => '/api/plugins/packages/sample.plugin/client.mjs',
            hostExternals: { vue: Vue, '@or3/plugin-sdk': Sdk },
            importModule: vi.fn(async () => ({ ok: true })),
        });
        expect(published.status).toBe('supported');
        expect(
            loader.resolve({
                descriptor: descriptor(),
                generation: 1,
                signal: new AbortController().signal,
                isGenerationCurrent: () => true,
                requiresTrustedHostUi: true,
            }).status
        ).toBe('ready');
    });

    it('refuses trusted Vue mount and reports the failed proof without loading another Vue', () => {
        const hostVue = { id: 'host-vue-singleton' };
        const importModule = vi.fn(async () => ({ bundledVue: { id: 'second-vue' } }));
        const evidence = applyHostEsmFacadeBehaviorProof(
            {
                generatedFacade: true,
                importMap: true,
                vueSingletonIdentity: false,
                sdkSingletonIdentity: false,
                vueReactivity: false,
                vueComponentRendering: false,
                cspCompatible: true,
            },
            {
                vueSingletonIdentity: true,
                sdkSingletonIdentity: true,
                vueReactivity: true,
                vueComponentRendering: false,
            }
        );
        const decision = decideTrustedHostUi(evidence);
        expect(decision.status).toBe('rebuild-required');
        expect(decision.loader).toBeNull();
        expect(decision.blockCodes).toEqual(['vue-component-rendering-unproven']);
        expect(decision.postBuildAlternative).toBe('isolated-client-or-declarative-ui');

        const loader = new ModuleV2Loader({
            assetUrl: () => '/api/plugins/packages/sample.plugin/entry.mjs',
            hostExternals: {
                '@or3/plugin-sdk': Sdk,
                vue: hostVue,
            },
            importModule,
            trustedHostUi: decision,
        });
        expect(
            loader.resolve({
                descriptor: descriptor(),
                generation: 1,
                signal: new AbortController().signal,
                isGenerationCurrent: () => true,
                requiresTrustedHostUi: true,
            })
        ).toMatchObject({
            status: 'rebuild-required',
            code: 'trusted-host-ui-abi-unproven',
            blockCodes: ['vue-component-rendering-unproven'],
        });
        expect(importModule).not.toHaveBeenCalled();
        expect(loader.resolveHostExternal('vue')).toBe(hostVue);
    });
});
