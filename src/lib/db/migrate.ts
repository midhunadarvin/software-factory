import { getSqlite } from "./client";

const DDL = `
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  root_path text NOT NULL,
  source text NOT NULL,
  remote_kind text NOT NULL,
  repo_owner text,
  repo_name text,
  clone_url text,
  default_branch text NOT NULL,
  github_pat_ciphertext blob,
  github_pat_iv blob,
  github_pat_tag blob,
  poll_enabled integer NOT NULL DEFAULT 0,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_root_path_uq ON projects(root_path);

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  issue_number integer NOT NULL,
  issue_title text NOT NULL,
  issue_body text NOT NULL DEFAULT '',
  issue_url text NOT NULL DEFAULT '',
  state text NOT NULL,
  last_active_state text NOT NULL,
  board_column text NOT NULL,
  branch text,
  worktree_path text,
  pr_url text,
  pr_number integer,
  reject_note text,
  error text,
  pending_artifact text,
  invoke_generation integer NOT NULL DEFAULT 0,
  locked_at text,
  locked_by text,
  tokens_used integer NOT NULL DEFAULT 0,
  impl_started_at text,
  archived_at text,
  created_at text NOT NULL,
  updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_gh_issue_uq ON jobs(project_id, issue_number)
  WHERE archived_at IS NULL AND issue_number > 0;
CREATE UNIQUE INDEX IF NOT EXISTS jobs_local_issue_uq ON jobs(project_id, issue_number)
  WHERE archived_at IS NULL AND issue_number < 0;
CREATE INDEX IF NOT EXISTS jobs_project_state_idx ON jobs(project_id, state);
CREATE INDEX IF NOT EXISTS jobs_project_issue_idx ON jobs(project_id, issue_number);
CREATE INDEX IF NOT EXISTS jobs_project_col_idx ON jobs(project_id, board_column);

CREATE TABLE IF NOT EXISTS artifacts (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id),
  kind text NOT NULL,
  version integer NOT NULL,
  source text NOT NULL,
  body text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS artifacts_job_kind_ver_idx ON artifacts(job_id, kind, version);

CREATE TABLE IF NOT EXISTS agent_events (
  id text PRIMARY KEY,
  job_id text,
  project_id text NOT NULL,
  level text NOT NULL,
  event text NOT NULL,
  payload text NOT NULL,
  created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS agent_events_job_created_idx ON agent_events(job_id, created_at);
CREATE INDEX IF NOT EXISTS agent_events_project_created_idx ON agent_events(project_id, created_at);
`;

export function migrate(): void {
  const sqlite = getSqlite();
  sqlite.exec(DDL);
  try {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN model text");
  } catch {
    /* already present */
  }
  try {
    sqlite.exec("ALTER TABLE projects ADD COLUMN pipeline text");
  } catch {
    /* already present */
  }
  try {
    sqlite.exec("ALTER TABLE projects ADD COLUMN intake text");
  } catch {
    /* already present */
  }
  try {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN source text NOT NULL DEFAULT 'local'");
  } catch {
    /* already present */
  }
  try {
    sqlite.exec("ALTER TABLE jobs ADD COLUMN external_key text");
  } catch {
    /* already present */
  }
  try {
    sqlite.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS jobs_external_key_uq ON jobs(project_id, external_key) WHERE archived_at IS NULL AND external_key IS NOT NULL",
    );
  } catch {
    /* already present */
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  console.log("migrated var/factory.sqlite");
}
