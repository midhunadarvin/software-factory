import { claudePlugin } from "./claude";
import { codexPlugin } from "./codex";
import { cursorPlugin } from "./cursor";
import { inprocessPlugin } from "./inprocess";
import type { HarnessId, HarnessPlugin } from "./types";
import { HARNESS_IDS } from "./types";

const plugins = new Map<string, HarnessPlugin>();

export function registerHarness(plugin: HarnessPlugin): void {
  if (!(HARNESS_IDS as readonly string[]).includes(plugin.id)) {
    throw new Error(`invalid harness id: ${plugin.id}`);
  }
  plugins.set(plugin.id, plugin);
}

export function unregisterHarness(id: string): boolean {
  return plugins.delete(id);
}

export function getHarness(id: string): HarnessPlugin | undefined {
  return plugins.get(id);
}

export function listHarnesses(): HarnessPlugin[] {
  return [...plugins.values()];
}

export function requireHarness(id: HarnessId): HarnessPlugin {
  const plugin = getHarness(id);
  if (!plugin) throw new Error(`unknown harness: ${id}`);
  return plugin;
}

const builtins = [inprocessPlugin, claudePlugin, cursorPlugin, codexPlugin];

export function loadBuiltinHarnesses(): void {
  for (const plugin of builtins) {
    if (!plugins.has(plugin.id)) registerHarness(plugin);
  }
}

loadBuiltinHarnesses();
