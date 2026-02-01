/**
 * Unit tests for CORS middleware
 * Tests spec-correct CORS behavior:
 * - Never emit '*' with credentials
 * - Preserve existing Vary headers
 * - Handle allowlist correctly
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { IncomingMessage, ServerResponse } from 'http';
import { Socket } from 'net';
import { createEvent, type H3Event } from 'h3';

// Mock H3 functions
const mockHeaders: Record<string, string> = {};
let mockStatus = 200;

let runtimeConfig: { security: { allowedOrigins: string[] } } = {
    security: { allowedOrigins: [] },
};

vi.mock('h3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('h3')>();
    return {
        ...actual,
        defineEventHandler: (fn: Function) => fn,
        getHeader: vi.fn((event: any, name: string) => {
            const headers = event.node?.req?.headers || event.headers || {};
            const value = headers[name.toLowerCase()];
            return Array.isArray(value) ? value[0] : value;
        }),
        setHeader: vi.fn((event: any, name: string, value: string) => {
            mockHeaders[name] = value;
        }),
        getResponseHeader: vi.fn((event: any, name: string) => {
            return mockHeaders[name];
        }),
        setResponseStatus: vi.fn((event: any, status: number) => {
            mockStatus = status;
        }),
    };
});

vi.mock('#imports', () => ({
    useRuntimeConfig: () => runtimeConfig,
}));

describe('CORS middleware', () => {
    function makeEvent(input: {
        headers: Record<string, string>;
        method: string;
    }): H3Event {
        const req = new IncomingMessage(new Socket());
        req.headers = Object.fromEntries(
            Object.entries(input.headers).map(([key, value]) => [
                key.toLowerCase(),
                value,
            ])
        );
        req.method = input.method;
        const res = new ServerResponse(req);
        return createEvent(req, res);
    }

    beforeEach(() => {
        // Reset mocks
        Object.keys(mockHeaders).forEach(key => delete mockHeaders[key]);
        mockStatus = 200;
        runtimeConfig = { security: { allowedOrigins: [] } };
        vi.clearAllMocks();
    });

    describe('credentials handling', () => {
        it('should NOT emit credentials with wildcard origin (allowAll)', async () => {
            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://example.com' },
                method: 'GET',
            });

            // With empty allowlist, allowAll is true
            await corsHandler(event);

            // Should set wildcard origin
            expect(mockHeaders['Access-Control-Allow-Origin']).toBe('*');
            // Should NOT emit credentials header
            expect(mockHeaders['Access-Control-Allow-Credentials']).toBeUndefined();
        });

        it('should emit credentials with explicit allowed origin', async () => {
            runtimeConfig = { security: { allowedOrigins: ['http://allowed.com'] } };

            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://allowed.com' },
                method: 'GET',
            });

            await corsHandler(event);

            // Should echo back the specific origin
            expect(mockHeaders['Access-Control-Allow-Origin']).toBe('http://allowed.com');
            // Should emit credentials
            expect(mockHeaders['Access-Control-Allow-Credentials']).toBe('true');
        });

        it('should NOT emit credentials when origin is blocked', async () => {
            runtimeConfig = { security: { allowedOrigins: ['http://allowed.com'] } };

            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://blocked.com' },
                method: 'GET',
            });

            await corsHandler(event);

            // Should not set any CORS headers for blocked origins
            expect(mockHeaders['Access-Control-Allow-Origin']).toBeUndefined();
            expect(mockHeaders['Access-Control-Allow-Credentials']).toBeUndefined();
        });
    });

    describe('Vary header handling', () => {
        it('should append Origin to existing Vary header', async () => {
            // Set an existing Vary header first
            mockHeaders['Vary'] = 'Accept-Encoding';

            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://example.com' },
                method: 'GET',
            });

            await corsHandler(event);

            // Should append Origin to existing Vary
            expect(mockHeaders['Vary']).toBe('Accept-Encoding, Origin');
        });

        it('should set Vary: Origin when no existing Vary header', async () => {
            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://example.com' },
                method: 'GET',
            });

            await corsHandler(event);

            expect(mockHeaders['Vary']).toBe('Origin');
        });

        it('should not duplicate Origin if already in Vary', async () => {
            // Set Vary with Origin already present
            mockHeaders['Vary'] = 'Accept-Encoding, Origin';

            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://example.com' },
                method: 'GET',
            });

            await corsHandler(event);

            // Should keep original Vary without duplication
            expect(mockHeaders['Vary']).toBe('Accept-Encoding, Origin');
        });
    });

    describe('origin handling', () => {
        it('should do nothing when no origin header', async () => {
            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: {},
                method: 'GET',
            });

            await corsHandler(event);

            expect(mockHeaders['Access-Control-Allow-Origin']).toBeUndefined();
            expect(mockHeaders['Vary']).toBeUndefined();
        });

        it('should handle preflight OPTIONS requests', async () => {
            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { 
                    origin: 'http://example.com',
                    'access-control-request-headers': 'X-Custom-Header',
                },
                method: 'OPTIONS',
            });

            await corsHandler(event);

            expect(mockStatus).toBe(204);
            expect(mockHeaders['Access-Control-Allow-Methods']).toBe('GET,POST,PUT,PATCH,DELETE,OPTIONS');
            expect(mockHeaders['Access-Control-Allow-Headers']).toBe('X-Custom-Header');
        });

        it('should use default headers when no access-control-request-headers', async () => {
            const corsHandler = (await import('../cors')).default;
            
            const event = makeEvent({
                headers: { origin: 'http://example.com' },
                method: 'OPTIONS',
            });

            await corsHandler(event);

            expect(mockHeaders['Access-Control-Allow-Headers']).toBe('Content-Type,Authorization');
        });
    });
});
