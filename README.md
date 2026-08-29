# Software Factory

Local TypeScript web app that turns a git repo (local folder or cloned GitHub repo) into a six-lane agent factory with human approval.

## Requirements

- Node.js 22+
- pnpm 9+
- git

## Setup

```sh
cd software-factory
pnpm install
cp .env.example .env
# set FACTORY_SECRET (64 hex chars), FACTORY_APP_PASSWORD, optional XAI_API_KEY
pnpm dev
```

Open http://127.0.0.1:3000 — log in, then **Open a repository**.

## First run

1. Paste an absolute path to a local git repo, or clone `owner/repo`.
2. Create a job from the board (title + brief).
3. Approve functional requirements, tech spec, and tasks.
4. Implementation runs in a linked worktree under `var/worktrees/` (your checkout is not touched).
5. Approve review. Local-only repos finish with a branch; GitHub + PAT opens a pull request.

Label GitHub issues `factory` to ingest them (requires PAT and poll enabled).

Without `XAI_API_KEY` the agents emit fixture artifacts so the board and HITL gates still work.

## Scripts

- `pnpm dev` — `src/server.ts` (FactoryRuntime + Next.js)
- `pnpm test` — unit tests
- `pnpm seed:board` — six sample cards on the first project

See [DESIGN.md](./DESIGN.md) for the full specification.
