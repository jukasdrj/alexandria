# Cloudflare API vs Wrangler CLI - Capabilities Comparison

This document outlines what can be managed via the Cloudflare API vs the Wrangler CLI for Alexandria's infrastructure.

## Authentication

### API Authentication
- **API Tokens** (recommended): Create scoped tokens with specific permissions
- **API Keys**: Available but less secure, broader permissions

Required permissions vary by service:
- **Tunnels**: `Cloudflare Tunnel Write` or `Cloudflare One Connector: cloudflared Write`
- **Access**: `Access: Service Token Write`, `Access: Application Write`, etc.
- **Workers**: `Workers Scripts Write`, `Workers KV Storage Write`, etc.

### Wrangler Authentication
```bash
npx wrangler login  # Interactive OAuth flow
npx wrangler whoami # Check authentication status
```

## Cloudflare Tunnels

### API Endpoints (Zero Trust → Tunnels)
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Tunnels** | GET | `cfd_tunnel` | Starting Dec 1, 2025: deleted tunnels excluded by default |
| **Get Tunnel** | GET | `cfd_tunnel/{tunnel_id}` | Details of specific tunnel |
| **Create Tunnel** | POST | `cfd_tunnel` | Body: `{"name": "tunnel-name", "tunnel_secret": "..."}` |
| **Delete Tunnel** | DELETE | `cfd_tunnel/{tunnel_id}` | Permanent deletion, cannot be undone |
| **Update Tunnel** | PATCH | `cfd_tunnel/{tunnel_id}` | Modify tunnel configuration |
| **List Connections** | GET | `cfd_tunnel/{tunnel_id}/connections` | Active tunnel connections |
| **Get Configuration** | GET | `cfd_tunnel/{tunnel_id}/configurations` | Tunnel routing config |

### Wrangler Tunnel Commands
```bash
# Wrangler has LIMITED tunnel support - most operations require API or dashboard
npx wrangler tunnel list              # List tunnels
npx wrangler tunnel info <tunnel_id>  # Get tunnel details
```

**IMPORTANT**: Tunnel creation, deletion, and configuration are primarily done via:
1. **Cloudflare Zero Trust Dashboard** (most common, remotely-managed tokens)
2. **Cloudflare API** (programmatic control)
3. **cloudflared CLI** (direct tunnel daemon management, not wrangler)

Our tunnel (`alexandria-db`) uses **remotely-managed configuration** (Zero Trust dashboard), not local `config.yml`.

## Cloudflare Access (Zero Trust)

### API Endpoints (Zero Trust → Access)
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/access/`

#### Applications
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Applications** | GET | `apps` | All Access applications |
| **Get Application** | GET | `apps/{app_id}` | Specific application details |
| **Create Application** | POST | `apps` | Define protected resource |
| **Update Application** | PUT | `apps/{app_id}` | Modify application config |
| **Delete Application** | DELETE | `apps/{app_id}` | Remove Access protection |

#### Policies
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Policies** | GET | `apps/{app_id}/policies` | Both scoped and reusable |
| **Create Policy** | POST | `apps/{app_id}/policies` | Application-specific policy |
| **Update Policy** | PUT | `apps/{app_id}/policies/{policy_id}` | Modify policy rules |
| **Delete Policy** | DELETE | `apps/{app_id}/policies/{policy_id}` | Remove policy |
| **List Reusable Policies** | GET | `policies` | Account-level reusable policies |

#### Service Tokens
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Service Tokens** | GET | `service_tokens` | All service tokens |
| **Create Service Token** | POST | `service_tokens` | Returns `client_id` and `client_secret` (one-time) |
| **Update Service Token** | PUT | `service_tokens/{token_id}` | Rotate or modify token |
| **Delete Service Token** | DELETE | `service_tokens/{token_id}` | Revoke token |

**CRITICAL**: Client secrets are only shown once during creation. If lost, must rotate or create new token.

### Wrangler Access Support
**None** - Cloudflare Access is managed via:
1. **Cloudflare Zero Trust Dashboard** (recommended for UI)
2. **Cloudflare API** (programmatic control)

## Cloudflare Workers

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/workers/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Workers** | GET | `scripts` | All deployed workers |
| **Get Worker** | GET | `scripts/{script_name}` | Download worker code |
| **Upload Worker** | PUT | `scripts/{script_name}` | Deploy/update worker |
| **Delete Worker** | DELETE | `scripts/{script_name}` | Remove worker |
| **Get Settings** | GET | `scripts/{script_name}/settings` | Bindings, compat flags |
| **Update Settings** | PATCH | `scripts/{script_name}/settings` | Modify bindings |
| **List Routes** | GET | `/zones/{zone_id}/workers/routes` | Worker routing rules |
| **Create Route** | POST | `/zones/{zone_id}/workers/routes` | Map pattern to worker |

### Wrangler Worker Commands
```bash
npx wrangler init [name]              # Initialize new worker project
npx wrangler dev                      # Local development (localhost:8787)
npx wrangler deploy                   # Deploy worker
npx wrangler delete [name]            # Delete worker
npx wrangler tail [name]              # Live logs
npx wrangler whoami                   # Check auth + account
npx wrangler deployments list         # List deployments
npx wrangler rollback [version]       # Rollback to previous version
```

**Wrangler Advantages**:
- **Local development**: `wrangler dev` runs worker locally with hot reload
- **Local bindings**: Access to local KV, R2, D1 for testing
- **Project scaffolding**: `wrangler init` creates proper project structure
- **Type generation**: Auto-generates TypeScript types for bindings
- **Interactive prompts**: Guided configuration

**API Advantages**:
- Programmatic deployments in CI/CD
- Bulk operations across multiple workers
- Integration with custom tooling

## Cloudflare Queues

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/queues/`

#### Queue Management
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Queues** | GET | `/` | All account queues |
| **Get Queue** | GET | `/{queue_id}` | Queue details |
| **Create Queue** | POST | `/` | Body: `{"queue_name": "..."}` |
| **Update Queue** | PUT | `/{queue_id}` | Modify queue config |
| **Delete Queue** | DELETE | `/{queue_id}` | Remove queue |
| **Purge Queue** | DELETE | `/{queue_id}/messages` | Delete all messages |
| **Get Purge Status** | GET | `/{queue_id}/purge` | Monitor purge progress |

#### Message Operations
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **Push Message** | POST | `/{queue_id}/messages` | Single message |
| **Push Batch** | POST | `/{queue_id}/messages/batch` | Multiple messages |
| **Pull Messages** | GET | `/{queue_id}/messages` | Retrieve batch |
| **Ack/Retry** | POST | `/{queue_id}/messages/ack` | Process messages |

#### Consumer Management
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Consumers** | GET | `/{queue_id}/consumers` | All consumers |
| **Get Consumer** | GET | `/{queue_id}/consumers/{consumer_id}` | Consumer details |
| **Create Consumer** | POST | `/{queue_id}/consumers` | Register consumer |
| **Update Consumer** | PUT | `/{queue_id}/consumers/{consumer_id}` | Modify consumer |
| **Delete Consumer** | DELETE | `/{queue_id}/consumers/{consumer_id}` | Remove consumer |

### Wrangler Queue Commands
```bash
npx wrangler queues list              # List all queues
npx wrangler queues create <name>     # Create queue
npx wrangler queues delete <name>     # Delete queue
npx wrangler queues consumer add      # Add consumer
npx wrangler queues consumer remove   # Remove consumer
```

**Queue Bindings in wrangler.jsonc**:
```jsonc
{
  "queues": {
    "producers": [
      { "binding": "ENRICHMENT_QUEUE", "queue": "alexandria-enrichment-queue" }
    ],
    "consumers": [
      {
        "queue": "alexandria-enrichment-queue",
        "max_batch_size": 10,
        "max_batch_timeout": 30,
        "max_retries": 3,
        "dead_letter_queue": "alexandria-enrichment-dlq"
      }
    ]
  }
}
```

**Wrangler Advantages**:
- Queue configuration in `wrangler.jsonc` (declarative)
- Consumer setup with worker deployment
- Local queue simulation in `wrangler dev`

**API Advantages**:
- Send/receive messages programmatically
- External systems can enqueue work
- Monitoring and analytics integration

## Cloudflare AI Gateway

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/ai-gateway/`

#### Gateway Management
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Gateways** | GET | `gateways` | All AI gateways |
| **Get Gateway** | GET | `gateways/{id}` | Gateway details |
| **Create Gateway** | POST | `gateways` | New AI gateway |
| **Update Gateway** | PUT | `gateways/{id}` | Modify gateway |
| **Delete Gateway** | DELETE | `gateways/{id}` | Remove gateway |

#### Logs & Analytics
| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Logs** | GET | `gateways/{gateway_id}/logs` | Request/response logs |
| **Get Log** | GET | `gateways/{gateway_id}/logs/{id}` | Specific log entry |
| **Get Request** | GET | `gateways/{gateway_id}/logs/{id}/request` | Request details |
| **Get Response** | GET | `gateways/{gateway_id}/logs/{id}/response` | Response details |
| **Delete Logs** | DELETE | `gateways/{gateway_id}/logs` | Clear logs |

#### Additional Features
- **Datasets**: CRUD operations for training/eval datasets
- **Evaluations**: Create and manage AI evaluations
- **Provider URLs**: Get gateway endpoints by AI provider

### Wrangler AI Gateway Support
**None** - AI Gateway is managed via:
1. **Cloudflare Dashboard** (AI → AI Gateway)
2. **Cloudflare API** (programmatic control)

## KV Namespaces

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/storage/kv/namespaces/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Namespaces** | GET | `/` | All KV namespaces |
| **Create Namespace** | POST | `/` | Body: `{"title": "..."}` |
| **Delete Namespace** | DELETE | `/{namespace_id}` | Remove namespace |
| **List Keys** | GET | `/{namespace_id}/keys` | All keys in namespace |
| **Read Value** | GET | `/{namespace_id}/values/{key}` | Get key value |
| **Write Value** | PUT | `/{namespace_id}/values/{key}` | Set key value |
| **Delete Key** | DELETE | `/{namespace_id}/values/{key}` | Remove key |
| **Write Bulk** | PUT | `/{namespace_id}/bulk` | Batch write |
| **Delete Bulk** | DELETE | `/{namespace_id}/bulk` | Batch delete |

### Wrangler KV Commands
```bash
npx wrangler kv namespace list                    # List namespaces
npx wrangler kv namespace create <name>           # Create namespace
npx wrangler kv namespace delete --namespace-id <id>
npx wrangler kv key list --namespace-id <id>      # List keys
npx wrangler kv key get <key> --namespace-id <id>
npx wrangler kv key put <key> <value> --namespace-id <id>
npx wrangler kv key delete <key> --namespace-id <id>
npx wrangler kv bulk put <file.json> --namespace-id <id>
```

**Wrangler Advantages**:
- Local KV in `wrangler dev` for testing
- Binding configuration in `wrangler.jsonc`
- JSON file bulk imports

## R2 Buckets

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/r2/buckets/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Buckets** | GET | `/` | All R2 buckets |
| **Create Bucket** | POST | `/` | Body: `{"name": "..."}` |
| **Delete Bucket** | DELETE | `/{bucket_name}` | Remove bucket |

**Object Operations**: R2 uses S3-compatible API (not REST API)
```bash
# Use AWS SDK or aws-cli with R2 credentials
aws s3 ls s3://bucket-name --endpoint-url https://<account_id>.r2.cloudflarestorage.com
```

### Wrangler R2 Commands
```bash
npx wrangler r2 bucket list               # List buckets
npx wrangler r2 bucket create <name>      # Create bucket
npx wrangler r2 bucket delete <name>      # Delete bucket
npx wrangler r2 object list <bucket>      # List objects
npx wrangler r2 object get <bucket>/<key> # Download object
npx wrangler r2 object put <bucket>/<key> --file <path>
npx wrangler r2 object delete <bucket>/<key>
```

**Wrangler Advantages**:
- Local R2 simulation in `wrangler dev`
- Direct object operations (no S3 SDK required)
- Binding configuration in `wrangler.jsonc`

## D1 Databases

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/d1/database/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Databases** | GET | `/` | All D1 databases |
| **Create Database** | POST | `/` | Body: `{"name": "..."}` |
| **Delete Database** | DELETE | `/{database_id}` | Remove database |
| **Query Database** | POST | `/{database_id}/query` | Execute SQL |

### Wrangler D1 Commands
```bash
npx wrangler d1 list                      # List databases
npx wrangler d1 create <name>             # Create database
npx wrangler d1 delete <name>             # Delete database
npx wrangler d1 execute <name> --command "SELECT * FROM users"
npx wrangler d1 execute <name> --file schema.sql
npx wrangler d1 migrations list <name>    # Migration tracking
npx wrangler d1 migrations create <name> <migration_name>
npx wrangler d1 migrations apply <name>
```

**Wrangler Advantages**:
- Local D1 in `wrangler dev`
- Migration management
- SQL file execution
- Binding configuration in `wrangler.jsonc`

## Hyperdrive

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/hyperdrive/configs/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **List Configs** | GET | `/` | All Hyperdrive configs |
| **Get Config** | GET | `/{config_id}` | Specific config |
| **Create Config** | POST | `/` | New database connection |
| **Update Config** | PATCH | `/{config_id}` | Modify connection |
| **Delete Config** | DELETE | `/{config_id}` | Remove config |

### Wrangler Hyperdrive Commands
```bash
npx wrangler hyperdrive list              # List configs
npx wrangler hyperdrive create <name> \
  --host=<hostname> \
  --port=<port> \
  --user=<user> \
  --password=<password> \
  --database=<database> \
  --access-client-id=<id> \              # Optional: Cloudflare Access
  --access-client-secret=<secret>
npx wrangler hyperdrive delete <id>       # Delete config
npx wrangler hyperdrive get <id>          # Get config details
```

**Wrangler Advantages**:
- Interactive config creation
- Cloudflare Access integration
- Binding configuration in `wrangler.jsonc`

## Analytics Engine

### API Endpoints
**Base URL**: `https://api.cloudflare.com/client/v4/accounts/{account_id}/analytics_engine/`

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| **Query Analytics** | GET | `sql` | SQL queries on analytics data |

Analytics Engine uses SQL-based queries via API. Data is written from Workers using bindings.

### Wrangler Analytics Support
```bash
# No direct analytics commands - use API or dashboard
# Write analytics from Workers:
env.ANALYTICS.writeDataPoint({
  blobs: ["search", "isbn"],
  doubles: [latency, 1],
  indexes: [isbn]
});
```

**Binding in wrangler.jsonc**:
```jsonc
{
  "analytics_engine_datasets": [
    { "binding": "ANALYTICS" },
    { "binding": "QUERY_ANALYTICS" }
  ]
}
```

## Summary Matrix

| Service | API Support | Wrangler Support | Best Tool | Notes |
|---------|-------------|------------------|-----------|-------|
| **Tunnels** | ✅ Full | ⚠️ Limited (list/info only) | API or Dashboard | Use `cloudflared` CLI for daemon management |
| **Access** | ✅ Full | ❌ None | API or Dashboard | Applications, policies, service tokens |
| **Workers** | ✅ Full | ✅✅ Excellent | Wrangler for dev, API for CI/CD | Wrangler has local dev + hot reload |
| **Queues** | ✅ Full | ✅ Good | Wrangler for config, API for messaging | Wrangler handles consumer bindings |
| **AI Gateway** | ✅ Full | ❌ None | API or Dashboard | Logs, analytics, datasets |
| **KV** | ✅ Full | ✅ Good | Wrangler for dev, API for external access | Wrangler has local KV simulation |
| **R2** | ✅ (S3 API) | ✅ Good | Wrangler for dev, S3 SDK for prod | Wrangler has local R2 simulation |
| **D1** | ✅ Full | ✅✅ Excellent | Wrangler | Best-in-class migration management |
| **Hyperdrive** | ✅ Full | ✅ Good | Wrangler for setup, API for monitoring | Connection pooling configs |
| **Analytics** | ✅ SQL queries | ✅ Write-only | API for reads, Workers for writes | No CLI query support |

## Key Takeaways

### When to Use Wrangler
- **Local development** (`wrangler dev`)
- **Worker deployments** with live logs
- **D1 migrations** and schema management
- **KV/R2 local testing**
- **Project initialization** and scaffolding
- **Interactive configuration** (prompts)

### When to Use Cloudflare API
- **CI/CD pipelines** (programmatic deployments)
- **Cloudflare Access** management (no Wrangler support)
- **Tunnel management** (creation, deletion, config)
- **AI Gateway** operations
- **External systems** sending/receiving queue messages
- **Bulk operations** across multiple resources
- **Custom tooling** integration

### When to Use Dashboard
- **Visual configuration** (Access policies, tunnel routes)
- **Analytics and monitoring**
- **One-time setup** (service tokens, API keys)
- **Troubleshooting** (logs, trace data)

## Alexandria Usage Patterns

### Current Setup
- **Tunnels**: Created via Zero Trust Dashboard (remotely-managed token)
- **Access**: Configured via Dashboard (IP bypass + service tokens)
- **Workers**: Deployed via `wrangler deploy` (local development workflow)
- **Queues**: Configured in `wrangler.jsonc`, deployed with worker
- **Hyperdrive**: Created via `wrangler hyperdrive create`, bound in config
- **R2**: Created via Dashboard, bound in `wrangler.jsonc`
- **KV**: Created via Dashboard, bound in `wrangler.jsonc`

### Recommended Workflows

**Development**:
```bash
cd worker/
npm run dev           # wrangler dev with local bindings
# Test endpoints on localhost:8787
```

**Deployment**:
```bash
./scripts/deploy-worker.sh  # Validates then runs wrangler deploy
npx wrangler tail           # Monitor live logs
```

**Infrastructure Changes**:
- **Access policies**: Use Zero Trust Dashboard or API
- **Tunnel config**: Use Zero Trust Dashboard or API
- **Queue messages**: Use API for external producers
- **Analytics queries**: Use API with SQL queries

## API Authentication Example

```bash
# Create API token at https://dash.cloudflare.com/profile/api-tokens
# Scoped permissions: Workers Scripts Write, Tunnel Write, Access Write, etc.

export CLOUDFLARE_API_TOKEN="your-token-here"

# List tunnels
curl -X GET "https://api.cloudflare.com/client/v4/accounts/{account_id}/cfd_tunnel" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json"

# Create Access service token
curl -X POST "https://api.cloudflare.com/client/v4/accounts/{account_id}/access/service_tokens" \
  -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "alexandria-service-token", "duration": "8760h"}'
```

## Sources

- [Cloudflare API Documentation](https://developers.cloudflare.com/api/)
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Tunnel API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/tunnels/)
- [Create a tunnel (API)](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/create-remote-tunnel-api/)
- [Cloudflare Access API](https://developers.cloudflare.com/api/resources/zero_trust/subresources/access/)
- [Service Tokens Documentation](https://developers.cloudflare.com/cloudflare-one/identity/service-tokens/)
- [Queues API Documentation](https://developers.cloudflare.com/api/resources/queues/)
- [AI Gateway API Documentation](https://developers.cloudflare.com/api/resources/ai_gateway/)
- [Wrangler Commands](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Tunnel Changelog - Deleted Resources Update](https://developers.cloudflare.com/changelog/2025-09-02-tunnel-networks-list-endpoints-new-default/)
