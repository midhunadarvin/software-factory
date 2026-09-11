import { describe, expect, it } from "vitest";
import { TaskGraphSchema, triageFastTrack } from "./schemas";

describe("TaskGraphSchema", () => {
  it("rejects cycles", () => {
    const r = TaskGraphSchema.safeParse({
      version: 1,
      tasks: [
        { id: "T-1", title: "a", dependsOn: ["T-2"], files: [], acceptance: ["x"], status: "pending" },
        { id: "T-2", title: "b", dependsOn: ["T-1"], files: [], acceptance: ["x"], status: "pending" },
      ],
    });
    expect(r.success).toBe(false);
  });

  it("fast-tracks only simple + low risk", () => {
    expect(triageFastTrack({ classification: "simple", risk: "low" })).toBe(true);
    expect(triageFastTrack({ classification: "simple", risk: "high" })).toBe(false);
    expect(triageFastTrack({ classification: "complex", risk: "low" })).toBe(false);
  });

  it("accepts a valid dag", () => {
    const r = TaskGraphSchema.safeParse({
      version: 1,
      tasks: [
        { id: "T-1", title: "a", dependsOn: [], files: [], acceptance: ["x"], status: "pending" },
        { id: "T-2", title: "b", dependsOn: ["T-1"], files: [], acceptance: ["x"], status: "pending" },
      ],
    });
    expect(r.success).toBe(true);
  });
});
