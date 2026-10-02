import { presentError, type ErrorContext } from '~~/shared/errors';

/** Display safe guidance from structured API failures; exception text is diagnostic. */
export function useApiError() {
    function getMessage(error: unknown, fallback = 'The operation could not be completed.', context: ErrorContext = {}): string {
        return presentError(error, { ...context, fallbackMessage: fallback }).message;
    }
    return { getMessage };
}
