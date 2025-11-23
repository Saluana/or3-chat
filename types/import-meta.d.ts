export {};

declare global {
  interface ImportMeta {
    hot?: {
      dispose: (cb: (data: any) => void) => void;
      accept: (cb?: (mod: any) => void) => void;
      // add other hot properties if needed
    };
    glob: (pattern: string, options?: { eager?: boolean; import?: string; query?: string }) => Record<string, any>;
    dev?: boolean;
  }
}
