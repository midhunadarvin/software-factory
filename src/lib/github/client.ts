export type GhIssue = {
  number: number;
  title: string;
  body: string;
  html_url: string;
  pull_request?: unknown;
  labels: { name: string }[];
};

async function gh(
  pat: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; json: unknown; text: string }> {
  const res = await fetch(`https://api.github.com${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${pat}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "software-factory",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

export async function listUserRepos(pat: string) {
  const { status, json } = await gh(pat, "GET", "/user/repos?per_page=100&sort=updated");
  if (status >= 400) throw new Error(`GitHub list repos failed: ${status}`);
  return (json as { full_name: string; clone_url: string; private: boolean }[]) ?? [];
}

export async function getRepo(pat: string, owner: string, repo: string) {
  return gh(pat, "GET", `/repos/${owner}/${repo}`);
}

export async function ensureLabels(pat: string, owner: string, repo: string) {
  for (const name of ["factory", "factory:claimed"]) {
    const r = await gh(pat, "POST", `/repos/${owner}/${repo}/labels`, {
      name,
      color: name === "factory" ? "0e8a16" : "fbca04",
    });
    if (r.status !== 201 && r.status !== 422) {
      throw new Error(`ensure label ${name} failed: ${r.status}`);
    }
  }
}

export async function searchFactoryIssues(pat: string, owner: string, repo: string) {
  const q = encodeURIComponent(
    `repo:${owner}/${repo} is:issue is:open label:factory -label:factory:claimed`,
  );
  const r = await gh(pat, "GET", `/search/issues?q=${q}`);
  if (r.status === 403 || r.status === 422) return { fallback: true as const, items: [] as GhIssue[] };
  if (r.status >= 400) throw new Error(`search issues failed: ${r.status}`);
  const items = ((r.json as { items?: GhIssue[] })?.items ?? []).filter((i) => !i.pull_request);
  return { fallback: false as const, items };
}

export async function listOpenFactoryIssues(pat: string, owner: string, repo: string) {
  const items: GhIssue[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await gh(
      pat,
      "GET",
      `/repos/${owner}/${repo}/issues?labels=factory&state=open&per_page=50&page=${page}`,
    );
    if (r.status >= 400) break;
    const batch = (r.json as GhIssue[]) ?? [];
    if (batch.length === 0) break;
    for (const i of batch) {
      if (i.pull_request) continue;
      if (i.labels.some((l) => l.name === "factory:claimed")) continue;
      items.push(i);
    }
  }
  return items;
}

export async function addClaimedLabel(
  pat: string,
  owner: string,
  repo: string,
  issueNumber: number,
) {
  return gh(pat, "POST", `/repos/${owner}/${repo}/issues/${issueNumber}/labels`, {
    labels: ["factory:claimed"],
  });
}

export async function createPullRequest(
  pat: string,
  owner: string,
  repo: string,
  input: { title: string; body: string; head: string; base: string },
) {
  return gh(pat, "POST", `/repos/${owner}/${repo}/pulls`, input);
}

export async function findPullRequest(
  pat: string,
  owner: string,
  repo: string,
  head: string,
) {
  const r = await gh(pat, "GET", `/repos/${owner}/${repo}/pulls?head=${owner}:${head}&state=open`);
  const list = (r.json as { html_url: string; number: number }[]) ?? [];
  return list[0] ?? null;
}

export async function getIssue(
  pat: string,
  owner: string,
  repo: string,
  number: number,
) {
  return gh(pat, "GET", `/repos/${owner}/${repo}/issues/${number}`);
}

export async function listIssueComments(
  pat: string,
  owner: string,
  repo: string,
  number: number,
) {
  return gh(pat, "GET", `/repos/${owner}/${repo}/issues/${number}/comments?per_page=30`);
}

export function parseRepoUrl(input: string): { owner: string; repo: string; cloneUrl: string } {
  const trimmed = input.trim().replace(/\.git$/, "");
  const short = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (short) {
    return {
      owner: short[1],
      repo: short[2],
      cloneUrl: `https://github.com/${short[1]}/${short[2]}.git`,
    };
  }
  const m = trimmed.match(/github\.com[/:]([^/]+)\/([^/]+)/i);
  if (!m) throw new Error("could not parse GitHub repo URL or owner/repo");
  return {
    owner: m[1],
    repo: m[2],
    cloneUrl: `https://github.com/${m[1]}/${m[2]}.git`,
  };
}
