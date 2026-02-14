import { describe, it, expect, vi } from 'vitest';
import type { H3Event } from 'h3';

const mockSetHeader = vi.hoisted(() => vi.fn());

vi.mock('h3', async () => {
    const actual = await vi.importActual<typeof import('h3')>('h3');
    return {
        ...actual,
        setHeader: mockSetHeader,
    };
});

import { setNoCacheHeaders } from '../headers';

describe('setNoCacheHeaders', () => {
    it('sets no-store cache control headers', () => {
        const mockEvent = {
            __is_event__: true,
            node: {},
        } as unknown as H3Event;

        setNoCacheHeaders(mockEvent);

        expect(mockSetHeader).toHaveBeenCalledWith(
            mockEvent,
            'Cache-Control',
            'no-store, no-cache, must-revalidate'
        );
        expect(mockSetHeader).toHaveBeenCalledWith(mockEvent, 'Pragma', 'no-cache');
    });
});
