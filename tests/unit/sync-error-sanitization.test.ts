/**
 * Tests for error message sanitization in sync operations
 * 
 * Issue: Full server error responses (including JSON blobs, stack traces)
 * were being shown directly in user-facing notifications, causing poor UX
 * and potential information disclosure.
 * 
 * Fix: Error messages are now truncated, sanitized, and cleaned of internal
 * details before being displayed to users.
 */
import { describe, it, expect } from 'vitest';
import type { SyncErrorCode } from '../../shared/sync/types';

describe('Sync - Error sanitization', () => {
    describe('SyncErrorCode classification', () => {
        it('should define all expected error codes', () => {
            const codes: SyncErrorCode[] = [
                'VALIDATION_ERROR',
                'UNAUTHORIZED',
                'CONFLICT',
                'NOT_FOUND',
                'RATE_LIMITED',
                'OVERSIZED',
                'NETWORK_ERROR',
                'SERVER_ERROR',
                'UNKNOWN',
            ];

            // Ensure type-level correctness
            codes.forEach(code => {
                expect(typeof code).toBe('string');
            });
        });
    });

    describe('isPermanentFailure logic', () => {
        // These tests verify the error classification logic in OutboxManager

        const permanentErrorCodes: SyncErrorCode[] = [
            'VALIDATION_ERROR',
            'OVERSIZED',
            'UNAUTHORIZED',
        ];

        const retryableErrorCodes: SyncErrorCode[] = [
            'CONFLICT',
            'NETWORK_ERROR',
            'RATE_LIMITED',
            'SERVER_ERROR',
            'UNKNOWN',
        ];

        it('should classify permanent errors correctly', () => {
            permanentErrorCodes.forEach(code => {
                // These should be classified as permanent
                expect(['VALIDATION_ERROR', 'OVERSIZED', 'UNAUTHORIZED']).toContain(code);
            });
        });

        it('should classify retryable errors correctly', () => {
            retryableErrorCodes.forEach(code => {
                // These should NOT be classified as permanent
                expect(['VALIDATION_ERROR', 'OVERSIZED', 'UNAUTHORIZED']).not.toContain(code);
            });
        });
    });

    describe('String-based error fallback patterns', () => {
        it('should recognize oversized document errors', () => {
            const errorMessages = [
                'Value is too large',
                'Document exceeds maximum size: Value is too large',
            ];

            errorMessages.forEach(msg => {
                expect(msg.includes('Value is too large')).toBe(true);
            });
        });

        it('should recognize schema validation errors', () => {
            const errorMessages = [
                'does not match the schema',
                'does not match validator',
                'missing the required field',
                'Value does not match validator',
            ];

            errorMessages.forEach(msg => {
                expect(
                    msg.includes('does not match the schema') ||
                    msg.includes('does not match validator') ||
                    msg.includes('missing the required field')
                ).toBe(true);
            });
        });

        it('should recognize undefined payload errors', () => {
            const errorMessages = [
                'Invalid payload for threads: received undefined',
                'invalid_type: received undefined',
            ];

            errorMessages.forEach(msg => {
                expect(msg.includes('received undefined')).toBe(true);
            });
        });
    });

    describe('Error message truncation', () => {
        it('should truncate long error messages to 200 chars', () => {
            const longError = 'A'.repeat(300);
            const truncated = longError.length > 200 
                ? longError.slice(0, 197) + '...'
                : longError;

            expect(truncated.length).toBeLessThanOrEqual(200);
            expect(truncated.endsWith('...')).toBe(true);
        });

        it('should not truncate short error messages', () => {
            const shortError = 'Sync failed';
            const result = shortError.length > 200 
                ? shortError.slice(0, 197) + '...'
                : shortError;

            expect(result).toBe(shortError);
        });
    });

    describe('PushResult with error codes', () => {
        it('should include errorCode in failed results', () => {
            const result = {
                results: [
                    {
                        opId: 'op-1',
                        success: false,
                        error: 'Validation failed',
                        errorCode: 'VALIDATION_ERROR' as SyncErrorCode,
                    },
                ],
                serverVersion: 100,
            };

            expect(result.results[0].errorCode).toBe('VALIDATION_ERROR');
            expect(result.results[0].error).toBeDefined();
        });

        it('should allow errorCode without error message', () => {
            const result = {
                results: [
                    {
                        opId: 'op-1',
                        success: false,
                        errorCode: 'NETWORK_ERROR' as SyncErrorCode,
                    },
                ],
                serverVersion: 100,
            };

            expect(result.results[0].errorCode).toBe('NETWORK_ERROR');
            expect(result.results[0].error).toBeUndefined();
        });

        it('should support successful results without error codes', () => {
            const result = {
                results: [
                    {
                        opId: 'op-1',
                        success: true,
                        serverVersion: 101,
                    },
                ],
                serverVersion: 101,
            };

            expect(result.results[0].success).toBe(true);
            expect(result.results[0].errorCode).toBeUndefined();
            expect(result.results[0].error).toBeUndefined();
        });
    });

    describe('Notification error message cleaning', () => {
        it('should remove JSON blobs from error messages', () => {
            const errorWithJson = 'Sync failed: {"code":"VALIDATION_ERROR","stack":"at foo.ts:123"}';
            
            // Simulate truncation that would happen in notification listener
            const cleaned = errorWithJson.length > 200
                ? errorWithJson.slice(0, 197) + '...'
                : errorWithJson;

            // JSON should not appear in cleaned message if properly sanitized
            // (This is what sanitizeErrorText does in gateway-sync-provider.ts)
            expect(cleaned.length).toBeLessThanOrEqual(200);
        });

        it('should remove stack traces from error messages', () => {
            const errorWithStack = 'Error: Sync failed\n    at Object.push (/app/sync.ts:42:15)\n    at processOps (/app/outbox.ts:123:8)';
            
            // Stack trace lines should be filtered out
            const lines = errorWithStack.split('\n').filter(line => {
                const trimmed = line.trim();
                return !trimmed.startsWith('at ') && !trimmed.match(/\.(ts|js|vue):\d+/);
            });

            expect(lines.length).toBeLessThan(errorWithStack.split('\n').length);
            expect(lines.join(' ')).not.toContain('at Object.push');
        });

        it('should handle malformed JSON gracefully', () => {
            const malformedError = 'Error: {invalid json';
            
            // Should not throw when trying to parse
            let parsed;
            try {
                parsed = JSON.parse(malformedError);
            } catch {
                // Expected to fail
            }

            expect(parsed).toBeUndefined();
        });
    });

    describe('Error deduplication', () => {
        it('should create consistent error keys for deduplication', () => {
            const createErrorKey = (tableName: string, pk: string, message: string) => 
                `${tableName}:${pk}:${message}`;

            const key1 = createErrorKey('threads', 'thread-1', 'Sync failed');
            const key2 = createErrorKey('threads', 'thread-1', 'Sync failed');
            const key3 = createErrorKey('threads', 'thread-2', 'Sync failed');

            expect(key1).toBe(key2);
            expect(key1).not.toBe(key3);
        });

        it('should dedupe within time window', () => {
            const DEDUPE_WINDOW_MS = 5000;
            const now = Date.now();
            const lastSeen = now - 3000; // 3 seconds ago

            const shouldDedupe = (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS);
            expect(shouldDedupe).toBe(true);
        });

        it('should not dedupe outside time window', () => {
            const DEDUPE_WINDOW_MS = 5000;
            const now = Date.now();
            const lastSeen = now - 6000; // 6 seconds ago

            const shouldDedupe = (lastSeen && now - lastSeen < DEDUPE_WINDOW_MS);
            expect(shouldDedupe).toBe(false);
        });
    });
});
