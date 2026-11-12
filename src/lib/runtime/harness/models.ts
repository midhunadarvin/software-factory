import { loadTicket, laneForJobState, nextLane } from "../ticket";
import { listAvailableModels } from "../llm";
import type { LlmModelInfo, PublicLlmProvider } from "../../llm/types";
import { catalogForHarness } from "./resolve-model";
import { resolveJobHarness } from "./run";
import { requireHarness } from "./registry";
import type { HarnessId } from "./types";

export type JobModelCatalog = {
  provider: PublicLlmProvider | null;
  harness: HarnessId;
  models: LlmModelInfo[];
  defaultModel: string;
};

const listCache = new Map<string, { at: number; catalog: JobModelCatalog }>();

export function clearHarnessModelCache() {
  listCache.clear();
}

export async function listModelsForJob(jobId: string): Promise<JobModelCatalog> {
  const job = await loadTicket(jobId);
  if (!job) return withHarness("inprocess", await listAvailableModels());
  const current = laneForJobState(job.state);
  const laneId =
    !current || current.key === "intake"
      ? current?.next ?? nextLane(job.state)?.key ?? "triage"
      : current.key;
  const harnessId = await resolveJobHarness(job.projectId, laneId);
  if (harnessId === "inprocess") {
    return withHarness("inprocess", await listAvailableModels());
  }
  const cached = listCache.get(harnessId);
  if (cached && Date.now() - cached.at < 60_000) return cached.catalog;
  const plugin = requireHarness(harnessId);
  const listed = await catalogForHarness(harnessId);
  const models: LlmModelInfo[] = listed.models.map((m) => ({
    id: m.id,
    name: m.name,
    style: "chat",
  }));
  if (!models.length) {
    return {
      harness: harnessId,
      provider: {
        id: plugin.id,
        label: plugin.label,
        description: plugin.description,
        defaultBaseUrl: "",
      },
      models: [],
      defaultModel: listed.defaultModel ?? "",
    };
  }
  const defaultModel = listed.defaultModel && models.some((m) => m.id === listed.defaultModel)
    ? listed.defaultModel
    : models[0].id;
  const catalog: JobModelCatalog = {
    harness: harnessId,
    provider: {
      id: plugin.id,
      label: plugin.label,
      description: plugin.description,
      defaultBaseUrl: "",
    },
    models,
    defaultModel,
  };
  listCache.set(harnessId, { at: Date.now(), catalog });
  return catalog;
}

function withHarness(
  harness: HarnessId,
  listed: Awaited<ReturnType<typeof listAvailableModels>>,
): JobModelCatalog {
  return { harness, ...listed };
}
