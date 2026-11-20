import { githubPlugin } from "./plugins/github";
import { jiraPlugin } from "./plugins/jira";
import { linearPlugin } from "./plugins/linear";
import type { IntegrationPlugin, PublicIntegration } from "./types";

const plugins = new Map<string, IntegrationPlugin>();

/** Register an intake integration. Built-ins load below; add more from app startup. */
export function registerIntegration(plugin: IntegrationPlugin): void {
  if (!plugin.id || !/^[a-z][a-z0-9_]*$/.test(plugin.id)) {
    throw new Error(`invalid integration id: ${plugin.id}`);
  }
  plugins.set(plugin.id, plugin);
}

export function unregisterIntegration(id: string): boolean {
  return plugins.delete(id);
}

export function getIntegration(id: string): IntegrationPlugin | undefined {
  return plugins.get(id);
}

export function listIntegrations(): IntegrationPlugin[] {
  return [...plugins.values()];
}

export function publicIntegrations(): PublicIntegration[] {
  return listIntegrations().map((p) => ({
    id: p.id,
    label: p.label,
    description: p.description,
    secretEnv: p.secretEnv,
    settingsFields: p.settingsFields,
    webhookPath: p.id,
  }));
}

export function webhookSecrets(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of listIntegrations()) out[p.id] = process.env[p.secretEnv] ?? "";
  return out;
}

const builtins = [githubPlugin, linearPlugin, jiraPlugin];

export function loadBuiltinIntegrations(): void {
  for (const plugin of builtins) {
    if (!plugins.has(plugin.id)) registerIntegration(plugin);
  }
}

loadBuiltinIntegrations();
