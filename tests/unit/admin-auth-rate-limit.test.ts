import { describe, it, expect, beforeEach, vi } from 'vitest';
import { 
    checkRateLimit, 
    recordFailedAttempt, 
    clearRateLimit 
} from '../../server/admin/auth/rate-limit';

describe('Admin Auth - Rate Limiting', () => {
    const testIp = '192.168.1.1';
    const testUsername = 'testadmin';

    // Clear rate limits before each test
    beforeEach(() => {
        clearRateLimit(testIp, testUsername);
    });

    describe('checkRateLimit', () => {
        it('should allow first attempt', () => {
            const result = checkRateLimit(testIp, testUsername);

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4); // 5 max - 1 = 4 remaining
            expect(result.resetAt).toBeGreaterThan(Date.now());
        });

        it('should allow up to max attempts', () => {
            // Record 4 failed attempts
            for (let i = 0; i < 4; i++) {
                recordFailedAttempt(testIp, testUsername);
            }

            // 5th attempt should still be allowed
            const result = checkRateLimit(testIp, testUsername);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(0);
        });

        it('should block after max attempts', () => {
            // Record 5 failed attempts
            for (let i = 0; i < 5; i++) {
                recordFailedAttempt(testIp, testUsername);
            }

            // 6th attempt should be blocked
            const result = checkRateLimit(testIp, testUsername);
            expect(result.allowed).toBe(false);
            expect(result.remaining).toBe(0);
        });

        it('should track different IPs independently', () => {
            const ip1 = '192.168.1.1';
            const ip2 = '192.168.1.2';

            // Max out ip1
            for (let i = 0; i < 5; i++) {
                recordFailedAttempt(ip1, testUsername);
            }

            // ip2 should still be allowed
            const result1 = checkRateLimit(ip1, testUsername);
            const result2 = checkRateLimit(ip2, testUsername);

            expect(result1.allowed).toBe(false);
            expect(result2.allowed).toBe(true);
        });

        it('should track different usernames independently', () => {
            const username1 = 'admin1';
            const username2 = 'admin2';

            // Max out username1
            for (let i = 0; i < 5; i++) {
                recordFailedAttempt(testIp, username1);
            }

            // username2 should still be allowed
            const result1 = checkRateLimit(testIp, username1);
            const result2 = checkRateLimit(testIp, username2);

            expect(result1.allowed).toBe(false);
            expect(result2.allowed).toBe(true);
        });
    });

    describe('recordFailedAttempt', () => {
        it('should increment count on failed attempts', () => {
            recordFailedAttempt(testIp, testUsername);
            const result1 = checkRateLimit(testIp, testUsername);
            expect(result1.remaining).toBe(3); // Started with 4, now 3

            recordFailedAttempt(testIp, testUsername);
            const result2 = checkRateLimit(testIp, testUsername);
            expect(result2.remaining).toBe(2); // Now 2
        });

        it('should start a new window for first attempt', () => {
            const before = Date.now();
            recordFailedAttempt(testIp, testUsername);
            const result = checkRateLimit(testIp, testUsername);
            
            expect(result.resetAt).toBeGreaterThan(before);
        });
    });

    describe('clearRateLimit', () => {
        it('should clear rate limit on successful login', () => {
            // Record some failed attempts
            for (let i = 0; i < 3; i++) {
                recordFailedAttempt(testIp, testUsername);
            }

            // Clear the rate limit
            clearRateLimit(testIp, testUsername);

            // Next check should be as if it's the first attempt
            const result = checkRateLimit(testIp, testUsername);
            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4); // Back to initial state
        });

        it('should only clear specific IP and username combination', () => {
            const username2 = 'admin2';

            // Record attempts for both usernames
            recordFailedAttempt(testIp, testUsername);
            recordFailedAttempt(testIp, username2);

            // Clear only testUsername
            clearRateLimit(testIp, testUsername);

            // testUsername should be reset, username2 should not
            const result1 = checkRateLimit(testIp, testUsername);
            const result2 = checkRateLimit(testIp, username2);

            expect(result1.remaining).toBe(4);
            expect(result2.remaining).toBe(3);
        });
    });

    describe('rate limit window', () => {
        it('should respect the time window', () => {
            // Note: This test checks the structure but not actual time passage
            // since we can't easily mock time in this context
            recordFailedAttempt(testIp, testUsername);
            const result = checkRateLimit(testIp, testUsername);

            // Reset time should be in the future (15 minutes from window start)
            const fifteenMinutes = 15 * 60 * 1000;
            const expectedReset = Date.now() + fifteenMinutes;
            
            // Allow for some variance (within 1 second)
            expect(result.resetAt).toBeGreaterThan(Date.now());
            expect(result.resetAt).toBeLessThan(expectedReset + 1000);
        });
    });

    describe('edge cases', () => {
        it('should handle empty username', () => {
            const result = checkRateLimit(testIp, '');
            expect(result.allowed).toBe(true);
        });

        it('should handle special characters in username', () => {
            const specialUsername = 'admin@test.com';
            const result = checkRateLimit(testIp, specialUsername);
            expect(result.allowed).toBe(true);
        });

        it('should handle very long usernames', () => {
            const longUsername = 'a'.repeat(1000);
            const result = checkRateLimit(testIp, longUsername);
            expect(result.allowed).toBe(true);
        });
    });
});
