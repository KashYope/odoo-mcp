interface EventEmitter {
  on(event: string | symbol, listener: (...args: any[]) => void): this;
  once(event: string | symbol, listener: (...args: any[]) => void): this;
  emit(event: string | symbol, ...args: any[]): boolean;
  removeListener(event: string | symbol, listener: (...args: any[]) => void): this;
  off?(event: string | symbol, listener: (...args: any[]) => void): this;
}

declare namespace NodeJS {
  type Signals =
    | 'SIGABRT'
    | 'SIGALRM'
    | 'SIGBUS'
    | 'SIGCHLD'
    | 'SIGCONT'
    | 'SIGFPE'
    | 'SIGHUP'
    | 'SIGILL'
    | 'SIGINT'
    | 'SIGIO'
    | 'SIGIOT'
    | 'SIGKILL'
    | 'SIGPIPE'
    | 'SIGPOLL'
    | 'SIGPROF'
    | 'SIGPWR'
    | 'SIGQUIT'
    | 'SIGSEGV'
    | 'SIGSTKFLT'
    | 'SIGSTOP'
    | 'SIGSYS'
    | 'SIGTERM'
    | 'SIGTRAP'
    | 'SIGTSTP'
    | 'SIGTTIN'
    | 'SIGTTOU'
    | 'SIGUNUSED'
    | 'SIGURG'
    | 'SIGUSR1'
    | 'SIGUSR2'
    | 'SIGVTALRM'
    | 'SIGWINCH'
    | 'SIGXCPU'
    | 'SIGXFSZ'
    | string;

  interface Process extends EventEmitter {
    env: Record<string, string | undefined>;
    exit(code?: number): never;
    cwd(): string;
  }
}

declare const process: NodeJS.Process;

declare class Buffer extends Uint8Array {
  static alloc(size: number): Buffer;
  static from(data: string | ArrayBuffer | Buffer | readonly number[], encoding?: string): Buffer;
  static concat(list: readonly Buffer[]): Buffer;
  writeUInt16BE(value: number, offset: number): number;
  readUInt16BE(offset: number): number;
  writeUInt32BE(value: number, offset: number): number;
  readUInt32BE(offset: number): number;
  subarray(start?: number, end?: number): Buffer;
  toString(encoding?: string): string;
  copy(target: Buffer, targetStart?: number): number;
  length: number;
}

declare module 'events' {
  export { EventEmitter };
}

declare module 'fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, options?: { encoding?: string } | string): string;
}

declare module 'path' {
  export function resolve(...paths: string[]): string;
}

declare module 'crypto' {
  interface Hash {
    update(data: string | ArrayBuffer | Buffer): Hash;
    digest(encoding?: string): string;
  }

  export function createHash(algorithm: string): Hash;
  export function randomUUID(): string;
}

declare module 'net' {
  export interface Socket extends EventEmitter {
    write(data: any, callback?: () => void): boolean;
    end(data?: any): void;
    destroy(error?: Error): void;
    setNoDelay(noDelay?: boolean): this;
    on(event: 'data', listener: (chunk: Buffer) => void): this;
    on(event: 'end', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }
}

declare module 'http' {
  import type { EventEmitter } from 'events';
  import type { Socket } from 'net';

  export interface IncomingMessage extends EventEmitter {
    headers: Record<string, string | string[] | undefined>;
    method?: string;
    url?: string;
  }

  export interface ServerResponse extends EventEmitter {
    writeHead(statusCode: number, headers?: Record<string, string>): void;
    end(data?: any): void;
  }

  export interface Server extends EventEmitter {
    listen(port: number, host: string, callback?: () => void): Server;
    close(callback?: (err?: Error) => void): void;
    address(): { address: string; port: number } | string | null;
    on(event: 'upgrade', listener: (req: IncomingMessage, socket: Socket, head: any) => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
  }

  export function createServer(listener?: (req: IncomingMessage, res: ServerResponse) => void): Server;
}

