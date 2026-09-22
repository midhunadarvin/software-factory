# Maintenance

How to keep this repository healthy as a maintainer. Day-to-day coding is in [DEVELOPER.md](./DEVELOPER.md).

## Source of truth

| Question | Answer |
|---|---|
| What may land in a PR? | [AGENTS.md](../AGENTS.md) + [CONTRIBUTING.md](../CONTRIBUTING.md) |
| Why was v1 designed this way? | [DESIGN.md](../DESIGN.md) (historical; do not treat as current API) |
| What is on disk after a restart? | [SELF-HOSTING.md](./SELF-HOSTING.md) |
| How do webhooks authenticate? | [WEBHOOKS.md](./WEBHOOKS.md) |

If `DESIGN.md` and the tree disagree, **the tree and AGENTS.md win**.

## CI

GitHub Actions (`.github/workflows/ci.yml`) runs on pull requests and pushes to the default branch:

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm test`

Do not merge red CI. If a native module (`better-sqlite3`) fails to compile on the runner, fix the workflow — do not skip the job.

Dependabot (`.github/dependabot.yml`) opens weekly npm PRs. Review them like any other change: run tests, watch for LangGraph / Next / Drizzle majors.

## Releases

This is an application (`private: true` in `package.json`), not an npm package.

1. Move `[Unreleased]` notes in [CHANGELOG.md](../CHANGELOG.md) into a dated version heading (`## [0.x.y] - YYYY-MM-DD`).
2. Bump `"version"` in `package.json` to match.
3. Tag `v0.x.y` on the default branch.
4. Optional: build and publish a container image from the `Dockerfile` (operators can also `docker compose up --build`).

Pre-1.0: breaking changes are allowed but must be called out in the changelog (schema ALTERs, env var renames, webhook URL changes).

## Schema and `var/`

`migrate()` is additive only (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD`, `CREATE INDEX IF NOT EXISTS`).

When you add a column:

- Old `var/factory.sqlite` files must keep working after pull + restart.
- Do not drop columns in place without a documented one-off for operators.
- Never instruct operators to delete `var/` unless they accept losing the board, checkpoints, and worktrees.

Checkpoints (`var/checkpoints.sqlite`) are LangGraph state. Changing node **names** on the default pipeline can strand in-flight jobs. Prefer new action types over renaming a live checkpoint.

## Secrets rotation

- `FACTORY_SECRET` rotation: set `FACTORY_SECRET_OLD` to the previous secret so existing GitHub PATs decrypt, then re-save PATs and drop `_OLD`.
- Webhook secrets: change provider + env together; a mismatch looks like forged traffic (401/403) or Jira 503 if the server secret is missing.
- Example values in `.env.example` must stay obviously fake.

## Dogfooding this repo

When Software Factory runs **against its own checkout**:

- Keep `FACTORY_ROOT` as this repo so jobs use `var/worktrees/`, not the branch that is running `pnpm dev`.
- Do not commit `var/` or `.env`.
- Agent PRs should still follow AGENTS.md (no extra webhook routes, no second DB).

## Review checklist

Use this when merging:

- [ ] Tests and typecheck pass
- [ ] Schema change has matching `migrate.ts` ALTER
- [ ] No new persistence path outside `var/`
- [ ] No new top-level framework or package that duplicates an existing module
- [ ] Client bundle still free of Node-only imports
- [ ] Changelog Unreleased updated for user-visible behavior
- [ ] Webhook / env docs updated if operators must change config

## Support surface

Issues and PRs on GitHub. Security: [SECURITY.md](../SECURITY.md). Conduct: [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).
