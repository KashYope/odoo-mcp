export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: any) => Promise<any> | any;
}

class ToolRegistry {
  private readonly tools: Tool[] = [];

  add(...tools: Tool[]): void {
    this.tools.push(...tools);
  }

  list(): Tool[] {
    return [...this.tools];
  }
}

export class InMemoryEventStore {
  private readonly events: any[] = [];

  append(event: any): void {
    this.events.push(event);
  }

  all(): any[] {
    return [...this.events];
  }
}

interface HostOptions {
  eventStore: InMemoryEventStore;
}

export class Host {
  public readonly tools: ToolRegistry;
  private readonly eventStore: InMemoryEventStore;

  constructor(options: HostOptions) {
    this.eventStore = options.eventStore;
    this.tools = new ToolRegistry();
  }

  listen({ port }: { port: number }): void {
    this.eventStore.append({ type: 'host_started', port, timestamp: Date.now() });
    console.log(`[MCP] Host listening on port ${port}`);
  }
}
