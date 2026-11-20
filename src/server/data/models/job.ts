export type Job = {
  id: string;
  projectId: string;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueUrl: string;
  state: string;
  lastActiveState: string;
  boardColumn: string;
  branch: string | null;
  worktreePath: string | null;
  prUrl: string | null;
  prNumber: number | null;
  rejectNote: string | null;
  error: string | null;
  pendingArtifact: string | null;
  invokeGeneration: number;
  lockedAt: string | null;
  lockedBy: string | null;
  tokensUsed: number;
  model: string | null;
  source: string;
  externalKey: string | null;
  implStartedAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type JobRequired =
  | "id"
  | "projectId"
  | "issueNumber"
  | "issueTitle"
  | "state"
  | "lastActiveState"
  | "boardColumn"
  | "createdAt"
  | "updatedAt";

export type NewJob = Pick<Job, JobRequired> & Partial<Omit<Job, JobRequired>>;

export type JobPatch = Partial<Omit<Job, "id" | "projectId" | "createdAt">>;
