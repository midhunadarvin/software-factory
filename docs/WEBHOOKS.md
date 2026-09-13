# Webhooks and intake

Jobs enter **Intake** from the UI, a GitHub poller, or **webhooks** (GitHub, Linear, Jira). Integrations are plugins. Each one owns verify / parse / project matching and appears in Settings.

The factory exposes unauthenticated POST endpoints at `/api/webhooks/<plugin-id>`. Auth is the provider signature (or a shared secret for Jira). Middleware does **not** require the app-password cookie.

Set `FACTORY_ORIGIN` to the public base URL, then use:

| Provider | URL | Secret env |
|---|---|---|
| GitHub | `{FACTORY_ORIGIN}/api/webhooks/github` | `GITHUB_WEBHOOK_SECRET` |
| Linear | `{FACTORY_ORIGIN}/api/webhooks/linear` | `LINEAR_WEBHOOK_SECRET` |
| Jira | `{FACTORY_ORIGIN}/api/webhooks/jira?secret=<JIRA_WEBHOOK_SECRET>` | `JIRA_WEBHOOK_SECRET` |

Settings → **Webhook intake** shows these URLs and lets you enable each source, filter by label, and turn on **auto-triage**.

## Matching

- **GitHub** — `repository.owner/name` must match the project's GitHub remote (`repoOwner` / `repoName`).
- **Linear** — enable Linear on the project; set **Team ID** if more than one project accepts Linear.
- **Jira** — enable Jira and set the project key (e.g. `ENG`).

Duplicates are ignored (`project` + `external_key`). Title/body refresh only while the card is still in Intake.

Label GitHub issues `factory` to ingest them via the 30s poller (requires PAT and poll enabled). Webhooks can ingest every opened issue without that label.

### Auto-triage

Off by default. When enabled on the project, a newly ingested webhook (or poller) ticket is sent to the triage lane immediately — same as clicking **Send to triage**. If the LLM is not ready, the card stays in Intake and a warning is logged.

## GitHub

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

## Linear

1. Linear **Settings → API → Webhooks**.
2. URL: `https://your-host/api/webhooks/linear`
3. Copy the signing secret into `LINEAR_WEBHOOK_SECRET`. Restart.
4. Subscribe to **Issues**.
5. In Factory Settings, enable Linear. Paste the team UUID if you run more than one project.
6. Create a Linear issue. It lands in Intake (or Triage if auto-triage is on).

## Jira

Jira Cloud issue webhooks do not send an HMAC. The factory checks a shared secret on the query string (`?secret=`), `Authorization: Bearer …`, or `X-Webhook-Secret`.

1. Set `JIRA_WEBHOOK_SECRET` to a long random string. Restart.
2. Jira **Settings → System → Webhooks** (or the project automation “Send web request” action).
   - URL: `https://your-host/api/webhooks/jira?secret=THE_SAME_SECRET`
   - Events: **Issue created** (and optionally **Issue updated**)
   - Body: the default Jira issue JSON (`jira:issue_created`)
3. In Factory Settings, enable Jira and set the project key (`ENG`, `OPS`, …).
4. Create a Jira issue in that project.

If the secret is missing on the server, the endpoint returns **503** so you notice before configuring the provider.

## Adding a plugin

See [DEVELOPER.md](./DEVELOPER.md#adding-an-intake-plugin). Rules that will get a PR rejected:

- New file at `src/app/api/webhooks/<name>/route.ts`
- Integration `id` that is not snake_case
- Client components importing `integrations/registry.ts`
