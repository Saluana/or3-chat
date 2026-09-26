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
        // Rate limiter bypasses checks in non-production; mock to production for tests
        vi.stubEnv('NODE_ENV', 'production');
    });

    describe('checkRateLimit', () => {
        it('should allow first attempt', () => {
            const result = checkRateLimit(testIp, testUsername);

            expect(result.allowed).toBe(true);
            expect(result.remaining).toBe(4); // 5 max - 1 = 4 remaining (first check counts)
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

});
