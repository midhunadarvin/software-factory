# Agent conventions (Software Factory)

This file is authoritative for agents working in this repo. If `DESIGN.md` disagrees, **this file wins**.

## Stack — do not replace

One Node process: `src/server.ts` starts FactoryRuntime + Next.js.

- Next 15, React 19, tRPC, Drizzle + better-sqlite3 (WAL), LangGraph, Zod, Vitest, Tailwind
- LLM: OpenAI-compatible (`XAI_API_KEY` / `OPENAI_API_KEY`)
- Persistence: `{FACTORY_ROOT}/var/` only (`factory.sqlite`, `checkpoints.sqlite`, `sessions/`, `worktrees/`)
- Do not add a second database, queue, or UI framework

## Where code goes

| Kind of change | Put it here |
|---|---|
| Pages / API routes | `src/app/` |
| UI | `src/components/` |
| tRPC | `src/lib/trpc/routers/` |
| Jobs, graph, lanes | `src/lib/runtime/` |
| Pipeline config | `src/lib/runtime/pipeline/` |
| New issue tracker (Slack, Asana, …) | `src/lib/integrations/plugins/` + `registerIntegration` |
| Schema | `src/lib/db/schema.ts` **and** `src/lib/db/migrate.ts` (`ALTER TABLE … ADD`) |
| Tests | colocated `*.test.ts`, run `pnpm test` and `pnpm typecheck` |

## Extension rules (do not diverge)

1. **New intake source** = an `IntegrationPlugin` (`verify`, `parse`, `match`, settings fields). Register it in `src/lib/integrations/registry.ts`. Webhooks already live at `POST /api/webhooks/[id]`. Do **not** add `/api/webhooks/<name>/route.ts`.
2. **New factory lane or HITL step** = a pipeline action (`produce` / `implement` / `fix` / `human_approval` / `publish`) in `src/lib/runtime/pipeline/`. Do not hardcode a new LangGraph node name unless the default pipeline needs a stable checkpoint name.
3. **Job and pipeline progress** stay in `var/`. Never invent another store. Never commit `var/`.
4. **Client components** must not import Node-only modules (`integrations/registry.ts`, `db/client`, `better-sqlite3`). Use `src/lib/intake/settings.ts` and data from tRPC.
5. **Reuse** the neighboring module. Do not add a package or top-level folder if an existing one already does the job.

## Change style

- Match the file you are editing: small functions, Zod at the boundary, no narrating comments.
- Colocate tests; assert behavior, not implementation diary.
- Product git commits: never stage `.factory/` notes (requirements, specs, tasks.json, review.md).
- Implementation runs in a linked worktree under `var/worktrees/`. Do not edit the operator’s current checkout branch.

## Review bar

Against the diff:

- **major** — new webhook route, new persistence mechanism, new UI stack, or a second way to define lanes
- **minor** — extra wrapper folder, new test runner, style-only drift

## Historical spec

`DESIGN.md` is the original product spec. Treat it as background. Current behavior is this tree + `AGENTS.md`.
