import { BUILTIN_AGENTS } from "./catalog";
import { UNTRUSTED_INSTRUCTION } from "./untrusted";
import type { AgentDefinition } from "./types";

const agents = new Map<string, AgentDefinition>();

export function registerAgent(agent: AgentDefinition): void {
  if (!agent.id || !/^[a-z][a-z0-9_]*$/.test(agent.id)) {
    throw new Error(`invalid agent id: ${agent.id}`);
  }
  agents.set(agent.id, agent);
}

export function unregisterAgent(id: string): boolean {
  return agents.delete(id);
}

export function getAgent(id: string): AgentDefinition | undefined {
  return agents.get(id);
}

export function listAgents(): AgentDefinition[] {
  return [...agents.values()];
}

export function loadBuiltinAgents(): void {
  for (const agent of BUILTIN_AGENTS) {
    if (!agents.has(agent.id)) registerAgent(agent);
  }
}

export function skillFor(id: string, override?: string): string {
  if (override?.trim()) return override.trim();
  return getAgent(id)?.skill ?? getAgent("implementation")?.skill ?? "";
}

export function resolveAgentSystem(id: string, overrideSkill?: string): string {
  const agent = getAgent(id) ?? getAgent("implementation");
  const skill = overrideSkill?.trim() || agent?.skill || "";
  const hint = agent?.exitHint ?? "";
  return [skill, UNTRUSTED_INSTRUCTION, hint].filter(Boolean).join("\n\n");
}

export function agentMaxSteps(id: string): number {
  return getAgent(id)?.maxSteps ?? 20;
}

loadBuiltinAgents();
