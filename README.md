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
2. Create a job from the board (title + brief). It always starts in **Triage**.
3. Every ticket visits every lane: Triage → Planning → Tech spec → Tasks → Implementation → PR.
4. The triage agent labels simple vs complex and risk. Simple + low risk **fast-tracks** planning HITL (artifacts are still written in each lane) so it can reach implementation and PR sooner.
5. Complex or higher-risk tickets pause for human approval after planning, spec, and tasks.
4. Implementation runs in a linked worktree under `var/worktrees/` (your checkout is not touched).
5. Approve review. Local-only repos finish with a branch; GitHub + PAT opens a pull request.

Label GitHub issues `factory` to ingest them (requires PAT and poll enabled).

Without a working agent key the UI shows a blocking error and all create/attach mutations fail.

## Scripts

- `pnpm dev` — `src/server.ts` (FactoryRuntime + Next.js)
- `pnpm test` — unit tests
- `pnpm seed:board` — six sample cards on the first project

See [DESIGN.md](./DESIGN.md) for the full specification.
