import { describe, it, expect, vi } from 'vitest';
import { setNoCacheHeaders } from '../headers';
import type { H3Event } from 'h3';

describe('setNoCacheHeaders', () => {
    it('sets no-store cache control headers', () => {
        const mockHeaders: Record<string, string> = {};
        const mockEvent = {
            __is_event__: true,
            node: {},
        } as unknown as H3Event;

        const setHeader = vi.fn((event, name, value) => {
            mockHeaders[name] = value;
        });

        vi.mock('h3', async () => {
            const actual = await vi.importActual('h3');
            return {
                ...actual,
                setHeader,
            };
        });

        // Import the implementation that uses the mocked setHeader
        const { setNoCacheHeaders: mockedSetNoCacheHeaders } = await import('../headers');
        
        // Mock setHeader manually
        const originalSetHeader = (await import('h3')).setHeader;
        vi.mocked(originalSetHeader).mockImplementation((event, name, value) => {
            mockHeaders[name] = value;
        });

        mockedSetNoCacheHeaders(mockEvent);

        expect(mockHeaders['Cache-Control']).toBe('no-store, no-cache, must-revalidate');
        expect(mockHeaders['Pragma']).toBe('no-cache');
    });
});
