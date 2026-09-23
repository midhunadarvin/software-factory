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
  artifact?: ArtifactKind;
  currentArtifact?: unknown;
  write?: boolean;
}): string {
  const agent = getAgent(opts.laneId) ?? getAgent("implementation");
  const tools = agent?.tools.join(", ") ?? "none";
  const finish =
    opts.write
      ? "Implement the task in this worktree, commit product files only (never .factory/), then stop."
      : opts.artifact
        ? `When done, write the typed JSON document to .factory/issues/<issue>/${artifactFileName(opts.artifact)} and stop. Do not implement product code.`
        : "Finish the lane task, then stop.";
  const role = [
    `# Worker role`,
    `You are the ${agent?.label ?? opts.laneId} agent for one Software Factory ticket.`,
    `Do this lane only. Do not spawn other agents. Do not approve, reject, merge, or dispatch other lanes.`,
    `This role supersedes any project AGENTS.md / CLAUDE.md identity while you are on this ticket.`,
    `Allowed factory work: ${tools}.`,
  ].join("\n");
  const skill = `# Skill\n${resolveAgentSystem(opts.laneId)}`;
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
