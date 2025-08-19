import type { ZodSchema } from 'zod';

export function parseOrThrow<T>(schema: ZodSchema, data: unknown): T {
    const res = (schema as any).safeParse(data);
    if (!res.success) throw new Error(res.error.message);
    return res.data as T;
}

export const nowSec = () => Math.floor(Date.now() / 1000);

export function newId(): string {
    // Prefer Web Crypto if available
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID) return g.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
