# vyltzero-cli

Production-ready CLI for the [VyltZero](https://github.com/bwalia/vyltzero) secrets management platform.

## Installation

```bash
# From source
cargo install --path .

# Or build locally
cargo build --release
```

## Configuration

Create `~/.vyltzero/config.toml`:

```toml
endpoint = "https://vault.example.com"
token = "s.my-vault-token"
tenant_id = "my-tenant"

[profiles.dev]
endpoint = "http://localhost:8443"

[profiles.prod]
endpoint = "https://vault.prod.example.com"
```

Or use environment variables:

```bash
export VYLTZERO_ADDR="https://vault.example.com"
export VYLTZERO_TOKEN="s.my-token"
export VYLTZERO_TENANT_ID="my-tenant"
```

### Token and tenant

The tenant a command reads and writes is taken from the token itself (its
`tenant_id` claim), so use a token issued for the tenant you want.
`--tenant-id` / `VYLTZERO_TENANT_ID` are only honoured when the server runs
with `VAULT_TRUST_GATEWAY_HEADERS` enabled, which is off by default.

Save a token after `vyltzero init` (or let `init` prompt for one):

```bash
# Verifies the token, then saves it with its endpoint and tenant to ~/.vyltzero/config.toml.
# Omit the token to be prompted for it, keeping it out of shell history.
vyltzero --addr https://vault.workstation.co.uk identity login

# One profile per tenant, selected with --profile or VYLTZERO_PROFILE
vyltzero --addr https://vault.workstation.co.uk --profile acme identity login
vyltzero --profile acme secret put app/db --data password=s3cret
```

Use the API host (`vault.…`), not the web console host (`vault-ui.…`).

## Usage

### Secrets

```bash
# Write a secret
vyltzero secret put prod/database/creds --data username=admin --data password=s3cret

# Read a secret
vyltzero secret get prod/database/creds

# Read a single field (for piping)
vyltzero secret get prod/database/creds --field password | pbcopy

# List secrets
vyltzero secret list prod/

# Delete a version
vyltzero secret delete prod/database/creds --versions 1 2

# Output as JSON
vyltzero --format json secret get prod/database/creds
```

### Transit Encryption

```bash
# Create a transit key
vyltzero transit create-key my-app-key

# Encrypt data
vyltzero transit encrypt my-app-key "sensitive data"

# Decrypt data
vyltzero transit decrypt my-app-key "vault:v1:..."

# Rotate key
vyltzero transit rotate-key my-app-key
```

### MCP (AI Agent Integration)

```bash
# List available MCP tools
vyltzero mcp list-tools

# Read a secret via MCP protocol
vyltzero mcp get-secret prod/database/password

# Encrypt via MCP
vyltzero mcp encrypt my-key "plaintext"

# Call any MCP tool directly
vyltzero mcp call read_secret --args '{"path":"prod/db","tenant_id":"t1"}'
```

### Identity & Leases

```bash
# Create a service account
vyltzero identity create-service-account my-app --policies read-only admin

# List leases
vyltzero lease list

# Renew a lease
vyltzero lease renew <lease-id> --increment 7200

# Check server status
vyltzero status
```

### Profiles

```bash
# Use a specific profile
vyltzero --profile prod secret get prod/database/creds

# Override endpoint on the fly
vyltzero --addr https://other-vault.com secret list
```

### Shell Completions

```bash
# Bash
vyltzero completion bash >> ~/.bashrc

# Zsh
vyltzero completion zsh >> ~/.zshrc

# Fish
vyltzero completion fish > ~/.config/fish/completions/vyltzero.fish

# PowerShell
vyltzero completion powershell >> $PROFILE
```

## Security

- Secrets are held in memory using `zeroize` — automatically wiped on drop
- Authentication tokens are never logged (hidden from `--help` and tracing)
- TLS certificate validation is enforced by default
- Destructive operations (destroy) show warnings before proceeding

## License

Apache-2.0
