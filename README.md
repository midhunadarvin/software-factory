# Software Factory

TypeScript web app that turns a git repo into an agent factory with human approval. Run it on your laptop or self-host it with Docker. Jobs enter **Intake** from the UI, a GitHub poller, or **webhooks** (GitHub, Linear, Jira).

## Requirements

- Node.js 22+
- pnpm 9+
- git
- Or Docker 24+ / Compose v2

## Setup (local)

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
2. Create a job from the board (title + brief), or open a GitHub/Linear/Jira issue if webhooks are configured. New cards start in **Intake**.
3. Send a card to **Triage**, or enable **Auto-move new webhook tickets to triage** in Settings.
4. Every ticket visits every configured lane (default: Triage → Planning → Tech spec → Tasks → Implementation → PR).
5. The triage agent labels simple vs complex and risk. Simple + low risk **fast-tracks** planning HITL so it can reach implementation sooner.
6. Complex or higher-risk tickets pause for human approval after planning, spec, and review.
7. Implementation runs in a linked worktree under `var/worktrees/` (your checkout is not touched).
8. Approve review. Local-only repos finish with a branch; GitHub + PAT opens a pull request.

Label GitHub issues `factory` to ingest them via the 30s poller (requires PAT and poll enabled). Webhooks can ingest every opened issue without that label.

Without a working agent key the UI shows a blocking error and all create/attach mutations fail.

## Self-host with Docker

The image runs the same process as `pnpm start`: Next.js + FactoryRuntime in one container. Persist `var/` (SQLite, checkpoints, worktrees) and a repos directory.

1. Copy env and set secrets. `FACTORY_ORIGIN` must be the URL webhook providers can reach.

```sh
cp .env.example .env
# FACTORY_SECRET, FACTORY_APP_PASSWORD, XAI_API_KEY or OPENAI_API_KEY
# FACTORY_ORIGIN=https://factory.example.com
# GITHUB_WEBHOOK_SECRET / LINEAR_WEBHOOK_SECRET / JIRA_WEBHOOK_SECRET as needed
```

2. Build and start:

```sh
docker compose up --build -d
```

Or build the image yourself:

```sh
docker build -t software-factory .
docker run --rm -p 3000:3000 --env-file .env \
  -e FACTORY_BIND=0.0.0.0:3000 \
  -v factory-data:/app/var \
  -v /path/to/repos:/repos \
  software-factory
```

3. Open `FACTORY_ORIGIN`, log in, attach or clone a repo. In Docker, clone dest defaults to `/repos/<owner>/<repo>` (`FACTORY_REPOS_DIR`). To use host checkouts:

```sh
FACTORY_HOST_REPOS=/absolute/path/to/repos docker compose up --build -d
```

Then attach `/repos/<name>` from the Open page.

4. Put a reverse proxy (Caddy, nginx, Traefik) in front if you need TLS. Point `FACTORY_ORIGIN` at that public HTTPS URL. Webhook signatures do not replace TLS.

Volumes:

| Mount | Purpose |
|---|---|
| `/app/var` | `factory.sqlite`, checkpoints, job worktrees, session logs |
| `/repos` | Git clones / attached work-trees |

The container listens on `0.0.0.0:3000`. Health: `GET /api/health` (Compose/Docker check `db: true`).

## Webhooks → intake

The factory exposes unauthenticated POST endpoints. Auth is the provider signature (or a shared secret for Jira). Middleware does **not** require the app-password cookie.

Set `FACTORY_ORIGIN` to the public base URL, then use:

| Provider | URL | Secret env |
|---|---|---|
| GitHub | `{FACTORY_ORIGIN}/api/webhooks/github` | `GITHUB_WEBHOOK_SECRET` |
| Linear | `{FACTORY_ORIGIN}/api/webhooks/linear` | `LINEAR_WEBHOOK_SECRET` |
| Jira | `{FACTORY_ORIGIN}/api/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>` | `JIRA_WEBHOOK_SECRET` |

Settings → **Webhook intake** shows these URLs and lets you enable each source, filter by label, and turn on **auto-triage**.

Matching:

- **GitHub** — `repository.owner/name` must match the project's GitHub remote (`repoOwner` / `repoName`).
- **Linear** — enable Linear on the project; set **Team ID** if more than one project accepts Linear.
- **Jira** — enable Jira and set the **project key** (e.g. `ENG`).

Duplicates are ignored (`project` + `external_key`). Title/body refresh only while the card is still in Intake.

### GitHub

1. Generate a random secret and set `GITHUB_WEBHOOK_SECRET` (same value you paste into GitHub). Restart the factory.
2. Repo (or org) **Settings → Webhooks → Add webhook**.
   - Payload URL: `https://your-host/api/webhooks/github`
   - Content type: `application/json`
   - Secret: the same `GITHUB_WEBHOOK_SECRET`
   - Events: **Issues** (opened / reopened / labeled are ingested)
3. Attach that repo as a Factory project (clone or open a folder whose origin is the repo).
4. In Factory Settings, leave **Accept GitHub issue webhooks** on. Leave **Required label** blank to ingest every opened issue, or set `factory` to require that label.
5. Open a GitHub issue. A card appears in **Intake**. Enable **Auto-move new webhook tickets to triage** to skip the manual send.

The 30s poller still works for issues labeled `factory` when a PAT is stored. Webhooks are the path for “create issue → intake immediately.”

### Linear

1. Linear **Settings → API → Webhooks**.
2. URL: `https://your-host/api/webhooks/linear`
3. Copy the signing secret into `LINEAR_WEBHOOK_SECRET`. Restart.
4. Subscribe to **Issues**.
5. In Factory Settings, enable Linear. Paste the team UUID if you run more than one project.
6. Create a Linear issue. It lands in Intake (or Triage if auto-triage is on).

### Jira

Jira Cloud issue webhooks do not send an HMAC. The factory checks a shared secret on the query string (`?secret=`), `Authorization: Bearer …`, or `X-Webhook-Secret`.

1. Set `JIRA_WEBHOOK_SECRET` to a long random string. Restart.
2. Jira **Settings → System → Webhooks** (or the project automation “Send web request” action).
   - URL: `https://your-host/api/webhooks/jira?secret=THE_SAME_SECRET`
   - Events: **Issue created** (and optionally **Issue updated**)
   - Body: the default Jira issue JSON (`jira:issue_created`)
3. In Factory Settings, enable Jira and set the project key (`ENG`, `OPS`, …).
4. Create a Jira issue in that project.

If the secret is missing on the server, the endpoint returns **503** so you notice before configuring the provider.

### Auto-triage

Off by default. When enabled on the project, a newly ingested webhook (or poller) ticket is sent to the triage lane immediately — same as clicking **Send to triage**. If the LLM is not ready, the card stays in Intake and a warning is logged.

## Scripts

- `pnpm dev` — `src/server.ts` (FactoryRuntime + Next.js)
- `pnpm start` — production (build first with `pnpm build`)
- `pnpm test` — unit tests
- `pnpm seed:board` — six sample cards on the first project
- `docker compose up --build` — self-hosted image

See [DESIGN.md](./DESIGN.md) for the original specification.
