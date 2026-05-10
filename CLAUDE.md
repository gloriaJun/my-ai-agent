# my-ai-agent

Docker-based AI agent stack combining n8n (workflow automation) and OpenClaw (Slack agent interface). LLM backend uses Gemini API via Google AI. All services run on a remote server accessible via SSH alias `ocl`.

## Service Architecture

| Service | Role | Port |
|---|---|---|
| n8n | Workflow orchestrator | 5678 |
| OpenClaw | Slack agent interface | 18789 |
| Nginx Proxy Manager | Reverse proxy | 80/443/81 |

All containers share an external Docker network named `proxy-net`.

## Key Files

| Path | Purpose |
|---|---|
| `docker-compose.yml` | Main service stack |
| `.env.example` | Required service environment variables |
| `config/openclaw/openclaw.template.json` | OpenClaw config template (Slack channels, LLM model) |
| `data/openclaw/openclaw.json` | Rendered OpenClaw config (gitignored, auto-generated) |
| `prompts/openclaw/SOUL.md` | OpenClaw agent system prompt |
| `prompts/openclaw/skills/*/SKILL.md` | OpenClaw skill definitions |
| `n8n/workflows/my-ai-agent.js` | My-AI-Agent n8n workflow SDK source of truth |

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

**Workflow modification procedure** (via MCP):
1. `validate_workflow` — must pass before saving
2. `update_workflow` — saves as **draft only**; the active version is not changed
3. Test if feasible (`execute_workflow` or trigger via webhook)
4. `publish_workflow` — **always required** to activate; never skip this step

**My-AI-Agent workflow (`aKIZYBnzbB0ZpTMC`) modification rule**:
- Always base changes on `n8n/workflows/my-ai-agent.js` (source of truth)
- `update_workflow` replaces the entire workflow — any connection absent from the SDK code is permanently lost
- Nodes with `onError: 'continueErrorOutput'` **must** have `.output(1).to(normalizeError)` declared as a side effect before `export default`; never omit these lines

See `docs/` for detailed workflow guides and TIL notes.

## OpenClaw Agent Configuration

- **System prompt**: `prompts/openclaw/SOUL.md`
- **Skills**: `prompts/openclaw/skills/<skill-name>/SKILL.md`
- **Config template**: `config/openclaw/openclaw.template.json`
- Config is re-rendered automatically on `start` and `restart`

When adding a new Slack channel (OpenClaw persona + n8n skill webhook), load:
`@docs/how-to/add-slack-channel.md`

## Deploy

Push to `main` triggers GitHub Actions (`.github/workflows/deploy.yml`), which SSHes into the remote server and runs `git pull --rebase && docker compose up -d`.

Manual deploy: `bash ./scripts/ctl.sh deploy`

Prerequisite: SSH config must have `ocl` as an alias for the remote server.

**Note**: `ctl.sh restart <container>` restarts the container only — it does NOT pull latest code. Always use `deploy` when repo file changes (SKILL.md, openclaw.template.json, etc.) need to reach the remote server.

**Repo modification guidelines**:
- **Post-deploy verification needed** (behavior change, config update, etc.) → run `ctl.sh deploy` then verify the behavior on the remote
- **Verification not needed** (docs, comments, non-functional changes) → confirm with user first, then push (GitHub Actions auto-deploys)

## References

| URL | Description |
|-----|-------------|
| https://docs.openclaw.ai | OpenClaw 공식 문서 홈 |
| https://docs.openclaw.ai/gateway/configuration | Config 전체 레퍼런스 (모델, fallback, provider 등) |
| https://docs.openclaw.ai/concepts/model-failover | Model failover 동작 원리 상세 |
| https://docs.openclaw.ai/channels/slack | OpenClaw Slack 채널 설정 (Socket Mode, replyToMode 등) |
