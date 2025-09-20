# Odoo MCP Connector

This project is an MCP (Model Context Protocol) connector that allows a Large Language Model (LLM) agent to interact with the Odoo Online (SaaS) API. It acts as a secure bridge, exposing a set of controlled "tools" that the LLM can use to perform actions within Odoo.

## 📝 Overview

The goal is to enable an LLM to safely and effectively manage Odoo resources. This is achieved by creating an intermediary MCP server that translates the agent's intentions into validated, secure API calls to Odoo. This approach avoids exposing Odoo's raw API to the agent and enforces strict governance.

### 🎯 Target Architecture

The data flows from the LLM agent to Odoo and back through the MCP stack:

`LLM Agent ⇄ MCP Client ⇄ Odoo MCP Server ⇄ Odoo Online API (JSON-RPC)`

Under the hood the server boots a self-contained [Model Context Protocol](https://modelcontextprotocol.io)
host with an in-memory event store. No additional services are required to run the connector locally—an MCP
client can point directly at the provided WebSocket endpoint.

### 🔑 Key Features

- **Security First**: All operations are governed by a strict security policy, including whitelists for models, fields, and methods. Write operations require a `plan → dry_run → confirm` flow before Odoo is mutated.
- **Execution Modes**: The confirmation flow is implemented natively in the tools: agents must stage an action (`plan`), request human approval (`dry_run`), and finally execute (`confirm`) with the returned `action_id`.
- **Abstraction Layer**: The connector talks to Odoo exclusively through the JSON-RPC transport, hiding authentication, retries, and error handling details from the agent.
- **Controlled Actions**: Only a curated list of MCP tools (e.g., `odoo.search_read`, `odoo.create`) is exposed. Each tool validates models, fields, and arguments against the local whitelist before hitting Odoo.
- **LLM-Friendly Interface**: The MCP tools declare JSON schemas that guide the agent. Responses automatically mask PII (Personally Identifiable Information) by obscuring configured fields.
- **Auditability**: All requests to Odoo are logged with deterministic request identifiers, and the in-memory action store tracks who planned, approved, and confirmed every mutation.
- **Self-contained MCP runtime**: A lightweight host and event store are bundled so the connector can run without external SDK dependencies. Swapping in a persistent event store (e.g., Postgres) only requires updating the host bootstrap.

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

1.  Create a `.env` file in the root of the project. The connector automatically loads it on startup.
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

By default the connector exposes an MCP-compliant WebSocket endpoint at `ws://localhost:3000/mcp`. The following environment
variables can be used to tweak the listener:

| Variable   | Default     | Description |
|------------|-------------|-------------|
| `PORT`     | `3000`      | TCP port to bind the HTTP server. |
| `HOST`     | `0.0.0.0`   | Interface address to bind the listener. |
| `MCP_PATH` | `/mcp`      | HTTP path that upgrades to the MCP WebSocket transport. |

The HTTP server also exposes a `GET /health` endpoint that can be used for readiness checks. Each WebSocket client must send an
`initialize` request (per the Model Context Protocol) before issuing `tools/list` or `tools/call` requests. Tool invocations
are streamed back to the client through `tools/stream` notifications followed by a terminal JSON-RPC response when the
execution completes.

### Running Tests

This project relies on Node's built-in test runner together with `ts-node` for TypeScript support. To execute the full unit test
suite, run:

```bash
npm test
```

The command discovers all `*.test.ts` files under the `tests/` directory and executes them. Include `npm test` as part of your
CI pipeline to ensure the Odoo connector, masking logic, and confirmation workflows remain covered by automated regression
tests.

## 🧰 Implemented Tools

The following MCP tools ship with the connector. Parameters marked with `*` are required.

| Tool | Category | Notable Parameters | Execution Modes |
|------|----------|--------------------|-----------------|
| `odoo.version` | Read | _(none)_ | `plan` not required — fire-and-forget |
| `odoo.models` | Read | _(none)_ | `plan` not required |
| `odoo.me` | Read | _(none)_ | `plan` not required |
| `odoo.search_read` | Read | `model*`, `domain`, `fields`, `limit`, `order` | `plan` not required |
| `odoo.get` | Read | `model*`, `id*`, `fields` | `plan` not required |
| `odoo.count` | Read | `model*`, `domain` | `plan` not required |
| `odoo.create` | Write | `model*`, `values*`, `mode*`, `action_id` | `plan → dry_run → confirm` |
| `odoo.write` | Write | `model*`, `ids*`, `values*`, `mode*`, `action_id` | `plan → dry_run → confirm` |
| `odoo.unlink` | Write | `model*`, `ids*`, `mode*`, `action_id` | `plan → dry_run → confirm` |
| `odoo.call_kw` | Business | `model*`, `method*`, `args`, `kwargs`, `mode*`, `action_id` | `plan → dry_run → confirm` |

When a tool supports execution modes, the agent must:

1. Call the tool with `mode="plan"` to receive a summary and `action_id`.
2. Re-play the tool with `mode="dry_run"` to request approval. The response includes approval metadata and masks PII fields.
3. Finally execute with `mode="confirm"` and the original `action_id`. The action store enforces that the payload matches the approved dry-run before calling Odoo.

The in-memory store records who initiated and approved each step using the MCP client metadata. Timestamps are returned in ISO-8601 format for auditing.

## 🛡️ Security & Governance

- **Whitelisting**: Only pre-approved models, fields, and methods can be accessed. The `src/config.ts` file defines the `ALLOWED_MODELS`, `WRITABLE_MODELS`, and `BUSINESS_METHOD_WHITELIST` lists used by the tools.
- **Confirmation Flow**: All write operations (`create`, `write`, `unlink`) and sensitive business logic calls (`call_kw`) require the confirmation sequence. Each stage records the actor that initiated it, and confirmation refuses to run if the payload changed since the dry run.
- **PII Masking**: The connector masks Personally Identifiable Information before returning it to the agent. Configure the `PII_FIELDS` array in `src/config.ts` to extend or shrink the masked fields.
- **Logging**: Every call to Odoo is logged with a deterministic SHA-256 request fingerprint, making it easy to trace requests end-to-end.
- **Access Verification**: Dry-run stages call `checkAccessRights` to verify the current service account can perform the requested write before confirmation.

### Configuration Reference

You can tailor what the agent can do by editing `src/config.ts`:

- **`ALLOWED_MODELS`** – defines the fields exposed for each model and whether it is writable.
- **`BUSINESS_METHOD_WHITELIST`** – enumerates which model methods are callable via `odoo.call_kw`.
- **`PII_FIELDS`** – lists the field names that should be masked in responses.
- **`MAX_LIMIT` / `DEFAULT_LIMIT`** – cap pagination for read operations.

Re-deploy the server after modifying the configuration to pick up changes. No code modifications are required for typical governance tweaks.

## 🗺️ Roadmap

- [x] **Phase 1: Core Read & Write Functionality**
    - [x] Implement the authenticated Odoo JSON-RPC client that powers the connector.
    - [x] Define and implement read-only tools (`search_read`, `get`, `version`).
    - [x] Set up the MCP server with an in-memory event store.
    - [x] Implement write tools (`create`, `write`) with a `plan → dry_run → confirm` mechanism.
- [ ] **Phase 2: Advanced Features & Security**
    - [x] Implement `unlink` and `call_kw` with strict whitelisting.
    - [x] Add robust PII masking for all responses.
    - [ ] Implement comprehensive logging and rate limiting.
        - [x] Structured request/response logging with deterministic request identifiers.
        - [ ] Rate limiting for MCP tool invocations.
- [ ] **Phase 3: Testing & Deployment**
    - [x] Add unit tests that exercise field sanitization and confirmation workflows.
    - [ ] Add integration tests against a demo Odoo instance.
    - [ ] Dockerize the application for deployment.
    - [ ] Document how to connect the server to an MCP client (e.g., Claude Desktop).
- [ ] **Phase 4: API Evolution**
    - [x] Add support for JSON-RPC as the primary transport layer.
    - [ ] Prepare for Odoo 20 by designing an abstraction that can accommodate a future REST or GraphQL API.

## 🤝 Contributing

Contributions are welcome! Please open an issue to discuss your ideas or submit a pull request.
