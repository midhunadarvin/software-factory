import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
  blob,
} from "drizzle-orm/sqlite-core";

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    rootPath: text("root_path").notNull(),
    source: text("source").notNull(),
    remoteKind: text("remote_kind").notNull(),
    repoOwner: text("repo_owner"),
    repoName: text("repo_name"),
    cloneUrl: text("clone_url"),
    defaultBranch: text("default_branch").notNull(),
    githubPatCiphertext: blob("github_pat_ciphertext", { mode: "buffer" }),
    githubPatIv: blob("github_pat_iv", { mode: "buffer" }),
    githubPatTag: blob("github_pat_tag", { mode: "buffer" }),
    pollEnabled: integer("poll_enabled").notNull().default(0),
    pipeline: text("pipeline"),
    intake: text("intake"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [uniqueIndex("projects_root_path_uq").on(t.rootPath)],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id),
    issueNumber: integer("issue_number").notNull(),
    issueTitle: text("issue_title").notNull(),
    issueBody: text("issue_body").notNull().default(""),
    issueUrl: text("issue_url").notNull().default(""),
    state: text("state").notNull(),
    lastActiveState: text("last_active_state").notNull(),
    boardColumn: text("board_column").notNull(),
    branch: text("branch"),
    worktreePath: text("worktree_path"),
    prUrl: text("pr_url"),
    prNumber: integer("pr_number"),
    rejectNote: text("reject_note"),
    error: text("error"),
    pendingArtifact: text("pending_artifact"),
    invokeGeneration: integer("invoke_generation").notNull().default(0),
    lockedAt: text("locked_at"),
    lockedBy: text("locked_by"),
    tokensUsed: integer("tokens_used").notNull().default(0),
    model: text("model"),
    source: text("source").notNull().default("local"),
    externalKey: text("external_key"),
    implStartedAt: text("impl_started_at"),
    archivedAt: text("archived_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (t) => [
    uniqueIndex("jobs_gh_issue_uq")
      .on(t.projectId, t.issueNumber)
      .where(sql`archived_at IS NULL AND issue_number > 0`),
    uniqueIndex("jobs_local_issue_uq")
      .on(t.projectId, t.issueNumber)
      .where(sql`archived_at IS NULL AND issue_number < 0`),
    index("jobs_project_state_idx").on(t.projectId, t.state),
    index("jobs_project_issue_idx").on(t.projectId, t.issueNumber),
    index("jobs_project_col_idx").on(t.projectId, t.boardColumn),
    uniqueIndex("jobs_external_key_uq")
      .on(t.projectId, t.externalKey)
      .where(sql`archived_at IS NULL AND external_key IS NOT NULL`),
  ],
);

export const artifacts = sqliteTable(
  "artifacts",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id")
      .notNull()
      .references(() => jobs.id),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    source: text("source").notNull(),
    body: text("body").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("artifacts_job_kind_ver_idx").on(t.jobId, t.kind, t.version)],
);

export const agentEvents = sqliteTable(
  "agent_events",
  {
    id: text("id").primaryKey(),
    jobId: text("job_id"),
    projectId: text("project_id").notNull(),
    level: text("level").notNull(),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("agent_events_job_created_idx").on(t.jobId, t.createdAt),
    index("agent_events_project_created_idx").on(t.projectId, t.createdAt),
  ],
);
