import { Host, InMemoryEventStore } from './mcp';
import { odooConnector } from './odoo-connector';
import { odooTools } from './tools';

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const HOST = process.env.HOST ?? '0.0.0.0';
const PATH = process.env.MCP_PATH ?? '/mcp';

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
    const serverHandle = await host.listen({ port: PORT, host: HOST, path: PATH });
    let shuttingDown = false;
    console.log(`👂 Server listening on ws://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${serverHandle.port}${PATH}`);
    console.log('🎉 Odoo MCP Connector is ready to accept connections.');

    const shutdown = async (reason: string, exitCode: number) => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      console.log(`🛑 Shutting down Odoo MCP Connector (${reason})...`);
      try {
        await serverHandle.close();
      } catch (error) {
        console.error('Error while closing MCP host:', error);
      }
      process.exit(exitCode);
    };

    const handleSignal = (signal: NodeJS.Signals) => {
      void shutdown(signal, 0);
    };

    process.once('SIGINT', handleSignal);
    process.once('SIGTERM', handleSignal);
    process.once('uncaughtException', (error) => {
      console.error('🔥 Uncaught exception:', error);
      void shutdown('uncaughtException', 1);
    });
    process.once('unhandledRejection', (reason) => {
      console.error('🔥 Unhandled rejection:', reason);
      void shutdown('unhandledRejection', 1);
    });

  } catch (error) {
    console.error('🔥 Failed to start the Odoo MCP Connector:', error);
    process.exit(1); // Exit with an error code
  }
}

// Run the main function
main();
