/**
 * Utilities for converting between camelCase and snake_case
 * Used for wire schema normalization (Task 15)
 */

/**
 * Convert a string from camelCase to snake_case
 */
export function camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/**
 * Convert a string from snake_case to camelCase
 */
export function snakeToCamel(str: string): string {
    return str.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
}

/**
 * Convert object keys from camelCase to snake_case recursively
 */
export function keysToSnakeCase<T = unknown>(obj: unknown): T {
    if (obj === null || obj === undefined) {
        return obj as T;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => keysToSnakeCase(item)) as T;
    }
    
    if (typeof obj === 'object' && obj.constructor === Object) {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const snakeKey = camelToSnake(key);
            result[snakeKey] = keysToSnakeCase(value);
        }
        return result as T;
    }
    
    return obj as T;
}

/**
 * Convert object keys from snake_case to camelCase recursively
 */
export function keysToCamelCase<T = unknown>(obj: unknown): T {
    if (obj === null || obj === undefined) {
        return obj as T;
    }
    
    if (Array.isArray(obj)) {
        return obj.map(item => keysToCamelCase(item)) as T;
    }
    
    if (typeof obj === 'object' && obj.constructor === Object) {
        const result: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(obj)) {
            const camelKey = snakeToCamel(key);
            result[camelKey] = keysToCamelCase(value);
        }
        return result as T;
    }
    
    return obj as T;
}

/**
 * Normalize wire schema input to snake_case
 * Accepts both camelCase and snake_case, always returns snake_case
 */
export function normalizeWireSchema<T = unknown>(input: unknown): T {
    // First convert everything to snake_case
    // This handles both camelCase and already-snake_case inputs
    return keysToSnakeCase<T>(input);
}
