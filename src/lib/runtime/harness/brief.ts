import { getAgent, resolveAgentSystem, wrapUntrusted } from "@software-factory/agent-sdk";
import type { ArtifactKind } from "../../artifacts/schemas";
import type { LaneContext } from "../context";
import { artifactFileName } from "./artifact-file";

export function buildLaneBrief(opts: {
  laneId: string;
  ticketTitle: string;
  ticketBody: string;
  context: LaneContext | null;
  userPrompt: string;
  skill?: string;
  artifact?: ArtifactKind;
  currentArtifact?: unknown;
  write?: boolean;
  issueNumber?: number;
  cli?: boolean;
}): string {
  const agent = getAgent(opts.laneId) ?? getAgent("implementation");
  const tools = agent?.tools.join(", ") ?? "none";
  const issueDir = String(Math.abs(opts.issueNumber ?? 0) || "<issue>");
  const artifactPath = opts.artifact
    ? `.factory/issues/${issueDir}/${artifactFileName(opts.artifact)}`
    : null;
  const finish = opts.write
    ? "Implement the task in this worktree, commit product files only (never .factory/), then stop."
    : artifactPath
      ? [
          `The ticket title and body are already in this prompt. Do not call Linear, GitHub, or factory tools (setTicketStatus, setRisk, finishLane, requestHumanReview, submitArtifact). They are not in this session.`,
          `Create directories if needed, write ONLY this JSON file, then stop: ${artifactPath}`,
          artifactShape(opts.artifact!),
          "Do not implement product code.",
        ].join("\n")
      : "Finish the lane task, then stop.";
  const role = [
    `# Worker role`,
    `You are the ${agent?.label ?? opts.laneId} agent for one Software Factory ticket.`,
    `Do this lane only. Do not spawn other agents. Do not approve, reject, merge, or dispatch other lanes.`,
    `This role supersedes any project AGENTS.md / CLAUDE.md identity while you are on this ticket.`,
    opts.cli
      ? "You only have this worktree. Read and write files here. Factory tools and issue-tracker APIs are unavailable."
      : `Allowed factory work: ${tools}.`,
  ].join("\n");
  const skill = `# Skill\n${resolveAgentSystem(opts.laneId, opts.skill)}${
    opts.cli && !opts.write
      ? "\n\nIgnore tool names in the skill. Finish by writing the JSON file in How to finish."
      : ""
  }`;
  const ticket = wrapUntrusted(
    "ticket",
    `${opts.ticketTitle}\n\n${opts.ticketBody}`.trim(),
  );
  const upstream = opts.context
    ? `# Upstream context\nPrevious lane: ${opts.context.fromLane}\n${opts.context.summary}\n${opts.context.bullets.map((b) => `- ${b}`).join("\n")}`
    : "";
  const current =
    opts.currentArtifact != null
      ? `# Current document (revise this)\n${JSON.stringify(opts.currentArtifact, null, 2)}`
      : "";
  return [
    role,
    skill,
    `# Ticket`,
    ticket,
    upstream,
    current,
    `# How to finish`,
    finish,
    `# Operator ask`,
    opts.userPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");
}

function artifactShape(kind: ArtifactKind): string {
  if (kind === "triage") {
    return `Schema:\n{"version":1,"classification":"simple"|"complex","risk":"low"|"medium"|"high","rationale":"why","affectedAreas":["path"],"fastTrack":false}`;
  }
  if (kind === "fr") {
    return `Schema: version 1, summary, actors[], requirements[{id:FR-n,statement,priority,acceptance[]}], visualPlan.`;
  }
  if (kind === "tech_spec") {
    return `Schema: version 1, summary, stack[], modules[], testing[], visualPlan.`;
  }
  if (kind === "task_graph") {
    return `Schema: version 1, tasks[{id:T-n,title,files[],dependsOn[],acceptance[]}].`;
  }
  if (kind === "review") {
    return `Schema: version 1, summary, verdict, findings[].`;
  }
  if (kind === "pr") {
    return `Schema: version 1, title, body.`;
  }
  return "";
}
