export type Project = {
  id: string;
  name: string;
  rootPath: string;
  source: string;
  remoteKind: string;
  repoOwner: string | null;
  repoName: string | null;
  cloneUrl: string | null;
  defaultBranch: string;
  githubPatCiphertext: Buffer | null;
  githubPatIv: Buffer | null;
  githubPatTag: Buffer | null;
  pollEnabled: number;
  pipeline: string | null;
  intake: string | null;
  harness: string | null;
  createdAt: string;
  updatedAt: string;
};

type ProjectRequired = "id" | "name" | "rootPath" | "source" | "remoteKind" | "defaultBranch" | "createdAt" | "updatedAt";

export type NewProject = Pick<Project, ProjectRequired> & Partial<Omit<Project, ProjectRequired>>;

export type ProjectPatch = Partial<Omit<Project, "id" | "createdAt">>;
