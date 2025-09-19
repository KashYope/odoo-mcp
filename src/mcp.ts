import crypto from 'crypto';
import http, { IncomingMessage, ServerResponse } from 'http';
import net from 'net';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (input: any) => Promise<any> | AsyncIterable<any> | Iterable<any> | any;
}

export class ToolRegistry {
  private readonly tools: Map<string, Tool> = new Map();

  add(...tools: Tool[]): void {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
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

interface ListenOptions {
  port: number;
  host?: string;
  path?: string;
}

export interface McpServerHandle {
  close(): Promise<void>;
  port: number;
  host: string;
}

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: any;
}

interface JsonRpcError {
  code: number;
  message: string;
  data?: any;
}

interface Session {
  id: string;
  connection: WebSocketConnection;
  initialized: boolean;
  clientInfo?: any;
}

export class Host {
  public readonly tools: ToolRegistry;
  private readonly eventStore: InMemoryEventStore;
  private readonly sessions = new Set<Session>();

  constructor(options: HostOptions) {
    this.eventStore = options.eventStore;
    this.tools = new ToolRegistry();
  }

  async listen({ port, host = '0.0.0.0', path = '/mcp' }: ListenOptions): Promise<McpServerHandle> {
    const server = http.createServer((req, res) => this.handleHttpRequest(req, res));

    server.on('upgrade', (request, socket) => {
      const upgradeHeader = request.headers.upgrade;
      const upgradeValue = Array.isArray(upgradeHeader) ? upgradeHeader[0] : upgradeHeader;
      if (!request.url || !upgradeValue || upgradeValue.toLowerCase() !== 'websocket') {
        socket.destroy();
        return;
      }

      const requestUrl = new URL(request.url, `http://${request.headers.host ?? 'localhost'}`);
      if (requestUrl.pathname !== path) {
        socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
        socket.destroy();
        return;
      }

      try {
        this.handleUpgrade(request, socket);
      } catch (error) {
        socket.destroy();
        console.error('[MCP] Failed to negotiate WebSocket:', error);
      }
    });

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve();
      });
    });

    const actualAddress = server.address();
    const boundPort = typeof actualAddress === 'object' && actualAddress ? actualAddress.port : port;
    const boundHost = typeof actualAddress === 'object' && actualAddress && actualAddress.address ? actualAddress.address : host;

    this.eventStore.append({ type: 'host_started', port: boundPort, host: boundHost, timestamp: Date.now() });
    console.log(`[MCP] Host listening on ws://${boundHost === '::' ? 'localhost' : boundHost}:${boundPort}${path}`);

    return {
      port: boundPort,
      host: boundHost,
      close: async () => {
        this.eventStore.append({ type: 'host_stopping', timestamp: Date.now() });
        for (const session of this.sessions) {
          session.connection.close(1001, 'Server shutting down');
        }
        await new Promise<void>((resolve, reject) => {
          server.close((err) => (err ? reject(err) : resolve()));
        });
        this.sessions.clear();
        this.eventStore.append({ type: 'host_stopped', timestamp: Date.now() });
        console.log('[MCP] Host stopped');
      },
    };
  }

  private handleHttpRequest(req: IncomingMessage, res: ServerResponse): void {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }

  private handleUpgrade(request: IncomingMessage, socket: net.Socket): void {
    const secWebSocketKey = request.headers['sec-websocket-key'];
    if (typeof secWebSocketKey !== 'string') {
      throw new Error('Missing Sec-WebSocket-Key header');
    }

    const acceptKey = this.generateAcceptValue(secWebSocketKey);
    const protocolsHeader = request.headers['sec-websocket-protocol'];
    const requestedProtocols = Array.isArray(protocolsHeader)
      ? protocolsHeader.flatMap((value) => value.split(',').map((item) => item.trim()))
      : typeof protocolsHeader === 'string'
        ? protocolsHeader.split(',').map((item) => item.trim())
        : [];
    const selectedProtocol = requestedProtocols.find((protocol) => protocol === 'mcp' || protocol === 'mcp.v1');

    const responseHeaders = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
    ];

    if (selectedProtocol) {
      responseHeaders.push(`Sec-WebSocket-Protocol: ${selectedProtocol}`);
    }

    socket.write(responseHeaders.join('\r\n') + '\r\n\r\n');

    const connection = new WebSocketConnection(socket);
    const session: Session = {
      id: crypto.randomUUID(),
      connection,
      initialized: false,
    };
    this.sessions.add(session);
    this.eventStore.append({ type: 'session_connected', sessionId: session.id, timestamp: Date.now() });

    connection.on('message', (data) => this.handleIncomingMessage(session, data));
    connection.on('close', (info) => this.handleSessionClosed(session, info));
    connection.on('error', (error) => this.handleSessionError(session, error));
  }

  private handleIncomingMessage(session: Session, raw: string): void {
    let message: JsonRpcRequest;
    try {
      message = JSON.parse(raw) as JsonRpcRequest;
    } catch (error) {
      this.sendError(session, null, {
        code: -32700,
        message: 'Invalid JSON received from client',
        data: { raw },
      });
      return;
    }

    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
      this.sendError(session, message.id ?? null, {
        code: -32600,
        message: 'Invalid request',
      });
      return;
    }

    switch (message.method) {
      case 'initialize':
        this.handleInitialize(session, message);
        break;
      case 'tools/list':
        this.handleListTools(session, message);
        break;
      case 'tools/call':
        this.handleCallTool(session, message);
        break;
      case 'ping':
        this.sendResponse(session, message.id ?? null, { pong: true });
        break;
      default:
        this.sendError(session, message.id ?? null, {
          code: -32601,
          message: `Method not found: ${message.method}`,
        });
    }
  }

  private handleInitialize(session: Session, message: JsonRpcRequest): void {
    if (session.initialized) {
      this.sendError(session, message.id ?? null, {
        code: -32600,
        message: 'Session already initialized',
      });
      return;
    }

    session.initialized = true;
    session.clientInfo = message.params?.client ?? null;
    this.eventStore.append({ type: 'session_initialized', sessionId: session.id, client: session.clientInfo, timestamp: Date.now() });

    this.sendResponse(session, message.id ?? null, {
      protocolVersion: '2024-05-22',
      capabilities: {
        tools: {
          list: true,
          call: true,
          streaming: true,
        },
      },
      tools: this.tools.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  private handleListTools(session: Session, message: JsonRpcRequest): void {
    if (!session.initialized) {
      this.sendError(session, message.id ?? null, {
        code: -32001,
        message: 'Session not initialized',
      });
      return;
    }

    this.sendResponse(session, message.id ?? null, {
      tools: this.tools.list().map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      })),
    });
  }

  private handleCallTool(session: Session, message: JsonRpcRequest): void {
    if (!session.initialized) {
      this.sendError(session, message.id ?? null, {
        code: -32001,
        message: 'Session not initialized',
      });
      return;
    }

    const id = message.id ?? null;
    if (id === null) {
      this.sendError(session, null, {
        code: -32600,
        message: 'Tool invocation requires a request id',
      });
      return;
    }

    const toolName = message.params?.name;
    if (typeof toolName !== 'string') {
      this.sendError(session, id, {
        code: -32602,
        message: 'Missing tool name',
      });
      return;
    }

    const tool = this.tools.get(toolName);
    if (!tool) {
      this.sendError(session, id, {
        code: -32601,
        message: `Unknown tool: ${toolName}`,
      });
      return;
    }

    const invocationId = typeof id === 'string' ? id : String(id);
    const args = message.params?.arguments ?? {};
    this.eventStore.append({
      type: 'tool_invocation_started',
      sessionId: session.id,
      tool: tool.name,
      invocationId,
      arguments: args,
      timestamp: Date.now(),
    });

    (async () => {
      try {
        const result = await tool.execute(args);
        if (isAsyncIterable(result) || isStreamableIterable(result)) {
          for await (const chunk of toAsyncIterable(result)) {
            this.sendNotification(session, 'tools/stream', {
              invocationId,
              chunk,
            });
          }
          this.sendResponse(session, id, { status: 'completed', streamed: true });
        } else {
          this.sendResponse(session, id, { status: 'completed', result });
        }
        this.eventStore.append({
          type: 'tool_invocation_completed',
          sessionId: session.id,
          tool: tool.name,
          invocationId,
          timestamp: Date.now(),
        });
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.eventStore.append({
          type: 'tool_invocation_failed',
          sessionId: session.id,
          tool: tool.name,
          invocationId,
          error: err.message,
          timestamp: Date.now(),
        });
        this.sendError(session, id, {
          code: -32000,
          message: err.message,
        });
      }
    })().catch((error) => {
      console.error('[MCP] Unexpected error handling tool invocation:', error);
    });
  }

  private handleSessionClosed(session: Session, info: CloseInfo): void {
    this.sessions.delete(session);
    this.eventStore.append({
      type: 'session_closed',
      sessionId: session.id,
      code: info.code,
      reason: info.reason,
      timestamp: Date.now(),
    });
  }

  private handleSessionError(session: Session, error: Error): void {
    this.eventStore.append({
      type: 'session_error',
      sessionId: session.id,
      error: error.message,
      timestamp: Date.now(),
    });
    console.error(`[MCP] Session ${session.id} error:`, error);
  }

  private sendResponse(session: Session, id: number | string | null, result: any): void {
    const payload = {
      jsonrpc: '2.0',
      id,
      result,
    };
    session.connection.send(JSON.stringify(payload));
  }

  private sendError(session: Session, id: number | string | null, error: JsonRpcError): void {
    const payload = {
      jsonrpc: '2.0',
      id,
      error,
    };
    session.connection.send(JSON.stringify(payload));
  }

  private sendNotification(session: Session, method: string, params: any): void {
    const payload = {
      jsonrpc: '2.0',
      method,
      params,
    };
    session.connection.send(JSON.stringify(payload));
  }

  private generateAcceptValue(secWebSocketKey: string): string {
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    return crypto.createHash('sha1').update(secWebSocketKey + GUID).digest('base64');
  }
}

interface DecodedFrame {
  fin: boolean;
  opcode: number;
  payload: Buffer;
  totalLength: number;
}

interface CloseInfo {
  code: number;
  reason: string;
}

type ConnectionEventMap = {
  message: [string];
  close: [CloseInfo];
  error: [Error];
};

type ConnectionEvent = keyof ConnectionEventMap;

class WebSocketConnection {
  private readonly socket: net.Socket;
  private buffer = Buffer.alloc(0);
  private readonly listeners: { [K in ConnectionEvent]?: Array<(...args: ConnectionEventMap[K]) => void> } = {};
  private closed = false;

  constructor(socket: net.Socket) {
    this.socket = socket;
    this.socket.on('data', (data) => this.handleData(data));
    this.socket.on('error', (err) => this.emit('error', err instanceof Error ? err : new Error(String(err))));
    this.socket.on('end', () => this.handleSocketEnd());
    this.socket.on('close', () => this.handleSocketEnd());
  }

  send(payload: string): void {
    if (this.closed) {
      return;
    }
    const data = Buffer.from(payload, 'utf8');
    const frame = encodeFrame(data, 0x1);
    this.socket.write(frame);
  }

  close(code: number = 1000, reason: string = ''): void {
    if (this.closed) {
      return;
    }
    const reasonBuffer = Buffer.from(reason, 'utf8');
    const payload = Buffer.alloc(2 + reasonBuffer.length);
    payload.writeUInt16BE(code, 0);
    reasonBuffer.copy(payload, 2);
    const frame = encodeFrame(payload, 0x8);
    this.socket.write(frame, () => {
      this.socket.end();
    });
    this.closed = true;
  }

  on<E extends ConnectionEvent>(event: E, listener: (...args: ConnectionEventMap[E]) => void): void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event]!.push(listener);
  }

  private emit<E extends ConnectionEvent>(event: E, ...args: ConnectionEventMap[E]): void {
    const handlers = this.listeners[event];
    if (!handlers) {
      return;
    }
    for (const handler of handlers) {
      handler(...args);
    }
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const frame = decodeFrame(this.buffer);
      if (!frame) {
        break;
      }

      this.buffer = this.buffer.subarray(frame.totalLength);

      switch (frame.opcode) {
        case 0x1: {
          if (!frame.fin) {
            this.close(1003, 'Fragmented frames are not supported');
            return;
          }
          const text = frame.payload.toString('utf8');
          this.emit('message', text);
          break;
        }
        case 0x8: {
          const { code, reason } = decodeCloseFrame(frame.payload);
          this.emit('close', { code, reason });
          this.closed = true;
          this.socket.end();
          return;
        }
        case 0x9: {
          const pongFrame = encodeFrame(frame.payload, 0xA);
          this.socket.write(pongFrame);
          break;
        }
        case 0xA: {
          break; // Pong - ignore
        }
        default: {
          // Unsupported opcode; close the connection
          this.close(1003, 'Unsupported WebSocket opcode');
          return;
        }
      }
    }
  }

  private handleSocketEnd(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.emit('close', { code: 1006, reason: 'Socket closed unexpectedly' });
  }
}

function decodeFrame(buffer: Buffer): DecodedFrame | null {
  if (buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }
    const high = buffer.readUInt32BE(offset);
    const low = buffer.readUInt32BE(offset + 4);
    offset += 8;
    if (high !== 0) {
      throw new Error('WebSocket frames larger than 4GB are not supported');
    }
    payloadLength = low;
  }

  let maskingKey: Buffer | undefined;
  if (masked) {
    if (buffer.length < offset + 4) {
      return null;
    }
    maskingKey = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.length < offset + payloadLength) {
    return null;
  }

  let payload = buffer.subarray(offset, offset + payloadLength);
  if (masked) {
    payload = applyMask(payload, maskingKey!);
  } else {
    payload = Buffer.from(payload);
  }

  return {
    fin,
    opcode,
    payload,
    totalLength: offset + payloadLength,
  };
}

function encodeFrame(payload: Buffer, opcode: number): Buffer {
  const fin = 0x80;
  const firstByte = fin | (opcode & 0x0f);
  let header = Buffer.from([firstByte]);
  let lengthByte = 0;
  let extendedLength: Buffer | null = null;

  if (payload.length < 126) {
    lengthByte = payload.length;
  } else if (payload.length < 65536) {
    lengthByte = 126;
    extendedLength = Buffer.alloc(2);
    extendedLength.writeUInt16BE(payload.length, 0);
  } else {
    lengthByte = 127;
    extendedLength = Buffer.alloc(8);
    extendedLength.writeUInt32BE(0, 0);
    extendedLength.writeUInt32BE(payload.length, 4);
  }

  const secondByte = lengthByte;
  const baseHeader = Buffer.from([firstByte, secondByte]);

  if (extendedLength) {
    header = Buffer.concat([baseHeader, extendedLength]);
  } else {
    header = baseHeader;
  }

  return Buffer.concat([header, payload]);
}

function applyMask(buffer: Buffer, mask: Buffer): Buffer {
  const result = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) {
    result[i] = buffer[i] ^ mask[i % 4];
  }
  return result;
}

function decodeCloseFrame(payload: Buffer): CloseInfo {
  if (payload.length < 2) {
    return { code: 1005, reason: '' };
  }
  const code = payload.readUInt16BE(0);
  const reason = payload.length > 2 ? payload.subarray(2).toString('utf8') : '';
  return { code, reason };
}

function isAsyncIterable(value: any): value is AsyncIterable<unknown> {
  return value !== null && typeof value === 'object' && Symbol.asyncIterator in value;
}

function isIterable(value: any): value is Iterable<unknown> {
  return value !== null && typeof value === 'object' && Symbol.iterator in value;
}

function isStreamableIterable(value: any): value is Iterable<unknown> {
  return isIterable(value) && typeof (value as any) !== 'string';
}

async function* toAsyncIterable(value: AsyncIterable<any> | Iterable<any>): AsyncIterable<any> {
  if (isAsyncIterable(value)) {
    for await (const item of value) {
      yield item;
    }
    return;
  }

  for (const item of value as Iterable<any>) {
    yield item;
  }
}
