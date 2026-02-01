/**
 * Composable for consistent API error message extraction
 */
export function useApiError() {
    /**
     * Extract a user-friendly error message from an API error
     * @param err - Error object from fetch/API call
     * @param fallback - Default message if no specific error message is found
     * @returns User-friendly error message
     */
    function getMessage(err: unknown, fallback = 'An error occurred'): string {
        if (err && typeof err === 'object') {
            if ('data' in err && err.data && typeof err.data === 'object' && 'statusMessage' in err.data) {
                return String(err.data.statusMessage);
            }
            if ('message' in err && typeof err.message === 'string') {
                return err.message;
            }
        }
        return fallback;
    }

    return {
        getMessage,
    };
}
