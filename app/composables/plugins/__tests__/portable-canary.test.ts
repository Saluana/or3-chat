import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it, vi } from 'vitest';
import * as sdk from '@or3/plugin-sdk/host';
import * as registry from '~/core/search/command-palette/registry';
import * as grants from '~~/shared/plugins/grant-review';
import { TRUSTED_HOST_FEATURES } from '~~/shared/plugins/host-esm-facade-runtime';
import { sha256Hex } from '~~/shared/runtime-crypto';
import type { PluginContext } from '@or3/plugin-sdk';
import type { CanaryTicketPayload, runCandidateClientCanary } from '../portable-canary';

// Exercise the real browser-check entry, replacing only browser module delivery.
// Node cannot import the authenticated browser route; its contents are supplied here.
async function check(setup: (context: PluginContext) => unknown, approved = ['commands.register']) {
    const bytes = new TextEncoder().encode('reviewed synthetic candidate');
    const digest = `sha256-${await sha256Hex(bytes)}` as const;
    const ticket: CanaryTicketPayload = {
        ticketId: 'ticket', nonce: 'nonce', pluginId: 'fixture.canary',
        packageDigest: digest, workspaceId: 'workspace', clientId: 'browser',
        profile: 'or3-trusted-host-v2', expiresAt: Date.now() + 60_000,
        clientEntry: { entry: 'client.mjs', isolation: 'host', digest },
        grants: { requestedGrants: approved, approvedGrants: approved, status: 'current',
            revision: '1', authoritySha256: null, packageDigest: digest },
    };
    const modules: Record<string, unknown> = {
        '@or3/plugin-sdk/host': sdk,
        '~/core/search/command-palette/registry': registry,
        '~~/shared/plugins/grant-review': grants,
        '~~/shared/runtime-crypto': { sha256Hex },
        '~~/shared/plugins/host-esm-facade-runtime': { getTrustedHostUiDecision: () => ({ status: 'supported' }), TRUSTED_HOST_FEATURES },
        '~~/shared/plugins/isolation/portable-bootstrap': { detectBrowserEngine: () => 'chromium' },
        '~~/shared/plugins/isolation/containment-policy': {},
        '~~/shared/plugins/isolation/portable-frame-transport': {},
        '/api/admin/plugins/packages/fixture.canary/canary/entry?ticketId=ticket': {
            default: { manifest: { id: 'fixture.canary', version: '1.0.0', trust: 'trusted-host', manifestVersion: 2, features: { required: [] } }, setup },
        },
    };
    const compiled = ts.transpileModule(readFileSync('app/composables/plugins/portable-canary.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {} as { runCandidateClientCanary: typeof runCandidateClientCanary };
    const fetcher = vi.fn(async () => new Response(bytes, { headers: { 'content-type': 'text/javascript' } }));
    new Function('require', 'exports', 'fetch', compiled)((name: string) => {
        if (!(name in modules)) throw new Error(`Unexpected dependency: ${name}`);
        return modules[name];
    }, exports, fetcher);
    return { outcome: await exports.runCandidateClientCanary(ticket), fetcher };
}

describe('trusted candidate browser check', () => {
    it('blocks the dotted command id that previously passed but failed live activation', async () => {
        const { outcome } = await check(context => {
            context.commands.register({ id: 'fixture.canary.save', label: 'Save' }, () => ({ ok: true, value: null }));
        });
        expect(outcome.status).toBe('blocked');
        expect(outcome.code).toBe('client-setup-failed');
    });

    it('validates setup without publishing a command or invoking its secret-writing handler, then cleans up', async () => {
        const handler = vi.fn(() => ({ ok: true as const, value: null }));
        const cleanup = vi.fn();
        const { outcome } = await check(context => {
            context.onCleanup(cleanup);
            context.commands.register({ id: 'fixture-canary-save', label: 'Save' }, handler);
        });
        expect(outcome).toMatchObject({ status: 'passed', diagnostics: { setupExecuted: true } });
        expect(registry.listPaletteCommands().some(command => command.id === 'fixture-canary-save')).toBe(false);
        expect(handler).not.toHaveBeenCalled();
        expect(cleanup).toHaveBeenCalledOnce();
    });

    it('blocks unreviewed command registration and caught attempts to access secrets during setup', async () => {
        const denied = await check(context => {
            try { context.commands.register({ id: 'fixture-canary-save', label: 'Save' }, () => ({ ok: true, value: null })); } catch {}
        }, []);
        expect(denied.outcome.status).toBe('blocked');
        const secret = await check(async context => {
            try { await context.secrets.set('key', 'synthetic'); } catch {}
        }, ['secrets.write']);
        expect(secret.outcome.status).toBe('blocked');
        expect(secret.fetcher).toHaveBeenCalledTimes(1); // entry bytes only; no host secret request
    });
});
