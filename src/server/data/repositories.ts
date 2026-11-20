import type { BaseCheckpointSaver } from "@langchain/langgraph";
import type {
  AgentEvent,
  Artifact,
  Job,
  JobPatch,
  NewArtifact,
  NewJob,
  NewProject,
  Project,
  ProjectPatch,
} from "./models";

export type ProjectRepo = {
  get(id: string): Promise<Project | undefined>;
  getByRootPath(rootPath: string): Promise<Project | undefined>;
  list(): Promise<Project[]>;
  insert(project: NewProject): Promise<void>;
  update(id: string, patch: ProjectPatch): Promise<void>;
  delete(id: string): Promise<void>;
};

export type JobListFilter = {
  projectId?: string;
  /** Include soft-deleted (archived) jobs. Default false. */
  includeArchived?: boolean;
};

export type JobRepo = {
  get(id: string): Promise<Job | undefined>;
  list(filter?: JobListFilter): Promise<Job[]>;
  findActiveByExternalKey(projectId: string, externalKey: string): Promise<Job | undefined>;
  findActiveByIssueNumber(projectId: string, issueNumber: number): Promise<Job | undefined>;
  insert(job: NewJob): Promise<void>;
  update(id: string, patch: JobPatch): Promise<void>;
  /** Compare-and-set on `state`. Returns false when the job is no longer in `expectedState`. */
  updateIfState(id: string, expectedState: string, patch: JobPatch): Promise<boolean>;
  /** Next free negative issue number for a local (non-tracker) ticket. */
  nextLocalIssueNumber(projectId: string): Promise<number>;
  releaseLocksHeldBy(owner: string): Promise<void>;
  listLockedBefore(cutoffIso: string): Promise<Job[]>;
  deleteByProject(projectId: string): Promise<void>;
};

export type ArtifactRepo = {
  latest(jobId: string, kind: string): Promise<Artifact | undefined>;
  /** Newest first. */
  listByJob(jobId: string): Promise<Artifact[]>;
  listByKind(kind: string): Promise<Artifact[]>;
  /** Insert the next version of `kind` for the job. */
  append(artifact: NewArtifact): Promise<Artifact>;
  insert(artifact: Artifact): Promise<void>;
  deleteKinds(jobId: string, kinds: string[]): Promise<void>;
};

export type EventRepo = {
  insert(event: AgentEvent): Promise<void>;
  /** Newest first. */
  listByJob(jobId: string, limit: number): Promise<AgentEvent[]>;
  /** Newest first. */
  recentForProject(projectId: string, limit: number): Promise<AgentEvent[]>;
  forProjectAfter(projectId: string, afterId: string): Promise<AgentEvent[]>;
};

/** Everything the factory persists. Drivers live in `data/drivers/<name>/`. */
export type DataStore = {
  readonly driver: string;
  readonly projects: ProjectRepo;
  readonly jobs: JobRepo;
  readonly artifacts: ArtifactRepo;
  readonly events: EventRepo;
  migrate(): Promise<void>;
  ping(): Promise<void>;
  /** LangGraph checkpoint store for pipeline threads. */
  checkpointer(): BaseCheckpointSaver;
  close(): void;
};
