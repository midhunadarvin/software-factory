import { llmModel } from "../../env";
import { requireHarness } from "./registry";
import type { HarnessId, HarnessModelList } from "./types";

export async function catalogForHarness(harnessId: HarnessId): Promise<HarnessModelList> {
  if (harnessId === "inprocess") {
    return { models: [{ id: llmModel(), name: llmModel() }], defaultModel: llmModel() };
  }
  const listed = (await requireHarness(harnessId).listModels?.()) ?? { models: [] };
  if (listed.models.length) return listed;
  return { models: [], defaultModel: undefined };
}

/**
 * Model id this harness will actually run. CLI catalogs never fall back to the
 * in-process LLM default (e.g. glm-5.3-flash), which Claude/Cursor reject.
 */
export async function resolveLaneModel(
  harnessId: HarnessId,
  stored: string | null | undefined,
): Promise<string | undefined> {
  const wanted = stored?.trim() || undefined;
  if (harnessId === "inprocess") return wanted ?? llmModel();
  const listed = await catalogForHarness(harnessId);
  const ids = new Set(listed.models.map((m) => m.id));
  if (wanted && ids.has(wanted)) return wanted;
  if (listed.defaultModel && (!ids.size || ids.has(listed.defaultModel))) return listed.defaultModel;
  return listed.models[0]?.id;
}
