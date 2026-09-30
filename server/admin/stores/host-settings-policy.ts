/**
 * @module server/admin/stores/host-settings-policy
 *
 * Purpose:
 * Classifies workspace host-setting keys for migration off a provider's old
 * client-writable settings namespace (Convex `kv`). OR3 keeps this policy in
 * the host so providers stay storage primitives.
 *
 * Migration classes:
 * - `authority`: security-authoritative keys. Old values were writable by
 *   ordinary workspace sync, so they are NEVER copied. Fresh values must be
 *   written through a trusted host path, and plugin consent requires fresh
 *   approval when no current review exists.
 * - `spend-ledger`: the plugin AI budget. The exact legacy record is copied so
 *   an upgrade cannot reset spend or reservations inside an active window.
 *   Corruption still fails closed because the ledger parser rejects it.
 * - `user-data`: setup values a user saved. Copied as-is; they convey no
 *   authority.
 * - `unknown`: anything else fails closed and is not copied. Unknown values in
 *   a client-writable namespace must never become trusted by default.
 *
 * Security-authoritative key families:
 * - `admin.guest_access.enabled` (guest/public access enforcement)
 * - `plugins.enabled` (marketplace plugin enablement)
 * - `plugins.grants.*` (per-plugin authority consent reviews)
 * - `plugins.settings.*` (plugin settings documents; contain the access gate
 *   policy consumed by `readPluginAccessPolicy`)
 * - `plugins.stateVersion.*` (plugin settings migration state)
 *
 * Enforcement/ledger key family:
 * - `plugins.ai-budget.*` (durable spend reservations)
 *
 * User-data key family (exact formats only):
 * - `plugin:<id>:setup-values`
 * - `plugin:<id>:setup-values.<packageDigest>`
 * - `plugin:<id>:setup-values.<packageDigest>.operation.<operationId>`
 *
 * Any other `plugin:` key is `unknown` and never migrates.
 */

export type HostSettingKeyClass =
    | 'authority'
    | 'spend-ledger'
    | 'user-data'
    | 'unknown';

const AUTHORITY_KEYS: ReadonlySet<string> = new Set([
    'admin.guest_access.enabled',
    'plugins.enabled',
]);

const AUTHORITY_PREFIXES: readonly string[] = [
    'plugins.grants.',
    'plugins.settings.',
    'plugins.stateVersion.',
];

const SPEND_LEDGER_PREFIXES: readonly string[] = ['plugins.ai-budget.'];

/**
 * Mirrors the reserved-key guard in the Convex sync template. Only the
 * supported setup-value formats migrate; an unrecognized `plugin:` key must
 * fail closed like any other unknown key.
 */
const SETUP_VALUES_KEY_PATTERN = /^plugin:[^:]+:setup-values(?:\..+)?$/;

/** Returns the migration class for one workspace host-setting key. */
export function classifyHostSettingKey(key: string): HostSettingKeyClass {
    if (
        AUTHORITY_KEYS.has(key) ||
        AUTHORITY_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
        return 'authority';
    }
    if (SPEND_LEDGER_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        return 'spend-ledger';
    }
    if (SETUP_VALUES_KEY_PATTERN.test(key)) {
        return 'user-data';
    }
    return 'unknown';
}

/**
 * Whether a legacy value for this key may be copied into the private settings
 * store. Authority and unknown keys fail closed.
 */
export function mayMigrateLegacyHostSetting(key: string): boolean {
    const classification = classifyHostSettingKey(key);
    return classification === 'spend-ledger' || classification === 'user-data';
}
