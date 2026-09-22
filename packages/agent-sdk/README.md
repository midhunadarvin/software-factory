# @software-factory/agent-sdk

Open-source catalog of Software Factory lane agents (triage, planning, spec, tasks, implementation, review, fix, PR).

The factory app depends on this package. **New agents and prompt changes belong here**, not in the web app. Bump the package version (or the workspace pin) to pick them up — do not copy skills into `src/lib/runtime`.

## Install

```sh
pnpm add @software-factory/agent-sdk
```

In this monorepo the factory uses `workspace:*`.

## Usage

```ts
import {
  getAgent,
  listAgents,
  registerAgent,
  resolveAgentSystem,
  skillFor,
} from "@software-factory/agent-sdk";

const review = getAgent("review");
const system = resolveAgentSystem("implementation");

registerAgent({
  id: "security",
  label: "Security",
  skill: "Audit the diff for secrets.",
  exitHint: "Call submitArtifact once, then stop.",
  tools: ["repo.read", "submit_artifact"],
  maxSteps: 8,
});
```

The host (Software Factory) supplies the LLM via the Vercel AI SDK (`@ai-sdk/xai` / `@ai-sdk/openai-compatible`), plus git worktree and ticket tools. This package owns **which agents exist** and **what they are told** — not provider HTTP.

## Publish

```sh
cd packages/agent-sdk
pnpm publish --access public
```

Source is published as TypeScript (`exports` point at `src/`). Add a `tsc` build later if you need `.js` on npm.
