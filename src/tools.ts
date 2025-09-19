import { Tool } from '@modelcontextprotocol/sdk';
import { z } from 'zod';
import { odooConnector } from './odoo-connector';

// Whitelist of models the LLM is allowed to interact with.
// This is a critical security measure.
const ALLOWED_MODELS = [
  'res.partner',
  'sale.order',
  'account.move',
  'product.product',
  'stock.picking',
  'mrp.production',
];

/**
 * Tool to search for and read records from Odoo.
 * This is the primary method for getting data out of Odoo.
 */
export const searchReadTool: Tool = {
  name: 'odoo.search_read',
  description: 'Searches for and reads records of a given model in Odoo.',
  inputSchema: z.object({
    model: z.enum(ALLOWED_MODELS as [string, ...string[]]).describe('The technical name of the Odoo model to search (e.g., "res.partner").'),
    domain: z.array(z.any()).optional().describe('The search domain to filter records (e.g., [["is_company", "=", true]]). Defaults to an empty domain.'),
    fields: z.array(z.string()).optional().describe('The fields to return for each record (e.g., ["name", "email"]). Defaults to a few common fields.'),
    limit: z.number().int().positive().max(100).optional().describe('The maximum number of records to return. Defaults to 5, max 100.'),
    order: z.string().optional().describe('The field to sort the results by (e.g., "name ASC").'),
  }),
  execute: async ({ model, domain = [], fields = ['id', 'name', 'display_name'], limit = 5, order }) => {
    try {
      const records = await odooConnector.searchRead(
        model,
        domain,
        fields,
        limit,
        0, // offset
        order
      );
      return {
        count: records.length,
        records: records,
      };
    } catch (error: any) {
      return { error: `Failed to execute search_read: ${error.message}` };
    }
  },
};

/**
 * Tool to get information about the currently authenticated user.
 */
export const meTool: Tool = {
    name: 'odoo.me',
    description: 'Gets information about the currently authenticated user.',
    inputSchema: z.object({}),
    execute: async () => {
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
            return users[0];
        } catch (error: any) {
            return { error: `Failed to get user info: ${error.message}` };
        }
    }
};

// We will add more tools here as we implement them.
export const odooTools = [
    searchReadTool,
    meTool,
];
