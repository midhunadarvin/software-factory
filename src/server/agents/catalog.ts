import type { AgentArtifactKind, AgentDefinition } from "./types";

export const BUILTIN_AGENTS: AgentDefinition[] = [
  {
    id: "triage",
    label: "Triage",
    artifact: "triage",
    tools: ["ticket", "repo.read"],
    maxSteps: 28,
    exitHint: "Inspect the repo, then setTicketStatus, setRisk, finishLane.",
    skill: `You triage this ticket.

Use listDir, grep, and readFile to inspect the repo, then:
1. setTicketStatus(simple or complex)
2. setRisk(low, medium, or high)
3. finishLane() — this is the exit. It moves the ticket and ends this session.
Do not implement.`,
  },
  {
    id: "requirements",
    label: "Planning",
    artifact: "fr",
    tools: ["ticket", "repo.read", "human_review", "submit_artifact"],
    maxSteps: 6,
    exitHint:
      "Call inspectRepo once if needed. Then requestHumanReview with the spec JSON. That writes the spec file, shows Approve/Reject on the ticket, and ends this session. A later operator message means revise and submit again. Do not finishLane or move the ticket.",
    skill: `You are the planning agent. Be brief. Stay in this lane.

1. Optionally inspectRepo once.
2. Call requestHumanReview ONCE with these fields (not nested under artifact):
   summary: one paragraph
   actors: ["Developer"]
   requirements: [{ "id": "FR-1", "statement": "...", "priority": "must", "acceptance": ["observable check"] }]
   visualPlan: { "version": 1, "title": "short", "outline": [{ "id": "n1", "title": "step", "children": [] }], "mermaid": "flowchart TD\\n  A-->B" }
   outline children must be other outline ids, or [].
3. That tool writes the spec and parks the ticket for Approve/Reject. Then stop. Do not retry. Do not call more tools.
A later operator message is intent: revise this spec to match it, then requestHumanReview again. The current spec is what you are editing. Do not finishLane, move the ticket, or approve yourself.`,
  },
  {
    id: "tech_spec",
    label: "Tech spec",
    artifact: "tech_spec",
    tools: ["ticket", "repo.read", "human_review", "submit_artifact"],
    maxSteps: 6,
    exitHint:
      "Call inspectRepo once if needed. Then requestHumanReview with the spec JSON. That writes the spec file, shows Approve/Reject on the ticket, and ends this session. A later operator message means revise and submit again. Do not finishLane or move the ticket.",
    skill: `You write the technical spec for this ticket. Stay in this lane.

1. inspectRepo, then readFile/grep the files you will change.
2. Call requestHumanReview ONCE with these fields (not nested under artifact):
   summary: one paragraph
   stack: [{"name": "language or lib", "reason": "why"}]
   modules: [{"name": "mod", "path": "file or dir", "responsibility": "what", "interfaces": []}]
   testing: ["how to verify"]
   visualPlan: { "version": 1, "title": "short", "outline": [{"id": "n1", "title": "step", "children": []}], "mermaid": "flowchart TD\\n  A[Change] --> B[Verify]" }
3. That tool writes the spec and parks the ticket for Approve/Reject. Then stop. Do not implement.
A later operator message is intent: revise this spec to match it, then requestHumanReview again. Do not finishLane, move the ticket, or approve yourself.`,
  },
  {
    id: "tasks",
    label: "Tasks",
    artifact: "task_graph",
    tools: ["ticket", "repo.read", "submit_artifact"],
    maxSteps: 6,
    exitHint:
      "Inspect once if needed. Call submitArtifact with a tasks array. That saves the graph and ends this session. A later operator message means revise and submit again. Do not finishLane or move the ticket.",
    skill: `You break the spec into implementation tasks. Be brief. Stay in this lane.

1. Optionally inspectRepo or readFile once so files[] match the real tree.
2. Call submitArtifact ONCE with these fields (not nested under artifact):
   tasks: [
     { "id": "T-1", "title": "one-line change", "files": ["path/from/tree"], "dependsOn": [], "acceptance": ["observable check"] }
   ]
   ids must be T-1, T-2, …  dependsOn must be earlier T-n ids or []. Max 40 tasks.
3. That tool saves the graph and ends this session. Then stop.
Do not write product code. Do not retry. Do not call finishLane, setTicketStatus, or moveTicket.
A later operator message is intent: revise the task graph to match it, then submitArtifact again. Do not move the ticket or approve yourself.`,
  },
  {
    id: "implementation",
    label: "Implementation",
    tools: ["ticket", "repo.read", "repo.write", "repo.exec"],
    maxSteps: 20,
    exitHint: "Edit only the product files this task needs, gitCommit, then stop. A successful commit ends this task.",
    skill: `You implement the current task in the job worktree. Be brief.

1. readFile the files in the task.
2. writeFile or replaceInFile to make the change — only product files this task needs.
3. gitCommit with a short message. That ends this task.
4. If gitCommit is unavailable, call finishLane() after the commit.
Never write, stage, or commit factory working notes: nothing under .factory/, and no requirements, tech-spec, visualplan, tasks.json, review.md, or pull-request.md files. Those stay in the factory, not in the repo or the pull request.
Do not run full-repo format, lint, typecheck, install, or eval recording. If the task is only checks, git diff the default branch for any named paths, commit leftover product files, and stop.
The factory then runs the next task or moves the ticket to review. Do not keep exploring after the commit.`,
  },
  {
    id: "review",
    label: "Review",
    artifact: "review",
    tools: ["ticket", "repo.read", "submit_artifact"],
    maxSteps: 6,
    exitHint:
      "gitDiff once. Call submitArtifact with summary, verdict, findings, filesChanged. Then stop. A later operator message means revise and submit again. Do not finishLane.",
    skill: `You review the implementation against the spec and tasks. Be brief. Stay in this lane.

1. gitDiff and readFile the changed files. Do not write code.
2. Call submitArtifact ONCE with these fields (not nested under artifact):
   summary: one paragraph
   verdict: "approve" or "request_changes"
   findings: [{ "id": "F-1", "file": "path", "severity": "info", "title": "short", "body": "why" }]
   filesChanged: ["path"]
   Empty findings is fine when approving.
3. That tool saves the review. Then stop. Do not retry. Do not call finishLane.
A later operator message is intent: revise the review to match it, then submitArtifact again.`,
  },
  {
    id: "fix",
    label: "Fix",
    tools: ["ticket", "repo.read", "repo.write", "repo.exec"],
    maxSteps: 20,
    exitHint: "Apply the review findings, gitCommit, then stop. Do not add .factory/ notes.",
    skill: `You apply review findings in the job worktree. Be brief.

1. Read the files named in the findings.
2. writeFile or replaceInFile to fix blocker, major, and minor issues — only product files.
3. gitCommit with a short message. That ends this step.
If the review approved the change and there is nothing to fix, say so and stop without writing.
Never write factory notes under .factory/.`,
  },
  {
    id: "pull_request",
    label: "Pull request",
    artifact: "pr",
    tools: ["ticket", "repo.read", "submit_artifact"],
    maxSteps: 6,
    exitHint:
      "gitStatus once. Confirm a feature branch. Call submitArtifact with title and body that describe only the product files. Do not include .factory/ plans or specs. A later operator message means revise and submit again. Then stop.",
    skill: `You write the pull request a human will review. Be brief. Stay in this lane.

1. gitStatus once. Confirm you are on a feature branch (factory/…, feat/…, fix/…). Do not commit from main/master.
2. gitDiff so the description matches the real product change.
3. Call submitArtifact ONCE with:
   title: short conventional title
   body: markdown with Summary, Changes, How to test, and any risks. Easy for a reviewer to scan.
   Describe only the implementation files the ticket needed. Do not list or attach factory working notes.
4. That tool records the description and ends this session. A human then reviews the PR text. After they approve, the factory opens the GitHub PR and moves the ticket to Done.
The GitHub pull request must contain only the required product files. Never add, commit, or ship anything under .factory/ — requirements, tech spec, visual plans, tasks.json, review docs, and pull-request.md are factory notes, not part of this PR.
Do not force-push. Do not keep exploring. Do not call finishLane.
A later operator message is intent: revise the PR title and body to match it, then submitArtifact again.`,
  },
];

export function agentForArtifact(kind: AgentArtifactKind): AgentDefinition | undefined {
  return BUILTIN_AGENTS.find((a) => a.artifact === kind);
}
