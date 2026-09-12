import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { jobs, projects } from "../../db/schema";
import { DEFAULT_PIPELINE } from "./default";
import { parsePipeline, resolvePipeline, type ResolvedPipeline } from "./resolve";
import type { PipelineConfig } from "./schema";

export function pipelineFromProject(row: { pipeline?: string | null } | null | undefined): PipelineConfig {
  if (!row?.pipeline) return DEFAULT_PIPELINE;
  try {
    return parsePipeline(row.pipeline);
  } catch {
    return DEFAULT_PIPELINE;
  }
}

export async function loadPipelineForProject(projectId: string): Promise<ResolvedPipeline> {
  const row = (await getDb().select().from(projects).where(eq(projects.id, projectId)).limit(1))[0];
  return resolvePipeline(pipelineFromProject(row));
}

export async function loadPipelineForJob(jobId: string): Promise<ResolvedPipeline> {
  const job = (await getDb().select().from(jobs).where(eq(jobs.id, jobId)).limit(1))[0];
  if (!job) return resolvePipeline(DEFAULT_PIPELINE);
  return loadPipelineForProject(job.projectId);
}
