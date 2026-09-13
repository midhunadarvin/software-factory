# Developer guide

Local setup, layout, tests, and how to extend Software Factory without fighting the architecture.

For contribution process (issues, PR shape, commit style) see [CONTRIBUTING.md](../CONTRIBUTING.md).
For invariants coding agents must not violate, see [AGENTS.md](../AGENTS.md).

## Prerequisites

- Node.js 22+ (see `.nvmrc`)
- pnpm 9+ (`corepack enable` then `corepack prepare pnpm@9.15.4 --activate`)
- git

## Setup

```sh
pnpm install
cp .env.example .env
```

Required in `.env`:

| Variable | Purpose |
|---|---|
| `FACTORY_SECRET` | 64 hex chars **or** `base64:` + ≥32 bytes. Derives PAT encryption and session HMAC. |
| `FACTORY_APP_PASSWORD` | Cookie login. Change the example value. |
| `XAI_API_KEY` or `OPENAI_API_KEY` | LLM. Without a working key the UI blocks attach/create. |

Useful overrides:

| Variable | Default | Notes |
|---|---|---|
| `FACTORY_ORIGIN` | `http://localhost:3000` | Public URL for browsers and webhooks |
| `FACTORY_BIND` | `127.0.0.1:3000` | Use `0.0.0.0:3000` in Docker |
| `OPENAI_COMPAT_BASE_URL` | `https://api.x.ai/v1` | API **root** ending in `/v1`, not `/chat/completions` |
| `OPENAI_COMPAT_MODEL` | `grok-4.5` | GLM/Kimi/DeepSeek → chat completions; Grok/GPT → Responses |
| `FACTORY_ROOT` | repo root | Where `var/` lives |
| `FACTORY_VAR_MAX_GB` | `20` | Cap on `var/` |

Restart `pnpm dev` after changing env. The factory probes `GET {OPENAI_COMPAT_BASE_URL}/models` before unlocking mutations.

```sh
pnpm dev          # http://127.0.0.1:3000 — FactoryRuntime + Next.js
pnpm test         # vitest (src/**/*.test.ts)
pnpm typecheck    # tsc --noEmit
pnpm build && pnpm start
pnpm seed:board   # six sample cards on the first project
pnpm db:migrate   # apply SQLite DDL / ALTERs (also runs on boot)
```

## One process

`src/server.ts` is the only entry:

1. Load `.env`, validate secrets
2. `migrate()` SQLite
3. `FactoryRuntime.start()`
4. Next.js request handler on the same HTTP server

Do not add a second Node service, worker, or database.

## Where code goes

| Kind of change | Put it here |
|---|---|
| Pages / API routes | `src/app/` |
| UI | `src/components/` |
| tRPC | `src/lib/trpc/routers/` |
| Jobs, graph, lanes | `src/lib/runtime/` |
| Pipeline config | `src/lib/runtime/pipeline/` |
| New issue tracker | `src/lib/integrations/plugins/` + `registerIntegration` |
| Schema | `src/lib/db/schema.ts` **and** `src/lib/db/migrate.ts` |
| Tests | colocated `*.test.ts` |

Path alias: `@/` → `src/`.

### Client vs server

Client components **must not** import Node-only modules (`better-sqlite3`, `db/client`, `integrations/registry.ts`). Use `src/lib/intake/settings.ts` and data from tRPC.

### Persistence

Everything durable lives under `{FACTORY_ROOT}/var/` (gitignored):

| Path | Contents |
|---|---|
| `var/factory.sqlite` | Projects, pipeline JSON, intake settings, jobs, artifacts, events |
| `var/checkpoints.sqlite` | LangGraph HITL interrupts |
| `var/sessions/` | Agent transcripts |
| `var/worktrees/` | Isolated implementation checkouts |

Never invent another store. Never commit `var/`.

Implementation runs in a **linked worktree** under `var/worktrees/`. Do not implement on the operator’s current checkout branch. Product git commits must not include `.factory/` notes (`requirements`, specs, `tasks.json`, `review.md`).

## Adding an intake plugin

Webhooks already live at `POST /api/webhooks/[id]`. Do **not** add `/api/webhooks/<name>/route.ts`.

1. Add `src/lib/integrations/plugins/<name>.ts` exporting an `IntegrationPlugin`:

   - `id` — snake_case (`asana`, `clickup`)
   - `secretEnv`, `verify`, `parse`, `match`, `settingsFields`

2. Register it in `src/lib/integrations/registry.ts` (next to GitHub / Linear / Jira) or from `src/server.ts` **before** `runtime.start()`.

```ts
import { registerIntegration } from "@/lib/integrations";
import { asanaPlugin } from "@/lib/integrations/plugins/asana";

registerIntegration(asanaPlugin);
```

3. Restart. Settings → Webhook intake lists the provider. Endpoint: `{FACTORY_ORIGIN}/api/webhooks/<id>`.

Operator-facing webhook URLs: [WEBHOOKS.md](./WEBHOOKS.md).

## Adding a pipeline lane or HITL step

Use a pipeline **action** (`produce` / `implement` / `fix` / `human_approval` / `publish`) in `src/lib/runtime/pipeline/`. Do not hardcode a new LangGraph node name unless the default pipeline needs a stable checkpoint name.

## Schema changes

1. Update Drizzle types in `src/lib/db/schema.ts`.
2. Add an idempotent `ALTER TABLE … ADD` (or `CREATE INDEX IF NOT EXISTS`) in `src/lib/db/migrate.ts`, wrapped in try/catch like the existing columns.
3. Add or extend a colocated test if behavior depends on the new field.
4. Document the operator impact in [MAINTENANCE.md](./MAINTENANCE.md) if `var/` on disk needs a one-off.

There is no generated migration folder. Boot always calls `migrate()`.

## Tests

- Runner: Vitest, Node environment, `src/**/*.test.ts`
- Assert behavior (inputs/outputs, HTTP status, parsed artifacts), not call graphs
- Prefer fixtures under `src/lib/runtime/` over hitting a live LLM
- After schema or env parsing changes, run `pnpm test && pnpm typecheck`

## Docker (dev check)

```sh
docker compose up --build -d
curl -sS http://127.0.0.1:3000/api/health
```

Operator volumes and TLS: [SELF-HOSTING.md](./SELF-HOSTING.md).

## Debugging a stuck job

1. Confirm LLM unlock: Settings / the blocking banner, and `GET /api/health`.
2. Inspect `var/factory.sqlite` (`jobs.state`, `board_column`, `error`).
3. HITL waits live in `var/checkpoints.sqlite` — a restart should **not** send cards back to Intake.
4. Transcripts: `var/sessions/`.
5. Implementation files: `var/worktrees/<project_id>/<job_id>/`.

If you attached **this** repo as a Factory project, keep `FACTORY_ROOT` pointed at the same tree so worktrees stay under this `var/`.
