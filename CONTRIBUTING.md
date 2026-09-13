# Contributing

Thanks for helping with Software Factory. This document is the human-facing process. Coding agents must also follow [AGENTS.md](./AGENTS.md); if anything conflicts, **AGENTS.md wins** for architecture.

## Before you start

1. Read the [Code of Conduct](./CODE_OF_CONDUCT.md).
2. Skim [docs/DEVELOPER.md](./docs/DEVELOPER.md) for setup, layout, and how to extend the factory.
3. Search [existing issues](https://github.com/midhunadarvin/software-factory/issues) before opening a new one.

## Ways to contribute

- Bug reports and reproductions
- Documentation and operator guides
- Tests around existing behavior
- Small, focused features that fit the current stack (see “Out of scope” below)

Security issues: follow [SECURITY.md](./SECURITY.md), not a public issue.

## Out of scope (will be declined)

These are product constraints, not style nits:

- A second database, queue, or UI framework
- A new webhook route file (`/api/webhooks/<name>/route.ts`) — use an `IntegrationPlugin` instead
- A second way to define pipeline lanes (hardcoded LangGraph node names for new lanes)
- Client components that import Node-only modules (`better-sqlite3`, `db/client`, `integrations/registry.ts`)
- Committing `var/` or `.env`

See [AGENTS.md](./AGENTS.md) for the full list.

## Development loop

```sh
pnpm install
cp .env.example .env   # set FACTORY_SECRET, FACTORY_APP_PASSWORD, and an LLM key
pnpm test
pnpm typecheck
pnpm dev
```

Details: [docs/DEVELOPER.md](./docs/DEVELOPER.md).

## Pull requests

1. Fork and branch from the default branch. Name branches after the change (`fix/session-cookie`, `docs/webhooks`).
2. Keep the diff small. One concern per PR.
3. Colocate tests as `*.test.ts` next to the code. Assert behavior, not implementation diary.
4. Schema changes update **both** `src/lib/db/schema.ts` and `src/lib/db/migrate.ts` (`ALTER TABLE … ADD`, idempotent).
5. Do not stage `.factory/` notes or anything under `var/`.
6. Fill in the pull request template. Link the issue if there is one.
7. Maintainers run CI (`pnpm test`, `pnpm typecheck`). Fix failures on your branch.

### Commit messages

Use a short imperative subject, then why if it is not obvious:

```
fix: resume HITL jobs after process restart

Checkpoints were ignored when invoke_generation was stale.
```

Prefixes that match this repo: `feat:`, `fix:`, `docs:`, `test:`, `refactor:`, `chore:`.

## Review bar

Reviewers look at the diff for:

- **major** — new webhook route, new persistence mechanism, new UI stack, or a second way to define lanes
- **minor** — extra wrapper folder, new test runner, style-only drift

Match the file you are editing: small functions, Zod at the boundary, no narrating comments.

## Release notes

This app is not published to npm. User-visible changes belong in [CHANGELOG.md](./CHANGELOG.md) under **Unreleased**. Maintainers move that section when tagging a version.

## Questions

Open a discussion or issue. Architecture questions: cite `AGENTS.md` and the relevant module rather than `DESIGN.md` (historical spec).
