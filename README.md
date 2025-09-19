# Odoo MCP Connector

This project is an MCP (Model Context Protocol) connector that allows a Large Language Model (LLM) agent to interact with the Odoo Online (SaaS) API. It acts as a secure bridge, exposing a set of controlled "tools" that the LLM can use to perform actions within Odoo.

## 📝 Overview

The goal is to enable an LLM to safely and effectively manage Odoo resources. This is achieved by creating an intermediary MCP server that translates the agent's intentions into validated, secure API calls to Odoo. This approach avoids exposing Odoo's raw API to the agent and enforces strict governance.

### 🎯 Target Architecture

The data flows from the LLM agent to Odoo and back through the MCP stack:

`LLM Agent ⇄ MCP Client ⇄ Odoo MCP Server ⇄ Odoo Online API (XML-RPC/JSON-RPC)`

### 🔑 Key Features

- **Security First**: All operations are governed by a strict security policy, including whitelists for models, fields, and methods. Write operations require a `dry_run` and confirmation flow.
- **Abstraction Layer**: The connector abstracts the underlying Odoo API (XML-RPC or JSON-RPC), making it resilient to future changes in Odoo's API (e.g., deprecation of RPC services in Odoo 19+).
- **Controlled Actions**: The connector exposes a set of well-defined tools (e.g., `odoo.search_read`, `odoo.create`) rather than the full, unrestricted API.
- **LLM-Friendly Interface**: The MCP tools are designed with schemas that make them easy for an LLM to understand and use. PII (Personally Identifiable Information) is masked in responses sent back to the agent.
- **Auditability**: All requests and responses are logged for security and debugging purposes.

## 🚀 Getting Started

### Prerequisites

- A **Node.js** environment (v18 or higher).
- An **Odoo Online** subscription with API access (typically the "Custom" plan).
- An **API Key** for an Odoo user with the necessary permissions.

### Installation

1.  **Clone the repository:**
    ```bash
    git clone <repository-url>
    cd odoo-mcp-connector
    ```
2.  **Install dependencies:**
    ```bash
    npm install
    ```

### Configuration

1.  Create a `.env` file in the root of the project.
2.  Add your Odoo connection details to the `.env` file:

    ```env
    ODOO_URL=https://your-company.odoo.com
    ODOO_DB=your-company-db
    ODOO_USERNAME=your-service-user@example.com
    ODOO_API_KEY=your-super-secret-api-key
    ```

### Running the Server

To start the MCP server, run:

```bash
npm run dev
```

The server will be available at `http://localhost:3000` (or the configured port).

## 🧰 Implemented Tools

The following MCP tools are available:

### Read Operations

- `odoo.version()`: Get the Odoo server version.
- `odoo.me()`: Get information about the current user.
- `odoo.models()`: List the whitelisted models available for interaction.
- `odoo.search_read(model, domain, fields, limit, order)`: Search for and read records.
- `odoo.get(model, id, fields)`: Get a single record by its ID.
- `odoo.count(model, domain)`: Count the number of records matching a domain.

### Write Operations (Requires Confirmation)

- `odoo.create(model, values)`: Create a new record.
- `odoo.write(model, ids, values)`: Update one or more records.
- `odoo.unlink(model, ids)`: Delete one or more records.

### Business Operations (Requires Confirmation)

- `odoo.call_kw(model, method, args, kwargs)`: Call a whitelisted business method on a model.

## 🛡️ Security & Governance

- **Whitelisting**: Only pre-approved models, fields, and methods can be accessed. This configuration is managed in the server.
- **Confirmation Flow**: All write operations (`create`, `write`, `unlink`) and sensitive business logic calls (`call_kw`) require a confirmation step from the user. The agent must first generate a plan, which is then approved.
- **PII Masking**: The server is responsible for filtering or masking Personally Identifiable Information before sending data back to the LLM agent.
- **Logging**: All API calls are logged with idempotency keys to ensure safe retries.

## 🗺️ Roadmap

- [ ] **Phase 1: Core Read & Write Functionality**
    - [ ] Implement Odoo XML-RPC client.
    - [ ] Define and implement read-only tools (`search_read`, `get`, `version`).
    - [ ] Set up basic MCP server.
    - [ ] Implement write tools (`create`, `write`) with a `dry_run` and confirmation mechanism.
- [ ] **Phase 2: Advanced Features & Security**
    - [ ] Implement `unlink` and `call_kw` with strict whitelisting.
    - [ ] Add robust PII masking for all responses.
    - [ ] Implement comprehensive logging and rate limiting.
- [ ] **Phase 3: Testing & Deployment**
    - [ ] Add unit and integration tests against a demo Odoo instance.
    - [ ] Dockerize the application for deployment.
    - [ ] Document how to connect the server to an MCP client (e.g., Claude Desktop).
- [ ] **Phase 4: API Evolution**
    - [ ] Add support for JSON-RPC as an alternative transport layer.
    - [ ] Prepare for Odoo 20 by designing an abstraction that can accommodate a future REST or GraphQL API.

## 🤝 Contributing

Contributions are welcome! Please open an issue to discuss your ideas or submit a pull request.
