import { randomUUID } from "node:crypto";
import { getStore } from "../server/data";
import { nowIso } from "../utils/paths";

const store = getStore();
await store.migrate();
const existing = await store.projects.list();
if (existing.length === 0) {
  console.log("create a project first (open a repo in the UI)");
  process.exit(0);
}
const project = existing[0]!;
const now = nowIso();
const states = [
  ["triage", "triage"],
  ["awaiting_requirements_approval", "planning"],
  ["awaiting_tech_spec_approval", "tech_spec"],
  ["awaiting_tasks_approval", "tasks"],
  ["implementation", "implementation"],
  ["awaiting_review_approval", "pull_request"],
] as const;
let n = -100;
for (const [state, col] of states) {
  await store.jobs.insert({
    id: randomUUID(),
    projectId: project.id,
    issueNumber: n--,
    issueTitle: `Seed ${state}`,
    issueBody: "seed",
    issueUrl: "",
    state,
    lastActiveState: col,
    boardColumn: col,
    createdAt: now,
    updatedAt: now,
  });
}
console.log("seeded 6 cards");
