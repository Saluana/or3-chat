import type { EnrichedConfigEntry } from '~/composables/admin/useAdminTypes';

export type ConfigSource = 'site' | 'environment' | 'default' | 'enforced';
export type ProjectedConfigEntry = Omit<EnrichedConfigEntry, 'application'> & {
    application: EnrichedConfigEntry['application'] | 'migration';
    source: ConfigSource;
    lockedReason?: string;
};

/** Changing these moves canonical data; a restart alone would strand it. */
const MIGRATION_KEYS = new Set(['OR3_SYNC_PROVIDER', 'NUXT_PUBLIC_STORAGE_PROVIDER', 'OR3_STORAGE_PROVIDER', 'AUTH_PROVIDER', 'OR3_AUTH_PROVIDER']);
/** Hosted billing pins these at build time (see packages/hosted-billing/module.ts). */
const HOSTED_ENFORCED: Record<string, { value: string; reason: string }> = {
    OR3_OPENROUTER_REQUIRE_USER_KEY: { value: 'true', reason: 'Hosted billing requires customers to use their own AI provider keys.' },
    OR3_OPENROUTER_ALLOW_USER_OVERRIDE: { value: 'true', reason: 'Hosted billing requires customers to use their own AI provider keys.' },
    OR3_GUEST_ACCESS_ENABLED: { value: 'false', reason: 'Hosted billing requires signed-in accounts; guest access is disabled.' },
};

/**
 * Adds the effective source to each entry. An unset environment value is a
 * resolved default, not an override; enforced policy wins over both.
 */
export function projectConfigSources(entries: EnrichedConfigEntry[], context: {
    siteKeys: Set<string>; savedSite: Record<string, string>; activeSite: Record<string, string>; hostedBilling: boolean; effectiveValues?: Record<string, string>;
}): ProjectedConfigEntry[] {
    return entries.map((entry) => {
        const enforced = context.hostedBilling ? HOSTED_ENFORCED[entry.key] : undefined;
        if (enforced) return { ...entry, value: enforced.value, source: 'enforced' as const, editable: false, lockedReason: enforced.reason };
        const application = MIGRATION_KEYS.has(entry.key) ? 'migration' as const : entry.application;
        if (context.siteKeys.has(entry.key)) {
            const saved = context.savedSite[entry.key];
            return { ...entry, application, value: saved ?? context.activeSite[entry.key] ?? null, editable: true, source: saved !== undefined ? 'site' as const : 'default' as const };
        }
        return { ...entry, application, value: entry.masked ? entry.value : context.effectiveValues?.[entry.key] ?? entry.value, source: entry.value === null ? 'default' as const : 'environment' as const };
    });
}
