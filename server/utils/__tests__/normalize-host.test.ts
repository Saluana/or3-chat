/**
 * @module server/utils/__tests__/normalize-host.test
 *
 * Purpose:
 * Validate host normalization rules used for allowlist checks.
 *
 * Behavior:
 * - Lowercases hostnames.
 * - Strips port suffixes.
 * - Preserves IPv6 bracket notation.
 *
 * Non-Goals:
 * - DNS or IP reachability validation.
 */

/* @vitest-environment node */
import { describe, it, expect } from 'vitest';
import { normalizeHost } from '../normalize-host';

describe('normalizeHost', () => {
    it('lowercases hostnames', () => {
        expect(normalizeHost('EXAMPLE.COM')).toBe('example.com');
        expect(normalizeHost('Example.Com')).toBe('example.com');
    });

    it('removes port numbers', () => {
        expect(normalizeHost('example.com:3000')).toBe('example.com');
        expect(normalizeHost('example.com:443')).toBe('example.com');
    });

    it('trims whitespace', () => {
        expect(normalizeHost('  example.com  ')).toBe('example.com');
        expect(normalizeHost('\texample.com\n')).toBe('example.com');
    });

    it('handles hosts without ports', () => {
        expect(normalizeHost('example.com')).toBe('example.com');
        expect(normalizeHost('localhost')).toBe('localhost');
    });

    it('handles IP addresses', () => {
        expect(normalizeHost('192.168.1.1')).toBe('192.168.1.1');
        expect(normalizeHost('192.168.1.1:8080')).toBe('192.168.1.1');
    });

    it('handles IPv6 addresses', () => {
        expect(normalizeHost('[::1]')).toBe('[::1]');
        expect(normalizeHost('[::1]:3000')).toBe('[::1]');
    });

    it('handles empty or edge case inputs', () => {
        expect(normalizeHost('')).toBe('');
        expect(normalizeHost(':')).toBe('');
        expect(normalizeHost(':8080')).toBe('');
    });

    it('handles multiple colons correctly (only removes port)', () => {
        // IPv6 full notation
        expect(normalizeHost('[2001:db8::1]')).toBe('[2001:db8::1]');
        expect(normalizeHost('[2001:db8::1]:443')).toBe('[2001:db8::1]');
    });
});
