import { describe, expect, it } from "vitest";
import { END } from "@langchain/langgraph";
import { routeFromStart } from "./graph";

describe("routeFromStart", () => {
  it("starts a new ticket at triage", () => {
    expect(routeFromStart({ stage: "" })).toBe("triage_draft");
    expect(routeFromStart({ stage: "triage_draft" })).toBe("triage_draft");
  });

  it("does not re-run triage after a handoff (Command.goto must not fan-out)", () => {
    expect(routeFromStart({ stage: "handoff" })).toBe(END);
    expect(routeFromStart({ stage: "done" })).toBe(END);
    expect(routeFromStart({ stage: "rejected" })).toBe(END);
  });

  it("honors an explicit dest stage so restart/continue land on that node", () => {
    expect(routeFromStart({ stage: "requirements_draft" })).toBe("requirements_draft");
    expect(routeFromStart({ stage: "tech_spec_gate" })).toBe("tech_spec_gate");
  });
});
