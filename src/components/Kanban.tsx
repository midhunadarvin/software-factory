"use client";

import { useRouter } from "next/navigation";

const LANES = [
  { id: "requirements", label: "Requirements" },
  { id: "tech_spec", label: "Tech spec" },
  { id: "tasks", label: "Tasks" },
  { id: "implementation", label: "Implementation" },
  { id: "review", label: "Review" },
  { id: "pull_request", label: "PR" },
] as const;

export type Card = {
  id: string;
  title: string;
  column: string;
  badge: string | null;
  local: boolean;
  issueUrl: string;
  tokensUsed: number;
  prUrl: string | null;
};

export function Kanban({
  projectId,
  cards,
}: {
  projectId: string;
  cards: Card[];
}) {
  const router = useRouter();
  return (
    <div className="board">
      {LANES.map((lane) => (
        <div key={lane.id} className="lane">
          <h3>{lane.label}</h3>
          {cards
            .filter((c) => c.column === lane.id)
            .map((c) => (
              <div
                key={c.id}
                className="card job"
                onClick={() => router.push(`/board/${c.id}?project=${projectId}`)}
              >
                <div>{c.title}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  {c.local && <span className="badge local">Local</span>}
                  {c.badge && <span className={`badge ${c.badge}`}>{c.badge}</span>}
                  {c.prUrl && <span className="badge">PR</span>}
                </div>
                {c.tokensUsed > 0 && <div className="muted">{c.tokensUsed} tokens</div>}
              </div>
            ))}
        </div>
      ))}
    </div>
  );
}
