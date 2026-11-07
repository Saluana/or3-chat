import { describe, expect, it } from 'vitest';
import { ENV_KEY_CONTRACT } from '../../../../shared/cloud/env-contract';
import { projectConfigSources } from '../config-projection';

/*
 * Failure inventory (task 9.1):
 * - an unset environment value must read as "default", not as an empty/overriding value;
 * - a saved site setting must report its saved value and the "site" source;
 * - hosted billing must show BYOK requirements and no-guest access as enforced and locked,
 *   even when the environment says otherwise;
 * - provider switches must be classified as needing a migration, never as a simple restart;
 * - secrets stay masked.
 */
const entry = (key: string, value: string | null, extra: Record<string, unknown> = {}) => ({
    key, value, masked: false, label: key, description: '', group: 'Auth' as const, order: 0, valueType: 'string' as const, application: 'unsupported' as const, editable: false, ...extra,
});

describe('configuration source projection', () => {
    it('labels defaults, saved site values and enforced hosted policy', () => {
        const projected = projectConfigSources([
            entry('OR3_BACKGROUND_MAX_JOBS', null),
            entry('OR3_SITE_NAME', null, { application: 'runtime' }),
            entry('OR3_OPENROUTER_REQUIRE_USER_KEY', 'false'),
            entry('OR3_GUEST_ACCESS_ENABLED', 'true'),
            entry('OR3_SYNC_PROVIDER', 'sqlite'),
            entry('OR3_OPENROUTER_API_KEY', '******', { masked: true }),
        ], { siteKeys: new Set(['OR3_SITE_NAME']), savedSite: { OR3_SITE_NAME: 'Acme' }, activeSite: { OR3_SITE_NAME: 'OR3' }, hostedBilling: true });
        const byKey = Object.fromEntries(projected.map(item => [item.key, item]));
        expect(byKey.OR3_BACKGROUND_MAX_JOBS).toMatchObject({ source: 'default', value: null });
        expect(byKey.OR3_SITE_NAME).toMatchObject({ source: 'site', value: 'Acme', editable: true });
        expect(byKey.OR3_OPENROUTER_REQUIRE_USER_KEY).toMatchObject({ source: 'enforced', value: 'true', editable: false });
        expect(byKey.OR3_OPENROUTER_REQUIRE_USER_KEY?.lockedReason).toMatch(/hosted billing/i);
        expect(byKey.OR3_GUEST_ACCESS_ENABLED).toMatchObject({ source: 'enforced', value: 'false' });
        expect(byKey.OR3_SYNC_PROVIDER).toMatchObject({ application: 'migration', source: 'environment' });
        expect(byKey.OR3_OPENROUTER_API_KEY).toMatchObject({ value: '******', masked: true });
    });

    it('uses resolved consumer values for resource defaults and never unmasks secrets', () => {
        const projected = projectConfigSources([entry('OR3_BACKGROUND_MAX_JOBS', null), entry('OR3_OPENROUTER_REQUIRE_USER_KEY', null), entry('OPENROUTER_API_KEY', '******', { masked: true })], {
            siteKeys: new Set(), savedSite: {}, activeSite: {}, hostedBilling: false,
            effectiveValues: { OR3_BACKGROUND_MAX_JOBS: '20', OR3_OPENROUTER_REQUIRE_USER_KEY: 'false', OPENROUTER_API_KEY: 'must-not-appear' },
        });
        expect(projected[0]).toMatchObject({ source: 'default', value: '20' });
        expect(projected[1]).toMatchObject({ source: 'default', value: 'false' });
        expect(projected[2]).toMatchObject({ masked: true, value: '******' });
    });

    it('treats the require-personal-key policy as public boolean metadata while masking credentials', () => {
        expect(ENV_KEY_CONTRACT.OR3_OPENROUTER_REQUIRE_USER_KEY?.secret).toBe(false);
        expect(ENV_KEY_CONTRACT.OPENROUTER_API_KEY?.secret).toBe(true);
    });

    it('leaves ordinary deployments unenforced', () => {
        const [item] = projectConfigSources([entry('OR3_OPENROUTER_REQUIRE_USER_KEY', 'false')], { siteKeys: new Set(), savedSite: {}, activeSite: {}, hostedBilling: false });
        expect(item).toMatchObject({ source: 'environment', value: 'false' });
    });
});
