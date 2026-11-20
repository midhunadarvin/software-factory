export type Artifact = {
  id: string;
  jobId: string;
  kind: string;
  version: number;
  source: string;
  /** JSON-encoded artifact body. */
  body: string;
  createdAt: string;
};

export type NewArtifact = Pick<Artifact, "jobId" | "kind" | "source" | "body">;
