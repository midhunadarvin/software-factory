import type {
  FunctionalRequirements,
  ReviewReport,
  TaskGraph,
  TechnicalSpec,
} from "./schemas";

export function frMarkdown(fr: FunctionalRequirements): string {
  const reqs = fr.requirements
    .map(
      (r) =>
        `### ${r.id}\n\nPriority: ${r.priority}\n\n${r.statement}\n\n${r.acceptance.map((a) => `- ${a}`).join("\n")}`,
    )
    .join("\n\n");
  return `# ${fr.summary}

## Actors

${fr.actors.map((a) => `- ${a}`).join("\n")}

${reqs}

## Out of scope

${fr.outOfScope.map((x) => `- ${x}`).join("\n") || "- (none)"}

## Open questions

${fr.openQuestions.map((x) => `- ${x}`).join("\n") || "- (none)"}

\`\`\`mermaid
${fr.visualPlan.mermaid}
\`\`\`
`;
}

export function specMarkdown(spec: TechnicalSpec): string {
  const stack = spec.stack
    .map((s) => `| ${s.name} | ${s.reason} |`)
    .join("\n");
  const modules = spec.modules
    .map(
      (m) =>
        `## ${m.name}\n\nPath: \`${m.path}\`\n\n${m.responsibility}\n\n${m.interfaces.map((i) => `- ${i}`).join("\n")}`,
    )
    .join("\n\n");
  return `# ${spec.summary}

| Stack | Reason |
|---|---|
${stack}

${modules}

## Data changes

${spec.dataChanges.map((x) => `- ${x}`).join("\n") || "- (none)"}

## API changes

${spec.apiChanges.map((x) => `- ${x}`).join("\n") || "- (none)"}

## Risks

${spec.risks.map((r) => `- ${r.risk}: ${r.mitigation}`).join("\n") || "- (none)"}

## Testing

${spec.testing.map((x) => `- ${x}`).join("\n")}

\`\`\`mermaid
${spec.visualPlan.mermaid}
\`\`\`
`;
}

export function tasksMarkdown(g: TaskGraph): string {
  return g.tasks
    .map(
      (t, i) =>
        `${i + 1}. **${t.id} ${t.title}** (${t.status})\n   - depends: ${t.dependsOn.join(", ") || "—"}\n   - files: ${t.files.join(", ") || "—"}\n   - ${t.acceptance.join("; ")}`,
    )
    .join("\n");
}

export function reviewMarkdown(r: ReviewReport): string {
  const byFile = new Map<string, typeof r.findings>();
  for (const f of r.findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }
  const sections = [...byFile.entries()]
    .map(
      ([file, findings]) =>
        `## ${file}\n\n${findings.map((f) => `- **${f.severity}** ${f.title}: ${f.body}`).join("\n")}`,
    )
    .join("\n\n");
  return `# Review: ${r.verdict}\n\n${r.summary}\n\n${sections}`;
}
