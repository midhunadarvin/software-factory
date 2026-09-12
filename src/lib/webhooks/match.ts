import { intakeFromProject, type IntakeConfig } from "../intake/config";
import { labelsInclude, type IncomingIssue } from "./parse";

export type ProjectRow = {
  id: string;
  repoOwner: string | null;
  repoName: string | null;
  intake?: string | null;
};

export function matchProject(
  issue: IncomingIssue,
  rows: ProjectRow[],
): { project: ProjectRow; intake: IntakeConfig } | null {
  const candidates = rows
    .map((project) => ({ project, intake: intakeFromProject(project) }))
    .filter(({ intake }) => {
      if (issue.source === "github") return intake.github.enabled;
      if (issue.source === "linear") return intake.linear.enabled;
      return intake.jira.enabled;
    });

  if (issue.source === "github") {
    const owner = (issue.repoOwner ?? "").toLowerCase();
    const repo = (issue.repoName ?? "").toLowerCase();
    const hit = candidates.find(
      ({ project }) =>
        (project.repoOwner ?? "").toLowerCase() === owner &&
        (project.repoName ?? "").toLowerCase() === repo,
    );
    if (!hit) return null;
    if (!labelsInclude(issue.labels, hit.intake.github.label)) return null;
    return hit;
  }

  if (issue.source === "linear") {
    const withTeam = candidates.filter(
      ({ intake }) => intake.linear.teamId && intake.linear.teamId === issue.linearTeamId,
    );
    const hit = withTeam[0] ?? (candidates.length === 1 ? candidates[0] : null);
    if (!hit) return null;
    if (!labelsInclude(issue.labels, hit.intake.linear.label)) return null;
    return hit;
  }

  const key = (issue.jiraProjectKey ?? "").toUpperCase();
  const withKey = candidates.filter(
    ({ intake }) => intake.jira.projectKey && intake.jira.projectKey.toUpperCase() === key,
  );
  const hit = withKey[0] ?? (candidates.length === 1 ? candidates[0] : null);
  if (!hit) return null;
  if (!labelsInclude(issue.labels, hit.intake.jira.label)) return null;
  return hit;
}
