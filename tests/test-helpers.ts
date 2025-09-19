export type AnyFn = (...args: any[]) => any;

export interface MockFunction<TArgs extends any[] = any[], TReturn = any> {
  (...args: TArgs): TReturn;
  mock: { calls: TArgs[] };
  mockImplementation(impl: (...args: TArgs) => TReturn): MockFunction<TArgs, TReturn>;
  mockReturnValue(value: TReturn): MockFunction<TArgs, TReturn>;
  mockResolvedValue(value: any): MockFunction<TArgs, any>;
  mockRejectedValue(error: any): MockFunction<TArgs, any>;
  mockClear(): void;
  mockRestore(): void;
}

interface RegisteredSpy {
  restore(): void;
}

class SpyRegistry {
  private readonly spies = new Set<RegisteredSpy>();

  register(entry: RegisteredSpy): void {
    this.spies.add(entry);
  }

  restoreAll(): void {
    for (const entry of this.spies) {
      entry.restore();
    }
    this.spies.clear();
  }
}

const registry = new SpyRegistry();

export function fn<TArgs extends any[] = any[], TReturn = any>(
  implementation?: (...args: TArgs) => TReturn
): MockFunction<TArgs, TReturn> {
  const calls: TArgs[] = [];
  let impl: ((...args: TArgs) => TReturn) | undefined = implementation;

  const mockFunction = (...args: TArgs) => {
    calls.push(args);
    if (impl) {
      return impl(...args);
    }
    return undefined as unknown as TReturn;
  };

  const typedMock = mockFunction as unknown as MockFunction<TArgs, TReturn>;
  typedMock.mock = { calls };
  typedMock.mockImplementation = (nextImpl: (...args: TArgs) => TReturn) => {
    impl = nextImpl;
    return typedMock;
  };
  typedMock.mockReturnValue = (value: TReturn) => {
    impl = () => value;
    return typedMock;
  };
  typedMock.mockResolvedValue = (value: any) => {
    impl = () => Promise.resolve(value) as unknown as TReturn;
    return typedMock as unknown as MockFunction<TArgs, any>;
  };
  typedMock.mockRejectedValue = (error: any) => {
    impl = () => Promise.reject(error) as unknown as TReturn;
    return typedMock as unknown as MockFunction<TArgs, any>;
  };
  typedMock.mockClear = () => {
    calls.length = 0;
  };
  typedMock.mockRestore = () => {
    impl = implementation;
    calls.length = 0;
  };

  registry.register({ restore: () => typedMock.mockRestore() });
  return typedMock;
}

export function spyOn<T extends object, K extends keyof T>(
  target: T,
  property: K
): MockFunction<any, any> {
  const original = target[property] as unknown as AnyFn;
  const boundOriginal = typeof original === 'function' ? original.bind(target) : () => original;
  const spy = fn(boundOriginal);

  (target as any)[property] = spy;
  registry.register({
    restore: () => {
      (target as any)[property] = original;
      spy.mockRestore();
    },
  });

  return spy;
}

export function restoreAllMocks(): void {
  registry.restoreAll();
}
