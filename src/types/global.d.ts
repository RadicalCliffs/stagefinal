// Global type declarations for runtime globals that may not be available in all environments

declare global {
  // Deno runtime namespace - used in server-side code
  namespace Deno {
    const env: {
      get(key: string): string | undefined;
    };
  }
  
  // Deno variable check
  const Deno: typeof Deno | undefined;
}

export {};
