import { z } from 'zod';

export function extractFirstJsonObject(input: string): string | null {
    const start = input.indexOf('{');
    const end = input.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    return input.slice(start, end + 1);
}

export function parseModelJson<T>(
    input: string,
    schema: z.ZodType<T>
): { ok: true; data: T } | { ok: false; error: string } {
    const jsonString = extractFirstJsonObject(input);
    if (!jsonString) return { ok: false, error: 'No JSON object found in model response' };

    try {
        const parsed = JSON.parse(jsonString) as unknown;
        const validated = schema.safeParse(parsed);
        if (!validated.success) {
            return {
                ok: false,
                error: validated.error.issues[0]?.message ?? 'Invalid model response shape',
            };
        }
        return { ok: true, data: validated.data };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Failed to parse model JSON',
        };
    }
}
