import { describe, expect, it } from "vitest";
import { parseStreamJsonLine } from "./stream-json";

describe("parseStreamJsonLine", () => {
  it("reads Claude assistant text and session id", () => {
    const { parts, sessionId } = parseStreamJsonLine(
      JSON.stringify({
        type: "assistant",
        session_id: "sess-1",
        message: { content: [{ type: "text", text: "hello" }] },
      }),
    );
    expect(sessionId).toBe("sess-1");
    expect(parts).toEqual([{ type: "text", delta: "hello" }]);
  });

  it("reads a tool_use line", () => {
    const { parts } = parseStreamJsonLine(JSON.stringify({ type: "tool_use", name: "Read" }));
    expect(parts).toEqual([{ type: "tool", delta: "", tool: "Read" }]);
  });

  it("passes through non-JSON as text", () => {
    const { parts } = parseStreamJsonLine("plain log line");
    expect(parts).toEqual([]);
  });
});
