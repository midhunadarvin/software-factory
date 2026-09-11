import { runGit } from "./exec";

const DEFAULT_NAMES = new Set(["main", "master", "develop", "dev", "trunk"]);
const FEATURE_PREFIX =
  /^(factory|feat|feature|fix|bugfix|chore|hotfix|refactor|docs|release)\//;

export function normalizeBranch(name: string): string {
  return name.replace(/^refs\/heads\//, "").trim();
}

export function isDefaultBranch(name: string, defaultBranch: string): boolean {
  const n = normalizeBranch(name);
  if (!n || n === "HEAD") return true;
  if (n === normalizeBranch(defaultBranch)) return true;
  return DEFAULT_NAMES.has(n);
}

export function isFeatureBranch(name: string, defaultBranch: string): boolean {
  const n = normalizeBranch(name);
  if (isDefaultBranch(n, defaultBranch)) return false;
  return FEATURE_PREFIX.test(n);
}

export async function currentBranch(cwd: string): Promise<string> {
  const r = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], { cwd });
  return normalizeBranch(r.stdout) || "HEAD";
}

export function isFactoryArtifactPath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").replace(/^\.\//, "");
  return n === ".factory" || n.startsWith(".factory/");
}

export function porcelainPath(line: string): string {
  const rest = line.length >= 3 ? line.slice(3) : line;
  const unquoted = rest.replace(/^"|"$/g, "");
  const parts = unquoted.split(" -> ");
  return (parts[parts.length - 1] ?? unquoted).trim();
}

/** Status lines for product files only — factory planning docs stay local. */
export async function productStatus(cwd: string): Promise<string> {
  const dirty = await runGit(["status", "--porcelain"], { cwd });
  return dirty.stdout
    .split("\n")
    .filter((line) => line.trim() && !isFactoryArtifactPath(porcelainPath(line)))
    .join("\n");
}

/** Stage and commit product files. Never include `.factory/` plans, specs, or review notes. */
export async function commitProductChanges(cwd: string, message: string): Promise<boolean> {
  await runGit(["add", "-A", "--", ".", ":!.factory", ":!.factory/**"], { cwd });
  await runGit(["rm", "-r", "-f", "--cached", "--ignore-unmatch", "--", ".factory"], { cwd });
  const cached = await runGit(["diff", "--cached", "--name-only"], { cwd });
  if (!cached.stdout.trim()) return false;
  const r = await runGit(
    ["-c", "user.email=factory@local", "-c", "user.name=Software Factory", "commit", "-m", message],
    { cwd },
  );
  return r.code === 0;
}

export async function commitAll(cwd: string, message: string): Promise<boolean> {
  return commitProductChanges(cwd, message);
}

/** Stay on a feature branch; if HEAD is the default (or detached), create/checkout `preferred`. */
export async function ensureFeatureBranch(opts: {
  cwd: string;
  defaultBranch: string;
  preferred: string;
}): Promise<{ branch: string; created: boolean; previous: string }> {
  const previous = await currentBranch(opts.cwd);
  if (isFeatureBranch(previous, opts.defaultBranch)) {
    return { branch: previous, created: false, previous };
  }
  const name = opts.preferred.replace(/[^\w./-]+/g, "-").replace(/^-+|-+$/g, "") || "factory/job";
  const exists = await runGit(["show-ref", "--verify", "--quiet", `refs/heads/${name}`], {
    cwd: opts.cwd,
  });
  if (exists.code === 0) {
    const co = await runGit(["checkout", name], { cwd: opts.cwd });
    if (co.code !== 0) throw new Error(co.stderr || `checkout ${name} failed`);
    return { branch: name, created: false, previous };
  }
  const created = await runGit(["checkout", "-b", name], { cwd: opts.cwd });
  if (created.code !== 0) throw new Error(created.stderr || `create branch ${name} failed`);
  return { branch: name, created: true, previous };
}
