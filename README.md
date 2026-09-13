# Software Factory

[![CI](https://github.com/midhunadarvin/software-factory/actions/workflows/ci.yml/badge.svg)](https://github.com/midhunadarvin/software-factory/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

TypeScript web app that turns a git repo into an **agent factory** with human approval. Run it on your laptop or self-host it with Docker. Jobs enter **Intake** from the UI, a GitHub poller, or webhooks (GitHub, Linear, Jira).

This is a **single-tenant** app (one operator, local or VPS). It is not a multi-tenant SaaS.

## Features

- Attach a local git folder or clone a GitHub repo — agents run against a tree on disk
- Configurable lanes (default: Triage → Planning → Tech spec → Tasks → Implementation → PR)
- Human-in-the-loop after planning artifacts and review; simple + low-risk tickets can fast-track
- Implementation in an isolated linked worktree (`var/worktrees/`) — your current branch is not touched
- Plugin intake: GitHub, Linear, Jira; add more without a new webhook route file
- Durable board: SQLite + LangGraph checkpoints survive `pnpm dev` / container restarts

## Requirements

- Node.js 22+ and pnpm 9+, plus git  
  **or** Docker 24+ / Compose v2

## Quick start

```sh
git clone https://github.com/midhunadarvin/software-factory.git
cd software-factory
pnpm install
cp .env.example .env
# set FACTORY_SECRET (64 hex chars), FACTORY_APP_PASSWORD, and XAI_API_KEY
pnpm dev
```

The factory **will not attach repos or create jobs** until `XAI_API_KEY` (or `OPENAI_API_KEY`) is set and `GET {OPENAI_COMPAT_BASE_URL}/models` succeeds. Restart after changing env.

`OPENAI_COMPAT_BASE_URL` is the API root ending in `/v1`, not a specific endpoint. For OpenCode Go:

```sh
OPENAI_COMPAT_BASE_URL=https://opencode.ai/zen/go/v1
OPENAI_COMPAT_MODEL=glm-5.3-flash
OPENAI_API_KEY=sk-…
```

Do not append `/chat/completions` or `/responses` — the factory picks the endpoint from the model (GLM/Kimi/DeepSeek → chat completions; Grok/GPT → Responses).

Open http://127.0.0.1:3000 — log in, then **Open a repository**.

## First run

1. Paste an absolute path to a local git repo, or clone `owner/repo`.
2. Create a job from the board (title + brief), or open a GitHub/Linear/Jira issue if webhooks are configured. New cards start in **Intake**.
3. Send a card to **Triage**, or enable **Auto-move new webhook tickets to triage** in Settings.
4. Every ticket visits every configured lane (default: Triage → Planning → Tech spec → Tasks → Implementation → PR).
5. The triage agent labels simple vs complex and risk. Simple + low risk **fast-tracks** planning HITL so it can reach implementation sooner.
6. Complex or higher-risk tickets pause for human approval after planning, spec, and review.
7. Implementation runs in a linked worktree under `var/worktrees/` (your checkout is not touched).
8. Approve review. Local-only repos finish with a branch; GitHub + PAT opens a pull request.

Without a working agent key the UI shows a blocking error and all create/attach mutations fail.

## Self-host and webhooks

- Docker, volumes, TLS, and restart behavior: **[docs/SELF-HOSTING.md](./docs/SELF-HOSTING.md)**
- GitHub / Linear / Jira URLs and matching: **[docs/WEBHOOKS.md](./docs/WEBHOOKS.md)**

```sh
docker compose up --build -d
```

Health: `GET /api/health` (`db: true`).

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | `src/server.ts` (FactoryRuntime + Next.js) |
| `pnpm build` / `pnpm start` | Production |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm seed:board` | Six sample cards on the first project |
| `pnpm db:migrate` | Apply SQLite DDL / ALTERs (also on boot) |
| `docker compose up --build` | Self-hosted image |

## Documentation

| Doc | When to read it |
|---|---|
| [docs/DEVELOPER.md](./docs/DEVELOPER.md) | Setup, layout, plugins, schema, tests |
| [docs/MAINTENANCE.md](./docs/MAINTENANCE.md) | Releases, CI, `var/`, review checklist |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Issues and pull requests |
| [SECURITY.md](./SECURITY.md) | Vulnerability reports |
| [AGENTS.md](./AGENTS.md) | Architecture rules for humans and coding agents |
| [DESIGN.md](./DESIGN.md) | Original product spec (historical) |
| [CHANGELOG.md](./CHANGELOG.md) | User-visible changes |

Current behavior is this tree + `AGENTS.md`. If `DESIGN.md` disagrees, **AGENTS.md wins**.

## Contributing

Bug reports and PRs are welcome. Please read [CONTRIBUTING.md](./CONTRIBUTING.md) and the [Code of Conduct](./CODE_OF_CONDUCT.md) first.

## License

[MIT](./LICENSE)
