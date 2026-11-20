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
| `FACTORY_LLM_API_KEY` or `OPENAI_API_KEY` or `XAI_API_KEY` | LLM for in-process lanes. Optional when `claude` / `cursor-agent` is on PATH. |

Useful overrides:

| Variable | Default | Notes |
|---|---|---|
| `FACTORY_ORIGIN` | `http://localhost:3000` | Public URL for browsers and webhooks |
| `FACTORY_BIND` | `127.0.0.1:3000` | Use `0.0.0.0:3000` in Docker |
| `LLM_PROVIDER` | `opencode_go` (when a generic key is set) | Registered plugin id: `opencode_go`, `xai`, `openai`, `custom` |
| `OPENAI_COMPAT_BASE_URL` | (unset) | Custom `/v1` root only. OpenCode Go is inferred from a generic key. |
| `OPENAI_COMPAT_MODEL` | plugin default (`glm-5.3-flash` on Go) | Must be an id from `GET /models` |
| `FACTORY_ROOT` | repo root | Where `var/` lives |
| `FACTORY_VAR_MAX_GB` | `20` | Cap on `var/` |

Restart `pnpm dev` after changing env. The factory unlocks when a coding CLI is on PATH, or after `GET {resolved provider}/models` succeeds.

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
2. `getStore().migrate()` (SQLite by default)
3. `FactoryRuntime.start()`
4. Next.js request handler on the same HTTP server

Do not add a second Node service, worker, or database.

## Where code goes

| Kind of change | Put it here |
|---|---|
| Pages / API routes | `src/app/` |
| UI | `src/components/` |
| tRPC | `src/server/trpc/routers/` |
| Job lifecycle (ticket state, board columns, PR publishing) | `src/server/jobs/` |
| Runtime (FactoryRuntime, LangGraph graph, queue, live events) | `src/server/runtime/` |
| Pipeline config and lanes | `src/server/pipeline/` |
| Artifacts (schemas, coercion, templates, versioned store) | `src/server/artifacts/` |
| Lane agents (prompts, catalog, lane runner, steer, sessions) | `src/server/agents/` |
| Agent tools (repo, review, sandbox) | `src/server/tools/` |
| Integrations, intake config, webhooks | `src/server/integrations/` |
| Generic helpers (auth, crypto, git, GitHub, env, paths, redact) | `src/utils/` — no product logic |
| New issue tracker | `src/server/integrations/plugins/` + `registerIntegration` |
| LLM calls, job model, parsing | `src/server/llm/` |
| New LLM backend | `src/server/llm/providers/plugins/` + `registerLlmProvider` |
| Data models | `src/server/data/models/` |
| Data access | `getStore()` from `src/server/data` |
| Schema | `src/server/data/drivers/sqlite/schema.ts` **and** `src/server/data/drivers/sqlite/migrate.ts` |
| Tests | colocated `*.test.ts` |

Path alias: `@/` → `src/`.

### Client vs server

Client components **must not** import Node-only modules (`better-sqlite3`, `@/server/data` runtime exports, `integrations/registry.ts`, `llm/providers/registry.ts`). Use `src/server/integrations/intake/settings.ts` and data from tRPC.

### Persistence

Everything durable lives under `{FACTORY_ROOT}/var/` (gitignored):

| Path | Contents |
|---|---|
| `var/factory.sqlite` | Projects, pipeline JSON, intake settings, jobs, artifacts, events |
| `var/checkpoints.sqlite` | LangGraph HITL interrupts |
| `var/sessions/` | Agent transcripts |
| `var/worktrees/` | Isolated implementation checkouts |

Never invent another store. Never commit `var/`.

### Source layout

```
src/
├── app/, components/   Next.js pages, API routes, UI
├── server/             the product
│   ├── jobs/           ticket state, board columns, PR publishing
│   ├── runtime/        FactoryRuntime, LangGraph graph, queue, live events
│   ├── pipeline/       pipeline config, lanes, lane ids
│   ├── artifacts/      artifact schemas, coercion, templates, store, fixtures
│   ├── agents/         lane agents, catalog, steer, sessions, harness/ (CLI runners)
│   ├── tools/          tools agents call (repo, review, sandbox)
│   ├── integrations/   issue trackers, intake/, webhooks/
│   ├── llm/            provider plugins, job model, output parsing
│   ├── data/           data access layer (below)
│   └── trpc/           API routers
├── utils/              generic helpers: auth, crypto, git, github, obs, env, paths, trpc client
└── server.ts           process entry
```

`src/layers.test.ts` enforces the data and LLM boundaries.

### Data access layer

```
src/server/data/
├── models/          Project, Job, Artifact, AgentEvent (plain types)
├── repositories.ts  ProjectRepo, JobRepo, ArtifactRepo, EventRepo, DataStore
├── drivers/sqlite/  Drizzle schema, migrate, repo implementations, checkpointer
└── index.ts         getStore() / closeStore()
```

Code outside `src/server/data` calls `getStore()` (or `ctx.store` in tRPC) and never imports `drizzle-orm` or `better-sqlite3`; `src/layers.test.ts` fails the build otherwise. `FACTORY_DB` selects the driver (default `sqlite`). To add a backend, implement `DataStore` under `src/server/data/drivers/<name>/` and register it in `src/server/data/index.ts`.

Implementation runs in a **linked worktree** under `var/worktrees/`. Do not implement on the operator’s current checkout branch. Product git commits must not include `.factory/` notes (`requirements`, specs, `tasks.json`, `review.md`).

## Adding an intake plugin

Webhooks already live at `POST /api/webhooks/[id]`. Do **not** add `/api/webhooks/<name>/route.ts`.

1. Add `src/server/integrations/plugins/<name>.ts` exporting an `IntegrationPlugin`:

   - `id` — snake_case (`asana`, `clickup`)
   - `secretEnv`, `verify`, `parse`, `match`, `settingsFields`

2. Register it in `src/server/integrations/registry.ts` (next to GitHub / Linear / Jira) or from `src/server.ts` **before** `runtime.start()`.

```ts
import { registerIntegration } from "@/server/integrations";
import { asanaPlugin } from "@/server/integrations/plugins/asana";

registerIntegration(asanaPlugin);
```

3. Restart. Settings → Webhook intake lists the provider. Endpoint: `{FACTORY_ORIGIN}/api/webhooks/<id>`.

Operator-facing webhook URLs: [WEBHOOKS.md](./WEBHOOKS.md).

## Adding an LLM provider plugin

`getModel()` must not grow per-vendor branches. A new backend is an `LlmProviderPlugin`.

1. Add `src/server/llm/providers/plugins/<name>.ts` exporting an `LlmProviderPlugin`:

   - `id` — snake_case (`openrouter`, `anthropic`)
   - `match`, `listModels`, `apiStyle`, `createModel`
   - Reuse `createChatModel` / `createResponsesModel` / `createMessagesModel` from `@/server/llm` when the host is OpenAI- or Anthropic-shaped

2. Register it in `src/server/llm/providers/registry.ts` (next to OpenCode Go / xAI / OpenAI / custom) or from `src/server.ts` **before** `runtime.start()`.

```ts
import { registerLlmProvider } from "@/server/llm";
import { openrouterPlugin } from "@/server/llm/providers/plugins/openrouter";

registerLlmProvider(openrouterPlugin);
```

3. Restart. Set `LLM_PROVIDER=<id>` or make `match(env)` return true at a higher `priority` than OpenCode Go (40). Settings and intake list models from `plugin.listModels`.

Do **not** probe the same API key against multiple third-party hosts.

## Adding a pipeline lane or HITL step

Use a pipeline **action** (`produce` / `implement` / `fix` / `human_approval` / `publish`) in `src/server/pipeline/`. Do not hardcode a new LangGraph node name unless the default pipeline needs a stable checkpoint name.

## Schema changes

1. Update the model type in `src/server/data/models/` and the Drizzle table in `src/server/data/drivers/sqlite/schema.ts` (a compile-time check fails if they drift).
2. Add an idempotent `ALTER TABLE … ADD` (or `CREATE INDEX IF NOT EXISTS`) in `src/server/data/drivers/sqlite/migrate.ts`, wrapped in try/catch like the existing columns.
3. If callers need a new query, add a method to the repo in `src/server/data/repositories.ts` and implement it in each driver.
4. Add or extend a colocated test if behavior depends on the new field.
5. Document the operator impact in [MAINTENANCE.md](./MAINTENANCE.md) if `var/` on disk needs a one-off.

There is no generated migration folder. Boot always calls `getStore().migrate()`.

## Tests

- Runner: Vitest, Node environment, `src/**/*.test.ts`
- Assert behavior (inputs/outputs, HTTP status, parsed artifacts), not call graphs
- Prefer fixtures in `src/server/artifacts/fixtures.ts` over hitting a live LLM
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
