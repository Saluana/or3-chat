import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    inspectProductionHostEsmFacade,
    recordProductionHostEsmFacadeReport,
} from '../plugin-runtime/check-host-esm-facade';

function outputFixture(html: string, chunk = ''): string {
    const root = mkdtempSync(resolve(tmpdir(), 'or3-host-esm-facade-'));
    const publicRoot = resolve(root, 'public');
    mkdirSync(resolve(publicRoot, '_nuxt'), { recursive: true });
    writeFileSync(resolve(publicRoot, 'index.html'), html);
    writeFileSync(resolve(publicRoot, '_nuxt/app.js'), chunk);
    return root;
}

describe('production host ESM facade probe', () => {
    it('records the current no-facade production policy as rebuild-required', () => {
        const outputRoot = outputFixture('<script type="module" src="/_nuxt/app.js"></script>');
        const report = inspectProductionHostEsmFacade(outputRoot);
        expect(report.evidence).toEqual({
            generatedFacade: false,
            importMap: false,
            vueSingletonIdentity: false,
            sdkSingletonIdentity: false,
            vueReactivity: false,
            vueComponentRendering: false,
            cspCompatible: true,
        });
        expect(report.decision.status).toBe('rebuild-required');
        const reportPath = recordProductionHostEsmFacadeReport(outputRoot, report);
        expect(JSON.parse(readFileSync(reportPath, 'utf8'))).toEqual(report);
    });

    it('detects a partial facade/import map but never treats markers as behavior proof', () => {
        const outputRoot = outputFixture(
            '<script type="importmap">{"imports":{"vue":"/_nuxt/host.js"}}</script>',
            [
                'or3-plugin-host-esm-facade:v1',
                'or3-plugin-vue-host-singleton:v1',
                'or3-plugin-sdk-host-singleton:v2',
            ].join(' ')
        );
        const report = inspectProductionHostEsmFacade(outputRoot);
        expect(report.evidence).toMatchObject({
            generatedFacade: true,
            importMap: true,
            vueSingletonIdentity: false,
            sdkSingletonIdentity: false,
        });
        expect(report.declaredExternalMarkers).toEqual({ vue: true, sdk: true });
        expect(report.decision.status).toBe('rebuild-required');
    });

    it('reports CSP-unsafe execution in a candidate facade', () => {
        const outputRoot = outputFixture(
            '<script type="importmap">{}</script>',
            'or3-plugin-host-esm-facade:v1; new Function("return 1")'
        );
        const report = inspectProductionHostEsmFacade(outputRoot);
        expect(report.evidence.cspCompatible).toBe(false);
        expect(report.cspUnsafeFacadeFiles).toEqual(['public/_nuxt/app.js']);
        expect(report.decision).toMatchObject({
            status: 'rebuild-required',
            blockCodes: expect.arrayContaining(['csp-compatibility-unproven']),
        });
    });
});
