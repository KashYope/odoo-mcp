import { Host, InMemoryEventStore } from '@modelcontextprotocol/sdk';
import { odooConnector } from './odoo-connector';
import { odooTools } from './tools';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

/**
 * The main entry point for the application.
 */
async function main() {
  console.log('🚀 Starting Odoo MCP Connector...');

  try {
    // 1. Connect to Odoo
    // This must be done before starting the server, as the tools rely on this connection.
    await odooConnector.connect();

    // 2. Create an MCP Host
    // The host is the server that listens for requests from MCP clients.
    const host = new Host({
      // For this example, we'll use an in-memory event store.
      // For a production environment, you would use a persistent store like PostgresEventStore.
      eventStore: new InMemoryEventStore(),
    });

    // 3. Register the Odoo tools with the host
    // This makes the tools available to any connected MCP client.
    host.tools.add(...odooTools);
    console.log(`✅ Registered ${odooTools.length} Odoo tools.`);

    // 4. Start the server
    host.listen({ port: PORT });
    console.log(`👂 Server listening on http://localhost:${PORT}`);
    console.log('🎉 Odoo MCP Connector is ready to accept connections.');

  } catch (error) {
    console.error('🔥 Failed to start the Odoo MCP Connector:', error);
    process.exit(1); // Exit with an error code
  }
}

// Run the main function
main();
