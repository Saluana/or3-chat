import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatAdminError } from '../formatAdminError';

// Mock parseErrorMessage
const mockParseErrorMessage = vi.fn();

vi.mock('~/utils/admin/parse-error', () => ({
    parseErrorMessage: (error: unknown, fallback: string) => mockParseErrorMessage(error, fallback),
}));

describe('formatAdminError', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('delegates to parseErrorMessage with Unknown error fallback', () => {
        const error = new Error('Test error');
        mockParseErrorMessage.mockReturnValue('Test error');

        const result = formatAdminError(error);

        expect(mockParseErrorMessage).toHaveBeenCalledWith(error, 'Unknown error');
        expect(result).toBe('Test error');
    });

    it('returns Unknown error when parseErrorMessage returns fallback', () => {
        mockParseErrorMessage.mockReturnValue('Unknown error');

        const result = formatAdminError(null);

        expect(result).toBe('Unknown error');
    });

    it('handles string errors', () => {
        mockParseErrorMessage.mockReturnValue('String error');

        const result = formatAdminError('String error');

        expect(mockParseErrorMessage).toHaveBeenCalledWith('String error', 'Unknown error');
        expect(result).toBe('String error');
    });

    it('handles fetch errors with statusMessage', () => {
        const fetchError = {
            data: { statusMessage: 'Not Found' },
        };
        mockParseErrorMessage.mockReturnValue('Not Found');

        const result = formatAdminError(fetchError);

        expect(result).toBe('Not Found');
    });
});
