import { intakeFromProject, pluginSettings, type IntakeConfig } from "../intake/config";
import { labelsInclude } from "./labels";
import { getIntegration } from "./registry";
import type { IncomingIssue, ProjectRow } from "./types";

export function matchProject(
  issue: IncomingIssue,
  rows: ProjectRow[],
): { project: ProjectRow; intake: IntakeConfig } | null {
  const plugin = getIntegration(issue.source);
  if (!plugin) return null;
  const enabled = rows
    .map((project) => {
      const intake = intakeFromProject(project);
      return { project, intake, settings: pluginSettings(intake, plugin.id) };
    })
    .filter(({ settings }) => Boolean(settings.enabled));
  const exact = enabled.filter(({ project, settings }) => plugin.match(issue, project, settings));
  const picked = exact[0] ?? (plugin.fallbackToSingle && enabled.length === 1 ? enabled[0] : undefined);
  if (!picked) return null;
  const label = String(picked.settings.label ?? "");
  if (!labelsInclude(issue.labels, label)) return null;
  return { project: picked.project, intake: picked.intake };
}
