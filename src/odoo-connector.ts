import crypto from 'crypto';
import { loadEnv } from './env-loader';

loadEnv();

export interface OdooConnectionConfig {
  baseUrl: string;
  db: string;
  username: string;
  apiKey: string;
}

interface JsonRpcParams {
  service: 'common' | 'object';
  method: string;
  args: any[];
  kwargs?: Record<string, any>;
}

interface JsonRpcResponse<T> {
  jsonrpc: string;
  id: string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: any;
  };
}

export interface OdooTransport {
  connect(): Promise<number>;
  executeKw<T>(model: string, method: string, params?: any[], kwargs?: Record<string, any>): Promise<T>;
  callCommon<T>(method: string, args?: any[]): Promise<T>;
  getUid(): number | null;
}

export class JsonRpcTransport implements OdooTransport {
  private readonly config: OdooConnectionConfig;
  private readonly baseUrl: string;
  private readonly timeout = 15000;
  private uid: number | null = null;

  constructor(config: OdooConnectionConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
  }

  private async request<T>(params: JsonRpcParams): Promise<T> {
    const payload = {
      jsonrpc: '2.0',
      method: 'call',
      params,
      id: crypto.randomUUID(),
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/jsonrpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Odoo request failed with status ${response.status}`);
      }

      const data = (await response.json()) as JsonRpcResponse<T>;
      if (data.error) {
        throw new Error(`${data.error.message}: ${JSON.stringify(data.error.data)}`);
      }
      if (data.result === undefined) {
        throw new Error('No result returned from Odoo.');
      }
      return data.result;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('The request to Odoo timed out.');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async connect(): Promise<number> {
    const uid = await this.request<number>({
      service: 'common',
      method: 'authenticate',
      args: [this.config.db, this.config.username, this.config.apiKey, {}],
    });

    if (typeof uid !== 'number') {
      throw new Error('Authentication failed. Ensure your credentials and API access are correct.');
    }

    this.uid = uid;
    return uid;
  }

  async executeKw<T>(model: string, method: string, params: any[] = [], kwargs: Record<string, any> = {}): Promise<T> {
    if (this.uid === null) {
      throw new Error('Not authenticated with Odoo. Call connect() first.');
    }

    const args = [this.config.db, this.uid, this.config.apiKey, model, method, params, kwargs];
    return this.request<T>({ service: 'object', method: 'execute_kw', args });
  }

  async callCommon<T>(method: string, args: any[] = []): Promise<T> {
    return this.request<T>({
      service: 'common',
      method,
      args,
    });
  }

  getUid(): number | null {
    return this.uid;
  }
}

export function loadConfigFromEnv(): OdooConnectionConfig {
  const baseUrl = process.env.ODOO_URL;
  const db = process.env.ODOO_DB;
  const username = process.env.ODOO_USERNAME;
  const apiKey = process.env.ODOO_API_KEY;

  if (!baseUrl || !db || !username || !apiKey) {
    throw new Error('Missing required Odoo configuration. Please set ODOO_URL, ODOO_DB, ODOO_USERNAME, and ODOO_API_KEY in your environment.');
  }

  return { baseUrl, db, username, apiKey };
}

export class OdooConnector {
  private readonly transport: OdooTransport;
  private uid: number | null = null;

  constructor(transport?: OdooTransport) {
    this.transport = transport ?? new JsonRpcTransport(loadConfigFromEnv());
  }

  public async connect(): Promise<void> {
    const uid = await this.transport.connect();
    this.uid = uid;
    console.log(`Successfully connected to Odoo. UID: ${uid}`);
  }

  public getUid(): number | null {
    return this.uid;
  }

  private ensureConnected(): void {
    if (this.uid === null) {
      throw new Error('Not connected to Odoo. Please call connect() first.');
    }
  }

  private logRequest(model: string, method: string, params: any[], kwargs: Record<string, any>): string {
    const payloadHash = crypto.createHash('sha256').update(JSON.stringify({ model, method, params, kwargs })).digest('hex');
    const requestId = payloadHash.slice(0, 12);
    console.log(`[Odoo] -> ${model}.${method} (request ${requestId})`);
    return requestId;
  }

  private logResponse(model: string, method: string, requestId: string, error?: Error): void {
    if (error) {
      console.error(`[Odoo] !! ${model}.${method} (request ${requestId})`, error.message);
    } else {
      console.log(`[Odoo] <- ${model}.${method} (request ${requestId})`);
    }
  }

  public async execute<T>(model: string, method: string, params: any[] = [], kwargs: Record<string, any> = {}): Promise<T> {
    this.ensureConnected();
    const requestId = this.logRequest(model, method, params, kwargs);
    try {
      const result = await this.transport.executeKw<T>(model, method, params, kwargs);
      this.logResponse(model, method, requestId);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logResponse(model, method, requestId, err);
      throw err;
    }
  }

  public async searchRead<T>(
    model: string,
    domain: any[] = [],
    fields: string[] = [],
    limit: number = 80,
    offset: number = 0,
    order: string = ''
  ): Promise<T[]> {
    const kwargs: Record<string, any> = {
      fields,
      limit,
      offset,
    };
    if (order) {
      kwargs.order = order;
    }
    return this.execute<T[]>(model, 'search_read', [domain], kwargs);
  }

  public async read<T>(model: string, ids: number[], fields: string[] = []): Promise<T[]> {
    const params: any[] = [ids];
    if (fields.length > 0) {
      params.push(fields);
    }
    return this.execute<T[]>(model, 'read', params);
  }

  public async count(model: string, domain: any[]): Promise<number> {
    return this.execute<number>(model, 'search_count', [domain]);
  }

  public async create(model: string, values: Record<string, any>): Promise<number> {
    return this.execute<number>(model, 'create', [values]);
  }

  public async write(model: string, ids: number[], values: Record<string, any>): Promise<boolean> {
    return this.execute<boolean>(model, 'write', [ids, values]);
  }

  public async unlink(model: string, ids: number[]): Promise<boolean> {
    return this.execute<boolean>(model, 'unlink', [ids]);
  }

  public async callKw<T>(model: string, method: string, args: any[] = [], kwargs: Record<string, any> = {}): Promise<T> {
    return this.execute<T>(model, method, args, kwargs);
  }

  public async checkAccessRights(model: string, operation: 'create' | 'write' | 'unlink'): Promise<boolean> {
    return this.execute<boolean>(model, 'check_access_rights', [operation], { raise_exception: false });
  }

  public async getVersion(): Promise<Record<string, any>> {
    return this.transport.callCommon<Record<string, any>>('version');
  }
}

// Export a singleton instance of the connector
export const odooConnector = new OdooConnector();
