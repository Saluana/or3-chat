/**
 * @module server/admin/config/config-manager.ts
 *
 * Purpose:
 * Orchestrates high-level configuration management by integrating low-level
 * environment variable persistence with human-readable schema metadata.
 *
 * Responsibilities:
 * - Gating configuration access via a strict WHITELIST.
 * - Protecting sensitive data via the shared environment-key contract.
 * - Providing enriched data structures for the Admin Dashboard Settings UI.
 * - Coordinating updates across persistence (`env-file.ts`) and validation (`resolve-config.ts`).
 *
 * Architecture:
 * This is the primary entry point for the Admin API. It ensures that changes
 * made by administrators are validated against the current system's capabilities
 * before being committed to the `.env` file.
 *
 * Non-goals:
 * - Does not handle direct file system operations (delegated to env-file.ts).
 * - Does not manage runtime process environment (handled by process manager/host).
 */
import { readEnvFile, writeEnvFile } from './env-file';
import {
    validateEnvConfig,
} from './resolve-config';
import {
    getConfigMetadata,
    type EnrichedConfigEntry,
} from './config-metadata';
import {
    ADMIN_WRITABLE_ENV_KEYS,
    ENV_KEY_CONTRACT,
} from '../../../shared/cloud/env-contract';

/**
 * Set of configuration keys that are permitted to be read/written by the admin API.
 *
 * Purpose:
 * Provides a security boundary by ensuring that internal-only or highly sensitive
 * server settings are never accidentally exposed or modified via the UI.
 */
const WHITELIST = new Set(ADMIN_WRITABLE_ENV_KEYS);

/**
 * Identifies sensitive configuration keys that should be masked.
 *
 * Behavior:
 * Keys containing 'SECRET', 'KEY', 'TOKEN', or 'PASSWORD' are automatically replaced
 * with a placeholder ('******') when read, preventing their exposure in API logs
 * or non-secure UI fields.
 */
function isSecretConfigKey(key: string): boolean {
    return ENV_KEY_CONTRACT[key]?.secret ?? /(SECRET|KEY|TOKEN|PASSWORD)/i.test(key);
}

/**
 * A basic configuration entry.
 */
export type ConfigEntry = {
    /** The configuration key (e.g., 'SSR_AUTH_ENABLED') */
    key: string;
    /** The configuration value (masked if secret) */
    value: string | null;
    /** Whether the value has been masked for security */
    masked: boolean;
};

/**
 * Reads all whitelisted configuration entries from the .env file.
 *
 * Behavior:
 * 1. Fetches current variables from `readEnvFile()`.
 * 2. Filters entries using the `WHITELIST`.
 * 3. Applies masking to keys matching `SECRET_PATTERN`.
 */
export async function readConfigEntries(): Promise<ConfigEntry[]> {
    const { map } = await readEnvFile();
    return Array.from(WHITELIST).map((key) => {
        const value = map[key] ?? null;
        const masked = value !== null && isSecretConfigKey(key);
        return { key, value: masked ? '******' : value, masked };
    });
}

const DEFAULT_CONFIG_GROUP = 'External Services' as const;
const DEFAULT_CONFIG_ORDER = 999;

/**
 * Reads all whitelisted configuration entries and augments them with metadata.
 *
 * Purpose:
 * Provides the data for the Settings page in the Admin Dashboard.
 *
 * Behavior:
 * Iterates through the WHITELIST and joins each entry with its corresponding
 * schema information from `config-metadata.ts`.
 */
export async function readEnrichedConfigEntries(): Promise<EnrichedConfigEntry[]> {
    const { map } = await readEnvFile();
    return Array.from(WHITELIST).map((key) => {
        const value = map[key] ?? null;
        const masked = value !== null && isSecretConfigKey(key);
        const metadata = getConfigMetadata(key);
        return {
            key,
            value: masked ? '******' : value,
            masked,
            label: metadata?.label ?? key,
            description: metadata?.description ?? '',
            group: metadata?.group ?? DEFAULT_CONFIG_GROUP,
            order: metadata?.order ?? DEFAULT_CONFIG_ORDER,
            valueType: metadata?.valueType ?? 'string',
        };
    });
}

/**
 * Updates multiple configuration entries simultaneously.
 *
 * Behavior:
 * 1. Validates every key against the WHITELIST.
 * 2. Skips updates where the value is the masking placeholder ('******').
 * 3. Interprets empty strings as a request to unset (delete) the key.
 * 4. Runs a "dry-build" of the refined configuration objects to ensure validity.
 * 5. Commits changes to the `.env` file via `writeEnvFile()`.
 *
 * @param updates - An array of key-value pairs to update.
 * @throws Error if any key is not in the whitelist.
 */
export async function writeConfigEntries(
    updates: Array<{ key: string; value: string | null }>
): Promise<void> {
    const { map } = await readEnvFile();

    const updateMap: Record<string, string | null> = {};
    for (const update of updates) {
        if (!WHITELIST.has(update.key)) {
            throw new Error(`Key not allowed: ${update.key}`);
        }
        if (update.value === '******') {
            continue;
        }
        if (update.value === '') {
            updateMap[update.key] = null;
            continue;
        }
        updateMap[update.key] = update.value;
    }

    const nextEnv: Record<string, string | undefined> = { ...map };
    for (const [key, value] of Object.entries(updateMap)) {
        if (value === null) {
            delete nextEnv[key];
        } else {
            nextEnv[key] = value;
        }
    }

    validateEnvConfig(nextEnv);

    await writeEnvFile(updateMap);
}
