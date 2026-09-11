"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MdxPreview({ source, title }: { source: string; title: string }) {
  const [tab, setTab] = useState<"preview" | "source">("preview");
  const parts = splitMdx(source);
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <div className="flex w-fit gap-1 rounded-lg bg-muted p-1">
          {(["preview", "source"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium capitalize",
                tab === t ? "bg-card shadow-xs" : "text-muted-foreground",
              )}
            >
              {t === "source" ? "MDX source" : "Review"}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {tab === "source" ? (
          <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap font-mono text-xs leading-relaxed">
            {source}
          </pre>
        ) : (
          <article className="max-w-none space-y-4 text-sm leading-relaxed">
            {parts.map((p, i) =>
              p.type === "mermaid" ? (
                <MermaidBlock key={i} chart={p.body} />
              ) : p.type === "code" ? (
                <pre key={i} className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">
                  {p.body}
                </pre>
              ) : (
                <MarkdownBlock key={i} text={p.body} />
              ),
            )}
          </article>
        )}
      </CardContent>
    </Card>
  );
}

function splitMdx(source: string): { type: "md" | "mermaid" | "code"; body: string }[] {
  const parts: { type: "md" | "mermaid" | "code"; body: string }[] = [];
  const re = /```(\w+)?\n([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m.index > last) parts.push({ type: "md", body: source.slice(last, m.index) });
    parts.push({ type: m[1] === "mermaid" ? "mermaid" : "code", body: m[2] ?? "" });
    last = m.index + m[0].length;
  }
  if (last < source.length) parts.push({ type: "md", body: source.slice(last) });
  return parts.filter((p) => p.body.trim());
}

function MarkdownBlock({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/);
  return (
    <div className="space-y-3">
      {blocks.map((block, i) => {
        if (block.startsWith("# ")) return <h2 key={i} className="text-xl font-semibold">{block.slice(2)}</h2>;
        if (block.startsWith("## ")) return <h3 key={i} className="text-base font-semibold">{block.slice(3)}</h3>;
        if (block.startsWith("### ")) return <h4 key={i} className="text-sm font-semibold">{block.slice(4)}</h4>;
        if (block.includes("|")) {
          const rows = block.split("\n").filter((r) => r.includes("|") && !/^\s*\|?\s*-+/.test(r));
          if (rows.length >= 2) {
            const cells = rows.map((r) =>
              r
                .split("|")
                .map((c) => c.trim())
                .filter(Boolean),
            );
            return (
              <table key={i} className="w-full border-collapse text-xs">
                <thead>
                  <tr>
                    {cells[0]!.map((c) => (
                      <th key={c} className="border border-border bg-muted/50 px-2 py-1 text-left">
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cells.slice(1).map((row, ri) => (
                    <tr key={ri}>
                      {row.map((c, ci) => (
                        <td key={ci} className="border border-border px-2 py-1">
                          {c}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          }
        }
        if (block.split("\n").every((l) => l.trim().startsWith("- "))) {
          return (
            <ul key={i} className="list-disc space-y-1 pl-5">
              {block.split("\n").map((l, li) => (
                <li key={li}>{l.replace(/^\s*-\s+/, "").replace(/\*\*(.*?)\*\*/g, "$1")}</li>
              ))}
            </ul>
          );
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {block.replace(/\*\*(.*?)\*\*/g, "$1")}
          </p>
        );
      })}
    </div>
  );
}

function MermaidBlock({ chart }: { chart: string }) {
  const id = useId().replace(/:/g, "");
  const ref = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "neutral", securityLevel: "strict" });
        const { svg } = await mermaid.render(`mmd-${id}`, chart);
        if (!cancelled && ref.current) ref.current.innerHTML = svg;
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "mermaid failed");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chart, id]);
  if (err) {
    return <pre className="overflow-auto rounded-lg bg-muted p-3 font-mono text-xs">{chart}</pre>;
  }
  return <div ref={ref} className="overflow-auto rounded-lg border border-border bg-card p-3" />;
}
