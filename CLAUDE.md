# my-ai-agent

Docker-based AI agent stack combining n8n (workflow automation) and OpenClaw (Discord agent interface). LLM backend uses Gemini API via Google AI. All services run on a remote server accessible via SSH alias `ocl`.

## Service Architecture

| Service | Role | Port |
|---|---|---|
| n8n | Workflow orchestrator | 5678 |
| OpenClaw | Discord agent interface | 18789 |
| Nginx Proxy Manager | Reverse proxy | 80/443/81 |

All containers share an external Docker network named `proxy-net`.

## Key Files

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Main service stack |
| `.env.example` | Required service environment variables |
| `config/openclaw/openclaw.template.json` | OpenClaw config template (Discord IDs, LLM model) |
| `data/openclaw/openclaw.json` | Rendered OpenClaw config (gitignored, auto-generated) |
| `prompts/openclaw/SOUL.md` | OpenClaw agent system prompt |
| `prompts/openclaw/skills/*/SKILL.md` | OpenClaw skill definitions |

## Environment Setup (Service)

```bash
# 1. Copy and fill in environment variables
cp .env.example .env

# 2. First-time setup: creates proxy-net, renders configs, starts all services
bash ./scripts/setup.sh
```

## Claude Code / MCP Setup

Separate from service setup. Required to use n8n MCP tools in Claude Code.

```bash
# 1. Add n8n JWT token
cp .mcp.env.example .mcp.env

# 2. Generate .mcp.json
bash ./scripts/gen-mcp.sh
```

The n8n-mcp server is pre-authorized in `.claude/settings.local.json`.

## Operational Commands

```bash
bash ./scripts/ctl.sh [COMMAND] [CONTAINER]
```

| Command | Description |
|---|---|
| `start/stop/restart` | Container lifecycle |
| `log` | Stream container logs |
| `exec` | Shell into container |
| `pair-list` | List OpenClaw pairing requests |
| `approve-pair` | Auto-approve latest pending pairing |
| `nginx-backup` | Backup Nginx proxy config → `config/nginx/proxy-host.json` |
| `nginx-restore` | Restore Nginx proxy config from backup |
| `reset-session` | Clear OpenClaw session files on remote |
| `deploy` | Push + remote `git pull` + `docker compose up -d` |

## n8n Workflow Development

n8n-mcp MCP server is enabled. Key tools: `search_nodes`, `get_node_types`, `validate_workflow`, `create_workflow_from_code`, `update_workflow`.

Always call `get_node_types` before writing workflow code — do not guess parameter names.

See `docs/` for detailed workflow guides and TIL notes.

## OpenClaw Agent Configuration

- **System prompt**: `prompts/openclaw/SOUL.md`
- **Skills**: `prompts/openclaw/skills/<skill-name>/SKILL.md`
- **Config template**: `config/openclaw/openclaw.template.json`
- Config is re-rendered automatically on `start` and `restart`

When adding a new Discord channel (OpenClaw persona + n8n skill webhook), load:
`@docs/how-to/add-channel.md`

## Deploy

Push to `main` triggers GitHub Actions (`.github/workflows/deploy.yml`), which SSHes into the remote server and runs `git pull --rebase && docker compose up -d`.

Manual deploy: `bash ./scripts/ctl.sh deploy`

Prerequisite: SSH config must have `ocl` as an alias for the remote server.

## References

| URL | Description |
|-----|-------------|
| https://docs.openclaw.ai | OpenClaw 공식 문서 홈 |
| https://docs.openclaw.ai/gateway/configuration | Config 전체 레퍼런스 (모델, fallback, provider 등) |
| https://docs.openclaw.ai/concepts/model-failover | Model failover 동작 원리 상세 |
