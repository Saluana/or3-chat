export {};

declare global {
  interface ImportMeta {
    hot?: {
      dispose: (cb: (data: Record<string, unknown>) => void) => void;
      accept: (cb?: (mod: unknown) => void) => void;
      // add other hot properties if needed
    };
    glob: (pattern: string, options?: { eager?: boolean; import?: string; query?: string }) => Record<string, unknown>;
    dev?: boolean;
  }
}
