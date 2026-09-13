# Self-hosting

Run Software Factory with Docker or `pnpm start`. The image is the same process as local: Next.js + FactoryRuntime in **one** container.

## Requirements

- Docker 24+ / Compose v2, or Node 22+ and pnpm 9+
- Persistent disk for `var/` (SQLite, checkpoints, worktrees)
- A reachable origin if you use webhooks (`FACTORY_ORIGIN`)

## Environment

Copy `.env.example` to `.env`. Set at least:

- `FACTORY_SECRET` — not the example hex string
- `FACTORY_APP_PASSWORD`
- `FACTORY_LLM_API_KEY` (or `OPENAI_API_KEY` / `XAI_API_KEY`)
- `FACTORY_ORIGIN` — URL browsers and webhook providers can reach (HTTPS in production)

Default LLM provider is OpenCode Go. Set `LLM_PROVIDER=xai|openai|custom` to select another registered plugin. `OPENAI_COMPAT_BASE_URL` is only for a custom `/v1` root — do not append `/chat/completions`, `/responses`, or `/messages`.

## Docker Compose

```sh
cp .env.example .env
# edit secrets and FACTORY_ORIGIN
docker compose up --build -d
```

Or without Compose:

```sh
docker build -t software-factory .
docker run --rm -p 3000:3000 --env-file .env \
  -e FACTORY_BIND=0.0.0.0:3000 \
  -v factory-data:/app/var \
  -v /path/to/repos:/repos \
  software-factory
```

The container listens on `0.0.0.0:3000`. Health: `GET /api/health` (Compose/Docker require `db: true`).

To attach host checkouts:

```sh
FACTORY_HOST_REPOS=/absolute/path/to/repos docker compose up --build -d
```

Then attach `/repos/<name>` from the Open page. Clone dest defaults to `/repos/<owner>/<repo>` (`FACTORY_REPOS_DIR`).

Put a reverse proxy (Caddy, nginx, Traefik) in front for TLS. Point `FACTORY_ORIGIN` at that public HTTPS URL. Webhook signatures do not replace TLS.

## Volumes

| Mount | Purpose |
|---|---|
| `/app/var` | `factory.sqlite`, checkpoints, job worktrees, session logs |
| `/repos` | Git clones / attached work-trees |

## State and restarts

Pipeline **config** and **job progress** live on disk under `{FACTORY_ROOT}/var/` (gitignored). A process restart does not reset the board.

| Path | What it keeps |
|---|---|
| `var/factory.sqlite` | Projects, pipeline JSON, intake settings, jobs, artifacts, events |
| `var/checkpoints.sqlite` | LangGraph interrupts (HITL gates) |
| `var/sessions/` | Agent transcripts |
| `var/worktrees/` | Isolated implementation checkouts |

On boot the runtime reopens those files, leaves **Intake** and **awaiting approval** cards parked, and continues only runnable lanes. Tickets do not jump back to Intake.

Do not delete `var/` if you want history. Back it up with the same care as a database.

When you attach this application repo as a Factory project, keep using the same `FACTORY_ROOT`. Implementation still runs in `var/worktrees/`, not in the checkout that is running the server.

## Production notes

- Bind `FACTORY_BIND=0.0.0.0:3000` only behind a proxy you control.
- Cap disk with `FACTORY_VAR_MAX_GB` (default 20).
- Rotate secrets as described in [SECURITY.md](../SECURITY.md) and [MAINTENANCE.md](./MAINTENANCE.md).
- Webhooks: [WEBHOOKS.md](./WEBHOOKS.md).
