import { getDb } from '~/db/client';

export type ValidationStatus = 'found' | 'missing' | 'deleted';

interface ValidateRecordOptions<T> {
    id: string;
    attempts?: number;
    delayMs?: number;
    getRecord: (db: ReturnType<typeof getDb>, id: string) => Promise<T | undefined>;
    isValid: (record: T) => boolean;
    isDeleted: (record: T) => boolean;
}

export async function validateDbRecordWithRetry<T>(
    options: ValidateRecordOptions<T>
): Promise<ValidationStatus> {
    const db = getDb();
    const attempts = options.attempts ?? 5;
    const delayMs = options.delayMs ?? 50;

    try {
        if (!db.isOpen()) await db.open();
    } catch {
        // ignore and still attempt lookups
    }

    for (let index = 0; index < attempts; index++) {
        try {
            const record = await options.getRecord(db, options.id);
            if (record && options.isValid(record)) {
                return options.isDeleted(record) ? 'deleted' : 'found';
            }
        } catch {
            // ignore and continue retries
        }

        if (index < attempts - 1) {
            await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
    }

    return 'missing';
}
