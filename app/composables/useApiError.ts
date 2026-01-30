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
    function getMessage(err: any, fallback = 'An error occurred'): string {
        return err?.data?.statusMessage || err?.message || fallback;
    }

    return {
        getMessage,
    };
}
