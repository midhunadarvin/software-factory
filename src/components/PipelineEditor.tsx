"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ACTION_TYPES, type ActionType, type LaneConfig, type PipelineConfig } from "@/lib/runtime/pipeline/schema";

const ACTION_LABELS: Record<ActionType, string> = {
  produce: "Produce artifact",
  implement: "Implement tasks",
  fix: "Fix review findings",
  human_approval: "Ask for human approval",
  publish: "Publish pull request",
};

const ARTIFACTS = ["triage", "fr", "tech_spec", "task_graph", "review", "pr"] as const;

type EditorLane = LaneConfig;

function clonePipeline(p: PipelineConfig): PipelineConfig {
  return JSON.parse(JSON.stringify(p)) as PipelineConfig;
}

export function PipelineEditor({
  value,
  defaultPipeline,
  custom,
  saving,
  error,
  onSave,
  onReset,
}: {
  value: PipelineConfig;
  defaultPipeline: PipelineConfig;
  custom: boolean;
  saving?: boolean;
  error?: string;
  onSave: (pipeline: PipelineConfig) => void;
  onReset: () => void;
}) {
  const [draft, setDraft] = useState<PipelineConfig>(() => clonePipeline(value));
  const dirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(value), [draft, value]);

  const updateLane = (index: number, patch: Partial<EditorLane>) => {
    setDraft((prev) => {
      const lanes = prev.lanes.map((lane, i) => (i === index ? { ...lane, ...patch } : lane));
      return { ...prev, lanes };
    });
  };

  const moveLane = (index: number, dir: -1 | 1) => {
    setDraft((prev) => {
      const lanes = [...prev.lanes];
      const next = index + dir;
      if (next < 0 || next >= lanes.length) return prev;
      const [item] = lanes.splice(index, 1);
      lanes.splice(next, 0, item);
      return { ...prev, lanes };
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Lanes and actions</CardTitle>
        <CardDescription>
          Each lane is a board station. Actions run in order — for example Review can inspect the diff, apply
          fixes, then wait for approval. {custom ? "This project has a custom pipeline." : "Using the built-in default."}{" "}
          Pause running jobs before saving. Tickets already in flight should be restarted from a lane.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {draft.lanes.map((lane, i) => (
          <div key={`${lane.id}-${i}`} className="rounded-lg border border-border bg-muted/30 p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[8rem] flex-1 space-y-1">
                <Label>Lane id</Label>
                <Input value={lane.id} onChange={(e) => updateLane(i, { id: e.target.value })} />
              </div>
              <div className="min-w-[8rem] flex-1 space-y-1">
                <Label>Label</Label>
                <Input value={lane.label} onChange={(e) => updateLane(i, { label: e.target.value })} />
              </div>
              <div className="min-w-[8rem] flex-1 space-y-1">
                <Label>Board column</Label>
                <Input value={lane.column} onChange={(e) => updateLane(i, { column: e.target.value })} />
              </div>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => moveLane(i, -1)} disabled={i === 0}>
                  <ArrowUp />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveLane(i, 1)}
                  disabled={i === draft.lanes.length - 1}
                >
                  <ArrowDown />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    setDraft((prev) => ({ ...prev, lanes: prev.lanes.filter((_, idx) => idx !== i) }))
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            </div>
            <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 rounded border-input"
                checked={Boolean(lane.hidden)}
                onChange={(e) => updateLane(i, { hidden: e.target.checked })}
              />
              Hide from board (still runs)
            </label>
            <div className="mt-3 space-y-2">
              <p className="text-[11px] font-medium tracking-[0.14em] text-muted-foreground uppercase">Actions</p>
              {lane.actions.map((action, j) => (
                <div key={`${lane.id}-a-${j}`} className="flex flex-wrap items-center gap-2 rounded-md bg-card p-2">
                  <select
                    className="h-9 min-w-[10rem] flex-1 rounded-md border border-input bg-background px-2 text-sm"
                    value={action.type}
                    onChange={(e) => {
                      const type = e.target.value as ActionType;
                      updateLane(i, {
                        actions: lane.actions.map((a, idx) => (idx === j ? { ...a, type } : a)),
                      });
                    }}
                  >
                    {ACTION_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {ACTION_LABELS[t]}
                      </option>
                    ))}
                  </select>
                  {action.type === "produce" && (
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={action.artifact ?? "review"}
                      onChange={(e) =>
                        updateLane(i, {
                          actions: lane.actions.map((a, idx) =>
                            idx === j ? { ...a, artifact: e.target.value as (typeof ARTIFACTS)[number] } : a,
                          ),
                        })
                      }
                    >
                      {ARTIFACTS.map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  )}
                  {action.type === "human_approval" && (
                    <label className="flex items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded border-input"
                        checked={Boolean(action.allowSendBack)}
                        onChange={(e) =>
                          updateLane(i, {
                            actions: lane.actions.map((a, idx) =>
                              idx === j ? { ...a, allowSendBack: e.target.checked } : a,
                            ),
                          })
                        }
                      />
                      Send back
                    </label>
                  )}
                  {(action.type === "human_approval" || action.type === "fix") && (
                    <select
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                      value={action.skipIf ?? ""}
                      onChange={(e) =>
                        updateLane(i, {
                          actions: lane.actions.map((a, idx) =>
                            idx === j
                              ? { ...a, skipIf: (e.target.value || undefined) as LaneConfig["actions"][number]["skipIf"] }
                              : a,
                          ),
                        })
                      }
                    >
                      <option value="">Always run</option>
                      <option value="fast_track">Skip if fast-track</option>
                      <option value="review_approved">Skip if review approved</option>
                    </select>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      updateLane(i, { actions: lane.actions.filter((_, idx) => idx !== j) })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  updateLane(i, {
                    actions: [...lane.actions, { type: "human_approval" }],
                  })
                }
              >
                <Plus />
                Add action
              </Button>
            </div>
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setDraft((prev) => ({
              ...prev,
              lanes: [
                ...prev.lanes.filter((l) => l.kind !== "terminal"),
                {
                  id: `lane_${prev.lanes.length}`,
                  label: "New lane",
                  column: `lane_${prev.lanes.length}`,
                  actions: [{ type: "produce", artifact: "review" }],
                },
                ...prev.lanes.filter((l) => l.kind === "terminal"),
              ],
            }))
          }
        >
          <Plus />
          Add lane
        </Button>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty || saving} onClick={() => onSave(draft)}>
            {saving ? "Saving…" : "Save pipeline"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => {
              setDraft(clonePipeline(defaultPipeline));
              onReset();
            }}
          >
            <RotateCcw />
            Reset to default
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
