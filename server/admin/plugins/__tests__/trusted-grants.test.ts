import { describe, expect, it } from 'vitest';
import { verifyPluginV2Compatibility } from '../../../../shared/plugins/v2-compatibility';
import { OR3_PLUGIN_V2_HOST_CAPABILITIES } from '../v2-host-capabilities';

function manifest(trust: 'trusted-host' | 'isolated-client', requestedGrants: string[]) {
    return {
        id: 'fixture.plugin',
        engines: { or3: '>=0.2.0', pluginApi: '^2.0.0' },
        requestedGrants,
        features: { required: [], optional: [] },
        dependencies: { required: [], optional: [] },
        trust,
    };
}

describe('trusted tier grant qualification', () => {
    it('accepts a trusted plugin grant and refuses it for an isolated package', () => {
        const trusted = verifyPluginV2Compatibility({
            manifest: manifest('trusted-host', ['ui.sidebar.register']),
            host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
            dependencies: [],
        });
        expect(trusted.status).toBe('compatible');

        const isolated = verifyPluginV2Compatibility({
            manifest: manifest('isolated-client', ['ui.sidebar.register']),
            host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
            dependencies: [],
        });
        expect(isolated.status).toBe('blocked');
        if (isolated.status === 'blocked') {
            expect(isolated.reasons.map((reason) => reason.code)).toContain('unsupported-grant');
            expect(isolated.reasons[0]?.message).toContain('ui.sidebar.register');
        }
    });

    it('refuses a grant that is still unqualified', () => {
        const result = verifyPluginV2Compatibility({
            manifest: manifest('trusted-host', ['ui.toast']),
            host: OR3_PLUGIN_V2_HOST_CAPABILITIES,
            dependencies: [],
        });
        expect(result.status).toBe('blocked');
        if (result.status === 'blocked') {
            expect(result.reasons.map((reason) => reason.code)).toEqual(['unsupported-grant']);
        }
    });
});
