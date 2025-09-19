import { ActionStageRecord, Tool, ToolExecutionContext } from './mcp';
import { odooConnector } from './odoo-connector';
import {
  ALLOWED_MODELS,
  BUSINESS_METHOD_WHITELIST,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PII_FIELDS,
  SAFE_MODELS,
  WRITABLE_MODELS,
} from './config';

const EXECUTION_MODES = ['plan', 'dry_run', 'confirm'] as const;
type ExecutionMode = (typeof EXECUTION_MODES)[number];

const executionModeSchema = {
  type: 'string',
  enum: EXECUTION_MODES,
  description: 'Execution mode: plan, dry_run, or confirm.',
};

type SearchReadInput = {
  model: string;
  domain?: any[];
  fields?: string[];
  limit?: number;
  order?: string;
};

type GetInput = {
  model: string;
  id: number;
  fields?: string[];
};

type CountInput = {
  model: string;
  domain?: any[];
};

type CreateInput = {
  model: string;
  values: Record<string, any>;
  mode: ExecutionMode;
  action_id?: string;
};

type WriteInput = {
  model: string;
  ids: number | number[];
  values: Record<string, any>;
  mode: ExecutionMode;
  action_id?: string;
};

type UnlinkInput = {
  model: string;
  ids: number | number[];
  mode: ExecutionMode;
  action_id?: string;
};

type CallKwInput = {
  model: string;
  method: string;
  args?: any[];
  kwargs?: Record<string, any>;
  mode: ExecutionMode;
  action_id?: string;
};

function assertModelAllowed(model: string): void {
  if (!SAFE_MODELS.includes(model)) {
    throw new Error(`Model "${model}" is not in the whitelist.`);
  }
}

function assertModelWritable(model: string): void {
  if (!WRITABLE_MODELS.includes(model)) {
    throw new Error(`Model "${model}" is not allowed for write operations.`);
  }
}

function ensureFieldsAllowed(model: string, requestedFields?: string[]): string[] {
  const allowed = ALLOWED_MODELS[model].fields;
  if (!requestedFields) {
    return allowed;
  }
  if (!Array.isArray(requestedFields)) {
    throw new Error('Fields must be provided as an array.');
  }
  const invalid = requestedFields.filter((field) => !allowed.includes(field));
  if (invalid.length > 0) {
    throw new Error(`Fields not allowed for model ${model}: ${invalid.join(', ')}`);
  }
  return requestedFields.length > 0 ? requestedFields : allowed;
}

function sanitizeOrder(model: string, order?: string): string | undefined {
  if (!order) {
    return undefined;
  }
  if (typeof order !== 'string') {
    throw new Error('Order must be a string.');
  }
  const allowedFields = ALLOWED_MODELS[model].fields;
  const clauses = order
    .split(',')
    .map((clause) => clause.trim())
    .filter(Boolean);

  const invalid = clauses.filter((clause) => {
    const [field] = clause.split(' ');
    return !allowedFields.includes(field);
  });

  if (invalid.length > 0) {
    throw new Error(`Order clause references disallowed fields: ${invalid.join(', ')}`);
  }

  return clauses.join(', ');
}

function sanitizeValues(model: string, values: Record<string, any>): Record<string, any> {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new Error('Values must be provided as an object.');
  }
  const allowedFields = new Set(ALLOWED_MODELS[model].fields);
  const sanitizedEntries = Object.entries(values).filter(([field]) => allowedFields.has(field));
  if (sanitizedEntries.length === 0) {
    throw new Error(`No allowed fields provided for model ${model}.`);
  }
  return Object.fromEntries(sanitizedEntries);
}

function maskString(value: string): string {
  if (value.length <= 2) {
    return '*'.repeat(value.length);
  }
  const visiblePrefix = value[0];
  const visibleSuffix = value[value.length - 1];
  return `${visiblePrefix}${'*'.repeat(Math.max(value.length - 2, 1))}${visibleSuffix}`;
}

function maskValue(key: string, value: any): any {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => maskValue(key, item));
  }

  if (typeof value === 'object') {
    return maskRecord(value as Record<string, any>);
  }

  if (typeof value === 'string' && PII_FIELDS.includes(key)) {
    return maskString(value);
  }

  return value;
}

function maskRecord(record: any): any {
  if (record === null || record === undefined) {
    return record;
  }
  if (Array.isArray(record)) {
    return record.map((item) => maskRecord(item));
  }
  if (typeof record !== 'object') {
    return record;
  }
  return Object.fromEntries(
    Object.entries(record as Record<string, any>).map(([key, value]) => [key, maskValue(key, value)])
  );
}

function maskRecords(records: any[]): any[] {
  return records.map((record) => maskRecord(record));
}

function normalizeIds(ids: number | number[]): number[] {
  const arrayIds = Array.isArray(ids) ? ids : [ids];
  if (arrayIds.length === 0) {
    throw new Error('At least one ID must be provided.');
  }
  const processed = arrayIds.map((id) => {
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
      throw new Error('Record IDs must be positive integers.');
    }
    return id;
  });
  return Array.from(new Set(processed));
}

function summarizeAction(action: string, payload: Record<string, any>): Record<string, any> {
  return {
    action,
    payload,
    note: 'This is a dry-run/plan response. Execute with mode="confirm" to apply changes.',
  };
}

function resolveActor(context: ToolExecutionContext): string {
  const info = context.clientInfo;
  if (typeof info === 'string' && info.length > 0) {
    return info;
  }
  if (info && typeof info === 'object') {
    if (typeof info.name === 'string' && info.name.length > 0) {
      return info.name;
    }
    if (typeof info.id === 'string' && info.id.length > 0) {
      return info.id;
    }
    if (typeof info.login === 'string' && info.login.length > 0) {
      return info.login;
    }
  }
  return context.sessionId;
}

function formatIso(timestamp?: number): string | undefined {
  if (typeof timestamp !== 'number') {
    return undefined;
  }
  return new Date(timestamp).toISOString();
}

function buildPlanMetadata(record: ActionStageRecord<'plan'>) {
  return {
    requested_by: record.metadata.requestedBy,
  };
}

function buildDryRunMetadata(record: ActionStageRecord<'dry_run'>) {
  return {
    requested_by: record.metadata.requestedBy,
    approved_by: record.metadata.approvedBy,
    approved_at: formatIso(record.metadata.approvedAt),
    expires_at: formatIso(record.metadata.expiresAt),
  };
}

function buildConfirmMetadata(record: ActionStageRecord<'confirm'>) {
  return {
    requested_by: record.metadata.requestedBy,
    approved_by: record.metadata.approvedBy,
    approved_at: formatIso(record.metadata.approvedAt),
    expires_at: formatIso(record.metadata.expiresAt),
    confirmed_by: record.metadata.confirmedBy,
    confirmed_at: formatIso(record.metadata.confirmedAt ?? record.timestamp),
  };
}

async function checkDryRunAccess(model: string, operation: 'create' | 'write' | 'unlink'): Promise<boolean> {
  try {
    return await odooConnector.checkAccessRights(model, operation);
  } catch (error) {
    return false;
  }
}

function assertExecutionMode(mode: string): asserts mode is ExecutionMode {
  if (!EXECUTION_MODES.includes(mode as ExecutionMode)) {
    throw new Error(`Execution mode must be one of: ${EXECUTION_MODES.join(', ')}`);
  }
}

export const __testables = {
  assertModelAllowed,
  assertModelWritable,
  ensureFieldsAllowed,
  sanitizeOrder,
  sanitizeValues,
  maskString,
  maskValue,
  maskRecord,
  maskRecords,
  normalizeIds,
  summarizeAction,
  resolveActor,
  formatIso,
  buildPlanMetadata,
  buildDryRunMetadata,
  buildConfirmMetadata,
  assertExecutionMode,
};

export const versionTool: Tool = {
  name: 'odoo.version',
  description: 'Returns the version information reported by the connected Odoo server.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async (_input, _context) => {
    try {
      const version = await odooConnector.getVersion();
      return version;
    } catch (error: any) {
      return { error: `Failed to retrieve version: ${error.message}` };
    }
  },
};

export const modelsTool: Tool = {
  name: 'odoo.models',
  description: 'Lists the models and fields that are available through this connector.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async (_input, _context) => {
    try {
      return SAFE_MODELS.map((model) => ({
        model,
        writable: WRITABLE_MODELS.includes(model),
        fields: ALLOWED_MODELS[model].fields,
        allowed_methods: BUSINESS_METHOD_WHITELIST[model] ?? [],
      }));
    } catch (error: any) {
      return { error: `Failed to load model metadata: ${error.message}` };
    }
  },
};

export const searchReadTool: Tool = {
  name: 'odoo.search_read',
  description: 'Searches for and reads records of a given model in Odoo.',
  inputSchema: {
    type: 'object',
    required: ['model'],
    properties: {
      model: {
        type: 'string',
        enum: SAFE_MODELS,
        description: 'The technical name of the Odoo model to search.',
      },
      domain: {
        type: 'array',
        description: 'The Odoo search domain to filter records.',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'The fields to return for each record.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_LIMIT,
        description: 'Maximum number of records to return.',
      },
      order: {
        type: 'string',
        description: 'Order clause (e.g., "name ASC"). Only whitelisted fields are accepted.',
      },
    },
  },
  execute: async ({ model, domain = [], fields, limit = DEFAULT_LIMIT, order }: SearchReadInput, _context) => {
    try {
      assertModelAllowed(model);
      if (!Array.isArray(domain)) {
        throw new Error('Domain must be an array.');
      }
      const safeFields = ensureFieldsAllowed(model, fields);
      const safeLimit = Math.min(
        Math.max(typeof limit === 'number' && Number.isFinite(limit) ? Math.floor(limit) : DEFAULT_LIMIT, 1),
        MAX_LIMIT
      );
      const safeOrder = sanitizeOrder(model, order);
      const records = await odooConnector.searchRead<any>(model, domain, safeFields, safeLimit, 0, safeOrder ?? '');
      return {
        count: records.length,
        records: maskRecords(records),
      };
    } catch (error: any) {
      return { error: `Failed to execute search_read: ${error.message}` };
    }
  },
};

export const getTool: Tool = {
  name: 'odoo.get',
  description: 'Retrieves a single record by ID.',
  inputSchema: {
    type: 'object',
    required: ['model', 'id'],
    properties: {
      model: {
        type: 'string',
        enum: SAFE_MODELS,
        description: 'The model to read.',
      },
      id: {
        type: 'integer',
        minimum: 1,
        description: 'The record ID to read.',
      },
      fields: {
        type: 'array',
        items: { type: 'string' },
        description: 'The fields to return. Defaults to the model whitelist.',
      },
    },
  },
  execute: async ({ model, id, fields }: GetInput, _context) => {
    try {
      assertModelAllowed(model);
      if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
        throw new Error('Record ID must be a positive integer.');
      }
      const safeFields = ensureFieldsAllowed(model, fields);
      const [record] = await odooConnector.read<any>(model, [id], safeFields);
      if (!record) {
        return { error: `Record ${id} not found for model ${model}.` };
      }
      return maskRecord(record);
    } catch (error: any) {
      return { error: `Failed to execute get: ${error.message}` };
    }
  },
};

export const countTool: Tool = {
  name: 'odoo.count',
  description: 'Counts records matching a domain.',
  inputSchema: {
    type: 'object',
    required: ['model'],
    properties: {
      model: {
        type: 'string',
        enum: SAFE_MODELS,
        description: 'The model to count records for.',
      },
      domain: {
        type: 'array',
        description: 'The Odoo domain to match.',
      },
    },
  },
  execute: async ({ model, domain = [] }: CountInput, _context) => {
    try {
      assertModelAllowed(model);
      if (!Array.isArray(domain)) {
        throw new Error('Domain must be an array.');
      }
      const total = await odooConnector.count(model, domain);
      return { count: total };
    } catch (error: any) {
      return { error: `Failed to execute count: ${error.message}` };
    }
  },
};

export const createTool: Tool = {
  name: 'odoo.create',
  description: 'Creates a new record. Requires plan → dry_run → confirm flow.',
  inputSchema: {
    type: 'object',
    required: ['model', 'values', 'mode'],
    properties: {
      model: {
        type: 'string',
        enum: WRITABLE_MODELS,
        description: 'The model to create a record for.',
      },
      values: {
        type: 'object',
        description: 'Field values for the new record.',
      },
      mode: executionModeSchema,
      action_id: {
        type: 'string',
        description: 'Action identifier returned by plan/dry_run. Required for mode="confirm".',
      },
    },
  },
  execute: async ({ model, values, mode, action_id }: CreateInput, context) => {
    try {
      assertModelAllowed(model);
      assertModelWritable(model);
      assertExecutionMode(mode);
      const sanitizedValues = sanitizeValues(model, values);
      const payload = { model, values: sanitizedValues };
      const actor = resolveActor(context);

      if (mode === 'plan') {
        const summary = summarizeAction('plan:create', { model, values: sanitizedValues });
        const record = context.actionStore.recordPlan({
          sessionId: context.sessionId,
          tool: 'odoo.create',
          payload,
          result: summary,
          requestedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildPlanMetadata(record),
        };
      }

      if (mode === 'dry_run') {
        const allowed = await checkDryRunAccess(model, 'create');
        const summary = summarizeAction('dry_run:create', {
          model,
          allowed,
          values: maskRecord(sanitizedValues),
        });
        const record = context.actionStore.recordDryRun({
          sessionId: context.sessionId,
          tool: 'odoo.create',
          payload,
          result: summary,
          approvedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildDryRunMetadata(record),
        };
      }

      if (!action_id || typeof action_id !== 'string') {
        throw new Error('Confirmation requires a valid action_id from dry_run.');
      }

      const dryRunRecord = context.actionStore.validateConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.create',
        payload,
      });
      const id = await odooConnector.create(model, sanitizedValues);
      const record = context.actionStore.recordConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.create',
        payload,
        result: { id },
        confirmedBy: actor,
      });
      return {
        id,
        action_id,
        metadata: buildConfirmMetadata(record),
        approval: {
          approved_by: dryRunRecord.metadata.approvedBy,
          approved_at: formatIso(dryRunRecord.metadata.approvedAt),
          expires_at: formatIso(dryRunRecord.metadata.expiresAt),
        },
      };
    } catch (error: any) {
      return { error: `Failed to execute create: ${error.message}` };
    }
  },
};

export const writeTool: Tool = {
  name: 'odoo.write',
  description: 'Updates one or more records. Requires plan → dry_run → confirm flow.',
  inputSchema: {
    type: 'object',
    required: ['model', 'ids', 'values', 'mode'],
    properties: {
      model: {
        type: 'string',
        enum: WRITABLE_MODELS,
        description: 'The model containing the records.',
      },
      ids: {
        anyOf: [
          { type: 'integer', minimum: 1 },
          { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
        ],
        description: 'One or more record IDs to update.',
      },
      values: {
        type: 'object',
        description: 'Field values to update.',
      },
      mode: executionModeSchema,
      action_id: {
        type: 'string',
        description: 'Action identifier returned by plan/dry_run. Required for mode="confirm".',
      },
    },
  },
  execute: async ({ model, ids, values, mode, action_id }: WriteInput, context) => {
    try {
      assertModelAllowed(model);
      assertModelWritable(model);
      assertExecutionMode(mode);
      const sanitizedValues = sanitizeValues(model, values);
      const targetIds = normalizeIds(ids);
      const payload = { model, ids: targetIds, values: sanitizedValues };
      const actor = resolveActor(context);

      if (mode === 'plan') {
        const summary = summarizeAction('plan:write', { model, ids: targetIds, values: sanitizedValues });
        const record = context.actionStore.recordPlan({
          sessionId: context.sessionId,
          tool: 'odoo.write',
          payload,
          result: summary,
          requestedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildPlanMetadata(record),
        };
      }

      if (mode === 'dry_run') {
        const allowed = await checkDryRunAccess(model, 'write');
        const summary = summarizeAction('dry_run:write', {
          model,
          ids: targetIds,
          allowed,
          values: maskRecord(sanitizedValues),
        });
        const record = context.actionStore.recordDryRun({
          sessionId: context.sessionId,
          tool: 'odoo.write',
          payload,
          result: summary,
          approvedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildDryRunMetadata(record),
        };
      }

      if (!action_id || typeof action_id !== 'string') {
        throw new Error('Confirmation requires a valid action_id from dry_run.');
      }

      const dryRunRecord = context.actionStore.validateConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.write',
        payload,
      });
      const success = await odooConnector.write(model, targetIds, sanitizedValues);
      const confirmRecord = context.actionStore.recordConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.write',
        payload,
        result: { success },
        confirmedBy: actor,
      });
      return {
        success,
        action_id,
        metadata: buildConfirmMetadata(confirmRecord),
        approval: {
          approved_by: dryRunRecord.metadata.approvedBy,
          approved_at: formatIso(dryRunRecord.metadata.approvedAt),
          expires_at: formatIso(dryRunRecord.metadata.expiresAt),
        },
      };
    } catch (error: any) {
      return { error: `Failed to execute write: ${error.message}` };
    }
  },
};

export const unlinkTool: Tool = {
  name: 'odoo.unlink',
  description: 'Deletes one or more records. Requires plan → dry_run → confirm flow.',
  inputSchema: {
    type: 'object',
    required: ['model', 'ids', 'mode'],
    properties: {
      model: {
        type: 'string',
        enum: WRITABLE_MODELS,
        description: 'The model containing the records.',
      },
      ids: {
        anyOf: [
          { type: 'integer', minimum: 1 },
          { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1 },
        ],
        description: 'One or more record IDs to delete.',
      },
      mode: executionModeSchema,
      action_id: {
        type: 'string',
        description: 'Action identifier returned by plan/dry_run. Required for mode="confirm".',
      },
    },
  },
  execute: async ({ model, ids, mode, action_id }: UnlinkInput, context) => {
    try {
      assertModelAllowed(model);
      assertModelWritable(model);
      assertExecutionMode(mode);
      const targetIds = normalizeIds(ids);
      const payload = { model, ids: targetIds };
      const actor = resolveActor(context);

      if (mode === 'plan') {
        const summary = summarizeAction('plan:unlink', { model, ids: targetIds });
        const record = context.actionStore.recordPlan({
          sessionId: context.sessionId,
          tool: 'odoo.unlink',
          payload,
          result: summary,
          requestedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildPlanMetadata(record),
        };
      }

      if (mode === 'dry_run') {
        const allowed = await checkDryRunAccess(model, 'unlink');
        const summary = summarizeAction('dry_run:unlink', {
          model,
          ids: targetIds,
          allowed,
        });
        const record = context.actionStore.recordDryRun({
          sessionId: context.sessionId,
          tool: 'odoo.unlink',
          payload,
          result: summary,
          approvedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildDryRunMetadata(record),
        };
      }

      if (!action_id || typeof action_id !== 'string') {
        throw new Error('Confirmation requires a valid action_id from dry_run.');
      }

      const dryRunRecord = context.actionStore.validateConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.unlink',
        payload,
      });
      const success = await odooConnector.unlink(model, targetIds);
      const confirmRecord = context.actionStore.recordConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.unlink',
        payload,
        result: { success },
        confirmedBy: actor,
      });
      return {
        success,
        action_id,
        metadata: buildConfirmMetadata(confirmRecord),
        approval: {
          approved_by: dryRunRecord.metadata.approvedBy,
          approved_at: formatIso(dryRunRecord.metadata.approvedAt),
          expires_at: formatIso(dryRunRecord.metadata.expiresAt),
        },
      };
    } catch (error: any) {
      return { error: `Failed to execute unlink: ${error.message}` };
    }
  },
};

export const callKwTool: Tool = {
  name: 'odoo.call_kw',
  description: 'Calls a whitelisted business method on a model. Requires plan → dry_run → confirm flow.',
  inputSchema: {
    type: 'object',
    required: ['model', 'method', 'mode'],
    properties: {
      model: {
        type: 'string',
        enum: SAFE_MODELS,
        description: 'The model whose method to call.',
      },
      method: {
        type: 'string',
        description: 'The method name to invoke (must be whitelisted).',
      },
      args: {
        type: 'array',
        description: 'Positional arguments for the method.',
      },
      kwargs: {
        type: 'object',
        description: 'Keyword arguments for the method.',
      },
      mode: executionModeSchema,
      action_id: {
        type: 'string',
        description: 'Action identifier returned by plan/dry_run. Required for mode="confirm".',
      },
    },
  },
  execute: async ({ model, method, args = [], kwargs = {}, mode, action_id }: CallKwInput, context) => {
    try {
      assertModelAllowed(model);
      const allowedMethods = BUSINESS_METHOD_WHITELIST[model] ?? [];
      if (!allowedMethods.includes(method)) {
        throw new Error(`Method ${method} is not whitelisted for model ${model}.`);
      }
      assertExecutionMode(mode);
      if (!Array.isArray(args)) {
        throw new Error('Args must be provided as an array.');
      }
      if (kwargs === null || typeof kwargs !== 'object' || Array.isArray(kwargs)) {
        throw new Error('Kwargs must be provided as an object.');
      }
      const payload = { model, method, args, kwargs };
      const actor = resolveActor(context);

      if (mode === 'plan') {
        const summary = summarizeAction('plan:call_kw', { model, method, args, kwargs });
        const record = context.actionStore.recordPlan({
          sessionId: context.sessionId,
          tool: 'odoo.call_kw',
          payload,
          result: summary,
          requestedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildPlanMetadata(record),
        };
      }

      if (mode === 'dry_run') {
        const allowed = await checkDryRunAccess(model, 'write');
        const summary = summarizeAction('dry_run:call_kw', { model, method, allowed });
        const record = context.actionStore.recordDryRun({
          sessionId: context.sessionId,
          tool: 'odoo.call_kw',
          payload,
          result: summary,
          approvedBy: actor,
        });
        return {
          ...summary,
          action_id: record.actionId,
          metadata: buildDryRunMetadata(record),
        };
      }

      if (!action_id || typeof action_id !== 'string') {
        throw new Error('Confirmation requires a valid action_id from dry_run.');
      }

      const dryRunRecord = context.actionStore.validateConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.call_kw',
        payload,
      });
      const result = await odooConnector.callKw<any>(model, method, args, kwargs);
      if (Array.isArray(result)) {
        const masked = maskRecords(result as Record<string, any>[]);
        const confirmRecord = context.actionStore.recordConfirm({
          actionId: action_id,
          sessionId: context.sessionId,
          tool: 'odoo.call_kw',
          payload,
          result: masked,
          confirmedBy: actor,
        });
        return {
          result: masked,
          action_id,
          metadata: buildConfirmMetadata(confirmRecord),
          approval: {
            approved_by: dryRunRecord.metadata.approvedBy,
            approved_at: formatIso(dryRunRecord.metadata.approvedAt),
            expires_at: formatIso(dryRunRecord.metadata.expiresAt),
          },
        };
      }
      if (typeof result === 'object' && result !== null) {
        const masked = maskRecord(result as Record<string, any>);
        const confirmRecord = context.actionStore.recordConfirm({
          actionId: action_id,
          sessionId: context.sessionId,
          tool: 'odoo.call_kw',
          payload,
          result: masked,
          confirmedBy: actor,
        });
        return {
          result: masked,
          action_id,
          metadata: buildConfirmMetadata(confirmRecord),
          approval: {
            approved_by: dryRunRecord.metadata.approvedBy,
            approved_at: formatIso(dryRunRecord.metadata.approvedAt),
            expires_at: formatIso(dryRunRecord.metadata.expiresAt),
          },
        };
      }
      const confirmRecord = context.actionStore.recordConfirm({
        actionId: action_id,
        sessionId: context.sessionId,
        tool: 'odoo.call_kw',
        payload,
        result,
        confirmedBy: actor,
      });
      return {
        result,
        action_id,
        metadata: buildConfirmMetadata(confirmRecord),
        approval: {
          approved_by: dryRunRecord.metadata.approvedBy,
          approved_at: formatIso(dryRunRecord.metadata.approvedAt),
          expires_at: formatIso(dryRunRecord.metadata.expiresAt),
        },
      };
    } catch (error: any) {
      return { error: `Failed to execute call_kw: ${error.message}` };
    }
  },
};

export const meTool: Tool = {
  name: 'odoo.me',
  description: 'Gets information about the currently authenticated user.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  execute: async (_input, _context) => {
    const uid = odooConnector.getUid();
    if (!uid) {
      return { error: 'Not connected. Cannot get user information.' };
    }
    try {
      const users = await odooConnector.execute<any[]>(
        'res.users',
        'read',
        [[uid]],
        { fields: ['id', 'name', 'login', 'company_id', 'partner_id'] }
      );

      if (users.length === 0) {
        return { error: `User with UID ${uid} not found.` };
      }
      return maskRecord(users[0]);
    } catch (error: any) {
      return { error: `Failed to get user info: ${error.message}` };
    }
  },
};

export const odooTools = [
  versionTool,
  modelsTool,
  searchReadTool,
  getTool,
  countTool,
  createTool,
  writeTool,
  unlinkTool,
  callKwTool,
  meTool,
];
