import type { ZodTypeAny } from "zod";
import type { ArtifactKind } from "../../artifacts/schemas";
import type { LaneContext } from "../context";

export const HARNESS_IDS = ["inprocess", "claude", "cursor", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export type HarnessDetect = { ok: true; binary?: string } | { ok: false; error: string };

export type LaneRunRequest = {
  jobId: string;
  projectId: string;
  laneId: string;
  cwd: string | null;
  brief: string;
  userPrompt: string;
  skill?: string;
  model?: string;
  context: LaneContext | null;
  steer?: boolean;
  resumeSessionId?: string;
  artifact?: ArtifactKind;
  schema?: ZodTypeAny;
  write?: boolean;
};

export type HarnessModel = { id: string; name?: string };

export type HarnessModelList = {
  models: HarnessModel[];
  defaultModel?: string;
};

export type HarnessResult = {
  artifact?: unknown;
  text: string;
  code: number;
  sessionId?: string;
};

export type HarnessSession = {
  id: string;
  pid?: number;
  send: (text: string) => Promise<void>;
  stop: () => Promise<void>;
  result: Promise<HarnessResult>;
};

export type HarnessPlugin = {
  id: HarnessId;
  label: string;
  description: string;
  detect: () => Promise<HarnessDetect>;
  listModels?: () => Promise<HarnessModelList>;
  start: (req: LaneRunRequest) => Promise<HarnessSession>;
};

export type HarnessConfig = {
  default: HarnessId;
  byLane: Partial<Record<string, HarnessId>>;
};
