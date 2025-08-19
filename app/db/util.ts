import type { ZodTypeAny, infer as ZodInfer } from 'zod';

export function parseOrThrow<TSchema extends ZodTypeAny>(
    schema: TSchema,
    data: unknown
): ZodInfer<TSchema> {
    const res = schema.safeParse(data as any);
    if (!res.success) throw new Error(res.error.message);
    return res.data as ZodInfer<TSchema>;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function newId(): string {
    // Prefer Web Crypto if available
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
