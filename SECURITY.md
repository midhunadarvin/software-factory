# Security policy

## Supported versions

This project is pre-1.0. Security fixes land on the default branch (`main` when present, otherwise the current default). There are no long-term support branches yet.

## What this app stores

Software Factory is a **single-tenant** local or self-hosted app. It keeps:

- SQLite databases, LangGraph checkpoints, session logs, and job worktrees under `{FACTORY_ROOT}/var/` (never commit this directory)
- An app password (`FACTORY_APP_PASSWORD`) and encryption secret (`FACTORY_SECRET`)
- Optional GitHub PATs, encrypted at rest with keys derived from `FACTORY_SECRET`
- Webhook signing secrets in the process environment

Treat `var/`, `.env`, and any PAT as production secrets.

## Reporting a vulnerability

**Do not open a public issue** for vulnerabilities that could leak secrets, bypass auth, or execute untrusted job text as instructions.

1. Use [GitHub private vulnerability reporting](https://github.com/midhunadarvin/software-factory/security/advisories/new).
2. Include: affected version/commit, impact, reproduction steps, and (if you have one) a suggested fix.
3. We will acknowledge the report and follow up with a timeline once we have reproduced it.

## Hardening checklist for operators

- Generate a unique `FACTORY_SECRET` (64 hex chars or `base64:` ≥ 32 bytes). Do not use the example value from `.env.example`.
- Bind to `127.0.0.1` unless you put a reverse proxy with TLS in front. In Docker, set `FACTORY_ORIGIN` to the public HTTPS URL.
- Webhook signatures do not replace TLS.
- Rotate `FACTORY_SECRET` with `FACTORY_SECRET_OLD` so existing PATs can be re-encrypted.
- Cap disk with `FACTORY_VAR_MAX_GB` (default 20).
- Job title/body are untrusted input. Do not weaken sandbox or tool allowlists to “make a ticket work.”
