declare const process: {
  env: Record<string, string | undefined>;
  exit(code?: number): never;
  cwd(): string;
};

declare function setTimeout(handler: (...args: any[]) => void, timeout?: number): number;
declare function clearTimeout(handle: number): void;

interface FetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<any>;
}

interface FetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

declare function fetch(input: string, init?: FetchInit): Promise<FetchResponse>;

interface AbortSignal {
  readonly aborted: boolean;
}

declare class AbortController {
  readonly signal: AbortSignal;
  constructor();
  abort(reason?: any): void;
}

declare module 'crypto' {
  interface Hash {
    update(data: string): Hash;
    digest(encoding: 'hex'): string;
  }

  interface CryptoModule {
    createHash(algorithm: string): Hash;
    randomUUID(): string;
  }

  const crypto: CryptoModule;
  export = crypto;
}

declare module 'fs' {
  function readFileSync(path: string, options?: { encoding: string } | string): string;
  function existsSync(path: string): boolean;
  export { readFileSync, existsSync };
}

declare module 'path' {
  function resolve(...paths: string[]): string;
  export { resolve };
}
