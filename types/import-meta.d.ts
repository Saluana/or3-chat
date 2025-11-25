export {};

declare global {
    interface ImportMetaEnv {
        readonly NUXT_PUBLIC_MAX_MESSAGE_FILES?: string;
        readonly [key: string]: string | boolean | undefined;
    }

    interface ImportMeta {
        readonly env: ImportMetaEnv;
        hot?: {
            dispose: (cb: (data: Record<string, unknown>) => void) => void;
            accept: (cb?: (mod: unknown) => void) => void;
            // add other hot properties if needed
        };
        glob: (
            pattern: string,
            options?: { eager?: boolean; import?: string; query?: string }
        ) => Record<string, unknown>;
        dev?: boolean;
    }
}
