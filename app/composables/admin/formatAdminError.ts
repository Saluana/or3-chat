import { parseErrorMessage } from '~/utils/admin/parse-error';

/**
 * Format an error for display in admin UI.
 * @deprecated Use parseErrorMessage from '~/utils/admin/parse-error' instead.
 */
export function formatAdminError(error: unknown): string {
    return parseErrorMessage(error, 'Unknown error');
}

