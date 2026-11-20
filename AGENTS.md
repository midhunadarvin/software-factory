# Agent conventions (Software Factory)

This file is authoritative for agents working in this repo. If `DESIGN.md` disagrees, **this file wins**.

## Stack — do not replace

One Node process: `src/server.ts` starts FactoryRuntime + Next.js.

- Next 15, React 19, tRPC, Drizzle + better-sqlite3 (WAL), LangGraph, Zod, Vitest, Tailwind
- LLM: provider plugins (`FACTORY_LLM_API_KEY`; default OpenCode Go). Do not hardcode a second client in `src/server/llm/model.ts`
- Persistence: `{FACTORY_ROOT}/var/` only (`factory.sqlite`, `checkpoints.sqlite`, `sessions/`, `worktrees/`), reached through `getStore()` in `src/server/data`
- Do not add a second database, queue, or UI framework

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
| LLM calls, job model, output parsing | `src/server/llm/` (`model.ts`, `parse.ts`, `session.ts`) |
| Data models (Project, Job, Artifact, AgentEvent) | `src/server/data/models/` — plain types, no DB imports |
| Data access | `getStore()` from `src/server/data` → `store.projects` / `jobs` / `artifacts` / `events` |
| New repository method | `src/server/data/repositories.ts` + every driver under `src/server/data/drivers/` |
| New issue tracker (Slack, Asana, …) | `src/server/integrations/plugins/` + `registerIntegration` |
| New LLM backend | `src/server/llm/providers/plugins/` + `registerLlmProvider` |
| New coding CLI harness | `src/server/agents/harness/` + `registerHarness` |
| Schema | `src/server/data/drivers/sqlite/schema.ts` **and** `src/server/data/drivers/sqlite/migrate.ts` (`ALTER TABLE … ADD`), then the model in `src/server/data/models/` |
| Tests | colocated `*.test.ts`, run `pnpm test` and `pnpm typecheck` |

## Extension rules (do not diverge)

1. **New intake source** = an `IntegrationPlugin` (`verify`, `parse`, `match`, settings fields). Register it in `src/server/integrations/registry.ts`. Webhooks already live at `POST /api/webhooks/[id]`. Do **not** add `/api/webhooks/<name>/route.ts`.
2. **New LLM backend** = an `LlmProviderPlugin` (`match`, `listModels`, `apiStyle`, `createModel`). Register it in `src/server/llm/providers/registry.ts` or from `src/server.ts` before `runtime.start()`. Do **not** add a second `getModel()` branch in `src/server/llm/model.ts`. Only `src/server/llm/` may import `@ai-sdk/*`.
3. **New coding CLI harness** = a `HarnessPlugin` (`detect`, `start`) in `src/server/agents/harness/`. Register it in `src/server/agents/harness/registry.ts`. Do **not** spawn `claude` / `codex` / `cursor-agent` from graph nodes directly. Default remains `inprocess`.
4. **New factory lane or HITL step** = a pipeline action in `src/server/pipeline/` plus an agent in `src/server/agents/` (`registerAgent` / `catalog.ts`). Do not paste a new skill string into `src/server/runtime`. Do not hardcode a new LangGraph node name unless the default pipeline needs a stable checkpoint name.
5. **New coding agent** = `registerAgent` from `@/server/agents`. The factory looks agents up by id.
6. **Job and pipeline progress** stay in `var/`. Never invent another store. Never commit `var/`. Read and write through `getStore()`; only `src/server/data/drivers/` may import `drizzle-orm`, `better-sqlite3`, or the LangGraph SQLite checkpointer (`src/layers.test.ts` enforces this). A new database backend is a driver under `src/server/data/drivers/<name>/` implementing `DataStore`, selected with `FACTORY_DB`.
7. **Client components** must not import Node-only modules (`integrations/registry.ts`, `llm/providers/registry.ts`, `@/server/data` runtime exports, `better-sqlite3`). Type-only imports from `@/server/data/models` are fine. Use `src/server/integrations/intake/settings.ts` and data from tRPC.
8. **Reuse** the neighboring module. Do not add a package or top-level folder if an existing one already does the job.

## Change style

- Match the file you are editing: small functions, Zod at the boundary, no narrating comments.
- Colocate tests; assert behavior, not implementation diary.
- Product git commits: never stage `.factory/` notes (requirements, specs, tasks.json, review.md).
- Implementation runs in a linked worktree under `var/worktrees/`. Do not edit the operator’s current checkout branch.

## Review bar

Against the diff:

- **major** — new webhook route, new persistence mechanism, DB access outside `getStore()`, new UI stack, or a second way to define lanes
- **minor** — extra wrapper folder, new test runner, style-only drift

## Historical spec

`DESIGN.md` is the original product spec. Treat it as background. Current behavior is this tree + `AGENTS.md`.

Human-facing docs (setup, webhooks, releases) live under `docs/`. Do not duplicate them here.
