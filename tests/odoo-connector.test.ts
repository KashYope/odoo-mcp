import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import type { OdooTransport, OdooConnectionConfig } from '../src/odoo-connector';
import { fn, restoreAllMocks } from './test-helpers';

process.env.ODOO_URL = process.env.ODOO_URL ?? 'https://odoo.test';
process.env.ODOO_DB = process.env.ODOO_DB ?? 'test-db';
process.env.ODOO_USERNAME = process.env.ODOO_USERNAME ?? 'tester@example.com';
process.env.ODOO_API_KEY = process.env.ODOO_API_KEY ?? 'test-key';

const {
  JsonRpcTransport,
  OdooConnector,
  loadConfigFromEnv,
} = require('../src/odoo-connector') as typeof import('../src/odoo-connector');

describe('JsonRpcTransport error handling', () => {
  const config: OdooConnectionConfig = {
    baseUrl: 'https://example.odoo.com',
    db: 'example-db',
    username: 'user@example.com',
    apiKey: 'secret',
  };
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreAllMocks();
  });

  it('throws when HTTP response is not ok', async () => {
    const fetchMock = fn().mockResolvedValue({ ok: false, status: 500 });
    globalThis.fetch = fetchMock as any;
    const transport = new JsonRpcTransport(config);
    await assert.rejects(transport.callCommon('version'), {
      message: 'Odoo request failed with status 500',
    });
    assert.equal(fetchMock.mock.calls.length, 1);
  });

  it('throws when RPC response contains an error payload', async () => {
    const fetchMock = fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        jsonrpc: '2.0',
        id: '1',
        error: { message: 'Access denied', data: { details: 'nope' } },
      }),
    });
    globalThis.fetch = fetchMock as any;
    const transport = new JsonRpcTransport(config);
    await assert.rejects(transport.callCommon('version'), {
      message: 'Access denied: {"details":"nope"}',
    });
  });

  it('throws when RPC response lacks a result', async () => {
    const fetchMock = fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: '1' }),
    });
    globalThis.fetch = fetchMock as any;
    const transport = new JsonRpcTransport(config);
    await assert.rejects(transport.callCommon('version'), {
      message: 'No result returned from Odoo.',
    });
  });

  it('wraps AbortError rejections with a friendly timeout message', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const fetchMock = fn().mockRejectedValue(abortError);
    globalThis.fetch = fetchMock as any;
    const transport = new JsonRpcTransport(config);
    await assert.rejects(transport.callCommon('version'), {
      message: 'The request to Odoo timed out.',
    });
  });

  it('returns data when the RPC call succeeds', async () => {
    const fetchMock = fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: '1', result: { server_version: '17.0' } }),
    });
    globalThis.fetch = fetchMock as any;
    const transport = new JsonRpcTransport(config);
    const result = await transport.callCommon('version');
    assert.deepStrictEqual(result, { server_version: '17.0' });
  });
});

describe('OdooConnector', () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it('requires connect() to be called before executing RPC methods', async () => {
    const connectMock = fn<any[], Promise<number>>().mockResolvedValue(42);
    const executeMock = fn<any[], Promise<any>>();
    const callCommonMock = fn<any[], Promise<any>>();
    const getUidMock = fn().mockReturnValue(42);
    const transport: OdooTransport = {
      connect: connectMock as any,
      executeKw: executeMock as any,
      callCommon: callCommonMock as any,
      getUid: getUidMock as any,
    };
    const connector = new OdooConnector(transport);
    await assert.rejects(connector.execute('res.partner', 'search_read'), {
      message: 'Not connected to Odoo. Please call connect() first.',
    });
    await connector.connect();
    assert.equal(connectMock.mock.calls.length, 1);
    executeMock.mockResolvedValue(['ok']);
    const result = await connector.execute('res.partner', 'search_read');
    assert.deepStrictEqual(result, ['ok']);
  });

  it('stores the authenticated uid when connect() succeeds', async () => {
    const connector = new OdooConnector({
      connect: async () => 99,
      executeKw: async () => { throw new Error('not used'); },
      callCommon: async () => { throw new Error('not used'); },
      getUid: () => 99,
    });
    await connector.connect();
    assert.equal(connector.getUid(), 99);
  });

  it('fails authentication when the uid is not a number', async () => {
    const transport = new JsonRpcTransport({
      baseUrl: 'https://example.odoo.com',
      db: 'example-db',
      username: 'user@example.com',
      apiKey: 'secret',
    });
    const originalFetch = globalThis.fetch;
    const fetchMock = fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ jsonrpc: '2.0', id: '1', result: 'oops' }),
    });
    globalThis.fetch = fetchMock as any;
    await assert.rejects(transport.connect(), {
      message: 'Authentication failed. Ensure your credentials and API access are correct.',
    });
    globalThis.fetch = originalFetch;
  });
});

describe('loadConfigFromEnv', () => {
  const keys = ['ODOO_URL', 'ODOO_DB', 'ODOO_USERNAME', 'ODOO_API_KEY'] as const;
  const originalValues: Record<(typeof keys)[number], string | undefined> = {
    ODOO_URL: process.env.ODOO_URL,
    ODOO_DB: process.env.ODOO_DB,
    ODOO_USERNAME: process.env.ODOO_USERNAME,
    ODOO_API_KEY: process.env.ODOO_API_KEY,
  };

  afterEach(() => {
    for (const key of keys) {
      if (originalValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValues[key] as string;
      }
    }
  });

  it('throws when any required environment variable is missing', () => {
    for (const key of keys) {
      delete process.env[key];
    }
    assert.throws(() => loadConfigFromEnv(), {
      message:
        'Missing required Odoo configuration. Please set ODOO_URL, ODOO_DB, ODOO_USERNAME, and ODOO_API_KEY in your environment.',
    });
  });

  it('returns the connection config when all variables are set', () => {
    process.env.ODOO_URL = 'https://example.odoo.com';
    process.env.ODOO_DB = 'example-db';
    process.env.ODOO_USERNAME = 'user@example.com';
    process.env.ODOO_API_KEY = 'secret';
    const config = loadConfigFromEnv();
    assert.deepStrictEqual(config, {
      baseUrl: 'https://example.odoo.com',
      db: 'example-db',
      username: 'user@example.com',
      apiKey: 'secret',
    });
  });
});
