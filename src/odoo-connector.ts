import Odoo from 'odoo-xmlrpc';
import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

class OdooConnector {
  private odoo: Odoo;
  private uid: number | null = null;

  constructor() {
    this.odoo = new Odoo({
      url: process.env.ODOO_URL,
      port: process.env.ODOO_PORT ? parseInt(process.env.ODOO_PORT, 10) : 80,
      db: process.env.ODOO_DB,
      username: process.env.ODOO_USERNAME,
      password: process.env.ODOO_API_KEY, // Use API key as password
    });
  }

  /**
   * Connects to the Odoo server and authenticates the user.
   * The user ID (uid) is stored for subsequent calls.
   */
  public connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.odoo.connect((err: any, uid: any) => {
        if (err) {
          console.error('Failed to connect to Odoo:', err);
          return reject(err);
        }
        // The connect method in this library actually returns the UID directly.
        // We will store it for later use.
        this.uid = uid;
        console.log(`Successfully connected to Odoo. UID: ${this.uid}`);
        resolve();
      });
    });
  }

  /**
   * Executes a method on an Odoo model.
   * This is a wrapper around the 'execute_kw' method of the Odoo API.
   * @param model The Odoo model to call the method on (e.g., 'res.partner').
   * @param method The method to call (e.g., 'search_read').
   * @param params An array of parameters for the method.
   * @returns A promise that resolves with the result of the method call.
   */
  public execute<T>(model: string, method: string, params: any[] = [[]], kwargs: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      if (this.uid === null) {
        return reject(new Error('Not connected to Odoo. Please call connect() first.'));
      }

      // The odoo-xmlrpc library has a quirky way of passing parameters.
      // It expects a single array where the first element is the positional args array,
      // and the second is the keyword args object.
      const formattedParams = [params, kwargs];

      this.odoo.execute_kw(model, method, formattedParams, (err: any, value: any) => {
        if (err) {
          console.error(`Error executing Odoo method: ${model}.${method}`, err);
          return reject(err);
        }
        resolve(value as T);
      });
    });
  }

  /**
   * A specific wrapper for the 'search_read' method.
   */
  public searchRead<T>(
    model: string,
    domain: any[] = [],
    fields: string[] = [],
    limit: number = 80,
    offset: number = 0,
    order: string = ''
  ): Promise<T[]> {
    const kwargs = {
        fields,
        limit,
        offset,
        order,
    };
    return this.execute(model, 'search_read', [domain], kwargs);
  }

  public getUid(): number | null {
    return this.uid;
  }
}

// Export a singleton instance of the connector
export const odooConnector = new OdooConnector();
