import { agentForArtifact, skillFor } from "@software-factory/agent-sdk";
import type { ActionConfig } from "./schema";

export function catalogAgentIdForAction(laneId: string, action: Pick<ActionConfig, "type" | "artifact">): string {
  if (action.type === "implement") return "implementation";
  if (action.type === "fix") return "fix";
  if (action.type === "produce" && action.artifact) {
    return agentForArtifact(action.artifact)?.id ?? laneId;
  }
  return laneId;
}

export function defaultSkillForAction(laneId: string, action: Pick<ActionConfig, "type" | "artifact">): string {
  return skillFor(catalogAgentIdForAction(laneId, action));
}

export function storedSkillForAction(
  laneId: string,
  action: Pick<ActionConfig, "type" | "artifact" | "skill">,
  text: string,
): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return trimmed === defaultSkillForAction(laneId, action).trim() ? undefined : trimmed;
}
