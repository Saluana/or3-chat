import { describe, it, expect } from 'vitest';
import {
    camelToSnake,
    snakeToCamel,
    keysToSnakeCase,
    keysToCamelCase,
    normalizeWireSchema,
} from '~~/shared/utils/casing';

describe('casing utilities', () => {
    describe('camelToSnake', () => {
        it('should convert camelCase to snake_case', () => {
            expect(camelToSnake('camelCase')).toBe('camel_case');
            expect(camelToSnake('createdAt')).toBe('created_at');
            expect(camelToSnake('userId')).toBe('user_id');
            expect(camelToSnake('mimeType')).toBe('mime_type');
        });

        it('should handle already snake_case strings', () => {
            expect(camelToSnake('snake_case')).toBe('snake_case');
            expect(camelToSnake('created_at')).toBe('created_at');
        });

        it('should handle single word strings', () => {
            expect(camelToSnake('word')).toBe('word');
            expect(camelToSnake('id')).toBe('id');
        });
    });

    describe('snakeToCamel', () => {
        it('should convert snake_case to camelCase', () => {
            expect(snakeToCamel('snake_case')).toBe('snakeCase');
            expect(snakeToCamel('created_at')).toBe('createdAt');
            expect(snakeToCamel('user_id')).toBe('userId');
            expect(snakeToCamel('mime_type')).toBe('mimeType');
        });

        it('should handle already camelCase strings', () => {
            expect(snakeToCamel('camelCase')).toBe('camelCase');
            expect(snakeToCamel('createdAt')).toBe('createdAt');
        });

        it('should handle single word strings', () => {
            expect(snakeToCamel('word')).toBe('word');
            expect(snakeToCamel('id')).toBe('id');
        });
    });

    describe('keysToSnakeCase', () => {
        it('should convert object keys from camelCase to snake_case', () => {
            const input = {
                userId: 123,
                createdAt: 1234567890,
                mimeType: 'image/png',
            };
            const expected = {
                user_id: 123,
                created_at: 1234567890,
                mime_type: 'image/png',
            };
            expect(keysToSnakeCase(input)).toEqual(expected);
        });

        it('should handle nested objects', () => {
            const input = {
                userId: 123,
                userProfile: {
                    firstName: 'John',
                    lastName: 'Doe',
                },
            };
            const expected = {
                user_id: 123,
                user_profile: {
                    first_name: 'John',
                    last_name: 'Doe',
                },
            };
            expect(keysToSnakeCase(input)).toEqual(expected);
        });

        it('should handle arrays', () => {
            const input = [
                { userId: 1, createdAt: 100 },
                { userId: 2, createdAt: 200 },
            ];
            const expected = [
                { user_id: 1, created_at: 100 },
                { user_id: 2, created_at: 200 },
            ];
            expect(keysToSnakeCase(input)).toEqual(expected);
        });

        it('should handle null and undefined', () => {
            expect(keysToSnakeCase(null)).toBe(null);
            expect(keysToSnakeCase(undefined)).toBe(undefined);
        });

        it('should handle primitive values', () => {
            expect(keysToSnakeCase('string')).toBe('string');
            expect(keysToSnakeCase(123)).toBe(123);
            expect(keysToSnakeCase(true)).toBe(true);
        });

        it('should handle already snake_case keys', () => {
            const input = {
                user_id: 123,
                created_at: 1234567890,
            };
            expect(keysToSnakeCase(input)).toEqual(input);
        });
    });

    describe('keysToCamelCase', () => {
        it('should convert object keys from snake_case to camelCase', () => {
            const input = {
                user_id: 123,
                created_at: 1234567890,
                mime_type: 'image/png',
            };
            const expected = {
                userId: 123,
                createdAt: 1234567890,
                mimeType: 'image/png',
            };
            expect(keysToCamelCase(input)).toEqual(expected);
        });

        it('should handle nested objects', () => {
            const input = {
                user_id: 123,
                user_profile: {
                    first_name: 'John',
                    last_name: 'Doe',
                },
            };
            const expected = {
                userId: 123,
                userProfile: {
                    firstName: 'John',
                    lastName: 'Doe',
                },
            };
            expect(keysToCamelCase(input)).toEqual(expected);
        });

        it('should handle arrays', () => {
            const input = [
                { user_id: 1, created_at: 100 },
                { user_id: 2, created_at: 200 },
            ];
            const expected = [
                { userId: 1, createdAt: 100 },
                { userId: 2, createdAt: 200 },
            ];
            expect(keysToCamelCase(input)).toEqual(expected);
        });

        it('should handle already camelCase keys', () => {
            const input = {
                userId: 123,
                createdAt: 1234567890,
            };
            expect(keysToCamelCase(input)).toEqual(input);
        });
    });

    describe('normalizeWireSchema', () => {
        it('should normalize camelCase input to snake_case', () => {
            const input = {
                userId: 123,
                createdAt: 1234567890,
                threadData: {
                    threadId: 'abc',
                    messageCount: 5,
                },
            };
            const expected = {
                user_id: 123,
                created_at: 1234567890,
                thread_data: {
                    thread_id: 'abc',
                    message_count: 5,
                },
            };
            expect(normalizeWireSchema(input)).toEqual(expected);
        });

        it('should accept and preserve snake_case input', () => {
            const input = {
                user_id: 123,
                created_at: 1234567890,
                thread_data: {
                    thread_id: 'abc',
                    message_count: 5,
                },
            };
            expect(normalizeWireSchema(input)).toEqual(input);
        });

        it('should handle mixed casing (normalize to snake_case)', () => {
            const input = {
                userId: 123,
                created_at: 1234567890, // Already snake_case
                threadData: {
                    thread_id: 'abc', // Mixed
                    messageCount: 5,
                },
            };
            const expected = {
                user_id: 123,
                created_at: 1234567890,
                thread_data: {
                    thread_id: 'abc',
                    message_count: 5,
                },
            };
            expect(normalizeWireSchema(input)).toEqual(expected);
        });

        it('should handle arrays of objects', () => {
            const input = [
                { userId: 1, createdAt: 100 },
                { user_id: 2, created_at: 200 },
            ];
            const expected = [
                { user_id: 1, created_at: 100 },
                { user_id: 2, created_at: 200 },
            ];
            expect(normalizeWireSchema(input)).toEqual(expected);
        });
    });
});
