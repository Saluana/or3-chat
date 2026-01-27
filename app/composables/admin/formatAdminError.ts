export function formatAdminError(error: unknown): string {
    if (!error) return 'Unknown error';
    if (typeof error === 'string') return error;
    if (error instanceof Error) return error.message;
    if (typeof error === 'object') {
        const maybe = error as {
            data?: { statusMessage?: string };
            statusMessage?: string;
            message?: string;
        };
        return (
            maybe.data?.statusMessage ??
            maybe.statusMessage ??
            maybe.message ??
            'Unknown error'
        );
    }
    return String(error);
}

