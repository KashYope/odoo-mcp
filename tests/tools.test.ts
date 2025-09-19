import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { ActionStateStore, InMemoryEventStore, type ToolExecutionContext } from '../src/mcp';
import { fn, spyOn, restoreAllMocks } from './test-helpers';

process.env.ODOO_URL = process.env.ODOO_URL ?? 'https://odoo.test';
process.env.ODOO_DB = process.env.ODOO_DB ?? 'test-db';
process.env.ODOO_USERNAME = process.env.ODOO_USERNAME ?? 'tester@example.com';
process.env.ODOO_API_KEY = process.env.ODOO_API_KEY ?? 'test-key';

const { createTool, __testables } = require('../src/tools') as typeof import('../src/tools');
const { odooConnector } = require('../src/odoo-connector') as typeof import('../src/odoo-connector');

describe('field sanitization helpers', () => {
  const { ensureFieldsAllowed, sanitizeValues, sanitizeOrder } = __testables;

  it('falls back to the model whitelist when fields are omitted', () => {
    const fields = ensureFieldsAllowed('res.partner');
    assert.ok(fields.length > 0);
    assert.ok(fields.includes('name'));
  });

  it('throws when a requested field is not allowed', () => {
    assert.throws(
      () => ensureFieldsAllowed('res.partner', ['id', 'forbidden_field']),
      /Fields not allowed for model res\.partner: forbidden_field/
    );
  });

  it('strips disallowed keys from values payloads', () => {
    const sanitized = sanitizeValues('res.partner', {
      name: 'Alice',
      email: 'alice@example.com',
      sneaky: 'value',
    });
    assert.deepStrictEqual(sanitized, { name: 'Alice', email: 'alice@example.com' });
  });

  it('rejects order clauses that reference non-whitelisted fields', () => {
    assert.throws(
      () => sanitizeOrder('res.partner', 'name ASC, forbidden DESC'),
      /Order clause references disallowed fields: forbidden DESC/
    );
    assert.equal(sanitizeOrder('res.partner', 'name ASC, email DESC'), 'name ASC, email DESC');
  });
});

describe('PII masking', () => {
  const { maskRecord, maskString } = __testables;

  it('masks sensitive fields while keeping other data intact', () => {
    const record = {
      id: 1,
      name: 'Alice',
      email: 'alice@example.com',
      phone: '1234567890',
      nested: { city: 'New York', safe: 'ok' },
    };
    const masked = maskRecord(record);
    assert.equal(masked.email, maskString('alice@example.com'));
    assert.equal(masked.phone, maskString('1234567890'));
    assert.equal(masked.name, 'Alice');
    assert.equal(masked.nested.city, maskString('New York'));
    assert.equal(masked.nested.safe, 'ok');
  });
});

describe('create tool confirmation workflow', () => {
  const { sanitizeValues, maskRecord } = __testables;
  let context: ToolExecutionContext;

  beforeEach(() => {
    const eventStore = new InMemoryEventStore();
    const actionStore = new ActionStateStore(eventStore);
    context = {
      sessionId: 'session-1',
      clientInfo: { name: 'Reviewer' },
      eventStore,
      actionStore,
    };
    spyOn(odooConnector, 'checkAccessRights').mockResolvedValue(true);
    spyOn(odooConnector, 'create').mockResolvedValue(123);
  });

  afterEach(() => {
    restoreAllMocks();
  });

  it('requires plan → dry_run → confirm and masks sensitive previews', async () => {
    const input = {
      model: 'res.partner',
      values: { name: 'Alice', email: 'alice@example.com', sneaky: 'ignore me' },
    };

    const planResult = await createTool.execute({ ...input, mode: 'plan' }, context);
    assert.equal(planResult.action, 'plan:create');
    assert.ok(planResult.action_id);
    assert.deepStrictEqual(planResult.metadata, { requested_by: 'Reviewer' });
    const expectedValues = sanitizeValues('res.partner', input.values);
    assert.deepStrictEqual(planResult.payload.values, expectedValues);

    const dryRunResult = await createTool.execute({ ...input, mode: 'dry_run' }, context);
    assert.equal(dryRunResult.action, 'dry_run:create');
    assert.equal(dryRunResult.action_id, planResult.action_id);
    assert.equal(dryRunResult.metadata.approved_by, 'Reviewer');
    const maskedValues = maskRecord(expectedValues);
    assert.deepStrictEqual(dryRunResult.payload.values, maskedValues);

    const confirmResult = await createTool.execute(
      { ...input, mode: 'confirm', action_id: dryRunResult.action_id },
      context
    );
    const createMock = odooConnector.create as unknown as ReturnType<typeof fn>;
    assert.equal(createMock.mock.calls.length, 1);
    assert.deepStrictEqual(createMock.mock.calls[0][1], expectedValues);
    assert.deepStrictEqual(confirmResult.metadata.requested_by, 'Reviewer');
    assert.equal(confirmResult.metadata.approved_by, 'Reviewer');
    assert.equal(confirmResult.metadata.confirmed_by, 'Reviewer');
    assert.equal(confirmResult.approval.approved_by, 'Reviewer');
    assert.equal(confirmResult.id, 123);
  });
});
