import { describe, expect, it } from 'vitest';
import {
    createDefaultAnswers,
    getProviderDescriptor,
    mapEnvToWizardAnswers,
} from '../catalog';
import {
    deriveEnvFromAnswers,
    deriveWizardOwnedEnvUpdates,
} from '../derive';
import { createDependencyInstallPlan } from '../install-plan';
import { buildRedactedSummary, sanitizeAnswersForSession, validateAnswers } from '../validation';

function answers() {
    return createDefaultAnswers({ instanceDir: '/tmp/or3' });
}

describe('wizard: native SQLite drivers', () => {
    it('keeps the current better-sqlite3 configuration as the default', () => {
        const { env } = deriveEnvFromAnswers(answers());

        expect(env.OR3_SQLITE_DRIVER).toBe('better-sqlite3');
        expect(env.OR3_SQLITE_DB_PATH).toBe('./.data/or3-sync.sqlite');
        expect(env.OR3_SQLITE_TURSO_URL).toBeUndefined();
        expect(env.OR3_SQLITE_D1_BINDING).toBeUndefined();
    });

    it('derives Bun with only local SQLite configuration', () => {
        const { env } = deriveEnvFromAnswers({
            ...answers(),
            sqliteDriver: 'bun',
            sqliteDbPath: '/data/or3.sqlite',
        });

        expect(env.OR3_SQLITE_DRIVER).toBe('bun');
        expect(env.OR3_SQLITE_DB_PATH).toBe('/data/or3.sqlite');
        expect(env.OR3_SQLITE_TURSO_URL).toBeUndefined();
        expect(env.OR3_SQLITE_D1_BINDING).toBeUndefined();
    });

    it('derives Turso without local-file settings and protects its token', () => {
        const tursoAnswers = {
            ...answers(),
            sqliteDriver: 'turso' as const,
            sqliteTursoUrl: 'libsql://or3-test.turso.io',
            sqliteTursoAuthToken: 'turso-secret-token',
        };
        const { env } = deriveEnvFromAnswers(tursoAnswers);
        const updates = deriveWizardOwnedEnvUpdates(env);

        expect(env.OR3_SQLITE_DRIVER).toBe('turso');
        expect(env.OR3_SQLITE_TURSO_URL).toBe('libsql://or3-test.turso.io');
        expect(env.OR3_SQLITE_TURSO_AUTH_TOKEN).toBe('turso-secret-token');
        expect(env.OR3_SQLITE_DB_PATH).toBeUndefined();
        expect(updates.OR3_SQLITE_DB_PATH).toBeNull();
        expect(buildRedactedSummary(tursoAnswers)).toContain(
            'OR3_SQLITE_TURSO_AUTH_TOKEN=<redacted>'
        );
        expect(
            sanitizeAnswersForSession(tursoAnswers, false).sqliteTursoAuthToken
        ).toBeUndefined();
    });

    it('derives D1 from its binding without local-file settings', () => {
        const { env } = deriveEnvFromAnswers({
            ...answers(),
            sqliteDriver: 'd1',
            sqliteD1Binding: 'OR3_DB',
        });

        expect(env.OR3_SQLITE_DRIVER).toBe('d1');
        expect(env.OR3_SQLITE_D1_BINDING).toBe('OR3_DB');
        expect(env.OR3_SQLITE_DB_PATH).toBeUndefined();
        expect(env.OR3_SQLITE_TURSO_URL).toBeUndefined();
    });

    it('shows only the fields needed for each native runtime', () => {
        const fields = getProviderDescriptor('sync', 'sqlite')?.fields ?? [];
        const field = (key: string) => fields.find((candidate) => candidate.key === key);

        expect(field('sqliteDbPath')?.visibleWhen?.({ ...answers(), sqliteDriver: 'bun' })).toBe(true);
        expect(field('sqliteDbPath')?.visibleWhen?.({ ...answers(), sqliteDriver: 'turso' })).toBe(false);
        expect(field('sqliteTursoUrl')?.visibleWhen?.({ ...answers(), sqliteDriver: 'turso' })).toBe(true);
        expect(field('sqliteD1Binding')?.visibleWhen?.({ ...answers(), sqliteDriver: 'd1' })).toBe(true);
    });

    it('installs only the selected runtime dependency', () => {
        const common = {
            ...answers(),
            authProvider: 'clerk' as const,
        };

        expect(
            createDependencyInstallPlan({
                ...common,
                sqliteDriver: 'better-sqlite3',
            }).packages
        ).toContain('better-sqlite3');
        expect(
            createDependencyInstallPlan({ ...common, sqliteDriver: 'turso' }).packages
        ).toContain('libsql');
        expect(
            createDependencyInstallPlan({ ...common, sqliteDriver: 'bun' }).packages
        ).not.toContain('better-sqlite3');
        expect(
            createDependencyInstallPlan({ ...common, sqliteDriver: 'd1' }).packages
        ).not.toContain('better-sqlite3');
    });

    it('validates the native runtime-specific settings', () => {
        const validTurso = validateAnswers({
            ...answers(),
            sqliteDriver: 'turso',
            sqliteTursoUrl: 'libsql://or3-test.turso.io',
            sqliteTursoAuthToken: 'token',
        });
        expect(
            validTurso.errors.filter((error) => error.includes('OR3_SQLITE_'))
        ).toEqual([]);

        const missingTurso = validateAnswers({
            ...answers(),
            sqliteDriver: 'turso',
            sqliteTursoUrl: '',
            sqliteTursoAuthToken: '',
        });
        expect(missingTurso.errors).toContain(
            'OR3_SQLITE_TURSO_URL is required for Turso.'
        );
        expect(missingTurso.errors).toContain(
            'OR3_SQLITE_TURSO_AUTH_TOKEN is required for Turso.'
        );

        const d1WithConnect = validateAnswers({
            ...answers(),
            sqliteDriver: 'd1',
            connectEnabled: true,
        });
        expect(d1WithConnect.errors).toContain(
            'Cloudflare D1 does not support OR3 Connect persistence yet. Disable OR3 Connect or choose another SQLite runtime.'
        );
        expect(d1WithConnect.errors).toContain(
            'Cloudflare D1 requires a Workers-compatible auth provider. Basic Auth uses a local better-sqlite3 database; choose Clerk or another compatible auth provider.'
        );
        expect(d1WithConnect.errors).toContain(
            'Cloudflare D1 requires Workers-compatible storage. The filesystem storage provider is not available in a Cloudflare Worker.'
        );
    });

    it('does not validate an inactive no-SSR sync provider', () => {
        const noSsrSync = validateAnswers({
            ...answers(),
            ssrAuthEnabled: false,
            syncEnabled: true,
            syncProvider: 'sqlite',
            sqliteDriver: 'turso',
            sqliteTursoUrl: '',
            sqliteTursoAuthToken: '',
            connectEnabled: false,
        });

        expect(
            noSsrSync.errors.filter((error) => error.includes('OR3_SQLITE_'))
        ).toEqual([]);
    });

    it('loads native runtime settings from an existing environment', () => {
        expect(
            mapEnvToWizardAnswers({
                OR3_SQLITE_DRIVER: 'turso',
                OR3_SQLITE_TURSO_URL: 'libsql://or3-test.turso.io',
                OR3_SQLITE_TURSO_AUTH_TOKEN: 'token',
                OR3_SQLITE_D1_BINDING: 'OR3_DB',
            })
        ).toMatchObject({
            sqliteDriver: 'turso',
            sqliteTursoUrl: 'libsql://or3-test.turso.io',
            sqliteTursoAuthToken: 'token',
            sqliteD1Binding: 'OR3_DB',
        });
    });
});
