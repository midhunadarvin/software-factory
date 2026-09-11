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

export function specMdx(spec: TechnicalSpec): string {
  const stack = spec.stack.map((s) => `| ${s.name} | ${s.reason} |`).join("\n");
  const modules = spec.modules
    .map(
      (m) =>
        `## ${m.name}\n\n\`${m.path}\`\n\n${m.responsibility}\n\n${
          m.interfaces.length ? m.interfaces.map((i) => `- ${i}`).join("\n") : "- (no extra interfaces)"
        }`,
    )
    .join("\n\n");
  return `# Technical specification

${spec.summary}

## Stack

| Package | Why |
| --- | --- |
${stack}

${modules}

## Data changes

${spec.dataChanges.map((x) => `- ${x}`).join("\n") || "- (none)"}

## API changes

${spec.apiChanges.map((x) => `- ${x}`).join("\n") || "- (none)"}

## Risks

${spec.risks.map((r) => `- **${r.risk}** — ${r.mitigation}`).join("\n") || "- (none)"}

## Testing

${spec.testing.map((x) => `- ${x}`).join("\n")}

## Visual plan

${spec.visualPlan.outline.map((n) => `- **${n.id}** ${n.title}${n.notes ? ` — ${n.notes}` : ""}`).join("\n")}

\`\`\`mermaid
${spec.visualPlan.mermaid}
\`\`\`
`;
}

export function frMdx(fr: FunctionalRequirements): string {
  const reqs = fr.requirements
    .map(
      (r) =>
        `### ${r.id} · ${r.priority}\n\n${r.statement}\n\n${r.acceptance.map((a) => `- ${a}`).join("\n")}`,
    )
    .join("\n\n");
  return `# Functional requirements

${fr.summary}

## Actors

${fr.actors.map((a) => `- ${a}`).join("\n")}

## Requirements

${reqs}

## Out of scope

${fr.outOfScope.map((x) => `- ${x}`).join("\n") || "- (none)"}

## Open questions

${fr.openQuestions.map((x) => `- ${x}`).join("\n") || "- (none)"}

## Visual plan

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
  const rows = g.tasks
    .map((t) => {
      const acceptance = t.acceptance.map((a) => `- ${a}`).join("\n") || "- (none)";
      return `## ${t.id} · ${t.title}

Status: **${t.status}**

Depends on: ${t.dependsOn.join(", ") || "—"}

Files: ${t.files.map((f) => `\`${f}\``).join(", ") || "—"}

### Acceptance

${acceptance}`;
    })
    .join("\n\n");
  return `# Implementation tasks

${g.tasks.length} task${g.tasks.length === 1 ? "" : "s"} in the graph.

${rows}
`;
}

export function prMarkdown(title: string, body: string): string {
  return `# ${title}\n\n${body}\n`;
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
