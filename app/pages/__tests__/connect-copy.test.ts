import { describe, expect, it } from 'vitest';
import connectPageSource from '../connect.vue?raw';

describe('Connect approval recovery copy', () => {
    it('shows the supported Connect-specific status and Doctor commands', () => {
        expect(connectPageSource).toContain('or3-intern connect status');
        expect(connectPageSource).toContain('or3-intern connect doctor');
    });

    it('exposes expiry recovery, live status, busy state, and focus targets', () => {
        expect(connectPageSource).toContain("state === 'expired'");
        expect(connectPageSource).toContain('npx @or3/connect');
        expect(connectPageSource).toContain('Code expires in');
        expect(connectPageSource).toContain('aria-live="polite"');
        expect(connectPageSource).toContain(':aria-busy="busy || monitoring"');
        expect(connectPageSource).toContain('ref="stateHeading"');
        expect(connectPageSource).toContain('ref="codeInput"');
        expect(connectPageSource).toContain('resetForNewCode');
    });
});
