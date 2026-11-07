import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BillingStore } from '../runtime/server/store';
import { ensureTrial, trialNetwork } from '../runtime/server/trial';
import { useRuntimeConfig } from '#imports';
import type { H3Event } from 'h3';
import type { SessionContext } from '~/core/hooks/hook-types';

describe('trial eligibility', () => {
    let root: string;
    let store: BillingStore;
    beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'or3-trial-')); store = new BillingStore(join(root, 'billing.sqlite')); });
    afterEach(() => { store.close(); rmSync(root, { recursive: true, force: true }); });

    it('never grants a trial merely because a billing status is requested', () => {
        expect(store.status('unclaimed')).toMatchObject({ allowed: false, state: 'expired' });
    });

    it('grants once per email and network and persists denials and prior grants', () => {
        const start = 1_800_000_000_000;
        store.claimTrial('alice', 'alice@example.test', '192.0.2.1', start);
        store.claimTrial('bob', 'bob@example.test', '192.0.2.1', start);
        store.claimTrial('carol', 'alice@example.test', '192.0.2.2', start);
        expect(store.status('alice', start)).toMatchObject({ state: 'trial', trialEndsAt: start + 7 * 86400000 });
        expect(store.status('bob', start).allowed).toBe(false);
        expect(store.status('carol', start).allowed).toBe(false);
        store.close();
        store = new BillingStore(join(root, 'billing.sqlite'));
        store.claimTrial('bob', 'bob@example.test', '192.0.2.3', start + 1);
        store.claimTrial('alice', 'alice@example.test', '192.0.2.4', start + 10 * 86400000);
        expect(store.status('bob', start + 1).allowed).toBe(false);
        expect(store.status('alice', start + 10 * 86400000).allowed).toBe(false);
    });

    it('requires both identities, while preserving existing trial and paid accounts', () => {
        store.claimTrial('missing', 'missing@example.test', null);
        expect(store.status('missing').allowed).toBe(false);
        store.claimTrial('missing', 'missing@example.test', '192.0.2.9');
        expect(store.status('missing').state).toBe('trial');
        store.db.prepare('INSERT INTO billing_accounts (user_id, trial_ends_at) VALUES (?, ?)').run('legacy', 1_800_000_000_000);
        store.claimTrial('legacy', 'legacy@example.test', '192.0.2.9');
        expect(store.account('legacy').trial_ends_at).toBe(1_800_000_000_000);
        store.db.prepare("INSERT INTO billing_accounts (user_id, trial_ends_at, customer_id) VALUES ('paid', 0, 'cus_1')").run();
        store.claimTrial('paid', 'paid@example.test', '192.0.2.10');
        expect(store.account('paid').trial_ends_at).toBe(0);
    });

    it('normalizes IPv4-mapped addresses and IPv6 privacy addresses', () => {
        expect(trialNetwork('::ffff:192.0.2.1')).toBe(trialNetwork('192.0.2.1'));
        expect(trialNetwork('2001:db8:0:1::abcd')).toBe(trialNetwork('2001:db8:0:1::1234'));
        expect(trialNetwork('2001:db8:0:2::1')).not.toBe(trialNetwork('2001:db8:0:1::1'));
        expect(trialNetwork('invalid')).toBeNull();
    });

    it('uses the configured proxy boundary and normalizes session emails before granting', () => {
        for (let i = 0; i < 4; i++) vi.mocked(useRuntimeConfig).mockReturnValueOnce({ security: { proxy: { trustProxy: true } } } as never);
        const event = (forwarded?: string) => ({ node: { req: { headers: forwarded ? { 'x-forwarded-for': forwarded } : {}, socket: { remoteAddress: '192.0.2.1' } } } }) as H3Event;
        const session = (id: string, email: string) => ({ authenticated: true, user: { id, email } }) as SessionContext;
        ensureTrial(event(), session('missing', 'missing@example.test'), store);
        expect(store.status('missing').allowed).toBe(false);
        ensureTrial(event('203.0.113.1'), session('alice', ' Alice@Example.Test '), store);
        ensureTrial(event('203.0.113.2'), session('bob', 'alice@example.test'), store);
        ensureTrial(event('203.0.113.1'), session('carol', 'carol@example.test'), store);
        expect(store.status('alice').state).toBe('trial');
        expect(store.status('bob').allowed).toBe(false);
        expect(store.status('carol').allowed).toBe(false);
    });
});
